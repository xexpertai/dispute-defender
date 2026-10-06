import { describe, expect, it } from "vitest";
import { fromCarrierTracking, fromDispute, fromOrder, fromPayPalTrackers, fromStoreLog, type CarrierEvent } from "@/lib/evidence/sources";
import type { EvidenceItem } from "@/lib/evidence/types";
import { assess, type DisputeContext, type Strategy } from "@/lib/strategy/rules";

/**
 * Reason × evidence matrix. Each row is one seller situation; the expected strategy, action and
 * buyer-fair flag are the product's promise ("it tells you when to fight, and when the buyer is right").
 */
const NOW = new Date("2026-10-06T12:00:00Z");
const ALL = ["make_offer", "escalate", "accept_claim", "provide_evidence", "send_message"];

const order = (amount: number, zip = "95131") => fromOrder({ id: "O1", purchase_units: [{ amount: { value: amount.toFixed(2), currency_code: "USD" }, shipping: { address: { postal_code: zip, country_code: "US" } } }] });
const pp = () => fromPayPalTrackers([{ transaction_id: "C1", tracking_number: "9400", carrier: "USPS" }]);
const scans = (...codes: [CarrierEvent["code"], string?, boolean?][]) =>
  fromCarrierTracking({ carrier: "USPS", trackingNumber: "9400", events: codes.map(([code, zip, signature], i) => ({ code, at: `2026-10-0${i + 1}T10:00:00Z`, postalCode: zip, signature })) });
const buyerMsg = () => fromDispute({ dispute_id: "D", messages: [{ posted_by: "BUYER", content: "It arrived cracked." }] }).slice(1);
const store = (tags: Record<string, unknown>) => fromStoreLog("INV1", [{ author: "seller", text: "note", tags }]);
const listing = (): EvidenceItem[] => [{ sourceRef: "listing:SKU", kind: "listing", label: "Listing", text: "x", facts: {} }];

type Row = [name: string, reason: string, amount: number, evidence: EvidenceItem[], allowed: string[], strategy: Strategy, action: string | null, buyerFair: boolean];

const INR = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED";
const SNAD = "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED";
const UNAUTH = "UNAUTHORISED";

const rows: Row[] = [
  // item not received
  ["INR · delivered, ZIP match, on file at PayPal", INR, 89, [...order(89), ...pp(), ...scans(["ACCEPTED", "10001"], ["DELIVERED", "95131"])], ALL, "FIGHT", "provide_evidence", false],
  ["INR · delivered, inquiry allows message only", INR, 89, [...order(89), ...pp(), ...scans(["DELIVERED", "95131"])], ["send_message", "accept_claim"], "FIGHT", "send_message", false],
  ["INR · delivered to another ZIP", INR, 89, [...order(89), ...pp(), ...scans(["DELIVERED", "60601"])], ALL, "REFUND", "accept_claim", true],
  ["INR · returned to sender", INR, 89, [...order(89), ...pp(), ...scans(["ACCEPTED"], ["RETURNED_TO_SENDER"])], ALL, "REFUND", "accept_claim", true],
  ["INR · no tracking at all", INR, 89, order(89), ALL, "REFUND", "accept_claim", true],
  ["INR · in transit, can message", INR, 89, [...order(89), ...pp(), ...scans(["ACCEPTED"], ["IN_TRANSIT"])], ALL, "FIGHT", "send_message", false],
  ["INR · in transit, claim stage, small amount", INR, 9.5, [...order(9.5), ...pp(), ...scans(["ACCEPTED"])], ["accept_claim"], "REFUND", "accept_claim", false],
  ["INR · tracking on file only (no scans), mid amount", INR, 40, [...order(40), ...pp()], ALL, "OFFER", "make_offer", false],
  ["INR · seller admits fault despite delivery", INR, 89, [...order(89), ...pp(), ...scans(["DELIVERED", "95131"]), ...store({ sellerAdmitsFault: true })], ALL, "REFUND", "accept_claim", true],
  ["INR · nothing allowed by PayPal", INR, 89, [...order(89), ...pp(), ...scans(["DELIVERED", "95131"])], [], "FIGHT", null, false],
  // not as described
  ["SNAD · photos + listing vs buyer complaint", SNAD, 64, [...order(64), ...listing(), ...store({ photosBeforeShipping: true }), ...buyerMsg()], ALL, "OFFER", "make_offer", false],
  ["SNAD · only the buyer's complaint", SNAD, 64, [...order(64), ...buyerMsg()], ALL, "REFUND", "accept_claim", false],
  ["SNAD · small amount → refund beats fighting", SNAD, 8, [...order(8), ...listing(), ...store({ photosBeforeShipping: true }), ...buyerMsg()], ALL, "REFUND", "accept_claim", false],
  // unauthorized
  ["UNAUTH · delivered to ship-to + repeat buyer", UNAUTH, 120, [...order(120), ...pp(), ...scans(["DELIVERED", "95131", true]), ...store({ buyerPriorOrders: 3 })], ALL, "FIGHT", "provide_evidence", false],
  ["UNAUTH · no shipping proof, first order", UNAUTH, 120, order(120), ALL, "REFUND", "accept_claim", false],
];

describe("strategy matrix: reason × evidence", () => {
  it.each(rows)("%s", (_name, reason, amount, evidence, allowed, strategy, action, buyerFair) => {
    const ctx: DisputeContext = { disputeId: "PP-R-M", reason, amount, currency: "USD", status: "WAITING_FOR_SELLER_RESPONSE", stage: "INQUIRY", allowedActions: allowed };
    const a = assess(ctx, evidence, NOW);
    expect({ strategy: a.recommendation.strategy, action: a.recommendation.action?.kind ?? null, buyerFair: a.recommendation.buyerFair }).toEqual({ strategy, action, buyerFair });
    // honesty invariants for every row
    const refs = new Set(evidence.map((e) => e.sourceRef));
    for (const r of a.strength.reasons) for (const ref of r.sourceRefs) expect(refs.has(ref), ref).toBe(true);
    if (a.recommendation.action?.amount) expect(Number(a.recommendation.action.amount.value)).toBeLessThanOrEqual(amount);
    if (a.recommendation.action) expect(allowed).toContain(a.recommendation.action.kind);
    expect(a.recommendation.why.length).toBeGreaterThan(0);
  });

  it("delivery after the case was opened is a cited, seller-supporting reason (premature INR)", () => {
    const opened = fromDispute({ dispute_id: "D", create_time: "2026-10-01T09:00:00Z" });
    const ev = [...opened, ...order(89), ...pp(), ...scans(["ACCEPTED"], ["DELIVERED", "95131"])];
    const a = assess({ disputeId: "D", reason: INR, amount: 89, currency: "USD", allowedActions: ALL }, ev, NOW);
    expect(a.strength.reasons.find((r) => r.id === "opened_before_delivery")?.sourceRefs).toEqual(["dispute:D", "track:USPS:9400#ev1"]);
  });

  it("a closed case explains itself as a hindsight review, not a retry", () => {
    const a = assess({ disputeId: "PP-R-C", reason: INR, amount: 12, currency: "USD", status: "RESOLVED", allowedActions: [] }, order(12), NOW);
    expect(a.recommendation.why.at(-1)).toMatch(/closed/);
  });
});
