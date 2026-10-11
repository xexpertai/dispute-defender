import { describe, expect, it } from "vitest";
import { ReplayGateway } from "@/lib/agent/gateway";
import { MockCarrier } from "@/lib/carrier/mock";
import { caseMatrix } from "@/lib/dashboard/matrix";
import { loadFixtures } from "@/lib/replay/fixtures";
import { SampleStore } from "@/lib/samples/store";

// The "Verify in 5 minutes" page: one row per case, from the fixed rules (no AI, no writes).
describe("verify page case matrix (Replay store)", () => {
  it("gives every case its call, proof on file, score and deciding fact; matches the board's calls card", async () => {
    const f = loadFixtures();
    const rows = await caseMatrix([...f.disputes.keys()], { gateway: new ReplayGateway(f), carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store) });
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(rows).toHaveLength(7);
    expect(by["PP-R-FWW-10190477"]).toMatchObject({ verdict: "FIGHT", have: 3, of: 3, score: "+1 +3 +1 +1 = +6", closed: true });
    expect(by["PP-R-KFL-10190426"]).toMatchObject({ verdict: "OFFER", have: 2, of: 3, against: 1 });
    expect(by["PP-R-VYZ-10190425"]).toMatchObject({ verdict: "REFUND", have: 0, decidedBy: "No tracking or proof of shipment on file" });
    expect(by["PP-R-FDW-10190427"]).toMatchObject({ verdict: "REFUND", against: 2, decidedBy: "Seller's own records acknowledge the problem" });
    expect(by["PP-R-OZN-10190428"].decidedBy).toBe("Your time (~$12.50) costs more than the $9.50 refund");
    expect(by["PP-R-KWQ-10190429"]).toMatchObject({ verdict: "HOLD", pending: 3 });
    // Same split as the board card: defend 2 · offer 1 · refund 3 · hold 1.
    const count = (v: string) => rows.filter((r) => r.verdict === v).length;
    expect([count("FIGHT"), count("OFFER"), count("REFUND"), count("HOLD")]).toEqual([2, 1, 3, 1]);
  });
});
