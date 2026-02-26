# Clinical-Agent — Gitea MCP Connector

## Overview

A bridge that connects Claude Code to Gitea/GitHub repositories via the Model Context Protocol (MCP). Provides tools for listing repos, managing issues, creating pull requests, and more.

## Quick Reference

```bash
npm install          # Install dependencies
npm start            # Run the MCP server (node src/connector.js)
npm run test-connection  # Verify API connectivity
npm run list-repos       # List available repositories
```

## Project Structure

```
src/
  connector.js       # Main MCP server — registers tools, handles requests
  list-repos.js      # Standalone MCP client for listing repos
  test-connection.js # Connection verification script
```

## Configuration

Copy `.env.example` to `.env` and set:
- `GITEA_API_URL` — API base URL (GitHub: `https://api.github.com`, Gitea: `https://host/api/v1`)
- `GITEA_TOKEN` — Personal access token
- `GITEA_OWNER` — Default organization or user (optional; auto-detected from git remote)

The `.mcp.json` file configures how Claude Code launches the server.

## Code Conventions

- **Language**: JavaScript (ES6+ with ESM modules — `"type": "module"`)
- **Node.js**: >= 18 required
- **Naming**:
  - `camelCase` for variables, functions, and object properties
  - `UPPER_SNAKE_CASE` for environment variables
  - `snake_case` for MCP tool names (e.g. `list_repos`, `create_issue`)
- **Imports**: Use explicit `.js` file extensions
- **HTTP**: Uses `curl` via `execSync` for proxy compatibility; avoid switching to node HTTP clients
- **Validation**: Zod schemas for MCP tool parameters
- **Error handling**: Try-catch with graceful degradation; MCP errors use `isError: true`
- **No build step** — source files run directly with Node

## MCP Tools (defined in connector.js)

`list_repos`, `get_repo`, `list_issues`, `create_issue`, `create_pull_request`, `get_connection_info`, `list_branches`

## Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP server/client protocol |
| `@boringstudio_org/gitea-mcp` | Gitea-specific MCP utilities |
| `axios` | HTTP client (fallback) |
| `dotenv` | `.env` file loading |
