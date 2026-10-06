// npm run mcp   (stdio MCP server; read-only unless DD_MCP_ALLOW_WRITES=1; PayPal sandbox only)
// Claude Desktop config: { "command": "npm", "args": ["run", "-s", "mcp"], "cwd": "<repo>" }
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpServer } from "../lib/mcp/server";
import { PayPalClient } from "../lib/paypal/client";
import { createSandboxToolkit } from "../lib/paypal/toolkit";

// stdout is the MCP channel: send any logging to stderr.
console.log = (...a: unknown[]) => console.error(...a);
const client = new PayPalClient();
const initial = createSandboxToolkit(await client.getAccessToken());
const server = buildMcpServer(client, {
  allowWrites: process.env.DD_MCP_ALLOW_WRITES === "1",
  // fresh (cached) token per call; the toolkit is re-checked for sandbox each time
  toolkit: { tools: initial.tools, run: async (method, args) => createSandboxToolkit(await client.getAccessToken()).run(method, args) },
});
await server.connect(new StdioServerTransport());
console.error("dispute-defender MCP server ready (sandbox)");
