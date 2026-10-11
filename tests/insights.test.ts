import { describe, expect, it } from "vitest";
import { ReplayGateway } from "@/lib/agent/gateway";
import { MockCarrier } from "@/lib/carrier/mock";
import { actionsTool, aiActions, insightsHash, numbersSupported, readCache, templateActions, writeCache } from "@/lib/insights/actions";
import { findPatterns, type DisputeFacts } from "@/lib/insights/patterns";
import { collectFacts } from "@/lib/insights/portfolio";
import { loadFixtures } from "@/lib/replay/fixtures";
import { SampleStore } from "@/lib/samples/store";
import { openDb } from "@/lib/store/db";

const INR = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED";
const fact = (id: string, over: Partial<DisputeFacts> = {}): DisputeFacts => ({
  id, reason: INR, amount: 50, currency: "USD", outcome: "open", trackingNumbers: ["T-" + id], delivered: true, signature: false,
  openedBeforeDelivery: false, noTracking: false, belowCostToFight: false, ...over,
});
const ids = (f: DisputeFacts[]) => findPatterns(f).map((p) => p.id);

describe("deterministic patterns", () => {
  it.each([
    // Each pattern needs >= 2 cases, >= 20 % of its base, and a contrast (not every case) in a small portfolio.
    ["early filing", [fact("a", { openedBeforeDelivery: true }), fact("b", { openedBeforeDelivery: true }), fact("c")], "opened_before_delivery", ["a", "b"]],
    ["high value, no signature", [fact("a", { amount: 89 }), fact("b", { amount: 95 }), fact("c", { amount: 89, signature: true })], "high_value_no_signature", ["a", "b"]],
    ["no tracking", [fact("a", { noTracking: true, trackingNumbers: [] }), fact("b", { noTracking: true, trackingNumbers: [] }), fact("c")], "no_tracking_at_paypal", ["a", "b"]],
    ["reused tracking", [fact("a", { trackingNumbers: ["X"] }), fact("b", { trackingNumbers: ["X"] }), fact("c")], "tracking_reused", ["a", "b"]],
    ["sku cluster", [fact("a", { sku: "S" }), fact("b", { sku: "S" }), fact("c", { sku: "T" })], "sku_S", ["a", "b"]],
    ["small disputes", [fact("a", { belowCostToFight: true }), fact("b", { belowCostToFight: true }), fact("c")], "below_cost_to_fight", ["a", "b"]],
    ["fast filing", [fact("a", { paidAt: "2026-10-01T00:00:00Z", openedAt: "2026-10-01T05:00:00Z" }), fact("b", { paidAt: "2026-10-01T00:00:00Z", openedAt: "2026-10-02T00:00:00Z" }), fact("c", { paidAt: "2026-10-01T00:00:00Z", openedAt: "2026-10-09T00:00:00Z" })], "filed_within_48h", ["a", "b"]],
  ] as const)("%s", (_n, facts, id, disputeIds) => {
    const p = findPatterns([...facts]).find((x) => x.id === id);
    expect(p?.disputeIds).toEqual(disputeIds);
  });

  it("needs a minimum sample and a contrast: one case, or every case of a small portfolio, is not a pattern", () => {
    expect(ids([fact("a", { noTracking: true, trackingNumbers: [] }), fact("b"), fact("c")])).toEqual([]); // 1 case
    const all = ["a", "b", "c"].map((x) => fact(x, { paidAt: "2026-10-01T00:00:00Z", openedAt: "2026-10-01T05:00:00Z" }));
    expect(ids(all)).toEqual([]); // 3 of 3: no contrast in a small portfolio
    const many = Array.from({ length: 10 }, (_, i) => fact(`d${i}`, { paidAt: "2026-10-01T00:00:00Z", openedAt: "2026-10-01T05:00:00Z" }));
    expect(ids(many)).toEqual(["filed_within_48h"]); // a larger portfolio: every case is a real signal
  });

  it("finds nothing in a clean portfolio and nothing at all without disputes", () => {
    expect(ids([fact("a"), fact("b")])).toEqual([]);
    expect(ids([])).toEqual([]);
  });

  it("ranks high-severity patterns first; every insight cites only real dispute ids", async () => {
    const f = loadFixtures();
    const facts = await collectFacts(new ReplayGateway(f), new MockCarrier(f.carrier), new SampleStore(f.store));
    const p = findPatterns(facts);
    expect(p.map((x) => x.id)).toEqual(["opened_before_delivery"]);
    for (const i of p) for (const d of i.disputeIds) expect(f.disputes.has(d)).toBe(true);
  });

  it("hash is stable and changes when the evidence changes", () => {
    const u = (x: string) => fact(x, { noTracking: true, trackingNumbers: [] });
    const a = findPatterns([u("a"), u("b"), fact("c")]);
    expect(a.length).toBe(1);
    expect(insightsHash(a)).toBe(insightsHash(findPatterns([u("a"), u("b"), fact("c")])));
    expect(insightsHash(a)).not.toBe(insightsHash(findPatterns([u("a"), u("x"), fact("c")])));
  });
});

describe("AI seller actions", () => {
  const patterns = findPatterns([fact("a", { noTracking: true, trackingNumbers: [] }), fact("b", { noTracking: true, trackingNumbers: [] }), fact("c", { openedBeforeDelivery: true }), fact("d", { openedBeforeDelivery: true })]);

  it("schema is strict and can only cite known insight ids", () => {
    const t = actionsTool(patterns.map((p) => p.id));
    expect(t.strict).toBe(true);
    expect(JSON.stringify(t.input_schema)).toContain(`"enum":${JSON.stringify(patterns.map((p) => p.id))}`);
    expect(patterns.map((p) => p.id).sort()).toEqual(["no_tracking_at_paypal", "opened_before_delivery"]);
  });

  it("drops actions without valid citations, caps at 4, prices the call", async () => {
    const client = {
      messages: {
        create: async () => ({
          usage: { input_tokens: 800, output_tokens: 300 },
          content: [{ type: "tool_use", name: "seller_actions", id: "t", input: { actions: [
            { title: "Add tracking to every order", why: "1 of 2 had none", insight_ids: ["no_tracking_at_paypal"], effort: "low" },
            { title: "Invented", why: "x", insight_ids: ["made_up"], effort: "low" },
            ...["A", "B", "C", "D"].map((l) => ({ title: `Step ${l}`, why: "y", insight_ids: ["opened_before_delivery"], effort: "low" })),
          ] } }],
        }),
      },
    };
    const r = await aiActions(client as never, patterns, "claude-haiku-4-5-20251001");
    expect(r.actions.map((a) => a.title)).toEqual(["Add tracking to every order", "Step A", "Step B"]);
    expect(r.usage).toMatchObject({ input: 800, output: 300, costUsd: 0.0023 });
  });

  it.each([
    ["no numbers", "Add tracking to every order", true],
    ["count from the data", "2 of 4 cases had no tracking", true],
    ["percentage of the counts", "50% of cases", true],
    ["invented percentage", "99% of disputes", false],
    ["invented word-free number", "Half your disputes (3)", false],
  ])("numbersSupported: %s", (_n, text, ok) => {
    expect(numbersSupported(text, patterns)).toBe(ok);
  });

  it("replaces a why with invented numbers by the cited pattern's real stat; drops a made-up headline", async () => {
    const client = { messages: { create: async () => ({ usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", name: "seller_actions", id: "t", input: { actions: [
      { title: "Add tracking", why: "99% of your disputes lack it", insight_ids: ["no_tracking_at_paypal"], effort: "low" },
      { title: "Fix 87% of disputes now", why: "x", insight_ids: ["opened_before_delivery"], effort: "low" },
    ] } }] }) } };
    const r = await aiActions(client as never, patterns);
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0].why).toBe(patterns.find((p) => p.id === "no_tracking_at_paypal")!.detail);
  });

  it("template actions come from the deterministic hints", () => {
    expect(templateActions(patterns)[0]).toMatchObject({ insightIds: [patterns[0].id], title: patterns[0].hint });
  });

  it("caches by input hash", () => {
    const db = openDb(":memory:");
    writeCache(db, "h1", { origin: "ai", actions: [], model: "m" });
    expect(readCache(db, "h1")).toMatchObject({ origin: "ai", model: "m" });
    expect(readCache(db, "h2")).toBeNull();
  });
});

describe("reset demo", () => {
  it("clears replay drafts and cached insights, never live approvals", async () => {
    const { resetReplayState } = await import("@/lib/demo/reset");
    const { saveDraft, insertApproval } = await import("@/lib/store/drafts");
    const db = openDb(":memory:");
    const d = { runId: "r", disputeId: "PP-1", reason: "OTHER", amount: 1, currency: "USD", draft: { origin: "template" as const, strategy: "FIGHT" as const, action: null, rationale: "", claims: [], sellerNote: "n", evidence: [] }, packRefs: [], packItems: [], createdAt: "2026-10-06T00:00:00Z" };
    saveDraft(db, { ...d, id: "run_a_d1", mode: "replay" });
    saveDraft(db, { ...d, id: "run_b_d1", mode: "live" });
    insertApproval(db, { id: "apr", draftId: "run_b_d1", approvedBy: "s", approvedAt: "2026-10-06T00:00:00Z", finalPayload: {} });
    writeCache(db, "h", { origin: "ai", actions: [] });
    expect(resetReplayState(db)).toEqual({ drafts: 1, insights: 1 });
    expect((db.prepare("SELECT id FROM drafts").all() as { id: string }[]).map((r) => r.id)).toEqual(["run_b_d1"]);
  });
});

describe("insight actions stay on-topic and keep the human in the loop", () => {
  const inrOnly = findPatterns([fact("a", { sku: "S" }), fact("b", { sku: "S" }), fact("c", { sku: "T", belowCostToFight: true }), fact("d", { sku: "U", belowCostToFight: true })]);
  const withSnad = findPatterns([fact("a", { sku: "S", reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED" }), fact("b", { sku: "S" }), fact("c", { sku: "T" })]);
  const reply = (actions: { title: string; why: string; insight_ids: string[] }[]) => ({
    messages: { create: async () => ({ usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", name: "seller_actions", id: "t", input: { actions: actions.map((a) => ({ ...a, effort: "low" })) } }] }) },
  });

  it("drops product-quality advice for 'item not received' patterns", async () => {
    const r = await aiActions(reply([{ title: "Inspect and improve quality of S", why: "Fix defects.", insight_ids: ["sku_S"] }, { title: "Use faster tracked shipping for S", why: "Fewer lost parcels.", insight_ids: ["sku_S"] }]) as never, inrOnly);
    expect(r.actions.map((a) => a.title)).toEqual(["Use faster tracked shipping for S"]);
  });

  it("allows condition advice when a cited pattern includes 'not as described' cases", async () => {
    const r = await aiActions(reply([{ title: "Improve the listing photos for S", why: "Set expectations.", insight_ids: ["sku_S"] }]) as never, withSnad);
    expect(r.actions).toHaveLength(1);
  });

  it.each(["Auto-refund small disputes without response", "Automate refunds under the threshold", "Accept small claims without your review"])("drops automation: %s", async (title) => {
    const r = await aiActions(reply([{ title, why: "Saves time.", insight_ids: ["below_cost_to_fight"] }]) as never, inrOnly);
    expect(r.actions).toEqual([]);
  });

  it("deterministic hints follow the same rules", () => {
    expect(inrOnly.find((i) => i.id === "sku_S")?.hint).toMatch(/shipping method/);
    expect(inrOnly.find((i) => i.id === "below_cost_to_fight")?.hint).toMatch(/you still approve/);
  });
});

describe("single-case lessons", () => {
  it("finds the incomplete-address return and the untracked shipment in the Replay store, each on its own case", async () => {
    const { findLessons } = await import("@/lib/insights/patterns");
    const f = loadFixtures();
    const facts = await collectFacts(new ReplayGateway(f), new MockCarrier(f.carrier), new SampleStore(f.store));
    const lessons = findLessons(facts);
    expect(lessons.map((l) => [l.id, l.disputeIds])).toEqual([
      ["address_incomplete_returned", ["PP-R-FDW-10190427"]],
      ["shipped_without_tracking", ["PP-R-VYZ-10190425"]],
    ]);
    for (const l of lessons) expect(l.detail).toContain("the agent recommends a refund");
  });

  it("needs both the address note and the return; skips 'no tracking' when a pattern already covers it", async () => {
    const { findLessons } = await import("@/lib/insights/patterns");
    expect(findLessons([fact("a", { returnedToSender: true }), fact("b", { addressFault: true })])).toEqual([]);
    const u = (x: string) => fact(x, { noTracking: true, noCarrierScans: true, trackingNumbers: [] });
    expect(findLessons([u("a"), fact("b"), fact("c")]).map((l) => l.id)).toEqual(["shipped_without_tracking"]);
    expect(findLessons([u("a"), u("b"), fact("c")]).map((l) => l.id)).toEqual([]); // the pattern shows it instead
  });

  it("never claims a refund call the rules did not make", async () => {
    const { findLessons } = await import("@/lib/insights/patterns");
    const l = findLessons([fact("a", { returnedToSender: true, addressFault: true, strategy: "FIGHT" }), fact("b"), fact("c")]);
    expect(l[0].detail).not.toContain("refund");
  });
});
