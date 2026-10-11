// npm run mcp:replay   (stdio MCP server on the Replay data: no keys, no network, nothing is ever sent)
// Claude Desktop config: { "command": "npm", "args": ["run", "-s", "mcp:replay"], "cwd": "<repo>" }
// MCP Inspector:         npx @modelcontextprotocol/inspector npm run -s mcp:replay
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ReplayGateway } from "../lib/agent/gateway";
import { MockCarrier } from "../lib/carrier/mock";
import { buildMcpServer } from "../lib/mcp/server";
import { ReplayPayPalClient } from "../lib/mcp/replay";
import { loadFixtures } from "../lib/replay/fixtures";
import { SampleStore } from "../lib/samples/store";

// stdout is the MCP channel: send any logging to stderr.
console.log = (...a: unknown[]) => console.error(...a);
const f = loadFixtures();
const replay = new ReplayPayPalClient(f.disputes);
const server = buildMcpServer(replay, {
  allowWrites: false,
  replay,
  assess: { gateway: new ReplayGateway(f), carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store) },
});
await server.connect(new StdioServerTransport());
console.error(`dispute-defender MCP server ready (Replay: ${f.disputes.size} recorded sandbox disputes; write tools return the would-be request and send nothing)`);
