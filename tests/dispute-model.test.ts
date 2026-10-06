import { describe, expect, it } from "vitest";
import { clockOf, outcomeOf, provenanceOf, reasonLabel, toContext, type DisputeRecord } from "@/lib/disputes/model";
import { loadFixtures } from "@/lib/replay/fixtures";

const base: DisputeRecord = { dispute_id: "PP-R-X", seller_response_due_date: "2026-10-20T00:00:00Z", buyer_response_due_date: "2026-10-21T00:00:00Z" };

describe("clockOf: who must act next", () => {
  it.each([
    ["WAITING_FOR_SELLER_RESPONSE", "seller", "2026-10-20T00:00:00Z"],
    ["WAITING_FOR_BUYER_RESPONSE", "buyer", "2026-10-21T00:00:00Z"],
    ["UNDER_REVIEW", "paypal", undefined],
    ["OPEN", "paypal", undefined],
    ["RESOLVED", "closed", undefined],
  ])("%s → %s", (status, owner, dueAt) => {
    const clock = clockOf({ ...base, status });
    expect(clock.owner).toBe(owner);
    expect(clock.dueAt).toBe(dueAt);
  });
});

describe("outcomeOf", () => {
  it.each([
    [{ status: "RESOLVED", dispute_outcome: { outcome_code: "RESOLVED_SELLER_FAVOUR" } }, "won"],
    [{ status: "RESOLVED", dispute_outcome: { outcome_code: "CANCELED_BY_BUYER" } }, "won"],
    [{ status: "RESOLVED", dispute_outcome: { outcome_code: "RESOLVED_BUYER_FAVOUR" } }, "lost"],
    [{ status: "RESOLVED", dispute_outcome: { outcome_code: "RESOLVED_WITH_PAYOUT" } }, "settled"],
    [{ status: "UNDER_REVIEW" }, "open"],
  ] as const)("%j → %s", (d, outcome) => {
    expect(outcomeOf({ ...base, ...d })).toBe(outcome);
  });
});

describe("toContext from a recorded dispute", () => {
  it("takes allowed actions only from HATEOAS links and keeps PayPal's accept-claim types", () => {
    const d3 = loadFixtures().disputes.get("PP-R-MQR-10190375")!;
    expect(toContext(d3)).toMatchObject({
      disputeId: "PP-R-MQR-10190375",
      reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
      amount: 12.75,
      currency: "USD",
      stage: "INQUIRY",
      allowedActions: ["send_message", "escalate", "accept_claim"],
      allowedAcceptClaimTypes: ["REFUND"],
    });
  });
});

describe("labels and provenance", () => {
  it("labels reasons for people", () => {
    expect(reasonLabel("MERCHANDISE_OR_SERVICE_NOT_RECEIVED")).toBe("Item not received");
    expect(reasonLabel("SOMETHING_NEW")).toBe("something new");
  });

  it.each([
    ["dispute", "paypal"],
    ["dispute_message", "paypal"],
    ["order", "paypal"],
    ["capture", "paypal"],
    ["paypal_tracking", "paypal"],
    ["carrier_event", "carrier"],
    ["store_log", "store"],
    ["chat", "store"],
    ["listing", "store"],
  ] as const)("%s comes from %s", (kind, p) => {
    expect(provenanceOf(kind)).toBe(p);
  });
});
