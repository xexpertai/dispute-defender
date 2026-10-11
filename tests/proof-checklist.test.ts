import { describe, expect, it } from "vitest";
import { ReplayGateway } from "@/lib/agent/gateway";
import { runAgent } from "@/lib/agent/run";
import { MockCarrier } from "@/lib/carrier/mock";
import type { EvidenceItem } from "@/lib/evidence/types";
import { FakeProvider } from "@/lib/llm/draft";
import { assessDispute } from "@/lib/mcp/assess";
import { loadFixtures } from "@/lib/replay/fixtures";
import { SampleStore } from "@/lib/samples/store";
import { proofChecklist, scoreMath } from "@/lib/strategy/checklist";
import type { Assessment, Reason } from "@/lib/strategy/rules";

const f = loadFixtures();
const deps = () => ({ gateway: new ReplayGateway(f), carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store) });

async function run(id: string): Promise<{ a: Assessment; ev: EvidenceItem[] }> {
  let ev: EvidenceItem[] = [];
  for await (const e of runAgent(id, { ...deps(), provider: new FakeProvider(), runId: "t" })) {
    if (e.type === "evidence") ev = e.items;
    if (e.type === "assessment") return { a: e.assessment, ev };
  }
  throw new Error("no assessment");
}

const statuses = (a: Assessment) => Object.fromEntries(a.checklist.items.map((i) => [i.id, i.status]));

describe("proof checklist: the proof that answers each PayPal reason code (Replay store, 7 cases)", () => {
  it("café $312 (not received, DEFEND): shipment, delivery, address and signature all on file", async () => {
    const { a } = await run("PP-R-FWW-10190477");
    expect(statuses(a)).toEqual({ shipment: "have", delivery: "have", address: "have", signature: "have" });
    expect([a.checklist.have, a.checklist.of]).toEqual([3, 3]);
    expect(a.checklist.claim).toMatch(/never arrived/);
    expect(scoreMath(a.strength.reasons)).toBe("+1 +3 +1 +1 = +6");
  });

  it("mugs (not as described, OFFER): listing and photos on file, the buyer's account is not answered", async () => {
    const { a } = await run("PP-R-KFL-10190426");
    expect(statuses(a)).toEqual({ listing: "have", photos: "have", delivery: "have", buyer_account: "against" });
    expect(a.checklist.items.find((i) => i.id === "listing")?.paypalType).toBe("ITEM_DESCRIPTION");
    expect([a.checklist.have, a.checklist.of]).toEqual([2, 3]);
    expect(scoreMath(a.strength.reasons)).toBe("+1 +2 −1 = +2");
  });

  it("plates, no tracking (REFUND, can't prove delivery): nothing on file", async () => {
    const { a } = await run("PP-R-VYZ-10190425");
    expect(statuses(a)).toEqual({ shipment: "missing", delivery: "missing", address: "missing", signature: "missing" });
    expect(a.checklist.have).toBe(0);
    expect(scoreMath(a.strength.reasons)).toBe("−3 = −3");
  });

  it("planter returned to sender (REFUND, buyer is right): the carrier and the store's own log show the opposite", async () => {
    const { a } = await run("PP-R-FDW-10190427");
    expect(statuses(a)).toEqual({ shipment: "have", delivery: "against", address: "missing", signature: "missing", no_fault: "against" });
  });

  it("platter in transit (HOLD): delivery, address and signature are pending, not missing", async () => {
    const { a } = await run("PP-R-KWQ-10190429");
    expect(a.recommendation.wait).toBe("awaiting_delivery");
    expect(statuses(a)).toEqual({ shipment: "have", delivery: "pending", address: "pending", signature: "pending" });
  });

  it("never cites a record the agent didn't gather, on any case", async () => {
    for (const id of f.disputes.keys()) {
      const { a, ev } = await run(id);
      const refs = new Set(ev.map((e) => e.sourceRef));
      for (const i of a.checklist.items) for (const r of i.sourceRefs) expect(refs.has(r), `${id} ${i.id} ${r}`).toBe(true);
      // Every "have" has a record behind it.
      for (const i of a.checklist.items.filter((x) => x.status === "have")) expect(i.sourceRefs.length, `${id} ${i.id}`).toBeGreaterThan(0);
    }
  });

  it("other reason codes: a generic item, and a seller's admitted fault always shows", () => {
    const reasons: Reason[] = [{ id: "seller_admits_fault", text: "Seller's own records acknowledge the problem", supports: "buyer", weight: 4, decisive: true, sourceRefs: ["store:X#line1"] }];
    const c = proofChecklist("CREDIT_NOT_PROCESSED", [{ sourceRef: "order:1", kind: "order", label: "Order", text: "", facts: {} }], reasons);
    expect(c.items.map((i) => [i.id, i.status])).toEqual([
      ["order", "have"],
      ["no_fault", "against"],
    ]);
    expect(scoreMath([])).toBe("0");
  });

  it("assess_dispute (MCP) returns the checklist and the score arithmetic", async () => {
    const out = await assessDispute("PP-R-FWW-10190477", deps());
    expect(out?.evidence_score.math).toBe("+1 +3 +1 +1 = +6");
    expect(out?.proof_checklist.required_on_file).toBe("3 of 3");
    expect(out?.proof_checklist.items.find((i) => i.proof === "Carrier delivery scan")?.sources[0].from).toBe("Carrier (mock)");
  });
});
