#!/usr/bin/env node

/**
 * Gitea MCP Connector
 *
 * A connector that bridges Claude Code to Gitea/GitHub repositories via the
 * Model Context Protocol (MCP). It auto-detects the git remote and provides
 * repository listing, issue management, and PR creation capabilities.
 *
 * Uses curl for HTTP requests to work reliably with enterprise proxy setups.
 *
 * Usage:
 *   - As MCP server:  node src/connector.js
 *   - Env vars:       GITEA_API_URL, GITEA_TOKEN (or auto-detect from git remote)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "child_process";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

/**
 * Detect the API base URL and owner from the git remote.
 */
function detectGitConfig() {
  try {
    const remoteUrl = execSync("git remote get-url origin", {
      encoding: "utf-8",
      cwd: path.join(__dirname, ".."),
    }).trim();

    const match = remoteUrl.match(/[/:]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (match) {
      return { owner: match[1], repo: match[2], remoteUrl };
    }
  } catch {
    // git not available or no remote configured
  }
  return null;
}

/**
 * Determine the API config based on environment or git remote.
 */
function getApiConfig() {
  const apiUrl = process.env.GITEA_API_URL || "https://api.github.com";
  const token = process.env.GITEA_TOKEN || process.env.GITHUB_TOKEN || "";
  const gitConfig = detectGitConfig();
  const isGitHub =
    apiUrl.includes("github.com") ||
    (gitConfig?.remoteUrl?.includes("github.com") ?? false);

  return {
    apiUrl,
    token,
    isGitHub,
    owner: gitConfig?.owner || process.env.GITEA_OWNER || "",
    repo: gitConfig?.repo || process.env.GITEA_REPO || "",
  };
}

/**
 * Make an HTTP request using curl (works reliably with proxy setups).
 */
function curlRequest(method, url, data = null, token = "", isGitHub = false) {
  const args = ["curl", "-s", "-X", method, "--max-time", "30"];
  args.push("-H", "Accept: application/json");
  args.push("-H", "Content-Type: application/json");

  if (token) {
    const authHeader = isGitHub
      ? `Bearer ${token}`
      : `token ${token}`;
    args.push("-H", `Authorization: ${authHeader}`);
  }

  if (data) {
    args.push("-d", JSON.stringify(data));
  }

  args.push(url);

  const cmd = args
    .map((a) => (a.includes(" ") || a.includes("{") ? `'${a}'` : a))
    .join(" ");

  const result = execSync(cmd, { encoding: "utf-8", timeout: 35000 });
  return JSON.parse(result);
}

export async function runConnector() {
  const config = getApiConfig();

  const server = new McpServer({
    name: "gitea-mcp-connector",
    version: "1.0.0",
  });

  function apiCall(method, endpoint, data = null, params = null) {
    let url = `${config.apiUrl}${endpoint}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== null && v !== undefined) searchParams.set(k, String(v));
      }
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }
    return curlRequest(method, url, data, config.token, config.isGitHub);
  }

  // --- TOOLS ---

  server.tool(
    "list_repos",
    "List all repositories for the authenticated user or a specific organization",
    {
      org: z
        .string()
        .optional()
        .describe("Organization name (omit for user repos)"),
      page: z.number().optional().describe("Page number (default: 1)"),
      per_page: z
        .number()
        .optional()
        .describe("Results per page (default: 30, max: 100)"),
    },
    async ({ org, page = 1, per_page = 100 }) => {
      const targetOrg = org || config.owner;
      let endpoint;
      if (targetOrg) {
        endpoint = `/orgs/${targetOrg}/repos`;
      } else if (config.token) {
        endpoint = "/user/repos";
      } else {
        return {
          content: [
            {
              type: "text",
              text: "Error: No org specified and no auth token. Provide an org name or set GITEA_TOKEN.",
            },
          ],
          isError: true,
        };
      }

      const repos = apiCall("GET", endpoint, null, {
        page,
        per_page,
        limit: per_page,
        type: "all",
      });

      if (!Array.isArray(repos)) {
        return {
          content: [
            {
              type: "text",
              text: `API Error: ${repos.message || JSON.stringify(repos)}`,
            },
          ],
          isError: true,
        };
      }

      const formatted = repos
        .map((r, i) => {
          const visibility = r.private ? "Private" : "Public";
          const lang = r.language || "N/A";
          const desc = r.description || "No description";
          const stars = r.stargazers_count || 0;
          const forks = r.forks_count || 0;
          return [
            `${i + 1}. ${r.full_name} [${visibility}]`,
            `   Language: ${lang} | Stars: ${stars} | Forks: ${forks}`,
            `   Description: ${desc}`,
            `   URL: ${r.html_url}`,
            `   Default Branch: ${r.default_branch || "N/A"}`,
            `   Created: ${r.created_at || "N/A"}`,
            `   Updated: ${r.updated_at || "N/A"}`,
          ].join("\n");
        })
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `Found ${repos.length} repositories:\n\n${formatted}` || "No repositories found.",
          },
        ],
      };
    }
  );

  server.tool(
    "get_repo",
    "Get details of a specific repository",
    {
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
    },
    async ({ owner, repo }) => {
      const r = apiCall("GET", `/repos/${owner}/${repo}`);
      return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
    }
  );

  server.tool(
    "list_issues",
    "List issues in a repository",
    {
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      state: z
        .enum(["open", "closed", "all"])
        .optional()
        .describe("Issue state filter"),
      page: z.number().optional(),
      per_page: z.number().optional(),
    },
    async ({ owner, repo, state = "open", page = 1, per_page = 20 }) => {
      const issues = apiCall("GET", `/repos/${owner}/${repo}/issues`, null, {
        state,
        page,
        per_page,
        limit: per_page,
      });

      if (!Array.isArray(issues)) {
        return {
          content: [{ type: "text", text: `Error: ${issues.message || JSON.stringify(issues)}` }],
          isError: true,
        };
      }

      const formatted = issues
        .map((i) => `#${i.number}: ${i.title} [${i.state}]`)
        .join("\n");
      return {
        content: [{ type: "text", text: formatted || "No issues found." }],
      };
    }
  );

  server.tool(
    "list_branches",
    "List branches in a repository",
    {
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
    },
    async ({ owner, repo }) => {
      const branches = apiCall("GET", `/repos/${owner}/${repo}/branches`);

      if (!Array.isArray(branches)) {
        return {
          content: [{ type: "text", text: `Error: ${branches.message || JSON.stringify(branches)}` }],
          isError: true,
        };
      }

      const formatted = branches.map((b) => b.name).join("\n");
      return {
        content: [{ type: "text", text: formatted || "No branches found." }],
      };
    }
  );

  server.tool(
    "create_issue",
    "Create a new issue in a repository",
    {
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      title: z.string().describe("Issue title"),
      body: z.string().optional().describe("Issue body/description"),
    },
    async ({ owner, repo, title, body }) => {
      const issue = apiCall("POST", `/repos/${owner}/${repo}/issues`, {
        title,
        body,
      });
      return {
        content: [
          {
            type: "text",
            text: `Created issue #${issue.number}: ${issue.title}\nURL: ${issue.html_url}`,
          },
        ],
      };
    }
  );

  server.tool(
    "create_pull_request",
    "Create a pull request",
    {
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      title: z.string().describe("PR title"),
      head: z.string().describe("Head branch"),
      base: z
        .string()
        .optional()
        .describe("Base branch (default: main)"),
      body: z.string().optional().describe("PR description"),
    },
    async ({ owner, repo, title, head, base = "main", body }) => {
      const pr = apiCall("POST", `/repos/${owner}/${repo}/pulls`, {
        title,
        head,
        base,
        body,
      });
      return {
        content: [
          {
            type: "text",
            text: `Created PR #${pr.number}: ${pr.title}\nURL: ${pr.html_url}`,
          },
        ],
      };
    }
  );

  server.tool(
    "get_connection_info",
    "Get current connection configuration and detected git remote info",
    {},
    async () => {
      const gitConfig = detectGitConfig();
      const info = {
        api_url: config.apiUrl,
        is_github: config.isGitHub,
        authenticated: !!config.token,
        detected_owner: config.owner,
        detected_repo: config.repo,
        git_remote: gitConfig?.remoteUrl || "not detected",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runConnector().catch((error) => {
    console.error("FATAL:", error.message);
    process.exit(1);
  });
}
