import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ReplayGateway } from "@/lib/agent/gateway";
import { MockCarrier } from "@/lib/carrier/mock";
import { buildMcpServer } from "@/lib/mcp/server";
import { ReplayPayPalClient } from "@/lib/mcp/replay";
import { loadFixtures } from "@/lib/replay/fixtures";
import { SampleStore } from "@/lib/samples/store";

// `npm run mcp:replay`: the MCP server on the Replay fixtures, with no keys and no network.
async function connect() {
  const f = loadFixtures();
  const replay = new ReplayPayPalClient(f.disputes);
  const server = buildMcpServer(replay, { allowWrites: false, replay, assess: { gateway: new ReplayGateway(f), carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store) } });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, replay };
}

const json = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0].text);
const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });

describe("MCP server in Replay (keyless)", () => {
  it("lists the read tools, assess_dispute and the 7 dispute tools; writes are not destructive in Replay", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["accept_dispute_claim_with_terms", "acknowledge_return_item", "assess_dispute", "escalate_dispute", "get_dispute", "list_disputes", "make_dispute_offer", "provide_dispute_evidence", "provide_dispute_supporting_info", "send_dispute_message"].sort(),
    );
    expect(tools.find((t) => t.name === "send_dispute_message")?.description).toMatch(/REPLAY: nothing is sent/);
    expect(tools.find((t) => t.name === "assess_dispute")?.annotations?.readOnlyHint).toBe(true);
  });

  it("list_disputes and get_dispute serve the recorded store's 7 cases, redacted, with HATEOAS actions", async () => {
    const { client } = await connect();
    const list = json(await call(client, "list_disputes", {}));
    expect(list).toHaveLength(7);
    const d = json(await call(client, "get_dispute", { dispute_id: "PP-R-KFL-10190426" }));
    expect(d.allowed_actions).toContain("make_offer");
    expect(d.dispute.dispute_id).toBe("PP-R-KFL-10190426");
  });

  it("a write returns the would-be request and sends nothing", async () => {
    const { client, replay } = await connect();
    const out = json(await call(client, "make_dispute_offer", { dispute_id: "PP-R-KFL-10190426", note: "Sorry about the mugs.", offer_type: "REFUND", offer_amount: { currency_code: "USD", value: "32.00" } }));
    expect(out).toMatchObject({ sent: false, would_send: { method: "POST", endpoint: "/v1/customer/disputes/PP-R-KFL-10190426/make-offer" } });
    expect(replay.captured).toHaveLength(1);
  });

  it("a write PayPal doesn't allow on the recorded case is refused (HATEOAS), and nothing is captured", async () => {
    const { client, replay } = await connect();
    const r = await call(client, "escalate_dispute", { dispute_id: "PP-R-FWW-10190477", note: "x" });
    expect(r.isError).toBe(true);
    expect(replay.captured).toHaveLength(0);
  });
});

describe("assess_dispute (the agent's rules verdict, no AI)", () => {
  it("KFL mugs: a fair offer of $32, with reasons tied to their records", async () => {
    const { client } = await connect();
    const a = json(await call(client, "assess_dispute", { dispute_id: "PP-R-KFL-10190426" }));
    expect(a).toMatchObject({ verdict: "Offer", decided_by: "Fixed rules, no AI", recommended_action: { kind: "make_offer", amount: { value: "32.00" } } });
    expect(a.data).toMatch(/^Replay/);
    expect(a.reasons.length).toBeGreaterThan(0);
    for (const r of a.reasons) expect(r.sources.length).toBeGreaterThan(0);
    expect(a.actions_paypal_allows_now.filter((x: { picked: boolean }) => x.picked)).toHaveLength(1);
    expect(a.cost_to_fight).toMatch(/assumes 30 min/);
  });

  it("VYZ plates: refund because the seller can't prove delivery, never 'the buyer is right'", async () => {
    const { client } = await connect();
    const a = json(await call(client, "assess_dispute", { dispute_id: "PP-R-VYZ-10190425" }));
    expect(a).toMatchObject({ verdict: "Refund", buyer_is_right: false, seller_cannot_prove_delivery: true });
    expect(JSON.stringify(a)).not.toMatch(/buyer is right/i);
  });

  it("FDW planter: refund, the buyer is right (the store's own log admits the label error)", async () => {
    const { client } = await connect();
    const a = json(await call(client, "assess_dispute", { dispute_id: "PP-R-FDW-10190427" }));
    expect(a).toMatchObject({ verdict: "Refund", buyer_is_right: true, seller_cannot_prove_delivery: false });
    expect(a.reasons.flatMap((r: { sources: { from: string }[] }) => r.sources.map((s) => s.from))).toContain("Store (sample)");
  });

  it("KWQ platter: hold, nothing to send before the delivery scan", async () => {
    const { client } = await connect();
    const a = json(await call(client, "assess_dispute", { dispute_id: "PP-R-KWQ-10190429" }));
    expect(a).toMatchObject({ verdict: "Hold", on_hold: "awaiting_delivery", recommended_action: null });
  });

  it("an unknown dispute is an error, not a guess", async () => {
    const { client } = await connect();
    const r = await call(client, "assess_dispute", { dispute_id: "PP-R-NOPE-1" });
    expect(r.isError).toBe(true);
  });
});
