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
