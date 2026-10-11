import { describe, expect, it } from "vitest";
import { proofFromDispute, proofHeadline } from "@/lib/paypal/proof";
import { loadFixtures } from "@/lib/replay/fixtures";

describe("PayPal API response proof", () => {
  const meta = { source: "live" as const, httpStatus: 200, debugId: "f00dbabe123", fetchedAt: "2026-10-12T10:00:00Z", disputeId: "PP-R-CMR-10190364" };

  it("keeps only whitelisted, non-personal fields from the real response", () => {
    const d = loadFixtures(undefined, { withArchive: true }).disputes.get("PP-R-CMR-10190364")!;
    const p = proofFromDispute(d as never, meta);
    expect(p).toEqual({
      source: "live",
      method: "GET",
      endpoint: "/v1/customer/disputes/PP-R-CMR-10190364",
      httpStatus: 200,
      disputeId: "PP-R-CMR-10190364",
      status: "RESOLVED",
      stage: "CHARGEBACK",
      outcome: "RESOLVED_SELLER_FAVOUR",
      updatedAt: d.update_time,
      debugId: "f00dbabe123",
      fetchedAt: "2026-10-12T10:00:00Z",
    });
    expect(JSON.stringify(p)).not.toMatch(/@|email|address|name/i);
  });

  it.each([
    [{ status: "RESOLVED", outcome: "RESOLVED_SELLER_FAVOUR" }, "RESOLVED · SELLER_FAVOUR"],
    [{ status: "RESOLVED", outcome: "RESOLVED_BUYER_FAVOUR" }, "RESOLVED · BUYER_FAVOUR"],
    [{ status: "WAITING_FOR_BUYER_RESPONSE" }, "WAITING_FOR_BUYER_RESPONSE"],
  ])("%j → %s", (p, h) => {
    expect(proofHeadline(p)).toBe(h);
  });
});
