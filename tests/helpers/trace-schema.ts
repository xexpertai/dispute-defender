import { z } from "zod";
import { STEPS } from "@/lib/agent/trace";

/** Test-side schema of the v1 trace contract, so every emitted event is shape-checked. */
const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "ISO time");
const badge = z.object({
  method: z.enum(["GET", "POST", "PATCH"]),
  endpoint: z.string().startsWith("/v"),
  api: z.enum(["Disputes", "Orders", "Tracking", "Transactions", "Payments", "OAuth", "Webhooks"]),
  status: z.number().int().optional(),
  debugId: z.string().nullable().optional(),
  ms: z.number().nonnegative().optional(),
  source: z.enum(["live", "replay"]).optional(),
}).strict();

export const TraceEventSchema = z.discriminatedUnion("type", [
  z.object({ v: z.literal(1), type: z.literal("run_started"), runId: z.string(), disputeId: z.string(), mode: z.enum(["live", "replay"]), at: iso }).strict(),
  z.object({
    v: z.literal(1),
    type: z.literal("step"),
    runId: z.string(),
    step: z.number().int().min(1).max(STEPS.length),
    key: z.enum(STEPS.map((s) => s.key) as [string, ...string[]]),
    title: z.string().min(1),
    status: z.enum(["running", "done", "skipped", "waiting", "error"]),
    detail: z.string().optional(),
    paypal: z.array(badge).optional(),
    ms: z.number().nonnegative().optional(),
    tokens: z.object({ model: z.string(), input: z.number(), output: z.number(), costUsd: z.number() }).optional(),
    sourceRefs: z.array(z.string()).optional(),
    at: iso,
  }).strict(),
  z.object({ v: z.literal(1), type: z.literal("evidence"), runId: z.string(), items: z.array(z.object({ sourceRef: z.string(), kind: z.string(), label: z.string(), text: z.string() }).passthrough()) }).strict(),
  z.object({ v: z.literal(1), type: z.literal("assessment"), runId: z.string(), assessment: z.object({ disputeId: z.string() }).passthrough() }).strict(),
  z.object({
    v: z.literal(1),
    type: z.literal("draft"),
    runId: z.string(),
    draftId: z.string(),
    origin: z.enum(["ai", "template"]),
    draft: z.object({ origin: z.enum(["ai", "template"]) }).passthrough().optional(),
    issues: z.array(z.object({ code: z.string(), message: z.string() })).optional(),
    packRefs: z.array(z.string()).optional(),
    fallbackReason: z.string().optional(),
  }).strict(),
  z.object({
    v: z.literal(1),
    type: z.literal("run_finished"),
    runId: z.string(),
    ms: z.number().nonnegative(),
    totals: z.object({ paypalCalls: z.number(), llmCalls: z.number(), inputTokens: z.number(), outputTokens: z.number(), costUsd: z.number() }).strict(),
    at: iso,
  }).strict(),
  z.object({ v: z.literal(1), type: z.literal("error"), runId: z.string(), message: z.string(), at: iso }).strict(),
]);
