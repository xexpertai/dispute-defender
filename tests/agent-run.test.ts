import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/agent/run/route";
import { ReplayGateway } from "@/lib/agent/gateway";
import { runAgent, type AgentDeps } from "@/lib/agent/run";
import { decodeSse, STEPS, type TraceEvent } from "@/lib/agent/trace";
import { initialTraceState, reduceTrace } from "@/lib/agent/trace-state";
import { MockCarrier } from "@/lib/carrier/mock";
import { FakeProvider } from "@/lib/llm/draft";
import { loadFixtures } from "@/lib/replay/fixtures";
import { SampleStore } from "@/lib/samples/store";
import { TraceEventSchema } from "./helpers/trace-schema";

const f = loadFixtures();
const deps = (): AgentDeps => ({ gateway: new ReplayGateway(f), carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store), provider: new FakeProvider(), runId: "r_test" });

async function collect(id: string) {
  const events: TraceEvent[] = [];
  for await (const e of runAgent(id, deps())) events.push(e);
  return events;
}

const of = <T extends TraceEvent["type"]>(events: TraceEvent[], type: T) => events.filter((e): e is Extract<TraceEvent, { type: T }> => e.type === type);

describe("agent run over recorded disputes (Replay, FakeProvider)", () => {
  const ids = [...f.disputes.keys()];

  it.each(ids)("%s: every event matches the v1 contract; steps 1→9 each go running → final", async (id) => {
    const events = await collect(id);
    for (const e of events) expect(() => TraceEventSchema.parse(e), JSON.stringify(e)).not.toThrow();
    expect(events[0]).toMatchObject({ type: "run_started", disputeId: id, mode: "replay" });
    expect(events.at(-1)?.type).toBe("run_finished");

    const steps = of(events, "step");
    expect(steps.filter((s) => s.status === "running").map((s) => s.step)).toEqual(STEPS.map((_, i) => i + 1));
    for (const s of STEPS) {
      const finals = steps.filter((e) => e.key === s.key && e.status !== "running");
      expect(finals, s.key).toHaveLength(1);
    }
    // order: every step's final event comes before the next step starts
    const seq = steps.map((s) => `${s.step}:${s.status === "running" ? "r" : "f"}`);
    expect(seq).toEqual(STEPS.flatMap((_, i) => [`${i + 1}:r`, `${i + 1}:f`]));
  });

  it.each(ids)("%s: badges are honest replay badges and every cited ref exists in the evidence", async (id) => {
    const events = await collect(id);
    const badges = of(events, "step").flatMap((s) => s.paypal ?? []);
    expect(badges.length).toBeGreaterThan(0);
    for (const b of badges) expect(b.source).toBe("replay");
    const refs = new Set(of(events, "evidence").at(-1)!.items.map((i) => i.sourceRef));
    for (const s of of(events, "step")) for (const r of s.sourceRefs ?? []) expect(refs.has(r), r).toBe(true);
    const draft = of(events, "draft")[0];
    for (const r of draft.packRefs ?? []) expect(refs.has(r), r).toBe(true);
    for (const c of draft.draft?.claims ?? []) for (const r of c.sourceRefs) expect(refs.has(r), r).toBe(true);
    expect(of(events, "run_finished")[0].totals).toMatchObject({ llmCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, paypalCalls: badges.length });
  });

  it("FakeProvider output is labelled TEMPLATE, never AI", async () => {
    const events = await collect("PP-R-MQR-10190375");
    expect(of(events, "draft")[0]).toMatchObject({ origin: "template", draft: { origin: "template" } });
    expect(of(events, "step").find((s) => s.key === "draft" && s.status === "done")?.detail).toMatch(/^TEMPLATE/);
  });

  it.each([
    // id, strategy, action, final approval status
    ["PP-R-MQR-10190375", "FIGHT", "send_message", "waiting"], // D3: delivered + ZIP match; inquiry only allows messaging
    ["PP-R-PLP-10190379", "REFUND", "accept_claim", "waiting"], // D4: in transit, $9.50 < cost to fight
    ["PP-R-CMR-10190364", "FIGHT", null, "skipped"], // D1: closed, won → hindsight
    ["PP-R-RFI-10190369", "FIGHT", null, "skipped"], // D2: closed, lost → hindsight
  ])("%s → %s / %s / approval %s", async (id, strategy, action, approval) => {
    const events = await collect(id);
    const a = of(events, "assessment")[0].assessment;
    expect(a.recommendation.strategy).toBe(strategy);
    expect(a.recommendation.action?.kind ?? null).toBe(action);
    expect(of(events, "step").find((s) => s.key === "await_approval" && s.status !== "running")?.status).toBe(approval);
  });

  it("maps D1's evidence with stable sourceRefs from PayPal, the mock carrier and the sample store", async () => {
    const items = of(await collect("PP-R-CMR-10190364"), "evidence").at(-1)!.items.map((i) => i.sourceRef);
    expect(items).toEqual([
      "dispute:PP-R-CMR-10190364",
      "dispute:PP-R-CMR-10190364#msg0",
      "order:810133174W798673R",
      "capture:72C200774H985740J",
      "pptrack:72C200774H985740J:9400111899223197428490",
      ...[0, 1, 2, 3, 4].map((n) => `track:USPS:9400111899223197428490#ev${n}`),
      "listing:MUG-SET-4",
      ...[0, 1, 2].map((n) => `store:KC-1791211304297#line${n}`),
      "chat:T-1304297#line0",
      "chat:T-1304297#line1",
    ]);
  });

  it("an unknown dispute ends in an error event, not a thrown exception", async () => {
    const events = await collect("PP-R-NOPE-1");
    expect(of(events, "error")[0].message).toMatch(/not found/);
    expect(of(events, "step")[1]).toMatchObject({ key: "fetch_dispute", status: "error" });
    expect(events.at(-1)?.type).toBe("run_finished");
  });

  it("folds into UI state: finished, 9 steps, evidence + assessment + draft present", async () => {
    const state = (await collect("PP-R-MQR-10190375")).reduce(reduceTrace, initialTraceState());
    expect(state.phase).toBe("finished");
    expect(state.steps.map((s) => s.status)).toEqual(["done", "done", "done", "done", "done", "done", "done", "done", "waiting"]);
    expect(state.evidence.length).toBeGreaterThan(5);
    expect(state.assessment?.strength.level).toBe("HIGH");
    expect(state.draft?.buyerMessage?.text).toBeTruthy();
  });

  it("reducer marks the running step as error when the run fails", () => {
    let s = reduceTrace(initialTraceState(), { v: 1, type: "run_started", runId: "r", disputeId: "PP-1", mode: "replay", at: "2026-10-05T19:00:00Z" });
    s = reduceTrace(s, { v: 1, type: "step", runId: "r", step: 2, key: "gather_order", title: "x", status: "running", at: "2026-10-05T19:00:00Z" });
    s = reduceTrace(s, { v: 1, type: "error", runId: "r", message: "boom", at: "2026-10-05T19:00:01Z" });
    s = reduceTrace(s, { v: 1, type: "run_finished", runId: "r", ms: 5, totals: { paypalCalls: 0, llmCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }, at: "2026-10-05T19:00:01Z" });
    expect(s.phase).toBe("error");
    expect(s.steps[1].status).toBe("error");
    expect(s.error).toBe("boom");
  });
});

describe("GET /api/agent/run (SSE)", () => {
  it("streams text/event-stream frames that decode to the full trace", async () => {
    const res = await GET(new Request("http://local/api/agent/run?dispute=PP-R-MQR-10190375&pace=0"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const wire = await res.text();
    expect(wire).toMatch(/^event: run_started\nid: run_[a-z0-9]+:0\ndata: \{/);
    const events = decodeSse(wire);
    for (const e of events) TraceEventSchema.parse(e);
    expect(events.map((e) => e.type).filter((t) => t !== "step")).toEqual(["run_started", "evidence", "evidence", "evidence", "evidence", "assessment", "draft", "run_finished"]);
    const sizes = events.flatMap((e) => (e.type === "evidence" ? [e.items.length] : []));
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b)); // cumulative, never shrinks
  });

  it.each(["", "../etc/passwd", "PP-R-<script>", "x".repeat(80)])("rejects bad dispute id %j", async (id) => {
    const res = await GET(new Request(`http://local/api/agent/run?dispute=${encodeURIComponent(id)}`));
    expect(res.status).toBe(400);
  });
});

describe("LiveGateway (fake PayPal client)", () => {
  it("re-reads open disputes for links and deadlines; tags badges live with debug ids", async () => {
    const { LiveGateway } = await import("@/lib/agent/gateway");
    const paths: string[] = [];
    const client = {
      request: async (_m: string, path: string) => {
        paths.push(path);
        if (path.startsWith("/v1/customer/disputes?")) return { status: 200, debugId: "d0", data: { items: [{ dispute_id: "PP-A", status: "WAITING_FOR_BUYER_RESPONSE" }, { dispute_id: "PP-B", status: "RESOLVED" }] } };
        if (path.endsWith("PP-B")) return { status: 200, debugId: "d2", data: { dispute_id: "PP-B", status: "RESOLVED", dispute_outcome: { outcome_code: "RESOLVED_SELLER_FAVOUR" } } };
        return { status: 200, debugId: "d1", data: { dispute_id: "PP-A", status: "WAITING_FOR_BUYER_RESPONSE", buyer_response_due_date: "2026-10-25T00:00:00Z", links: [{ rel: "send_message" }] } };
      },
    };
    const gw = new LiveGateway(client as never);
    const list = await gw.listDisputes();
    expect(paths).toEqual(["/v1/customer/disputes?page_size=50", "/v1/customer/disputes/PP-A", "/v1/customer/disputes/PP-B"]);
    expect(list[0].links).toEqual([{ rel: "send_message" }]);
    expect(list[1].dispute_outcome?.outcome_code).toBe("RESOLVED_SELLER_FAVOUR");
    await gw.listDisputes();
    expect(paths.filter((p) => p.endsWith("PP-B"))).toHaveLength(1); // resolved details cached
    const { calls } = await gw.getDispute("PP-A");
    expect(calls[0]).toMatchObject({ source: "live", status: 200, debugId: "d1", api: "Disputes" });
  });
});

describe("LiveGateway reads through PayPal's Agent Toolkit", () => {
  it("uses the toolkit for dispute/order/tracking/list, REST only for the capture lookup; 404 → null", async () => {
    const { LiveGateway } = await import("@/lib/agent/gateway");
    const ran: string[] = [];
    const rest: string[] = [];
    const toolkit = async (method: string, args: Record<string, unknown>) => {
      ran.push(`${method} ${JSON.stringify(args)}`);
      if (method === "get_dispute" && args.dispute_id === "PP-NOPE") return JSON.stringify({ ok: false, status: 404, code: "x" });
      if (method === "get_dispute") return JSON.stringify({ dispute_id: args.dispute_id, status: "WAITING_FOR_SELLER_RESPONSE", buyer: { email_address: "b@example.com" } });
      if (method === "get_order") return JSON.stringify({ id: args.id, purchase_units: [] });
      if (method === "get_shipment_tracking") return JSON.stringify({ trackers: [{ transaction_id: "C1", tracking_number: "9", carrier: "USPS" }] });
      return JSON.stringify({ items: [] });
    };
    const client = { request: async (_m: string, path: string) => (rest.push(path), { status: 200, debugId: "d", data: { links: [{ rel: "up", href: "https://x/v2/checkout/orders/O1" }] } }) };
    const gw = new LiveGateway(client as never, undefined, toolkit);
    const d = await gw.getDispute("PP-A");
    expect(d.calls[0]).toMatchObject({ via: "agent-toolkit", source: "live", status: 200, api: "Disputes" });
    expect(JSON.stringify(d.data)).not.toContain("b@example.com");
    expect((await gw.getDispute("PP-NOPE")).data).toBeNull();
    const o = await gw.findOrderByCapture("C1");
    expect(o.calls.map((c) => c.via)).toEqual(["rest", "agent-toolkit"]);
    expect((await gw.getTrackers("C1")).data).toHaveLength(1);
    await gw.listDisputes();
    expect(ran.map((r) => r.split(" ")[0])).toEqual(["get_dispute", "get_dispute", "get_order", "get_shipment_tracking", "list_disputes"]);
    expect(rest).toEqual(["/v2/payments/captures/C1"]);
  });

  it("a non-404 toolkit failure throws (the run shows an error, not empty data)", async () => {
    const { LiveGateway } = await import("@/lib/agent/gateway");
    const gw = new LiveGateway({ request: async () => ({}) } as never, undefined, async () => JSON.stringify({ ok: false, status: 500 }));
    await expect(gw.getDispute("PP-A")).rejects.toThrow(/500/);
  });
});
