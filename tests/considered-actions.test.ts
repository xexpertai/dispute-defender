import { describe, expect, it } from "vitest";
import { fromCarrierTracking, fromOrder, type CarrierEvent } from "@/lib/evidence/sources";
import { assess, consideredActions, type DisputeContext } from "@/lib/strategy/rules";

const NOW = new Date("2026-10-06T12:00:00Z");
const ctx = (over: Partial<DisputeContext> = {}): DisputeContext => ({
  disputeId: "PP-R-T",
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  amount: 312,
  currency: "USD",
  status: "UNDER_REVIEW",
  stage: "CHARGEBACK",
  sellerResponseDueDate: "2026-10-20T00:00:00Z",
  allowedActions: ["provide_supporting_info", "accept_claim", "require_evidence", "adjudicate"],
  ...over,
});
const order = fromOrder({ id: "O1", purchase_units: [{ amount: { value: "312.00", currency_code: "USD" }, shipping: { address: { postal_code: "95131", country_code: "US" } } }] });
const scan = (...events: CarrierEvent[]) => fromCarrierTracking({ carrier: "USPS", trackingNumber: "9400", events });
const shipped: CarrierEvent = { code: "ACCEPTED", at: "2026-09-30T10:00:00Z", postalCode: "10001" };
const delivered: CarrierEvent = { code: "DELIVERED", at: "2026-10-03T18:00:00Z", postalCode: "95131", signature: true };

describe("considered actions (HATEOAS choice made visible)", () => {
  it("lists only the seller actions PayPal links, marks the chosen one, and gives a reason for each", () => {
    const a = assess(ctx(), [...order, ...scan(shipped, delivered)], NOW);
    const c = a.recommendation.considered ?? [];
    expect(c.map((x) => x.kind)).toEqual(["provide_supporting_info", "accept_claim"]); // sandbox simulation rels dropped
    expect(c.filter((x) => x.chosen).map((x) => x.kind)).toEqual([a.recommendation.action?.kind]);
    expect(c.every((x) => x.note.length > 0)).toBe(true);
    expect(c.find((x) => x.kind === "accept_claim")?.note).toMatch(/give up a case/);
  });

  it("on hold (in transit), nothing is chosen and the evidence route says why it is held", () => {
    const a = assess(ctx({ amount: 120 }), [...order, ...scan(shipped)], NOW);
    expect(a.recommendation.wait).toBe("awaiting_delivery");
    const c = a.recommendation.considered ?? [];
    expect(c.some((x) => x.chosen)).toBe(false);
    expect(c.find((x) => x.kind === "provide_supporting_info")?.note).toMatch(/no delivery scan/);
  });

  it("closed cases carry no considered list; no links means an empty list", () => {
    expect(assess(ctx({ status: "RESOLVED", allowedActions: [] }), order, NOW).recommendation.considered).toBeUndefined();
    expect(consideredActions([], "FIGHT", null, "no_allowed_action", false)).toEqual([]);
  });
});
