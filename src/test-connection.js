#!/usr/bin/env node

/**
 * Test Connection Script
 *
 * Verifies that the Gitea MCP connector can reach the API
 * and lists available MCP tools.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testConnection() {
  console.log("Testing Gitea MCP Connector...\n");

  const transport = new StdioClientTransport({
    command: "node",
    args: [path.join(__dirname, "connector.js")],
    env: { ...process.env },
  });

  const client = new Client({
    name: "connection-tester",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);
    console.log("Connected to MCP server successfully.\n");

    // List available tools
    const toolsList = await client.listTools();
    console.log(`Available tools (${toolsList.tools.length}):`);
    for (const tool of toolsList.tools) {
      console.log(`  - ${tool.name}: ${tool.description}`);
    }
    console.log();

    // Get connection info
    const info = await client.callTool({
      name: "get_connection_info",
      arguments: {},
    });

    console.log("Connection info:");
    for (const content of info.content) {
      if (content.type === "text") {
        console.log(content.text);
      }
    }

    await client.close();
    console.log("\nConnection test passed.");
  } catch (error) {
    console.error("Connection test failed:", error.message);
    await client.close().catch(() => {});
    process.exit(1);
  }
}

testConnection();
