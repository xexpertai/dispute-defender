import { describe, expect, it } from "vitest";
import { bucketOf, formatCountdown, rank, summarize, toRow, urgency, type GuardianRow } from "@/lib/dashboard/guardian";
import type { DisputeRecord } from "@/lib/disputes/model";
import { loadFixtures } from "@/lib/replay/fixtures";

const NOW = new Date("2026-10-06T12:00:00Z");
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

const dispute = (over: Partial<DisputeRecord>): DisputeRecord => ({
  dispute_id: "PP-R-X",
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  status: "WAITING_FOR_SELLER_RESPONSE",
  dispute_life_cycle_stage: "INQUIRY",
  dispute_amount: { value: "100.00", currency_code: "USD" },
  ...over,
});

describe("deadline buckets and urgency", () => {
  it.each([
    [null, "none"],
    [-0.5, "overdue"],
    [0, "due_48h"],
    [47.9, "due_48h"],
    [48, "due_7d"],
    [167.9, "due_7d"],
    [168, "later"],
  ] as const)("hoursLeft %s → %s", (h, bucket) => {
    expect(bucketOf(h)).toBe(bucket);
  });

  it.each([
    ["seller", "overdue", 3],
    ["seller", "due_48h", 2],
    ["seller", "due_7d", 1.2],
    ["seller", "later", 1],
    ["seller", "none", 1],
    ["buyer", "due_48h", 0.5],
    ["paypal", "none", 0.5],
    ["closed", "none", 0],
  ] as const)("%s clock, %s → urgency %s", (owner, bucket, u) => {
    expect(urgency(owner, bucket)).toBe(u);
  });
});

describe("priority = $ at risk × urgency", () => {
  it.each([
    ["your move, overdue", dispute({ seller_response_due_date: hoursFromNow(-2) }), "seller", "overdue", 300],
    ["your move, due in 10h", dispute({ seller_response_due_date: hoursFromNow(10) }), "seller", "due_48h", 200],
    ["your move, due in 5d", dispute({ seller_response_due_date: hoursFromNow(120) }), "seller", "due_7d", 120],
    ["your move, due in 15d", dispute({ seller_response_due_date: hoursFromNow(360) }), "seller", "later", 100],
    ["buyer to reply", dispute({ status: "WAITING_FOR_BUYER_RESPONSE", buyer_response_due_date: hoursFromNow(5) }), "buyer", "due_48h", 50],
    ["PayPal reviewing", dispute({ status: "UNDER_REVIEW" }), "paypal", "none", 50],
    ["resolved", dispute({ status: "RESOLVED", dispute_outcome: { outcome_code: "RESOLVED_SELLER_FAVOUR" } }), "closed", "none", 0],
  ])("%s", (_name, d, owner, bucket, priority) => {
    const row = toRow(d, NOW);
    expect(row.clock.owner).toBe(owner);
    expect(row.bucket).toBe(bucket);
    expect(row.priority).toBe(priority);
  });

  it("ranks by priority, then nearest deadline, then amount", () => {
    const rows = [
      toRow(dispute({ dispute_id: "PP-A", dispute_amount: { value: "40.00", currency_code: "USD" }, seller_response_due_date: hoursFromNow(300) }), NOW), // 40
      toRow(dispute({ dispute_id: "PP-B", dispute_amount: { value: "30.00", currency_code: "USD" }, seller_response_due_date: hoursFromNow(-1) }), NOW), // 90
      toRow(dispute({ dispute_id: "PP-C", dispute_amount: { value: "45.00", currency_code: "USD" }, seller_response_due_date: hoursFromNow(20) }), NOW), // 90, sooner
      toRow(dispute({ dispute_id: "PP-D", dispute_amount: { value: "500.00", currency_code: "USD" }, status: "UNDER_REVIEW" }), NOW), // 250
    ];
    expect(rank(rows).map((r: GuardianRow) => r.id)).toEqual(["PP-D", "PP-B", "PP-C", "PP-A"]);
  });
});

describe("guardian summary over the recorded sandbox fixtures (Replay)", () => {
  const f = loadFixtures();
  const s = summarize([...f.disputes.values()], new Date(f.snapshotAt));

  it("counts $ at risk only for open disputes and reports real outcomes", () => {
    expect(s.openCount).toBe(2);
    expect(s.atRisk).toBe(22.25); // D3 12.75 + D4 9.50
    expect(s.won).toEqual({ count: 1, amount: 12 }); // D1
    expect(s.lost).toEqual({ count: 1, amount: 12.5 }); // D2, amount_refunded
    expect(s.yourMove).toBe(1); // D4 after sandbox require-evidence
    expect(s.dueSoon).toBe(0); // PayPal gave D4 ~3d 8h
  });

  it("puts your-move D4 (claim, seller deadline) above the buyer-clock inquiry D3", () => {
    expect(s.open.map((r) => [r.id, r.clock.owner, r.bucket])).toEqual([
      ["PP-R-PLP-10190379", "seller", "due_7d"],
      ["PP-R-MQR-10190375", "buyer", "later"],
    ]);
    expect(s.open[0].priority).toBe(11.4); // 9.50 × 1.2
    expect(s.open[0].actions).toEqual(["provide_evidence", "accept_claim"]);
    expect(s.open[1].actions).not.toContain("adjudicate"); // sandbox-only sims are never shown as seller actions
  });
});

describe("formatCountdown", () => {
  it.each([
    [null, "no deadline"],
    [478.3, "19d 22h"],
    [5.2, "5h 12m"],
    [0.25, "15m"],
    [-3, "overdue 3h 0m"],
    [-30, "overdue 1d 6h"],
  ] as const)("%s → %s", (h, text) => {
    expect(formatCountdown(h)).toBe(text);
  });
});

describe("dashboard showcase (lead with a defended case)", () => {
  it("leads with the first FIGHT case and offers a REFUND/OFFER case second", async () => {
    const { pickShowcase } = await import("@/lib/dashboard/showcase");
    const rows = ["PP-A", "PP-B", "PP-C"].map((id) => toRow(dispute({ dispute_id: id }), NOW));
    const s = pickShowcase(rows, new Map([["PP-A", "REFUND"], ["PP-B", "FIGHT"], ["PP-C", "OFFER"]] as const));
    expect([s.lead?.id, s.settle?.id]).toEqual(["PP-B", "PP-A"]);
    expect(pickShowcase(rows, new Map()).lead?.id).toBe("PP-A");
  });

  it("on the recorded fixtures: leads with D3 (delivered, Spanish reply), then D4 (refund)", async () => {
    const { pickShowcase, rulesStrategies } = await import("@/lib/dashboard/showcase");
    const { ReplayGateway } = await import("@/lib/agent/gateway");
    const { MockCarrier } = await import("@/lib/carrier/mock");
    const { SampleStore } = await import("@/lib/samples/store");
    const f = loadFixtures();
    const s = summarize([...f.disputes.values()], new Date(f.snapshotAt));
    const strat = await rulesStrategies(s.open.map((r) => r.id), { gateway: new ReplayGateway(f), carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store) });
    const show = pickShowcase(s.open, strat);
    expect([show.lead?.id, show.settle?.id]).toEqual(["PP-R-MQR-10190375", "PP-R-PLP-10190379"]);
  });
});
