#!/usr/bin/env node

/**
 * List Repositories Script
 *
 * Connects to the Gitea MCP server as a client, calls the list_repos tool,
 * and displays all repositories. Also supports direct API calls as a fallback.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import axios from "axios";
import { execSync } from "child_process";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

/**
 * Detect git remote configuration
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
    // ignore
  }
  return null;
}

/**
 * Method 1: Use MCP client to connect to the Gitea MCP server via stdio
 */
async function listReposViaMcp(org) {
  console.log("=== Method 1: MCP Client -> Gitea MCP Server ===\n");

  const transport = new StdioClientTransport({
    command: "node",
    args: [path.join(__dirname, "connector.js")],
    env: {
      ...process.env,
    },
  });

  const client = new Client({
    name: "repo-lister",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);

    const toolsList = await client.listTools();
    console.log(
      "Available MCP tools:",
      toolsList.tools.map((t) => t.name).join(", ")
    );
    console.log();

    const result = await client.callTool({
      name: "list_repos",
      arguments: org ? { org } : {},
    });

    console.log("Repositories:\n");
    for (const content of result.content) {
      if (content.type === "text") {
        console.log(content.text);
      }
    }

    await client.close();
    return true;
  } catch (error) {
    console.error("MCP method failed:", error.message);
    await client.close().catch(() => {});
    return false;
  }
}

/**
 * Method 2: Direct API call as fallback
 */
async function listReposViaApi(org) {
  console.log("\n=== Method 2: Direct API Call ===\n");

  const apiUrl = process.env.GITEA_API_URL || "https://api.github.com";
  const token = process.env.GITEA_TOKEN || process.env.GITHUB_TOKEN || "";
  const isGitHub = apiUrl.includes("github.com");

  const headers = { Accept: "application/json" };
  if (token) {
    headers["Authorization"] = isGitHub
      ? `Bearer ${token}`
      : `token ${token}`;
  }

  const targetOrg = org || detectGitConfig()?.owner;
  if (!targetOrg) {
    console.log(
      "No organization detected. Set GITEA_OWNER or provide an org name."
    );
    return false;
  }

  try {
    const endpoint = `${apiUrl}/orgs/${targetOrg}/repos`;
    console.log(`Fetching repos from: ${endpoint}`);

    const response = await axios.get(endpoint, {
      headers,
      params: { per_page: 100, limit: 100 },
    });

    const repos = response.data;
    console.log(`\nFound ${repos.length} repositories for ${targetOrg}:\n`);

    repos.forEach((r, i) => {
      const visibility = r.private ? "Private" : "Public";
      const lang = r.language || "N/A";
      const desc = r.description || "No description";
      const stars = r.stargazers_count || 0;
      const forks = r.forks_count || 0;
      console.log(`${i + 1}. ${r.full_name} [${visibility}]`);
      console.log(`   Language: ${lang} | Stars: ${stars} | Forks: ${forks}`);
      console.log(`   Description: ${desc}`);
      console.log(`   URL: ${r.html_url}`);
      console.log(
        `   Default Branch: ${r.default_branch || "N/A"}`
      );
      console.log(`   Created: ${r.created_at || "N/A"}`);
      console.log(`   Updated: ${r.updated_at || "N/A"}`);
      console.log();
    });

    return true;
  } catch (error) {
    console.error(
      "Direct API call failed:",
      error.response?.data?.message || error.message
    );
    return false;
  }
}

// Main
const org = process.argv[2] || detectGitConfig()?.owner;
console.log(`Listing repositories for: ${org || "(authenticated user)"}\n`);

const mcpSuccess = await listReposViaMcp(org);
if (!mcpSuccess) {
  await listReposViaApi(org);
}
