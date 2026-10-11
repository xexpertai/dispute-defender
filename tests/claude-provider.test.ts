import { describe, expect, it } from "vitest";
import { ReplayGateway } from "@/lib/agent/gateway";
import { runAgent } from "@/lib/agent/run";
import type { TraceEvent } from "@/lib/agent/trace";
import { MockCarrier } from "@/lib/carrier/mock";
import { LlmBudget, LlmBudgetExceeded } from "@/lib/llm/budget";
import { ClaudeProvider, costUsd, draftTool, type DraftToolInput } from "@/lib/llm/claude";
import { loadFixtures } from "@/lib/replay/fixtures";
import { SampleStore } from "@/lib/samples/store";
import { openDb } from "@/lib/store/db";

/** Fake Anthropic client: records requests, replies with a canned tool call. No network. */
function fakeClient(reply: Partial<DraftToolInput> | null, opts: { stop?: string; input?: number; output?: number } = {}) {
  const requests: Record<string, unknown>[] = [];
  const client = {
    messages: {
      create: async (req: Record<string, unknown>) => {
        requests.push(req);
        const base: DraftToolInput = {
          strategy: "FIGHT",
          action: "send_message",
          offer_type: "none",
          amount: "",
          rationale: "Delivered to the right ZIP.",
          claims: [],
          seller_note_to_paypal: "Delivered.",
          buyer_message: { language: "es", text: "¡Hola! Su pedido fue entregado.", english_gloss: "Hi! Your order was delivered." },
        };
        return {
          stop_reason: opts.stop ?? "tool_use",
          usage: { input_tokens: opts.input ?? 3200, output_tokens: opts.output ?? 600 },
          content: reply === null ? [{ type: "text", text: "no tool" }] : [{ type: "tool_use", id: "t1", name: "draft_response", input: { ...base, ...reply } }],
        };
      },
    },
  };
  return { client: client as unknown as ConstructorParameters<typeof ClaudeProvider>[0]["client"], requests };
}

const f = loadFixtures(undefined, { withArchive: true });
async function run(id: string, provider: ClaudeProvider) {
  const events: TraceEvent[] = [];
  for await (const e of runAgent(id, { gateway: new ReplayGateway(f), carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store), provider, runId: "r" })) events.push(e);
  const draftEv = events.find((e): e is Extract<TraceEvent, { type: "draft" }> => e.type === "draft")!;
  const finished = events.find((e): e is Extract<TraceEvent, { type: "run_finished" }> => e.type === "run_finished")!;
  return { events, draftEv, finished };
}

describe("draft_response tool schema", () => {
  it("is strict, limits actions to HATEOAS rels and citations to gathered refs", () => {
    const t = draftTool(["send_message", "escalate", "accept_claim", "adjudicate"], ["order:O1", "track:USPS:1#ev0"]);
    expect(t.strict).toBe(true);
    const props = (t.input_schema as unknown as { properties: Record<string, { enum?: string[]; items?: { properties: { source_refs: { items: { enum: string[] } } } } }> }).properties;
    expect(props.action.enum).toEqual(["accept_claim", "send_message", "escalate", "none"]);
    expect(props.claims.items!.properties.source_refs.items.enum).toEqual(["order:O1", "track:USPS:1#ev0"]);
    expect((t.input_schema as unknown as { additionalProperties: boolean }).additionalProperties).toBe(false);
  });

  it("prices Haiku 4.5 at $1 / $5 per million tokens", () => {
    expect(costUsd(3500, 1000)).toBe(0.0085);
  });
});

describe("ClaudeProvider in the agent loop (fake client)", () => {
  it("sends one forced, redacted request and returns an AI draft in the buyer's language with a gloss", async () => {
    const { client, requests } = fakeClient({ claims: [{ text: "Carrier shows delivered", source_refs: ["track:USPS:9400111899223197428491#ev4"] }] });
    const logged: number[] = [];
    const { draftEv, finished } = await run("PP-R-MQR-10190375", new ClaudeProvider({ client, afterCall: (u) => logged.push(u.input + u.output) }));
    expect(requests).toHaveLength(1);
    const req = requests[0] as { model: string; tool_choice: unknown; messages: { content: string }[] };
    expect(req.model).toBe("claude-haiku-4-5-20251001");
    expect(req.tool_choice).toEqual({ type: "tool", name: "draft_response" });
    const prompt = req.messages[0].content;
    expect(prompt).toContain('"code": "es"');
    expect(prompt).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i); // no emails reach the model
    expect(draftEv).toMatchObject({ origin: "ai", draft: { origin: "ai", buyerMessage: { language: "es", englishGloss: "Hi! Your order was delivered." } } });
    expect(finished.totals).toMatchObject({ llmCalls: 1, inputTokens: 3200, outputTokens: 600, costUsd: costUsd(3200, 600) });
    expect(logged).toEqual([3800]);
  });

  it("falls back to TEMPLATE when the AI picks an action PayPal does not allow", async () => {
    const { client } = fakeClient({ action: "provide_evidence" as DraftToolInput["action"] });
    const { draftEv, events } = await run("PP-R-MQR-10190375", new ClaudeProvider({ client }));
    expect(draftEv.origin).toBe("template");
    expect(draftEv.fallbackReason).toMatch(/AI draft failed validation/);
    expect(draftEv.issues?.[0].code).toBe("ai_fallback");
    const v = events.find((e) => e.type === "step" && e.key === "validate" && e.status === "done") as Extract<TraceEvent, { type: "step" }>;
    expect(v.detail).toMatch(/AI draft rejected, TEMPLATE used/);
  });

  it("falls back to TEMPLATE (and still counts tokens) when the response has no tool call", async () => {
    const { client } = fakeClient(null, { stop: "max_tokens" });
    const { draftEv, finished } = await run("PP-R-PLP-10190379", new ClaudeProvider({ client }));
    expect(draftEv.origin).toBe("template");
    expect(draftEv.fallbackReason).toMatch(/AI draft unavailable/);
    expect(finished.totals.llmCalls).toBe(1);
  });

  it("caps an offer at the disputed amount via validation", async () => {
    const { client } = fakeClient({ strategy: "REFUND", action: "accept_claim", amount: "99.00" });
    const { draftEv } = await run("PP-R-PLP-10190379", new ClaudeProvider({ client }));
    // 99 > 9.50 is not a partial refund → full REFUND, which never carries an amount
    expect(draftEv.draft?.action).toEqual({ kind: "accept_claim", acceptClaimType: "REFUND" });
  });
});

describe("LlmBudget", () => {
  it("logs every call and refuses past the daily cap", () => {
    const db = openDb(":memory:");
    const now = () => new Date("2026-10-06T10:00:00Z");
    const b = new LlmBudget(db, 2, now);
    b.record({ model: "m", input: 100, output: 20, costUsd: 0.0002 });
    b.assertAvailable();
    b.record({ model: "m", input: 100, output: 20, costUsd: 0.0002 });
    expect(() => b.assertAvailable()).toThrow(LlmBudgetExceeded);
    expect(b.allTime()).toMatchObject({ calls: 2, input_tokens: 200, output_tokens: 40 });
    // budget refusal becomes a TEMPLATE fallback, with no request sent
  });

  it("a refused call never reaches the client", async () => {
    const { client, requests } = fakeClient({});
    const { draftEv } = await run("PP-R-MQR-10190375", new ClaudeProvider({ client, beforeCall: () => { throw new LlmBudgetExceeded(40, 40); } }));
    expect(requests).toHaveLength(0);
    expect(draftEv.fallbackReason).toMatch(/Daily AI call limit/);
  });
});
