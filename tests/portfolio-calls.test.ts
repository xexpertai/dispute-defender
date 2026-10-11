import { describe, expect, it } from "vitest";
import { ReplayGateway } from "@/lib/agent/gateway";
import { MockCarrier } from "@/lib/carrier/mock";
import { portfolioCalls } from "@/lib/dashboard/calls";
import { summarize } from "@/lib/dashboard/guardian";
import { rulesStrategies, type RulesVerdict } from "@/lib/dashboard/showcase";
import { loadFixtures } from "@/lib/replay/fixtures";
import { SampleStore } from "@/lib/samples/store";

describe("portfolio calls (board card)", () => {
  it("groups the Replay store's 7 cases by the rules' call, with amounts from the cases", async () => {
    const f = loadFixtures();
    const gateway = new ReplayGateway(f);
    const disputes = await gateway.listDisputes();
    const s = summarize(disputes, gateway.now());
    const rows = [...s.open, ...s.closed];
    const v = await rulesStrategies(rows.map((r) => r.id), { gateway, carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store) });
    const p = portfolioCalls(rows, v);
    expect(p.total).toBe(7);
    const by = Object.fromEntries(p.groups.map((g) => [g.kind, g]));
    expect(by.defend).toMatchObject({ amount: 401, won: 2 });
    expect(by.defend.ids.sort()).toEqual(["PP-R-FWW-10190477", "PP-R-WEO-10190424"]);
    expect(by.offer).toMatchObject({ ids: ["PP-R-KFL-10190426"], amount: 64, offered: 32 });
    expect(by.refund).toMatchObject({ amount: 80, buyerFair: 1, unprovable: 1 }); // FDW: buyer is right; VYZ: no tracking, can't prove delivery; OZN: time costs more
    expect(by.refund.ids.sort()).toEqual(["PP-R-FDW-10190427", "PP-R-OZN-10190428", "PP-R-VYZ-10190425"]);
    expect(by.hold).toMatchObject({ ids: ["PP-R-KWQ-10190429"], amount: 142 });
  });

  it("a wait always reads as hold, whatever the strategy; unknown cases are skipped", () => {
    const v = new Map<string, RulesVerdict>([
      ["a", { strategy: "FIGHT", strength: "LOW", wait: "awaiting_delivery" }],
      ["b", { strategy: "REFUND", strength: "LOW" }],
    ]);
    const rows = ["a", "b", "c"].map((id) => ({ id, amount: 10, currency: "USD", outcome: "open" as const }));
    const p = portfolioCalls(rows, v);
    expect(p.total).toBe(2);
    expect(p.groups.map((g) => g.kind)).toEqual(["refund", "hold"]);
    expect(p.groups[0].buyerFair).toBeUndefined();
  });
});

describe("escalation warning (case header)", () => {
  it("shows only on inquiries waiting for the seller: VYZ and KFL in Replay", async () => {
    const { escalationRisk } = await import("@/lib/disputes/model");
    const f = loadFixtures();
    const ids = [...f.disputes.values()].filter((d) => escalationRisk(d)).map((d) => d.dispute_id).sort();
    expect(ids).toEqual(["PP-R-KFL-10190426", "PP-R-VYZ-10190425"]);
    expect(escalationRisk({ status: "WAITING_FOR_SELLER_RESPONSE", dispute_life_cycle_stage: "CHARGEBACK" })).toBe(false);
  });
});
