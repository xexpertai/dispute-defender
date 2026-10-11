import { describe, expect, it } from "vitest";
import { validateDraft } from "@/lib/agent/validate";
import { MockCarrier } from "@/lib/carrier/mock";
import { fromCarrierTracking, fromOrder, fromPayPalTrackers } from "@/lib/evidence/sources";
import { FakeProvider, templateDraft, type Draft, type DraftInput, type DraftProvider } from "@/lib/llm/draft";
import { loadFixtures } from "@/lib/replay/fixtures";
import { SampleStore } from "@/lib/samples/store";
import { assess, type DisputeContext } from "@/lib/strategy/rules";

const NOW = new Date("2026-10-06T12:00:00Z");
const ctx: DisputeContext = { disputeId: "PP-R-V", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", amount: 50, currency: "USD", allowedActions: ["provide_evidence", "make_offer", "send_message"] };
const evidence = [
  ...fromOrder({ id: "O1", purchase_units: [{ amount: { value: "50.00", currency_code: "USD" }, shipping: { address: { postal_code: "95131" } } }] }),
  ...fromPayPalTrackers([{ transaction_id: "C1", tracking_number: "9400", carrier: "USPS" }]),
  ...fromCarrierTracking({ carrier: "USPS", trackingNumber: "9400", events: [{ code: "DELIVERED", at: "2026-10-03T10:00:00Z", postalCode: "95131" }] }),
];
const input = (): DraftInput => ({ disputeId: ctx.disputeId, reason: ctx.reason, amount: 50, currency: "USD", assessment: assess(ctx, evidence, NOW), evidence, buyerMessages: [], sellerTone: "friendly", allowedActions: ctx.allowedActions });

describe("template draft (FakeProvider)", () => {
  it("is labelled TEMPLATE, cites only gathered sources, and passes validation untouched", async () => {
    const provider: DraftProvider = new FakeProvider();
    const { draft, usage } = await provider.draft(input());
    expect(draft.origin).toBe("template");
    expect(usage).toBeUndefined();
    const res = validateDraft(draft, evidence, ctx);
    expect(res).toMatchObject({ ok: true, issues: [] });
    expect(res.draft.claims).toEqual(draft.claims);
    expect(draft.evidence[0]).toMatchObject({ evidence_type: "PROOF_OF_FULFILLMENT", tracking_info: [{ carrier_name: "USPS", tracking_number: "9400" }] });
  });
});

describe("template buyer message fits the dispute reason", () => {
  it("asks a not-as-described buyer for a photo instead of talking about delivery", () => {
    const snad: DisputeContext = { ...ctx, reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", allowedActions: ["send_message"] };
    const a = assess(snad, evidence, NOW);
    a.recommendation.action = { kind: "send_message" };
    const d = templateDraft({ ...input(), reason: snad.reason, assessment: a, allowedActions: snad.allowedActions });
    expect(d.buyerMessage?.text).toMatch(/photo/);
    expect(d.buyerMessage?.text).not.toMatch(/delivered|neighbours/);
  });

  it("keeps the delivered wording for an item-not-received message", () => {
    const inr: DisputeContext = { ...ctx, allowedActions: ["send_message"] };
    const d = templateDraft({ ...input(), assessment: assess(inr, evidence, NOW), allowedActions: inr.allowedActions });
    expect(d.buyerMessage?.text).toMatch(/delivered/);
  });
});

describe("validateDraft (server-side guard for any draft, AI or template)", () => {
  const base = (): Draft => templateDraft(input());

  it("drops claims that cite unknown or no sources", () => {
    const d = { ...base(), claims: [...base().claims, { text: "Buyer signed for it", sourceRefs: ["track:USPS:9400#ev9"] }, { text: "Trust me", sourceRefs: [] }] };
    const res = validateDraft(d, evidence, ctx);
    expect(res.issues.map((i) => i.code)).toEqual(["unknown_source", "uncited_claim"]);
    expect(res.draft.claims).toEqual(base().claims);
    expect(res.ok).toBe(true);
  });

  it.each([
    ["an action PayPal does not allow", { kind: "accept_claim" as const, acceptClaimType: "REFUND" as const }, "action_not_allowed"],
    ["an offer above the disputed amount", { kind: "make_offer" as const, offerType: "REFUND" as const, amount: { value: "50.01", currency_code: "USD" } }, "amount_exceeds_dispute"],
  ])("blocks %s", (_n, action, code) => {
    const res = validateDraft({ ...base(), action }, evidence, ctx);
    expect(res.ok).toBe(false);
    expect(res.draft.action).toBeNull();
    expect(res.issues.map((i) => i.code)).toContain(code);
  });

  it("removes tracking numbers that were never gathered", () => {
    const d = { ...base(), evidence: [{ evidence_type: "PROOF_OF_FULFILLMENT" as const, tracking_info: [{ carrier_name: "USPS", tracking_number: "FAKE123" }], sourceRefs: [] }] };
    const res = validateDraft(d, evidence, ctx);
    expect(res.issues.map((i) => i.code)).toContain("unknown_tracking");
    expect(res.draft.evidence).toEqual([]);
  });

  it("trims the note to PayPal's 2000-character limit", () => {
    const res = validateDraft({ ...base(), sellerNote: "x".repeat(2500) }, evidence, ctx);
    expect(res.draft.sellerNote).toHaveLength(2000);
    expect(res.issues.map((i) => i.code)).toEqual(["note_too_long"]);
  });
});

describe("demo adapters", () => {
  const f = loadFixtures(undefined, { withArchive: true });

  it("mock carrier only answers for the right carrier + number", async () => {
    const c = new MockCarrier(f.carrier);
    expect((await c.track("usps", "9400111899223197428490"))?.events.at(-1)?.code).toBe("DELIVERED");
    expect(await c.track("UPS", "9400111899223197428490")).toBeNull();
    expect(await c.track("USPS", "0000")).toBeNull();
  });

  it("mock scans never predate the first recorded order that carries their tracking number", () => {
    // D2's real sandbox payment reuses D1's label (a spike artifact), so compare with the earliest order.
    const firstOrderAt = new Map<string, string>();
    for (const [capture, trackers] of f.trackersByCapture) {
      const at = f.ordersByCapture.get(capture)?.create_time ?? "";
      for (const t of trackers) if (!firstOrderAt.has(t.tracking_number) || at < firstOrderAt.get(t.tracking_number)!) firstOrderAt.set(t.tracking_number, at);
    }
    expect(firstOrderAt.size).toBeGreaterThan(0);
    for (const [number, orderAt] of firstOrderAt) {
      for (const s of f.carrier.trackings[number]?.events ?? []) {
        expect(s.at >= orderAt, `${number} ${s.at} before order ${orderAt}`).toBe(true);
      }
    }
  });

  it("sample store returns listing, store log and chat items keyed by invoice", async () => {
    const items = await new SampleStore(f.store).evidenceFor("KC-1791221197517");
    expect(items.map((i) => i.kind)).toEqual(["listing", "store_log", "store_log", "chat"]);
    expect(await new SampleStore(f.store).evidenceFor("UNKNOWN")).toEqual([]);
  });
});

describe("carrier scans respect the app clock", () => {
  it("drops mock scans dated after gateway.now()", async () => {
    const { ReplayGateway } = await import("@/lib/agent/gateway");
    const { runAgent } = await import("@/lib/agent/run");
    const f = loadFixtures(undefined, { withArchive: true });
    const early = { ...f, snapshotAt: "2026-10-05T18:00:00Z" }; // before D3's 18:20+ scans
    const events = [];
    for await (const e of runAgent("PP-R-MQR-10190375", { gateway: new ReplayGateway(early), carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store), provider: new FakeProvider() })) events.push(e);
    const ev = events.filter((e) => e.type === "evidence").at(-1);
    const scans = ev && ev.type === "evidence" ? ev.items.filter((i) => i.kind === "carrier_event") : [];
    expect(scans.map((s) => s.facts.eventCode)).toEqual(["LABEL_CREATED", "ACCEPTED"]);
  });
});
