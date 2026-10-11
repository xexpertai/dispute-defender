import { describe, expect, it } from "vitest";
import { testTheChecker } from "@/lib/agent/checker";
import { fromCarrierTracking, fromOrder, fromPayPalTrackers } from "@/lib/evidence/sources";
import { templateDraft } from "@/lib/llm/draft";
import { assess, type DisputeContext } from "@/lib/strategy/rules";
import type { StoredDraft } from "@/lib/store/drafts";

const NOW = new Date("2026-10-07T18:00:00Z");
const ctx: DisputeContext = { disputeId: "PP-R-C", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", amount: 312, currency: "USD", status: "UNDER_REVIEW", allowedActions: ["provide_supporting_info", "accept_claim"] };
const evidence = [
  ...fromOrder({ id: "O1", purchase_units: [{ amount: { value: "312.00", currency_code: "USD" }, shipping: { address: { postal_code: "95131" } } }] }),
  ...fromPayPalTrackers([{ transaction_id: "C1", tracking_number: "9400", carrier: "USPS" }]),
  ...fromCarrierTracking({ carrier: "USPS", trackingNumber: "9400", events: [{ code: "DELIVERED", at: "2026-10-07T15:05:00Z", postalCode: "95131", signature: true }] }),
];

describe("test our checker (made-up claims injected into a real draft, validated server-side)", () => {
  it("catches a claim citing a record that doesn't exist and a policy outcome only PayPal can decide", () => {
    const a = assess(ctx, evidence, NOW);
    const draft = templateDraft({ disputeId: ctx.disputeId, reason: ctx.reason, amount: 312, currency: "USD", assessment: a, evidence, buyerMessages: [], sellerTone: "friendly", allowedActions: ctx.allowedActions });
    const stored: StoredDraft = { id: "run_x_d1", runId: "run_x", disputeId: "PP-R-C", mode: "replay", reason: ctx.reason, amount: 312, currency: "USD", draft, packRefs: [], packItems: evidence, createdAt: NOW.toISOString() };
    const r = testTheChecker(stored);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ caught: true, reason: "cites a record that doesn't exist" });
    expect(r[1]).toMatchObject({ caught: true, reason: "states an outcome only PayPal can decide" });
    expect(stored.draft.claims.some((c) => /second package|Seller Protection/.test(c.text))).toBe(false); // nothing saved
  });
});
