import { describe, expect, it } from "vitest";
import { fromCarrierTracking, fromChat, fromOrder, fromPayPalTrackers, fromStoreLog, type CarrierEvent } from "@/lib/evidence/sources";
import type { EvidenceItem } from "@/lib/evidence/types";
import { assess, deadlinePriority, type DisputeContext } from "@/lib/strategy/rules";

const NOW = new Date("2026-10-06T12:00:00Z");
const INR = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED";
const SNAD = "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED";

const ctx = (over: Partial<DisputeContext> = {}): DisputeContext => ({
  disputeId: "PP-R-T",
  reason: INR,
  amount: 89,
  currency: "USD",
  status: "WAITING_FOR_SELLER_RESPONSE",
  stage: "INQUIRY",
  sellerResponseDueDate: "2026-10-20T00:00:00Z",
  allowedActions: ["make_offer", "escalate", "accept_claim", "provide_evidence", "send_message"],
  allowedOfferTypes: ["REFUND", "REFUND_WITH_RETURN"],
  allowedAcceptClaimTypes: ["REFUND", "PARTIAL_REFUND"],
  ...over,
});

const order = (zip = "95131", amount = "89.00") =>
  fromOrder({ id: "O1", purchase_units: [{ amount: { value: amount, currency_code: "USD" }, shipping: { address: { postal_code: zip, country_code: "US" } } }] });
const scans = (...events: CarrierEvent[]) => fromCarrierTracking({ carrier: "USPS", trackingNumber: "9400", events });
const delivered = (zip = "95131", signature = false): CarrierEvent => ({ code: "DELIVERED", at: "2026-10-03T18:00:00Z", postalCode: zip, signature });
const shipped: CarrierEvent = { code: "ACCEPTED", at: "2026-09-30T10:00:00Z", postalCode: "10001" };

const ids = (a: ReturnType<typeof assess>) => a.strength.reasons.map((r) => r.id);
const allRefsExist = (a: ReturnType<typeof assess>, ev: EvidenceItem[]) => {
  const refs = new Set(ev.map((e) => e.sourceRef));
  for (const r of a.strength.reasons) for (const ref of r.sourceRefs) expect(refs.has(ref), ref).toBe(true);
  for (const e of a.evidenceToSubmit) for (const ref of e.sourceRefs) expect(refs.has(ref), ref).toBe(true);
};

describe("strategy rules: item not received", () => {
  it("delivered + ZIP match + signature + tracking at PayPal → HIGH, FIGHT with tracking evidence", () => {
    const ev = [...order(), ...scans(shipped, delivered("95131", true)), ...fromPayPalTrackers([{ transaction_id: "T1", tracking_number: "9400", carrier: "USPS" }])];
    const a = assess(ctx(), ev, NOW);
    expect(a.strength.level).toBe("HIGH");
    expect(ids(a)).toEqual(["tracking_at_paypal", "delivered_scan", "zip_match", "signature"]);
    expect(a.recommendation).toMatchObject({ strategy: "FIGHT", buyerFair: false, action: { kind: "provide_evidence" } });
    expect(a.evidenceToSubmit[0]).toEqual({ evidence_type: "PROOF_OF_FULFILLMENT", tracking_info: [{ carrier_name: "USPS", tracking_number: "9400" }], sourceRefs: ["track:USPS:9400#ev1"] });
    allRefsExist(a, ev);
  });

  it("no tracking at all → REFUND because the seller can't prove delivery (not 'the buyer is right')", () => {
    const ev = order();
    const a = assess(ctx(), ev, NOW);
    expect(a.recommendation).toMatchObject({ strategy: "REFUND", buyerFair: true, unprovable: true, action: { kind: "accept_claim", acceptClaimType: "REFUND" } });
    expect(a.recommendation.why.join(" ")).toMatch(/can't prove delivery/);
    expect(JSON.stringify(a.recommendation)).not.toMatch(/buyer is right|supports the buyer|favours the buyer/i);
    expect(a.strength).toMatchObject({ level: "LOW" });
    expect(a.strength.reasons[0]).toMatchObject({ id: "no_tracking", supports: "buyer", decisive: true, sourceRefs: ["order:O1"] });
    expect(a.evidenceToSubmit).toEqual([]);
  });

  it("buyer-fair: delivered to a different ZIP → REFUND even though a delivery scan exists", () => {
    const ev = [...order("95131"), ...scans(shipped, delivered("60601"))];
    const a = assess(ctx(), ev, NOW);
    expect(ids(a)).toContain("zip_mismatch");
    expect(a.recommendation).toMatchObject({ strategy: "REFUND", buyerFair: true });
    expect(a.recommendation.unprovable).toBeUndefined();
  });

  it("buyer-fair: returned to sender → REFUND", () => {
    const ev = [...order(), ...scans(shipped, { code: "RETURNED_TO_SENDER", at: "2026-10-04T10:00:00Z" })];
    expect(assess(ctx(), ev, NOW).recommendation).toMatchObject({ strategy: "REFUND", buyerFair: true });
  });

  it("still in transit during inquiry → message the buyer with tracking first", () => {
    const ev = [...order(), ...scans(shipped, { code: "IN_TRANSIT", at: "2026-10-05T10:00:00Z" })];
    const a = assess(ctx(), ev, NOW);
    expect(a.recommendation).toMatchObject({ strategy: "FIGHT", buyerFair: false, action: { kind: "send_message" } });
    expect(a.recommendation.why[0]).toMatch(/still on its way/);
  });

  it("cost-to-fight: small dispute with only medium evidence → REFUND to save time", () => {
    const ev = [...order("95131", "9.00"), ...scans(shipped, { code: "OUT_FOR_DELIVERY", at: "2026-10-03T08:00:00Z" }), ...fromPayPalTrackers([{ transaction_id: "T1", tracking_number: "9400", carrier: "USPS" }])];
    const a = assess(ctx({ amount: 9, allowedActions: ["accept_claim", "make_offer"] }), ev, NOW);
    expect(a.costToFight).toBe(12.5);
    expect(a.recommendation.strategy).toBe("REFUND");
    expect(a.recommendation.why.join(" ")).toMatch(/costs more than (refunding|the refund)/);
  });

  it("claim stage (no make_offer/send_message): FIGHT sends evidence through whichever endpoint PayPal offers", () => {
    const ev = [...order(), ...scans(shipped, delivered())];
    expect(assess(ctx({ stage: "CHARGEBACK", allowedActions: ["provide_evidence", "accept_claim"] }), ev, NOW).recommendation.action).toEqual({ kind: "provide_evidence" });
    // Under PayPal review: the evidence goes in as supporting info (the evidence pack is attached).
    const review = assess(ctx({ stage: "CHARGEBACK", status: "UNDER_REVIEW", allowedActions: ["provide_supporting_info", "accept_claim"] }), ev, NOW);
    expect(review.recommendation.action).toEqual({ kind: "provide_supporting_info" });
    expect(review.evidenceToSubmit.length).toBeGreaterThan(0);
    const none = assess(ctx({ stage: "CHARGEBACK", status: "UNDER_REVIEW", allowedActions: [] }), ev, NOW);
    expect(none.recommendation.action).toBeNull();
    expect(none.recommendation.why.at(-1)).toMatch(/hasn't opened a response window yet/);
    expect(none.recommendation.wait).toBe("no_allowed_action");
    // Only the sandbox simulation links: still no seller action, so still on hold.
    const simOnly = assess(ctx({ stage: "CHARGEBACK", status: "UNDER_REVIEW", allowedActions: ["adjudicate", "require_evidence"] }), ev, NOW);
    expect(simOnly.recommendation).toMatchObject({ action: null, wait: "no_allowed_action" });
    // Some seller action exists, just not the one the strategy needs.
    const other = assess(ctx({ stage: "CHARGEBACK", status: "UNDER_REVIEW", allowedActions: ["accept_claim"] }), ev, NOW);
    expect(other.recommendation.why.at(-1)).toMatch(/does not allow this action right now/);
    // Closed: a hindsight review, never "on hold".
    const closed = assess(ctx({ stage: "CHARGEBACK", status: "RESOLVED", allowedActions: [] }), ev, NOW);
    expect(closed.recommendation.wait).toBeUndefined();
  });
});

describe("strategy rules: not as described", () => {
  it("mixed evidence → OFFER refund with return (full amount, item comes back)", () => {
    const ev = [
      ...order(),
      { sourceRef: "listing:MUG-01", kind: "listing", label: "Listing", text: "Blue ceramic mug set of 4", facts: {} } as EvidenceItem,
      ...fromStoreLog("DD-1", [{ author: "seller", text: "Packed 4 mugs, photos attached", tags: { photosBeforeShipping: true } }]),
      { sourceRef: "dispute:PP-R-T#msg0", kind: "dispute_message", label: "Buyer message", text: "Mugs are green not blue", facts: { postedBy: "BUYER" } } as EvidenceItem,
    ];
    const a = assess(ctx({ reason: SNAD }), ev, NOW);
    expect(a.strength.level).toBe("MEDIUM");
    // A partial refund without a return (PayPal needs a return address for REFUND_WITH_RETURN).
    expect(a.recommendation).toMatchObject({ strategy: "OFFER", action: { kind: "make_offer", offerType: "REFUND", amount: { value: "44.50", currency_code: "USD" } } });
    allRefsExist(a, ev);
  });

  it("buyer-fair: seller's own chat admits the mistake → REFUND, never fight", () => {
    const ev = [...order(), ...fromChat("t1", [{ author: "seller", text: "Sorry, we shipped the wrong colour", tags: { sellerAdmitsFault: true } }])];
    const a = assess(ctx({ reason: SNAD }), ev, NOW);
    expect(a.recommendation).toMatchObject({ strategy: "REFUND", buyerFair: true });
    expect(a.strength.reasons[0]).toMatchObject({ id: "seller_admits_fault", sourceRefs: ["chat:t1#line0"] });
  });
});

describe("strategy rules: unauthorised", () => {
  it("repeat buyer + delivered to the account's ZIP → FIGHT", () => {
    const ev = [...order(), ...scans(shipped, delivered()), ...fromStoreLog("DD-1", [{ author: "system", text: "Buyer account has 4 completed orders", tags: { buyerPriorOrders: 4 } }])];
    const a = assess(ctx({ reason: "UNAUTHORISED" }), ev, NOW);
    expect(ids(a)).toEqual(["delivered_scan", "zip_match", "repeat_buyer"]);
    expect(a.recommendation.strategy).toBe("FIGHT");
  });
});

describe("deadline guardian priority", () => {
  it.each([
    ["2026-10-06T06:00:00Z", "overdue", 267],
    ["2026-10-07T12:00:00Z", "due_48h", 178],
    ["2026-10-10T12:00:00Z", "due_7d", 106.8],
    ["2026-10-30T12:00:00Z", "later", 89],
  ] as const)("due %s → %s", (due, bucket, score) => {
    expect(deadlinePriority(89, due, "WAITING_FOR_SELLER_RESPONSE", NOW)).toMatchObject({ bucket, score });
  });

  it("resolved or no deadline → no priority", () => {
    expect(deadlinePriority(89, "2026-10-07T00:00:00Z", "RESOLVED", NOW).bucket).toBe("none");
    expect(deadlinePriority(89, undefined, "OPEN", NOW)).toEqual({ score: 0, bucket: "none", hoursLeft: null });
  });
});
