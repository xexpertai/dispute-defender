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

  it("ranks your move first, then by priority, nearest deadline, amount", () => {
    const rows = [
      toRow(dispute({ dispute_id: "PP-A", dispute_amount: { value: "40.00", currency_code: "USD" }, seller_response_due_date: hoursFromNow(300) }), NOW), // 40
      toRow(dispute({ dispute_id: "PP-B", dispute_amount: { value: "30.00", currency_code: "USD" }, seller_response_due_date: hoursFromNow(-1) }), NOW), // 90
      toRow(dispute({ dispute_id: "PP-C", dispute_amount: { value: "45.00", currency_code: "USD" }, seller_response_due_date: hoursFromNow(20) }), NOW), // 90, sooner
      toRow(dispute({ dispute_id: "PP-D", dispute_amount: { value: "500.00", currency_code: "USD" }, status: "UNDER_REVIEW" }), NOW), // 250
    ];
    // Your move first (seller deadlines), then priority: PP-D (PayPal reviewing, no seller clock) comes last.
    expect(rank(rows).map((r: GuardianRow) => r.id)).toEqual(["PP-B", "PP-C", "PP-A", "PP-D"]);
  });
});

describe("guardian summary over the recorded sandbox fixtures (Replay)", () => {
  const f = loadFixtures();
  const s = summarize([...f.disputes.values()], new Date(f.snapshotAt));

  it("counts $ at risk only for open disputes (Kiln & Clay only; D1–D4 are archived)", () => {
    expect(s.openCount).toBe(5);
    expect(s.atRisk).toBe(286); // 142 + 64 + 42 + 28.50 + 9.50
    expect(s.won).toEqual({ count: 2, amount: 401 }); // the bowl $89 + the cafe $312, decided live in the sandbox (RESOLVED · SELLER_FAVOUR)
    expect(s.lost).toEqual({ count: 0, amount: 0 });
    expect(s.yourMove).toBe(2); // the two KC inquiries
    expect(s.dueSoon).toBe(0);
  });

  it("ranks your move first, then $ × urgency (PayPal-review claims have no seller clock)", () => {
    expect(s.open.map((r) => [r.id, r.clock.owner, r.bucket])).toEqual([
      ["PP-R-KFL-10190426", "seller", "later"], // $64 mugs inquiry
      ["PP-R-VYZ-10190425", "seller", "later"], // $42 plates inquiry
      ["PP-R-KWQ-10190429", "paypal", "none"], // $142 platter, PayPal reviewing
      ["PP-R-FDW-10190427", "paypal", "none"], // $28.50 planter
      ["PP-R-OZN-10190428", "paypal", "none"], // $9.50 vase
    ]);
    for (const r of s.open) expect(r.actions).not.toContain("adjudicate"); // sandbox-only sims are never shown as seller actions
  });
});

describe("guardian summary over the archived M0 disputes (tests only)", () => {
  const f = loadFixtures(undefined, { withArchive: true });
  const s = summarize([...f.disputes.values()], new Date(f.snapshotAt));
  it("reports the real M0 outcomes and D4's seller deadline", () => {
    expect(s.won).toEqual({ count: 3, amount: 413 }); // D1 $12 + the KC bowl $89 + the KC cafe $312
    expect(s.lost).toEqual({ count: 1, amount: 12.5 }); // D2, amount_refunded
    const d4 = s.open.find((r) => r.id === "PP-R-PLP-10190379")!;
    expect(d4.priority).toBe(19); // 9.50 × 2: due 9 Oct 03:59 UTC, < 48 h after the replay snapshot (7 Oct, the cafe re-read)
    expect(d4.actions).toEqual(["provide_evidence", "accept_claim"]);
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
  it("never leads with a case on hold", async () => {
    const { pickShowcase } = await import("@/lib/dashboard/showcase");
    const rows = ["PP-A", "PP-B"].map((id) => toRow(dispute({ dispute_id: id }), NOW));
    const s = pickShowcase(rows, new Map([["PP-A", { strategy: "FIGHT" as const, strength: "HIGH" as const, wait: "no_allowed_action" }], ["PP-B", { strategy: "FIGHT" as const, strength: "MEDIUM" as const }]]));
    expect(s.lead?.id).toBe("PP-B");
  });

  it("leads with the first FIGHT case and offers a REFUND/OFFER case second", async () => {
    const { pickShowcase } = await import("@/lib/dashboard/showcase");
    const rows = ["PP-A", "PP-B", "PP-C"].map((id) => toRow(dispute({ dispute_id: id }), NOW));
    const v = (strategy: "FIGHT" | "OFFER" | "REFUND", strength: "HIGH" | "MEDIUM" | "LOW" = "HIGH") => ({ strategy, strength });
    const s = pickShowcase(rows, new Map([["PP-A", v("REFUND")], ["PP-B", v("FIGHT")], ["PP-C", v("OFFER")]]));
    expect([s.lead?.id, s.settle?.id]).toEqual(["PP-B", "PP-A"]);
    expect(pickShowcase(rows, new Map()).lead?.id).toBe("PP-A");
    // A strong defence leads over a higher-priority weak one (e.g. a package still in transit).
    const weakFirst = pickShowcase(rows, new Map([["PP-A", v("FIGHT", "LOW")], ["PP-B", v("FIGHT", "HIGH")]]));
    expect(weakFirst.lead?.id).toBe("PP-B");
  });

  it("on the recorded fixtures: leads with a defended case, then a settlement (KC mugs offer)", async () => {
    const { pickShowcase, rulesStrategies } = await import("@/lib/dashboard/showcase");
    const { ReplayGateway } = await import("@/lib/agent/gateway");
    const { MockCarrier } = await import("@/lib/carrier/mock");
    const { SampleStore } = await import("@/lib/samples/store");
    const f = loadFixtures();
    const s = summarize([...f.disputes.values()], new Date(f.snapshotAt));
    const strat = await rulesStrategies(s.open.map((r) => r.id), { gateway: new ReplayGateway(f), carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store) });
    // The platter (in transit) is on hold, so it never leads: the button would end at "nothing to send".
    expect(strat.get("PP-R-KWQ-10190429")?.wait).toBe("awaiting_delivery");
    const show = pickShowcase(s.open, strat);
    expect(show.lead?.id).not.toBe("PP-R-KWQ-10190429");
    // Replay features the video's case, rewound to before PayPal's decision; the mugs offer is second.
    const { rewindDispute } = await import("@/lib/replay/rewind");
    const cafe = rewindDispute(f.disputes.get("PP-R-FWW-10190477")!, f.rewinds.get("PP-R-FWW-10190477")!);
    const featured = pickShowcase(s.open, strat, toRow(cafe, new Date(f.snapshotAt)));
    expect([featured.lead?.id, featured.settle?.id]).toEqual(["PP-R-FWW-10190477", "PP-R-KFL-10190426"]);
  });
});
