import "server-only";
import { MockCarrier } from "../carrier/mock";
import Anthropic from "@anthropic-ai/sdk";
import { LlmBudget } from "../llm/budget";
import { ClaudeProvider } from "../llm/claude";
import { FakeProvider, type DraftProvider } from "../llm/draft";
import { RecordedProvider } from "../llm/recorded";
import { CliProvider } from "../llm/cli";
import { registerSecret } from "../log/scrub";
import { sharedDb } from "../store/shared";
import { getPayPalClient } from "../paypal/client";
import { createSandboxToolkit } from "../paypal/toolkit";
import { fixtures } from "../replay/fixtures";
import { SampleStore } from "../samples/store";
import type { AgentDeps } from "./run";
import { LiveGateway, ReplayGateway, type DisputeGateway } from "./gateway";
import type { StepKey } from "./trace";

/**
 * Wires the agent for the current mode. Replay is the default (no network, instant, judge-safe).
 * Live = read-only sandbox GETs; set DD_MODE=live (the sandbox guard still applies).
 * Draft provider: FakeProvider (TEMPLATE, no cost) unless DD_LLM=claude is set explicitly and a
 * CLAUDE_API_KEY exists. Claude calls are capped per day and every call is logged to llm_calls.
 */
export type Mode = "live" | "replay";

export const currentMode = (): Mode => (process.env.DD_MODE === "live" ? "live" : "replay");

export function gatewayFor(mode: Mode = currentMode()): DisputeGateway {
  if (mode === "replay") return new ReplayGateway(fixtures());
  const client = getPayPalClient();
  // Reads go through PayPal's Agent Toolkit (sandbox-forced, re-checked per call; token cached).
  return new LiveGateway(client, undefined, async (method, args) => String(await createSandboxToolkit(await client.getAccessToken()).run(method, args)));
}

/** Replay pacing per step, in ms, so a person can follow the trace (≈6 s total at pace 1). */
export const REPLAY_PACE_MS: Record<StepKey, number> = {
  fetch_dispute: 700,
  gather_order: 650,
  gather_tracking: 950,
  gather_logs: 550,
  assess: 700,
  draft: 1100,
  validate: 600,
  package: 600,
  await_approval: 300,
};

export function agentDeps(opts: { mode?: Mode; pace?: number; liveAi?: boolean } = {}): AgentDeps {
  const mode = opts.mode ?? currentMode();
  const f = fixtures();
  const pace = Math.max(0, Math.min(opts.pace ?? (mode === "replay" ? 1 : 0), 5));
  return {
    gateway: gatewayFor(mode),
    carrier: new MockCarrier(f.carrier),
    store: new SampleStore(f.store),
    provider: draftProvider(mode, opts.liveAi ?? false),
    pace: pace > 0 ? (key) => new Promise((r) => setTimeout(r, REPLAY_PACE_MS[key] * pace)) : undefined,
  };
}

export const aiEnabled = () => process.env.DD_LLM === "claude" && Boolean(process.env.CLAUDE_API_KEY?.trim());

/**
 * Which draft writer runs:
 *  - live AI explicitly requested (and enabled) → Claude (rate-limited + daily cap by the caller)
 *  - Replay → the recorded real Claude draft for that fixture ($0), else TEMPLATE
 *  - Live sandbox → Claude when enabled, else TEMPLATE
 */
export function draftProvider(mode: Mode = currentMode(), liveAi = false): DraftProvider {
  if (process.env.DD_LLM === "cli") return new CliProvider(); // dev only; throws in production builds
  if (liveAi && aiEnabled()) return claudeProvider();
  if (mode === "replay") return new RecordedProvider(fixtures().aiDrafts, new FakeProvider());
  return aiEnabled() ? claudeProvider() : new FakeProvider();
}

export function claudeProvider(): ClaudeProvider {
  const apiKey = process.env.CLAUDE_API_KEY!.trim();
  registerSecret(apiKey);
  const budget = new LlmBudget(sharedDb());
  return new ClaudeProvider({
    client: new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 }),
    beforeCall: () => budget.assertAvailable(),
    afterCall: (usage) => budget.record(usage, "draft"),
  });
}
