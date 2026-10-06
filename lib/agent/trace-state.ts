import type { EvidenceItem } from "../evidence/types";
import type { Draft } from "../llm/draft";
import type { Assessment } from "../strategy/rules";
import { STEPS, type PayPalCallBadge, type StepKey, type TokenUsage, type TraceEvent } from "./trace";
import type { ValidationIssue } from "./validate";

/** UI state for the live trace, built by folding TraceEvents. Pure, so Replay and tests share it. */
export type StepStatus = "pending" | "running" | "done" | "skipped" | "waiting" | "error";

export interface StepView {
  n: number;
  key: StepKey;
  title: string;
  status: StepStatus;
  detail?: string;
  paypal: PayPalCallBadge[];
  ms?: number;
  tokens?: TokenUsage;
  sourceRefs: string[];
}

export interface TraceState {
  phase: "idle" | "running" | "finished" | "error";
  runId?: string;
  mode?: "live" | "replay";
  steps: StepView[];
  evidence: EvidenceItem[];
  assessment?: Assessment;
  draft?: Draft;
  draftId?: string;
  fallbackReason?: string;
  issues: ValidationIssue[];
  packRefs: string[];
  error?: string;
  totals?: Extract<TraceEvent, { type: "run_finished" }>["totals"];
  ms?: number;
}

export const initialTraceState = (): TraceState => ({
  phase: "idle",
  steps: STEPS.map((s, i) => ({ n: i + 1, key: s.key, title: s.title, status: "pending", paypal: [], sourceRefs: [] })),
  evidence: [],
  issues: [],
  packRefs: [],
});

export function reduceTrace(state: TraceState, e: TraceEvent): TraceState {
  switch (e.type) {
    case "run_started":
      return { ...initialTraceState(), phase: "running", runId: e.runId, mode: e.mode };
    case "step":
      return {
        ...state,
        steps: state.steps.map((s) =>
          s.n === e.step
            ? { ...s, status: e.status, detail: e.detail ?? s.detail, paypal: e.paypal ?? s.paypal, ms: e.ms ?? s.ms, tokens: e.tokens ?? s.tokens, sourceRefs: e.sourceRefs ?? s.sourceRefs }
            : s,
        ),
      };
    case "evidence":
      return { ...state, evidence: e.items };
    case "assessment":
      return { ...state, assessment: e.assessment };
    case "draft":
      return { ...state, draft: e.draft, draftId: e.draftId, fallbackReason: e.fallbackReason, issues: e.issues ?? [], packRefs: e.packRefs ?? [] };
    case "error":
      return { ...state, phase: "error", error: e.message, steps: state.steps.map((s) => (s.status === "running" ? { ...s, status: "error" } : s)) };
    case "run_finished":
      return { ...state, phase: state.phase === "error" ? "error" : "finished", totals: e.totals, ms: e.ms };
  }
}

/** Index of the step currently running (for the progress rail), or -1. */
export const activeStep = (s: TraceState) => s.steps.findIndex((x) => x.status === "running");
