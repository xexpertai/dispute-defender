import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "@/lib/mcp/server";

const dispute = { dispute_id: "PP-R-ABC-1", status: "WAITING_FOR_SELLER_RESPONSE", messages: [{ content: "mail me at buyer@example.com" }], links: [{ rel: "self" }, { rel: "send_message" }] };

function fakePayPal() {
  const calls: { method: string; path: string }[] = [];
  return {
    calls,
    request: async (method: string, path: string) => {
      calls.push({ method, path });
      if (path.startsWith("/v1/customer/disputes?")) return { status: 200, debugId: "d", data: { items: [dispute] } };
      if (method === "GET") return { status: 200, debugId: "d", data: dispute };
      return { status: 200, debugId: "dbg-w", data: {} };
    },
  };
}

async function connect(allowWrites: boolean) {
  const pp = fakePayPal();
  const server = buildMcpServer(pp as never, { allowWrites });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, pp };
}

const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content[0].text);

describe("MCP server (PayPal Agent Toolkit extension)", () => {
  it("exposes read tools and the 6 custom dispute tools, writes marked destructive", async () => {
    const { client } = await connect(false);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["accept_dispute_claim_with_terms", "acknowledge_return_item", "escalate_dispute", "get_dispute", "list_disputes", "make_dispute_offer", "provide_dispute_evidence", "send_dispute_message"].sort(),
    );
    expect(tools.find((t) => t.name === "send_dispute_message")?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === "get_dispute")?.annotations?.readOnlyHint).toBe(true);
    expect(JSON.stringify(tools.find((t) => t.name === "provide_dispute_evidence")?.inputSchema)).not.toContain("files");
  });

  it("get_dispute returns redacted details plus HATEOAS actions", async () => {
    const { client } = await connect(false);
    const out = JSON.parse(textOf(await client.callTool({ name: "get_dispute", arguments: { dispute_id: "PP-R-ABC-1" } })));
    expect(out.allowed_actions).toEqual(["send_message"]);
    expect(JSON.stringify(out)).not.toContain("buyer@example.com");
  });

  it("refuses writes unless enabled, and never calls PayPal", async () => {
    const { client, pp } = await connect(false);
    const r = await client.callTool({ name: "send_dispute_message", arguments: { dispute_id: "PP-R-ABC-1", message: "hi" } });
    expect(r.isError).toBe(true);
    expect(pp.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("with writes enabled: HATEOAS-gated; allowed action posts, disallowed one is refused", async () => {
    const { client, pp } = await connect(true);
    const ok = await client.callTool({ name: "send_dispute_message", arguments: { dispute_id: "PP-R-ABC-1", message: "hi" } });
    expect(JSON.parse(textOf(ok))).toEqual({ status: 200, debug_id: "dbg-w" });
    const no = await client.callTool({ name: "escalate_dispute", arguments: { dispute_id: "PP-R-ABC-1", note: "x" } });
    expect(no.isError).toBe(true);
    expect(textOf(no)).toMatch(/not allowed/);
    expect(pp.calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["/v1/customer/disputes/PP-R-ABC-1/send-message"]);
  });
});

describe("MCP server with the PayPal Agent Toolkit's tools", () => {
  it("serves the toolkit's read tools (redacted) next to our 6 custom tools; never its write tools", async () => {
    const { createSandboxToolkit } = await import("@/lib/paypal/toolkit");
    const real = createSandboxToolkit("dummy-token-not-used"); // builds tool definitions only, no network
    const ran: string[] = [];
    const toolkit = {
      tools: real.tools as never,
      run: async (method: string) => {
        ran.push(method);
        return JSON.stringify({ dispute_id: "PP-R-ABC-1", buyer: { email_address: "buyer@example.com" }, links: [{ rel: "send_message" }] });
      },
    };
    const server = buildMcpServer(fakePayPal() as never, { allowWrites: false, toolkit });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of ["list_disputes", "get_dispute", "get_order", "get_shipment_tracking", "list_transactions", "provide_dispute_evidence", "send_dispute_message"]) expect(names).toContain(n);
    for (const n of ["create_dispute", "accept_dispute_claim", "create_shipment_tracking"]) expect(names).not.toContain(n);
    const out = textOf(await client.callTool({ name: "get_dispute", arguments: { dispute_id: "PP-R-ABC-1" } }));
    expect(ran).toEqual(["get_dispute"]);
    expect(out).not.toContain("buyer@example.com");
    expect(JSON.parse(out).allowed_actions).toEqual(["send_message"]);
  });
});
