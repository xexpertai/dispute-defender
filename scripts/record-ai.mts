// npm run ai:record [-- <dispute_id> ...]   (real Claude calls: Haiku, logged to llm_calls)
// Captures one real AI draft per Replay fixture so the hosted demo shows genuine AI output at $0
// per visitor. Only drafts that pass server validation (no TEMPLATE fallback) are saved.
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ReplayGateway } from "../lib/agent/gateway";
import { runAgent } from "../lib/agent/run";
import type { TraceEvent } from "../lib/agent/trace";
import { MockCarrier } from "../lib/carrier/mock";
import { LlmBudget } from "../lib/llm/budget";
import { ClaudeProvider } from "../lib/llm/claude";
import { registerSecret } from "../lib/log/scrub";
import { loadFixtures } from "../lib/replay/fixtures";
import { SampleStore } from "../lib/samples/store";
import { openDb } from "../lib/store/db";

const apiKey = process.env.CLAUDE_API_KEY?.trim();
if (!apiKey) throw new Error("CLAUDE_API_KEY missing in .env.local");
registerSecret(apiKey);
const f = loadFixtures();
const insightsMode = process.argv.includes("--insights");
const ids = insightsMode ? [] : process.argv.slice(2).length ? process.argv.slice(2) : [...f.disputes.keys()];
const budget = new LlmBudget(openDb());
let last: { input: number; output: number; costUsd: number; model: string } | null = null;
const provider = new ClaudeProvider({
  client: new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 }),
  beforeCall: () => budget.assertAvailable(),
  afterCall: (u) => {
    last = u;
    budget.record(u, "draft:record");
  },
});
const dir = path.join(process.cwd(), "fixtures/ai/drafts");
mkdirSync(dir, { recursive: true });
for (const id of ids) {
  last = null;
  let draftEv: Extract<TraceEvent, { type: "draft" }> | undefined;
  for await (const e of runAgent(id, { gateway: new ReplayGateway(f), carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store), provider, runId: "rec" })) {
    if (e.type === "draft") draftEv = e;
  }
  const u = last as { input: number; output: number; costUsd: number; model: string } | null;
  if (!draftEv?.draft || draftEv.origin !== "ai" || draftEv.fallbackReason || !u) {
    console.log(`${id}: not saved (${draftEv?.fallbackReason ?? "no AI draft"})`);
    continue;
  }
  const out = { _meta: { source: "claude", model: u.model, recorded_at: new Date().toISOString(), usage: { input: u.input, output: u.output, costUsd: u.costUsd } }, disputeId: id, draft: draftEv.draft };
  writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(out, null, 2) + "\n");
  console.log(`${id}: saved (${draftEv.draft.strategy}, ${draftEv.draft.claims.length} claims, ${u.input}+${u.output} tokens, $${u.costUsd.toFixed(4)})`);
}
if (insightsMode) {
  const { collectFacts } = await import("../lib/insights/portfolio");
  const { findPatterns } = await import("../lib/insights/patterns");
  const { aiActions, insightsHash } = await import("../lib/insights/actions");
  const patterns = findPatterns(await collectFacts(new ReplayGateway(f), new MockCarrier(f.carrier), new SampleStore(f.store)));
  budget.assertAvailable();
  const { actions, usage } = await aiActions(new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 }), patterns);
  budget.record(usage, "insights:record");
  writeFileSync(
    path.join(process.cwd(), "fixtures/ai/insights.json"),
    JSON.stringify({ _meta: { model: usage.model, recorded_at: new Date().toISOString(), usage: { input: usage.input, output: usage.output, costUsd: usage.costUsd } }, inputHash: insightsHash(patterns), actions }, null, 2) + "\n",
  );
  console.log(`insights: ${patterns.length} patterns -> ${actions.length} actions (${usage.input}+${usage.output} tokens, $${usage.costUsd.toFixed(4)})`);
}
const t = budget.allTime();
console.log(`llm_calls total: ${t.calls} calls, ${t.input_tokens} in / ${t.output_tokens} out, $${t.cost_usd.toFixed(4)}`);
