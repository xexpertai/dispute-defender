// npm run mcp   (stdio MCP server; read-only unless DD_MCP_ALLOW_WRITES=1; PayPal sandbox only)
// Claude Desktop config: { "command": "npm", "args": ["run", "-s", "mcp"], "cwd": "<repo>" }
// No PayPal keys? Use `npm run mcp:replay` (scripts/mcp-replay.mts): same tools on the Replay data.
import { existsSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// stdout is the MCP channel: send any logging to stderr.
console.log = (...a: unknown[]) => console.error(...a);

// Credentials come from .env.local (written by `npm run paypal:key`) or the environment.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (!process.env.PAYPAL_CLIENT_ID?.trim() || !process.env.PAYPAL_CLIENT_SECRET?.trim() || process.env.PAYPAL_ENV !== "sandbox") {
  console.error(
    [
      "npm run mcp needs PayPal SANDBOX credentials, and none were found" + (existsSync(".env.local") ? " in .env.local." : " (.env.local is missing)."),
      "  - Add them:          npm run paypal:key   (hidden input; writes .env.local)",
      "  - Or try it keyless: npm run mcp:replay   (the same tools on the recorded Replay data; nothing is sent)",
    ].join("\n"),
  );
  process.exit(1);
}

const { buildMcpServer } = await import("../lib/mcp/server");
const { PayPalClient } = await import("../lib/paypal/client");
const { createSandboxToolkit } = await import("../lib/paypal/toolkit");
const { LiveGateway } = await import("../lib/agent/gateway");
const { MockCarrier } = await import("../lib/carrier/mock");
const { SampleStore } = await import("../lib/samples/store");
const { loadFixtures } = await import("../lib/replay/fixtures");

const client = new PayPalClient();
const run = async (method: string, args: unknown) => createSandboxToolkit(await client.getAccessToken()).run(method, args);
const initial = createSandboxToolkit(await client.getAccessToken());
const f = loadFixtures();
const server = buildMcpServer(client, {
  allowWrites: process.env.DD_MCP_ALLOW_WRITES === "1",
  // fresh (cached) token per call; the toolkit is re-checked for sandbox each time
  toolkit: { tools: initial.tools, run: async (method, args) => String(await run(method, args)) },
  // assess_dispute reads the live sandbox; carrier scans and store logs are the demo store's mock/sample data.
  assess: { gateway: new LiveGateway(client, undefined, async (method, args) => String(await run(method, args))), carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store) },
});
await server.connect(new StdioServerTransport());
console.error("dispute-defender MCP server ready (sandbox)");
