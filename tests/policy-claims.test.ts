import { describe, expect, it } from "vitest";
import { findPolicyClaim, stripPolicyClaims, validateDraft } from "@/lib/agent/validate";
import type { Draft } from "@/lib/llm/draft";

describe("policy / legal outcome guard", () => {
  it.each([
    ["Seller protection applies.", true],
    ["Strong seller protection here.", true],
    ["Purchase Protection covers this order.", true],
    ["You will win this case.", true],
    ["We are going to win.", true],
    ["PayPal must rule in our favor.", true],
    ["This is guaranteed.", true],
    ["The seller is fully protected.", true],
    ["The buyer is legally entitled to nothing.", true],
    ["The payment is eligible for Seller Protection per PayPal's record.", false],
    ["Seller protection status: ELIGIBLE.", false],
    ["Tracking shows the package was delivered.", false],
    ["We hope PayPal reviews the tracking.", false],
  ])("%s → banned %s", (text, banned) => {
    expect(Boolean(findPolicyClaim(text))).toBe(banned);
  });

  it("removes only the offending sentence", () => {
    expect(stripPolicyClaims("Delivered on Oct 5. Seller protection applies. Thanks!")).toEqual({ text: "Delivered on Oct 5. Thanks!", removed: ["Seller protection applies."] });
  });

  const draft = (over: Partial<Draft>): Draft => ({ origin: "ai", strategy: "FIGHT", action: null, rationale: "r", claims: [], sellerNote: "Delivered.", evidence: [], ...over });

  it("cleans note, rationale, buyer message and drops claims that state an outcome", () => {
    const r = validateDraft(
      draft({
        sellerNote: "Delivered to the right ZIP. Seller protection applies.",
        rationale: "Strong seller protection here. Delivery is proven.",
        buyerMessage: { language: "en", text: "Hi! You will win nothing. It was delivered.", englishGloss: "" },
        claims: [{ text: "PayPal must side with us", sourceRefs: ["x"] }],
      }),
      [{ sourceRef: "x", kind: "order", label: "o", text: "o", facts: {} }],
      { disputeId: "D", reason: "R", amount: 1, currency: "USD", allowedActions: [] },
    );
    expect(r.draft.sellerNote).toBe("Delivered to the right ZIP.");
    expect(r.draft.rationale).toBe("Delivery is proven.");
    expect(r.draft.claims).toEqual([]);
    expect(r.issues.filter((i) => i.code === "policy_claim")).toHaveLength(4);
    expect(r.draft.buyerMessage?.text).toBe("Hi! It was delivered.");
    expect(r.ok).toBe(true);
  });

  it("a note that is nothing but an outcome claim blocks the draft (falls back to TEMPLATE)", () => {
    const r = validateDraft(draft({ sellerNote: "Seller protection applies." }), [], { disputeId: "D", reason: "R", amount: 1, currency: "USD", allowedActions: [] });
    expect(r.ok).toBe(false);
  });
});

describe("Seller Protection statements need PayPal's record", () => {
  const capture = (status?: string) => ({ sourceRef: "capture:C1", kind: "capture" as const, label: "Payment", text: "t", facts: { sellerProtection: status } });
  const ctx = { disputeId: "D", reason: "R", amount: 1, currency: "USD", allowedActions: [] };
  const d = (note: string): Draft => ({ origin: "ai", strategy: "FIGHT", action: null, rationale: "r", claims: [], sellerNote: note, evidence: [] });

  it("keeps 'eligible for Seller Protection per PayPal's record' when the capture is ELIGIBLE", () => {
    const r = validateDraft(d("Delivered. The payment is eligible for Seller Protection per PayPal's record."), [capture("ELIGIBLE")], ctx);
    expect(r.draft.sellerNote).toContain("Seller Protection");
  });

  it.each([undefined, "NOT_ELIGIBLE", "PARTIALLY_ELIGIBLE"])("removes it when the capture says %s", (status) => {
    const r = validateDraft(d("Delivered. The payment is eligible for Seller Protection per PayPal's record."), [capture(status)], ctx);
    expect(r.draft.sellerNote).toBe("Delivered.");
  });

  it("noteSources links a Seller Protection sentence and mentioned ids to their records", async () => {
    const { noteSources } = await import("@/lib/agent/note-sources");
    const ev = [
      capture("ELIGIBLE"),
      { sourceRef: "order:O77", kind: "order" as const, label: "Order", text: "", facts: {} },
      { sourceRef: "pptrack:C1:9400123", kind: "paypal_tracking" as const, label: "Tracking", text: "", facts: { trackingNumber: "9400123" } },
    ];
    expect(noteSources("Order O77 shipped with 9400123. Eligible for Seller Protection per PayPal's record.", ev).sort()).toEqual(["capture:C1", "order:O77", "pptrack:C1:9400123"]);
    expect(noteSources("Nothing to cite here.", ev)).toEqual([]);
  });
});

describe("human prose", () => {
  it.each([
    ["delivered on 2026-10-05 at 18:58.", "delivered on 5 Oct, 6:58 PM UTC."],
    ["opened 2026-10-05T17:27:52.611Z", "opened 5 Oct, 5:27 PM UTC"],
    ["shipped 2026-10-09", "shipped 9 Oct"],
    ["Eligible per PayPal's record (capture:5HF82502Y85788524).", "Eligible per PayPal's record."],
    ["at 00:05 on 2026-01-02 00:05 UTC", "at 00:05 on 2 Jan, 12:05 AM UTC"],
  ])("%s → %s", async (a, b) => {
    const { humanizeProse } = await import("@/lib/agent/validate");
    expect(humanizeProse(a)).toBe(b);
  });

  it("validateDraft humanizes note, claims and buyer message", () => {
    const r = validateDraft(
      { origin: "ai", strategy: "FIGHT", action: null, rationale: "r", claims: [{ text: "Delivered 2026-10-05 at 18:58", sourceRefs: ["x"] }], sellerNote: "Delivered on 2026-10-05 at 18:58 (capture:C1).", buyerMessage: { language: "en", text: "It arrived 2026-10-05." }, evidence: [] },
      [{ sourceRef: "x", kind: "order", label: "o", text: "o", facts: {} }],
      { disputeId: "D", reason: "R", amount: 1, currency: "USD", allowedActions: [] },
    );
    expect(r.draft.sellerNote).toBe("Delivered on 5 Oct, 6:58 PM UTC.");
    expect(r.draft.claims[0].text).toBe("Delivered 5 Oct, 6:58 PM UTC");
    expect(r.draft.buyerMessage?.text).toBe("It arrived 5 Oct.");
  });
});
