"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { TraceEvent } from "@/lib/agent/trace";
import { initialTraceState, reduceTrace, type StepView, type TraceState } from "@/lib/agent/trace-state";
import { PROVENANCE_LABEL, provenanceOf } from "@/lib/disputes/model";
import type { EvidenceItem } from "@/lib/evidence/types";
import { evidenceAnchor, humanLabel, money, utcStamp } from "@/lib/format";
import type { Assessment, Reason } from "@/lib/strategy/rules";
import { CaseFile } from "./CaseFile";
import { DraftPanel } from "./DraftPanel";
import { EvidenceContext, useEvidence } from "./EvidenceContext";
import { PROVENANCE_DOT, SourceChip } from "./SourceChip";

const EVENT_TYPES: TraceEvent["type"][] = ["run_started", "step", "evidence", "assessment", "draft", "run_finished", "error"];

type Action = { kind: "event"; event: TraceEvent } | { kind: "reset" } | { kind: "fail"; message: string };

function reducer(state: TraceState, a: Action): TraceState {
  if (a.kind === "reset") return { ...initialTraceState(), phase: "running" };
  if (a.kind === "fail") return reduceTrace(state, { v: 1, type: "error", runId: state.runId ?? "", message: a.message, at: new Date().toISOString() });
  return reduceTrace(state, a.event);
}

export interface AgentTraceProps {
  disputeId: string;
  mode: "live" | "replay";
  autoStart?: boolean;
  pace?: string;
  closed?: boolean;
  /** Live Claude is configured: offer a fresh (capped) AI draft. */
  aiAvailable?: boolean;
}

export function AgentTrace({ disputeId, mode, autoStart, pace, closed, aiAvailable }: AgentTraceProps) {
  const [state, dispatch] = useReducer(reducer, undefined, initialTraceState);
  const [details, setDetails] = useState(false);
  const [allSteps, setAllSteps] = useState(false);
  const source = useRef<EventSource | null>(null);
  const stampRef = useRef<HTMLDivElement>(null);

  const start = useCallback(
    (liveAi = false) => {
      source.current?.close();
      dispatch({ kind: "reset" });
      const qs = new URLSearchParams({ dispute: disputeId, ...(pace ? { pace } : {}), ...(liveAi ? { ai: "live" } : {}) });
      const es = new EventSource(`/api/agent/run?${qs}`);
      source.current = es;
      let done = false;
      for (const type of EVENT_TYPES) {
        es.addEventListener(type, (m) => {
          const event = JSON.parse((m as MessageEvent<string>).data) as TraceEvent;
          dispatch({ kind: "event", event });
          if (type === "run_finished") {
            done = true;
            es.close();
          }
        });
      }
      es.onerror = () => {
        es.close();
        if (!done) dispatch({ kind: "fail", message: "Lost the connection to the agent (or too many runs from this network). Try again in a moment." });
      };
    },
    [disputeId, pace],
  );

  useEffect(() => {
    if (!autoStart) return;
    const t = window.setTimeout(() => start(), 250);
    return () => {
      window.clearTimeout(t);
      source.current?.close();
    };
  }, [autoStart, start]);

  useEffect(() => () => source.current?.close(), []);

  // Phones: when the verdict lands, bring it on screen.
  useEffect(() => {
    if (state.phase !== "finished" || window.innerWidth >= 1024) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(() => stampRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" }), 450);
    return () => window.clearTimeout(t);
  }, [state.phase]);

  const byRef = useMemo(() => new Map(state.evidence.map((e) => [e.sourceRef, e])), [state.evidence]);
  const running = state.phase === "running";
  const doneCount = state.steps.filter((s) => s.status !== "pending" && s.status !== "running").length;
  const focus = (() => {
    const r = state.steps.findIndex((s) => s.status === "running");
    if (r >= 0) return r;
    const last = [...state.steps].reverse().findIndex((s) => s.status !== "pending");
    return last >= 0 ? state.steps.length - 1 - last : 0;
  })();

  return (
    <EvidenceContext.Provider value={{ byRef, details }}>
      <div className="grid gap-x-6 gap-y-8 lg:grid-cols-12 lg:items-start">
        {/* ------------------------------------------------------------ trace */}
        <section aria-labelledby="trace-h" className="case-wrap lg:col-span-4">
          <div className="case">
            <span className="case-tab">Agent · 9 steps</span>
            <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4">
              <div className="min-w-0">
                <h2 id="trace-h" className="font-display text-[1.15rem] leading-tight">
                  Agent trace
                </h2>
                <p className="text-xs text-muted" aria-live="polite">
                  {state.phase === "idle" && "Reads PayPal, never sends without you"}
                  {running && `Step ${Math.min(doneCount + 1, 9)} of 9`}
                  {state.phase === "finished" && `Done in ${((state.ms ?? 0) / 1000).toFixed(1)} s`}
                  {state.phase === "error" && "Stopped"}
                </p>
              </div>
              {running ? (
                <span className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-2" role="status">
                  <span className="spin inline-block size-3.5 rounded-full border-2 border-line-strong border-t-ink" aria-hidden="true" />
                  Running · {Math.min(doneCount + 1, 9)}/9
                </span>
              ) : (
                <button type="button" onClick={() => start()} className="inline-flex min-h-11 shrink-0 items-center rounded-full bg-primary px-4 text-sm font-semibold text-on-primary hover:opacity-90">
                  {state.phase === "idle" ? "Start the agent" : "Run again"}
                </button>
              )}
            </div>
            <div className="h-1 w-full bg-surface-2" aria-hidden="true">
              <div className="h-full bg-ink transition-[width] duration-500" style={{ width: `${(doneCount / 9) * 100}%` }} />
            </div>
            <ol className="flex flex-col px-2 py-2">
              {state.steps.map((s, i) => (
                <StepRow key={s.key} step={s} last={i === state.steps.length - 1} visible={allSteps || i === focus} details={details} />
              ))}
            </ol>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-1">
              <button type="button" onClick={() => setAllSteps((v) => !v)} className="inline-flex min-h-11 items-center px-1 text-xs font-semibold text-ink-2 lg:hidden" aria-expanded={allSteps}>
                {allSteps ? "Show current step only" : "Show all 9 steps"}
              </button>
              <button type="button" onClick={() => setDetails((v) => !v)} aria-pressed={details} className="inline-flex min-h-11 items-center px-1 text-xs font-semibold text-ink-2 hover:text-ink">
                {details ? "Hide details" : "Show details (API calls, raw refs)"}
              </button>
            </div>
            {details && state.totals && (
              <p className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line px-4 py-2 font-mono text-[0.68rem] text-muted">
                <span>{state.totals.paypalCalls} PayPal calls{mode === "replay" ? " (recorded)" : ""}</span>
                <span>{state.totals.llmCalls} live AI calls</span>
                <span>
                  {state.totals.inputTokens + state.totals.outputTokens} tokens · ${state.totals.costUsd.toFixed(4)}
                </span>
              </p>
            )}
            {state.error && (
              <div className="mx-3 mb-3 rounded-lg border border-loss/40 bg-loss-soft p-3 text-sm text-loss" role="alert">
                {state.error}
                <button type="button" onClick={() => start()} className="mt-1 block min-h-11 font-semibold underline">
                  Try again
                </button>
              </div>
            )}
            {aiAvailable && state.phase === "finished" && (
              <div className="border-t border-line px-4 py-3">
                <button type="button" onClick={() => start(true)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-ai/40 px-4 text-sm font-semibold text-ai hover:bg-ai-soft">
                  Fresh draft with live AI
                </button>
                <p className="mt-1 text-[0.7rem] text-muted">One Claude call. Limited per visitor and per day.</p>
              </div>
            )}
          </div>
        </section>

        {/* ------------------------------------------------------------ case file (signature) */}
        <div className="flex min-w-0 flex-col gap-8 lg:col-span-8">
          <CaseFile state={state} disputeId={disputeId} closed={closed} stampRef={stampRef} />
        </div>

        {/* ------------------------------------------------------------ the full write-up */}
        {(state.assessment || state.draft) && (
          <div className="grid gap-x-6 gap-y-8 lg:col-span-12 lg:grid-cols-2 lg:items-start">
            {state.assessment && <Recommendation a={state.assessment} closed={closed} />}
            {state.draft && (
              <DraftPanel
                key={state.draftId}
                draft={state.draft}
                draftId={state.draftId}
                fallbackReason={state.fallbackReason}
                issues={state.issues.filter((i) => i.code !== "ai_fallback").length}
                mode={mode}
                closed={closed}
                evidence={state.evidence}
                onSubmitted={(detail) =>
                  dispatch({
                    kind: "event",
                    event: { v: 1, type: "step", runId: state.runId ?? "", step: 9, key: "await_approval", title: "Wait for your approval", status: "done", detail, at: new Date().toISOString() },
                  })
                }
              />
            )}
          </div>
        )}
        {state.evidence.length > 0 && (
          <div className="lg:col-span-12">
            <Evidence items={state.evidence} packRefs={state.packRefs} />
          </div>
        )}
      </div>
    </EvidenceContext.Provider>
  );
}

// ---------------------------------------------------------------------------------------- steps

const STATUS_STYLE: Record<StepView["status"], string> = {
  pending: "border-line-strong text-muted bg-surface",
  running: "border-ink text-ink bg-surface pulse",
  done: "border-ink bg-ink text-bg",
  skipped: "border-line-strong text-muted bg-surface-2",
  waiting: "border-amber text-amber bg-amber-soft",
  error: "border-loss bg-loss text-white",
};

function StepRow({ step: s, last, visible, details }: { step: StepView; last: boolean; visible: boolean; details: boolean }) {
  const glyph = s.status === "done" ? "✓" : s.status === "skipped" ? "–" : s.status === "error" ? "!" : String(s.n);
  const apis = [...new Set(s.paypal.map((b) => b.api))];
  return (
    <li className={`relative grid-cols-[1.75rem_1fr] gap-x-2.5 rounded-lg px-2 py-1.5 ${visible ? "grid" : "hidden lg:grid"} ${s.status === "running" ? "bg-surface-2" : ""}`}>
      {!last && <span className="absolute left-[1.4rem] top-8 hidden h-[calc(100%-1.4rem)] w-px bg-line lg:block" aria-hidden="true" />}
      <span className={`relative z-10 mt-0.5 grid size-6 place-items-center rounded-full border font-mono text-[0.65rem] font-semibold ${STATUS_STYLE[s.status]}`} aria-hidden="true">
        {glyph}
      </span>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className={`text-[0.85rem] font-semibold leading-snug ${s.status === "pending" ? "text-muted" : "text-ink"}`}>
            <span className="sr-only">Step {s.n}: </span>
            {s.title}
          </p>
          {details && s.ms !== undefined && s.status !== "running" && <span className="shrink-0 font-mono text-[0.65rem] tabular-nums text-muted">{(s.ms / 1000).toFixed(1)}s</span>}
        </div>
        {s.detail && <p className={`line-clamp-2 text-[0.75rem] leading-snug ${s.status === "waiting" ? "text-amber" : "text-ink-2"}`}>{s.detail}</p>}
        {s.paypal.length > 0 &&
          (details ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {s.paypal.map((b, i) => (
                <span key={i} className="inline-flex max-w-full items-center gap-1 rounded border border-pp/30 bg-pp-soft px-1.5 py-0.5 font-mono text-[0.62rem] text-pp" title={b.source === "replay" ? "Recorded sandbox response (Replay)" : `Live sandbox call${b.debugId ? ` · debug_id ${b.debugId}` : ""}`}>
                  <span className="truncate">
                    {b.method} {b.endpoint}
                  </span>
                  {b.status && <span className="opacity-70">{b.status}</span>}
                  {b.source === "replay" && <span className="opacity-70">rec</span>}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-0.5 flex flex-wrap gap-1">
              {apis.map((api) => (
                <span key={api} className="rounded border border-pp/25 bg-pp-soft px-1.5 py-px text-[0.66rem] font-semibold text-pp">
                  PayPal {api} ✓
                </span>
              ))}
            </p>
          ))}
      </div>
    </li>
  );
}

// ------------------------------------------------------------------------------------- results

const STRATEGY: Record<Assessment["recommendation"]["strategy"], { title: string; tone: string }> = {
  FIGHT: { title: "Defend with evidence", tone: "text-win" },
  OFFER: { title: "Make a fair offer", tone: "text-amber" },
  REFUND: { title: "Refund the buyer", tone: "text-loss" },
};

const ACTION: Record<string, { label: string; path: string }> = {
  provide_evidence: { label: "Provide evidence", path: "provide-evidence" },
  send_message: { label: "Message the buyer", path: "send-message" },
  make_offer: { label: "Make an offer", path: "make-offer" },
  accept_claim: { label: "Accept the claim and refund", path: "accept-claim" },
  escalate: { label: "Escalate to PayPal", path: "escalate" },
};

const LEVEL = { HIGH: "Strong evidence", MEDIUM: "Mixed evidence", LOW: "Weak evidence" };
const LEVEL_TONE = { HIGH: "text-win border-win/40 bg-win-soft", MEDIUM: "text-amber border-amber/40 bg-amber-soft", LOW: "text-loss border-loss/40 bg-loss-soft" };

function Recommendation({ a, closed }: { a: Assessment; closed?: boolean }) {
  const rec = a.recommendation;
  const s = STRATEGY[rec.strategy];
  const act = rec.action ? ACTION[rec.action.kind] : null;
  return (
    <section aria-labelledby="rec-h" className="rise case p-5 sm:p-6">
      <p className="text-sm text-muted">{closed ? "Hindsight review (case closed)" : "Recommendation"}</p>
      <h2 id="rec-h" className={`mt-1 font-display text-[1.8rem] leading-none ${s.tone}`}>
        {s.title}
      </h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${LEVEL_TONE[a.strength.level]}`} title="Confidence from the evidence, with the reasons below. Not a win probability.">
          {LEVEL[a.strength.level]}
        </span>
        {rec.buyerFair && <span className="rounded-full border border-amber/40 bg-amber-soft px-2 py-0.5 text-xs font-semibold text-amber">The buyer is right</span>}
      </div>
      <ul className="mt-3 flex flex-col gap-1 text-[0.92rem] leading-relaxed text-ink-2">
        {rec.why.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>

      {a.strength.reasons.length > 0 && (
        <>
          <h3 className="mt-5 text-sm font-semibold">Why</h3>
          <ul className="mt-1 flex flex-col divide-y divide-line">
            {a.strength.reasons.map((r) => (
              <ReasonRow key={r.id} r={r} />
            ))}
          </ul>
        </>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-surface-2 p-3">
          <p className="text-xs text-muted">Next PayPal action</p>
          {act ? (
            <>
              <p className="mt-0.5 text-sm font-semibold">
                {act.label}
                {rec.action?.amount && ` · ${money(Number(rec.action.amount.value), rec.action.amount.currency_code)}`}
              </p>
              <p className="text-[0.7rem] text-muted">PayPal allows this on the dispute right now</p>
            </>
          ) : (
            <p className="mt-0.5 text-sm text-ink-2">{closed ? "None: the case is closed." : "None allowed by PayPal right now."}</p>
          )}
        </div>
        <div className="rounded-lg bg-surface-2 p-3">
          <p className="text-xs text-muted">Cost to fight</p>
          <p className="mt-0.5 text-sm font-semibold">
            ~{money(a.costToFight, a.currency)} of your time <span className="font-normal text-muted">vs {money(a.amount, a.currency)} disputed</span>
          </p>
          <p className="text-[0.7rem] text-muted">30 min at $25/h</p>
        </div>
      </div>
    </section>
  );
}

function ReasonRow({ r }: { r: Reason }) {
  const seller = r.supports === "seller";
  return (
    <li className="flex flex-col gap-0.5 py-2">
      <span className="flex min-w-0 items-start gap-2 text-sm">
        <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[0.7rem] font-bold ${seller ? "bg-win-soft text-win" : "bg-loss-soft text-loss"}`} aria-label={seller ? "Supports you" : "Supports the buyer"}>
          {seller ? "+" : "−"}
        </span>
        <span>
          {r.text}
          {r.decisive && <span className="ml-1.5 text-xs font-semibold text-amber">decisive</span>}
        </span>
      </span>
      <span className="flex flex-wrap gap-x-1 pl-7">
        {r.sourceRefs.map((ref) => (
          <SourceChip key={ref} sourceRef={ref} />
        ))}
      </span>
    </li>
  );
}

function Evidence({ items, packRefs }: { items: EvidenceItem[]; packRefs: string[] }) {
  const { details } = useEvidence();
  const pack = new Set(packRefs);
  const sorted = [...items].sort((a, b) => (a.at ?? "9").localeCompare(b.at ?? "9"));
  return (
    <section aria-labelledby="ev-h" className="rise case p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="ev-h" className="font-display text-[1.3rem]">
          Evidence timeline
        </h2>
        <p className="text-xs text-muted">
          {items.length} records · {pack.size} in the evidence pack
        </p>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        {(["paypal", "carrier", "store"] as const).map((p) => (
          <span key={p} className="inline-flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${PROVENANCE_DOT[p]}`} aria-hidden="true" />
            {PROVENANCE_LABEL[p]}
          </span>
        ))}
      </div>
      <ol className="mt-3 grid gap-1.5 md:grid-cols-2">
        {sorted.map((e) => {
          const p = provenanceOf(e.kind);
          return (
            <li key={e.sourceRef} id={evidenceAnchor(e.sourceRef)} className="ev-item grid grid-cols-[0.5rem_1fr] gap-x-3 rounded-lg px-2 py-2">
              <span className={`mt-1.5 size-2 rounded-full ${PROVENANCE_DOT[p]}`} aria-hidden="true" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <p className="text-sm font-medium">{humanLabel(e, e.sourceRef)}</p>
                  <span className="font-mono text-[0.66rem] text-muted">{utcStamp(e.at)}</span>
                </div>
                {e.text && <p className="text-[0.82rem] leading-snug text-ink-2">{e.text}</p>}
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.7rem] text-muted">
                  <span>{PROVENANCE_LABEL[p]}</span>
                  {pack.has(e.sourceRef) && <span className="rounded-sm bg-ink px-1 text-[0.6rem] font-semibold uppercase tracking-wide text-bg">in pack</span>}
                  {details && <span className="break-all font-mono text-[0.62rem] opacity-80">{e.sourceRef}</span>}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
