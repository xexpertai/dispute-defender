// The MCP beat of the story video: a real call to the keyless Replay MCP server (npm run -s mcp:replay), saved
// for the edit. No keys, no network, nothing is sent to PayPal.  Usage: npx tsx scripts/video/mcp-shot.mts <out.json>
import { writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const id = "PP-R-VYZ-10190425";
const client = new Client({ name: "story-video", version: "1" });
await client.connect(new StdioClientTransport({ command: "npm", args: ["run", "-s", "mcp:replay"], cwd: process.cwd(), stderr: "ignore" }));
const tools = (await client.listTools()).tools.map((t) => t.name);
const res = await client.callTool({ name: "assess_dispute", arguments: { dispute_id: id } });
await client.close();
const text = (res.content as { type: string; text: string }[]).find((c) => c.type === "text")!.text;
writeFileSync(process.argv[2], JSON.stringify({ command: "npm run -s mcp:replay", tool: "assess_dispute", args: { dispute_id: id }, tools, result: JSON.parse(text) }, null, 1));
console.log("mcp shot ->", process.argv[2]);
