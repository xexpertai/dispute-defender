import { describe, expect, it } from "vitest";
import { ReplayGateway } from "@/lib/agent/gateway";
import { runAgent } from "@/lib/agent/run";
import type { TraceEvent } from "@/lib/agent/trace";
import { MockCarrier } from "@/lib/carrier/mock";
import { clientKey, RateLimiter } from "@/lib/guard/rate-limit";
import { FakeProvider } from "@/lib/llm/draft";
import { RecordedProvider } from "@/lib/llm/recorded";
import { loadFixtures } from "@/lib/replay/fixtures";
import { SampleStore } from "@/lib/samples/store";

const f = loadFixtures();

async function run(id: string, provider = new RecordedProvider(f.aiDrafts, new FakeProvider())) {
  const events: TraceEvent[] = [];
  for await (const e of runAgent(id, { gateway: new ReplayGateway(f), carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store), provider, runId: "r" })) events.push(e);
  return events;
}
const draftOf = (ev: TraceEvent[]) => ev.find((e): e is Extract<TraceEvent, { type: "draft" }> => e.type === "draft")!;
const finished = (ev: TraceEvent[]) => ev.find((e): e is Extract<TraceEvent, { type: "run_finished" }> => e.type === "run_finished")!;

describe("recorded AI drafts (hosted demo at $0)", () => {
  it("has a recording for every Replay fixture", () => {
    expect([...f.aiDrafts.keys()].sort()).toEqual([...f.disputes.keys()].sort());
  });

  it.each([...f.disputes.keys()])("%s: replays as AI-written (recorded), passes validation, costs nothing", async (id) => {
    const ev = await run(id);
    const d = draftOf(ev);
    expect(d.origin).toBe("ai");
    expect(d.fallbackReason).toBeUndefined();
    expect(d.draft?.recorded?.model).toMatch(/^claude-haiku-4-5/);
    expect(finished(ev).totals).toMatchObject({ llmCalls: 0, inputTokens: 0, costUsd: 0 });
    const step = ev.find((e) => e.type === "step" && e.key === "draft" && e.status === "done") as Extract<TraceEvent, { type: "step" }>;
    expect(step.detail).toMatch(/recorded from a real claude-haiku-4-5.* \$0 now/);
  });

  it("the D3 recording answers the Spanish-speaking buyer in Spanish with an English gloss", async () => {
    const d = draftOf(await run("PP-R-MQR-10190375")).draft!;
    expect(d.buyerMessage).toMatchObject({ language: "es" });
    expect(d.buyerMessage?.englishGloss).toBeTruthy();
  });

  it("a stale recording that cites unknown evidence falls back to TEMPLATE", async () => {
    const rec = structuredClone(f.aiDrafts.get("PP-R-PLP-10190379")!);
    rec.draft.action = { kind: "send_message" }; // PayPal does not allow this on D4
    const ev = await run("PP-R-PLP-10190379", new RecordedProvider(new Map([[rec.disputeId, rec]]), new FakeProvider()));
    expect(draftOf(ev)).toMatchObject({ origin: "template" });
    expect(draftOf(ev).fallbackReason).toMatch(/failed validation/);
  });

  it("uses the fallback provider when a dispute has no recording", async () => {
    const ev = await run("PP-R-PLP-10190379", new RecordedProvider(new Map(), new FakeProvider()));
    expect(draftOf(ev).origin).toBe("template");
  });
});

describe("rate limiter", () => {
  it("allows max hits per window, then reports seconds to wait, then resets", () => {
    let t = 0;
    const rl = new RateLimiter({ run: { max: 2, windowMs: 10_000 } }, () => t);
    expect(rl.check("run", "1.2.3.4")).toBe(0);
    expect(rl.check("run", "1.2.3.4")).toBe(0);
    expect(rl.check("run", "1.2.3.4")).toBe(10);
    expect(rl.check("run", "5.6.7.8")).toBe(0); // per IP
    t = 10_000;
    expect(rl.check("run", "1.2.3.4")).toBe(0);
  });

  it("keys on the first X-Forwarded-For hop", () => {
    expect(clientKey(new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } }))).toBe("9.9.9.9");
    expect(clientKey(new Request("http://x"))).toBe("local");
  });
});
