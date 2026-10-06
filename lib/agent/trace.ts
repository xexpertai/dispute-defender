import type { EvidenceItem } from "../evidence/types";
import type { Assessment } from "../strategy/rules";
import type { Draft } from "../llm/draft";
import type { ValidationIssue } from "./validate";

/**
 * Agent trace contract (v1). The UI's live trace, the Replay player and the video script all read
 * this shape, so change it only with a version bump.
 *
 * Wire format: Server-Sent Events, one event per message:
 *   event: <type>\n
 *   id: <runId>:<seq>\n
 *   data: <JSON TraceEvent>\n\n
 */
export const TRACE_VERSION = 1;

/** Fixed, numbered steps. Number = index + 1; the UI renders them in this order. */
export const STEPS = [
  { key: "fetch_dispute", title: "Read the dispute from PayPal" },
  { key: "gather_order", title: "Pull the order and payment" },
  { key: "gather_tracking", title: "Check shipment tracking" },
  { key: "gather_logs", title: "Read store and chat logs" },
  { key: "assess", title: "Weigh the evidence" },
  { key: "draft", title: "Draft the response" },
  { key: "validate", title: "Check every claim against its source" },
  { key: "package", title: "Build the evidence pack" },
  { key: "await_approval", title: "Wait for your approval" },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];
export const stepNumber = (key: StepKey) => STEPS.findIndex((s) => s.key === key) + 1;

/** Badge shown next to a step for each PayPal call it made. */
export interface PayPalCallBadge {
  method: "GET" | "POST" | "PATCH";
  /** Templated path, e.g. "/v1/customer/disputes/{id}". Never contains query secrets. */
  endpoint: string;
  /** Short product name for the badge, e.g. "Disputes", "Orders", "Tracking". */
  api: "Disputes" | "Orders" | "Tracking" | "Transactions" | "Payments" | "OAuth" | "Webhooks";
  status?: number;
  debugId?: string | null;
  ms?: number;
  /** "replay" = served from a recorded, redacted sandbox response; "live" = a real sandbox call just now. */
  source?: "live" | "replay";
}

export interface TokenUsage {
  model: string;
  input: number;
  output: number;
  costUsd: number;
}

export type TraceEvent =
  | { v: 1; type: "run_started"; runId: string; disputeId: string; mode: "live" | "replay"; at: string }
  | {
      v: 1;
      type: "step";
      runId: string;
      step: number;
      key: StepKey;
      title: string;
      /** "waiting" = paused on a human (the approval step). */
      status: "running" | "done" | "skipped" | "waiting" | "error";
      /** One-line human detail, already redacted. */
      detail?: string;
      paypal?: PayPalCallBadge[];
      ms?: number;
      tokens?: TokenUsage;
      sourceRefs?: string[];
      at: string;
    }
  /** Cumulative: each evidence event carries every item gathered so far (sent after each gather step). */
  | { v: 1; type: "evidence"; runId: string; items: EvidenceItem[] }
  | { v: 1; type: "assessment"; runId: string; assessment: Assessment }
  | {
      v: 1;
      type: "draft";
      runId: string;
      draftId: string;
      origin: "ai" | "template";
      /** The validated draft the seller reviews (claims already filtered to known sources). */
      draft?: Draft;
      issues?: ValidationIssue[];
      /** sourceRefs that go into the evidence pack. */
      packRefs?: string[];
      /** Set when an AI draft was unavailable or rejected and the TEMPLATE was used instead. */
      fallbackReason?: string;
    }
  | {
      v: 1;
      type: "run_finished";
      runId: string;
      ms: number;
      totals: { paypalCalls: number; llmCalls: number; inputTokens: number; outputTokens: number; costUsd: number };
      at: string;
    }
  | { v: 1; type: "error"; runId: string; message: string; at: string };

export function encodeSse(event: TraceEvent, seq: number): string {
  return `event: ${event.type}\nid: ${event.runId}:${seq}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Parse an SSE stream chunk back into events (used by Replay and tests). */
export function decodeSse(text: string): TraceEvent[] {
  return text
    .split("\n\n")
    .map((block) => block.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => Boolean(l))
    .map((l) => JSON.parse(l.slice(6)) as TraceEvent);
}
