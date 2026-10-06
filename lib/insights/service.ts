import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { aiEnabled, currentMode, gatewayFor } from "../agent/deps";
import { MockCarrier } from "../carrier/mock";
import { LlmBudget } from "../llm/budget";
import { registerSecret } from "../log/scrub";
import { fixtures } from "../replay/fixtures";
import { SampleStore } from "../samples/store";
import { sharedDb } from "../store/shared";
import { aiActions, insightsHash, readCache, templateActions, writeCache, type ActionsResult } from "./actions";
import { findPatterns, reasonText, type Insight } from "./patterns";
import { money } from "../format";
import { collectFacts } from "./portfolio";

export interface InsightsView {
  mode: "live" | "replay";
  disputes: number;
  patterns: Insight[];
  /** Friendly label per dispute id for the UI ("$12.75 · Speckled ceramic mug set (4)"). */
  caseLabels: Record<string, string>;
  actions: ActionsResult;
  hash: string;
}

interface RecordedInsights {
  _meta: { model: string; recorded_at: string; usage: { input: number; output: number; costUsd: number } };
  inputHash: string;
  actions: ActionsResult["actions"];
}

function recorded(hash: string): ActionsResult | null {
  const p = path.join(process.cwd(), "fixtures/ai/insights.json");
  if (!existsSync(p)) return null;
  const r = JSON.parse(readFileSync(p, "utf8")) as RecordedInsights;
  return r.inputHash === hash ? { origin: "ai-recorded", actions: r.actions, model: r._meta.model, recordedAt: r._meta.recorded_at } : null;
}

/** Patterns are always computed; AI actions come from cache, a recording, or one live call. */
export async function getInsights(opts: { liveAi?: boolean } = {}): Promise<InsightsView> {
  const mode = currentMode();
  const f = fixtures();
  const facts = await collectFacts(gatewayFor(mode), new MockCarrier(f.carrier), new SampleStore(f.store));
  const patterns = findPatterns(facts);
  const hash = insightsHash(patterns);
  const caseLabels = Object.fromEntries(
    facts.map((x) => [x.id, `${money(x.amount, x.currency)} · ${(x.sku && f.store.listings?.[x.sku]?.title) || reasonText(x.reason)}`]),
  );
  const base = { mode, disputes: facts.length, patterns, caseLabels, hash };
  if (!patterns.length) return { ...base, actions: { origin: "template", actions: [] } };

  const db = sharedDb();
  const cached = readCache(db, hash);
  if (cached && !opts.liveAi) return { ...base, actions: cached };
  const rec = mode === "replay" && !opts.liveAi ? recorded(hash) : null;
  if (rec) return { ...base, actions: rec };

  if (aiEnabled() && (mode === "live" || opts.liveAi)) {
    const apiKey = process.env.CLAUDE_API_KEY!.trim();
    registerSecret(apiKey);
    const budget = new LlmBudget(db);
    try {
      budget.assertAvailable();
      const { actions, usage } = await aiActions(new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 }), patterns);
      budget.record(usage, "insights");
      if (actions.length) {
        const result: ActionsResult = { origin: "ai", actions, model: usage.model, usage };
        writeCache(db, hash, result);
        return { ...base, actions: result };
      }
    } catch {
      /* fall through to the deterministic suggestions */
    }
  }
  return { ...base, actions: { origin: "template", actions: templateActions(patterns) } };
}
