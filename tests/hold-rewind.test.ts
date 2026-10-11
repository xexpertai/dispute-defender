import { describe, expect, it } from "vitest";
import { ReplayGateway } from "@/lib/agent/gateway";
import { runAgent } from "@/lib/agent/run";
import type { TraceEvent } from "@/lib/agent/trace";
import { MockCarrier } from "@/lib/carrier/mock";
import { sandboxDecided } from "@/lib/disputes/model";
import { fromCarrierTracking, fromOrder, fromPayPalTrackers } from "@/lib/evidence/sources";
import { FakeProvider } from "@/lib/llm/draft";
import { RecordedProvider } from "@/lib/llm/recorded";
import { availableActions } from "@/lib/paypal/links";
import { loadFixtures } from "@/lib/replay/fixtures";
import { rewindDispute } from "@/lib/replay/rewind";
import { SampleStore } from "@/lib/samples/store";
import { assess } from "@/lib/strategy/rules";
import { holdNote, verdictOf, verdictTitle } from "@/lib/strategy/verdict";

const f = loadFixtures();
const CAFE = "PP-R-FWW-10190477";
const PLATTER = "PP-R-KWQ-10190429";

async function run(id: string, opts: { rewind?: boolean } = {}) {
  const early = opts.rewind ? f.rewinds.get(id)?.aiDraft : undefined;
  const drafts = early ? new Map([...f.aiDrafts, [id, early]]) : f.aiDrafts;
  const events: TraceEvent[] = [];
  const gateway = new ReplayGateway(f, opts.rewind ? { rewind: id } : {});
  for await (const e of runAgent(id, { gateway, carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store), provider: new RecordedProvider(drafts, new FakeProvider()), runId: "r" })) events.push(e);
  return events;
}
const assessmentOf = (ev: TraceEvent[]) => ev.find((e): e is Extract<TraceEvent, { type: "assessment" }> => e.type === "assessment")!.assessment;
const draftOf = (ev: TraceEvent[]) => ev.find((e): e is Extract<TraceEvent, { type: "draft" }> => e.type === "draft")!;
const approvalStep = (ev: TraceEvent[]) => ev.filter((e): e is Extract<TraceEvent, { type: "step" }> => e.type === "step" && e.key === "await_approval").at(-1)!;

describe("in transit, under PayPal review: hold, no contradictions", () => {
  it("the $142 platter: on hold (not DEFEND), nothing to approve, and the hold is explained", async () => {
    const ev = await run(PLATTER);
    const a = assessmentOf(ev);
    expect(a.strength.level).toBe("LOW");
    expect(a.recommendation).toMatchObject({ action: null, wait: "awaiting_delivery" });
    expect(verdictOf(a.recommendation)).toBe("HOLD");
    expect(verdictTitle(a.recommendation)).toMatch(/^Hold/);
    expect(holdNote(a.recommendation)).toMatch(/Nothing to send yet/);
    // PayPal lists supporting info, so the reason says why the agent holds it anyway.
    expect(a.recommendation.why.join(" ")).toMatch(/PayPal would accept evidence now, but the agent holds it/);
    expect(draftOf(ev).draft?.action ?? null).toBeNull();
    expect(approvalStep(ev)).toMatchObject({ status: "skipped" });
    expect(approvalStep(ev).detail).toMatch(/^Holding: no delivery scan yet/);
    const weigh = ev.filter((e): e is Extract<TraceEvent, { type: "step" }> => e.type === "step" && e.key === "assess").at(-1)!;
    expect(weigh.detail).toMatch(/recommend: hold until the delivery scan/);
    expect(weigh.detail).not.toMatch(/defend/);
  });

  it("rules: a package still moving with only PayPal-review actions holds instead of defending", () => {
    const now = new Date("2026-10-06T12:00:00Z");
    const ev = [
      ...fromOrder({ id: "O1", purchase_units: [{ amount: { value: "142.00", currency_code: "USD" }, shipping: { address: { postal_code: "95131", country_code: "US" } } }] }),
      ...fromPayPalTrackers([{ transaction_id: "C1", tracking_number: "9400", carrier: "USPS" }]),
      ...fromCarrierTracking({ carrier: "USPS", trackingNumber: "9400", events: [{ code: "ACCEPTED", at: "2026-10-05T10:00:00Z" }] }),
    ];
    const a = assess({ disputeId: "D", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", amount: 142, currency: "USD", stage: "CHARGEBACK", status: "UNDER_REVIEW", allowedActions: ["accept_claim", "provide_supporting_info", "adjudicate"] }, ev, now);
    expect(a.recommendation).toMatchObject({ action: null, wait: "awaiting_delivery" });
    expect(verdictOf(a.recommendation)).toBe("HOLD");
  });

  it("verdicts: DEFEND only when there's something to send; message-first is WAIT", () => {
    const base = { strategy: "FIGHT" as const, action: { kind: "provide_evidence" as const }, why: [], buyerFair: false };
    expect(verdictOf(base)).toBe("FIGHT");
    expect(verdictOf({ ...base, action: null, wait: "no_allowed_action" })).toBe("HOLD");
    expect(verdictOf({ ...base, action: { kind: "send_message" }, wait: "message_first" })).toBe("WAIT");
    expect(holdNote({ ...base, action: { kind: "send_message" }, wait: "message_first" })).toBeNull();
    expect(verdictOf({ ...base, strategy: "REFUND" })).toBe("REFUND");
  });
});

describe("the video's case, rewound to before PayPal's decision", () => {
  const spec = f.rewinds.get(CAFE)!;

  it("has a rewind spec with the pre-decision AI draft", () => {
    expect(spec).toBeDefined();
    expect(spec.aiDraft?.disputeId).toBe(CAFE);
    expect(spec.aiDraft!._meta.recorded_at < spec.before).toBe(true);
  });

  it("drops only what happened at or after the cutoff and restores the status and links of that moment", () => {
    const rec = f.disputes.get(CAFE)!;
    expect(rec.status).toBe("RESOLVED");
    const r = rewindDispute(rec, spec) as typeof rec & Record<string, unknown>;
    expect(r.status).toBe("UNDER_REVIEW");
    expect(r.dispute_outcome).toBeUndefined();
    expect(r.adjudications).toBeNull();
    expect(r.supporting_info).toBeNull();
    expect((r.fund_movements as { reason: string }[]).map((m) => m.reason)).toEqual(["HOLD_PLACED"]);
    expect(availableActions(r)).toEqual(expect.arrayContaining(["accept_claim", "provide_supporting_info"]));
    // Everything else is the recording as-is.
    expect(r.create_time).toBe(rec.create_time);
    expect(r.disputed_transactions).toEqual(rec.disputed_transactions);
    expect(r.dispute_life_cycle_stage).toBe(rec.dispute_life_cycle_stage);
    // The capture reads as held (PayPal released the hold at 15:35, after the cutoff).
    const ord = new ReplayGateway(f, { rewind: CAFE });
    return ord.findOrderByCapture("5S991501Y76859350").then(({ data }) => {
      const cap = (data as { purchase_units: { payments: { captures: { status: string; status_details?: { reason: string } }[] } }[] }).purchase_units[0].payments.captures[0];
      expect(cap).toMatchObject({ status: "PENDING", status_details: { reason: "BUYER_COMPLAINT" } });
      const orig = f.ordersByCapture.get("5S991501Y76859350") as unknown as { purchase_units: { payments: { captures: { status: string }[] } }[] };
      expect(orig.purchase_units[0].payments.captures[0].status).toBe("COMPLETED");
      expect(f.disputes.get(CAFE)!.status).toBe("RESOLVED");
    });
  });

  it("works end to end as in the video: DEFEND, strong evidence, supporting info, the recorded AI draft, ready for approval", async () => {
    const ev = await run(CAFE, { rewind: true });
    const a = assessmentOf(ev);
    expect(a.recommendation).toMatchObject({ strategy: "FIGHT", action: { kind: "provide_supporting_info" } });
    expect(a.recommendation.wait).toBeUndefined();
    expect(a.strength.level).toBe("HIGH");
    const d = draftOf(ev);
    expect(d.origin).toBe("ai");
    expect(d.fallbackReason).toBeUndefined();
    expect(d.draft?.recorded?.at).toBe(spec.aiDraft!._meta.recorded_at);
    expect(d.draft?.action).toEqual({ kind: "provide_supporting_info" });
    expect(approvalStep(ev)).toMatchObject({ status: "waiting" });
  });

  it("without the rewind it stays a closed case (hindsight review)", async () => {
    const ev = await run(CAFE);
    expect(approvalStep(ev).detail).toMatch(/hindsight review/);
  });
});

describe("sandbox decisions are labelled as ours", () => {
  it("every closed Replay case was decided by the sandbox test endpoint", () => {
    const closed = [...f.disputes.values()].filter((d) => d.status === "RESOLVED");
    expect(closed.length).toBeGreaterThan(0);
    for (const d of closed) expect(sandboxDecided(d)).toBe(true);
    expect(sandboxDecided({ status: "UNDER_REVIEW", adjudications: null })).toBe(false);
  });
});
