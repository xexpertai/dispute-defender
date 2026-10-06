"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { TraceEvent } from "@/lib/agent/trace";
import { initialTraceState, reduceTrace, type StepView, type TraceState } from "@/lib/agent/trace-state";
import { PROVENANCE_LABEL, provenanceOf } from "@/lib/disputes/model";
import type { EvidenceItem } from "@/lib/evidence/types";
import { evidenceAnchor, money, utcStamp } from "@/lib/format";
import type { Assessment, Reason } from "@/lib/strategy/rules";
import { DraftPanel } from "./DraftPanel";
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
  const source = useRef<EventSource | null>(null);

  const start = useCallback((liveAi = false) => {
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
      if (!done) dispatch({ kind: "fail", message: "Lost the connection to the agent. Try again." });
    };
  }, [disputeId, pace]);

  useEffect(() => {
    if (!autoStart) return;
    const t = window.setTimeout(() => start(), 250);
    return () => {
      window.clearTimeout(t);
      source.current?.close();
    };
  }, [autoStart, start]);

  useEffect(() => () => source.current?.close(), []);

  const running = state.phase === "running";
  const doneCount = state.steps.filter((s) => s.status !== "pending" && s.status !== "running").length;

  return (
    <div className="grid gap-5 lg:grid-cols-12 lg:items-start lg:gap-6">
      {/* ------------------------------------------------------------ trace */}
      <section aria-labelledby="trace-h" className="rounded-2xl border border-line bg-surface shadow-card lg:sticky lg:top-28 lg:col-span-5">
        <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
          <div>
            <h2 id="trace-h" className="font-display text-[1.3rem] leading-none">
              Agent trace
            </h2>
            <p className="mt-1 text-xs text-muted" aria-live="polite">
              {state.phase === "idle" && "9 steps · reads PayPal, never submits without you"}
              {running && `Step ${Math.min(doneCount + 1, 9)} of 9…`}
              {state.phase === "finished" && `Finished in ${((state.ms ?? 0) / 1000).toFixed(1)} s`}
              {state.phase === "error" && "Stopped"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => start()}
            disabled={running}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-on-primary transition hover:opacity-90 disabled:cursor-progress disabled:opacity-60"
          >
            {running ? (
              <>
                <span className="size-2 rounded-full bg-primary pulse" aria-hidden="true" /> Running
              </>
            ) : state.phase === "idle" ? (
              <>Defend this dispute</>
            ) : (
              <>Run again</>
            )}
          </button>
        </div>
        <div className="h-1 w-full bg-surface-2" aria-hidden="true">
          <div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${(doneCount / 9) * 100}%` }} />
        </div>
        <ol className="flex flex-col px-2 py-2 sm:px-3">
          {state.steps.map((s, i) => (
            <StepRow key={s.key} step={s} last={i === state.steps.length - 1} />
          ))}
        </ol>
        {state.totals && (
          <div className="perf mx-4" aria-hidden="true" />
        )}
        {state.totals && (
          <p className="flex flex-wrap gap-x-3 gap-y-1 px-4 py-3 font-mono text-[0.7rem] text-muted sm:px-5">
            <span>{state.totals.paypalCalls} PayPal calls{mode === "replay" ? " (replayed)" : ""}</span>
            <span>{state.totals.llmCalls} AI calls</span>
            <span>
              {state.totals.inputTokens + state.totals.outputTokens} tokens · ${state.totals.costUsd.toFixed(4)}
            </span>
          </p>
        )}
        {state.error && (
          <div className="mx-4 mb-4 rounded-lg border border-loss/40 bg-loss-soft p-3 text-sm text-loss" role="alert">
            {state.error}
            <button type="button" onClick={() => start()} className="mt-1 block min-h-11 font-semibold underline">
              Try again
            </button>
          </div>
        )}
        {aiAvailable && state.phase === "finished" && (
          <div className="border-t border-line px-4 py-3 sm:px-5">
            <button type="button" onClick={() => start(true)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-ai/40 px-4 text-sm font-semibold text-ai hover:bg-ai-soft">
              Fresh draft with live AI
            </button>
            <p className="mt-1 text-[0.7rem] text-muted">One Claude Haiku call (~$0.007). Limited per visitor and per day.</p>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ results */}
      <div className="flex min-w-0 flex-col gap-5 lg:col-span-7">
        {state.phase === "idle" && <IdleCard />}
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
            onSubmitted={(detail) =>
              dispatch({
                kind: "event",
                event: { v: 1, type: "step", runId: state.runId ?? "", step: 9, key: "await_approval", title: "Wait for your approval", status: "done", detail, at: new Date().toISOString() },
              })
            }
          />
        )}
        {state.evidence.length > 0 && <Evidence items={state.evidence} packRefs={state.packRefs} />}
        {running && !state.assessment && <Skeleton />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------- steps

const STATUS_STYLE: Record<StepView["status"], string> = {
  pending: "border-line-strong text-muted bg-surface",
  running: "border-primary text-primary bg-primary-soft pulse",
  done: "border-ink bg-ink text-bg",
  skipped: "border-line-strong text-muted bg-surface-2",
  waiting: "border-amber text-amber bg-amber-soft pulse",
  error: "border-loss bg-loss text-white",
};

function StepRow({ step: s, last }: { step: StepView; last: boolean }) {
  const glyph = s.status === "done" ? "✓" : s.status === "skipped" ? "–" : s.status === "error" ? "!" : String(s.n);
  return (
    <li className={`relative grid grid-cols-[2.25rem_1fr] gap-x-3 rounded-xl px-2 py-2 ${s.status === "running" ? "bg-surface-2" : ""}`}>
      {!last && <span className="absolute left-[1.6rem] top-10 h-[calc(100%-1.75rem)] w-px bg-line" aria-hidden="true" />}
      <span className={`relative z-10 grid size-8 place-items-center rounded-full border font-mono text-xs font-semibold ${STATUS_STYLE[s.status]}`} aria-hidden="true">
        {glyph}
      </span>
      <div className="min-w-0 pt-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={`text-sm font-semibold ${s.status === "pending" ? "text-muted" : "text-ink"}`}>
            <span className="sr-only">Step {s.n}: </span>
            {s.title}
          </p>
          {s.ms !== undefined && s.status !== "running" && <span className="shrink-0 font-mono text-[0.68rem] tabular-nums text-muted">{(s.ms / 1000).toFixed(1)}s</span>}
        </div>
        {s.detail && <p className={`mt-0.5 text-[0.8rem] leading-snug ${s.status === "waiting" ? "text-amber" : "text-ink-2"}`}>{s.detail}</p>}
        {s.paypal.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {s.paypal.map((b, i) => (
              <span
                key={i}
                className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-pp/30 bg-pp-soft px-1.5 py-0.5 font-mono text-[0.66rem] text-pp"
                title={b.source === "replay" ? "Recorded sandbox response (Replay)" : `Live sandbox call${b.debugId ? ` · debug_id ${b.debugId}` : ""}`}
              >
                <span className="whitespace-nowrap font-sans font-bold">PayPal {b.api}</span>
                <span className="truncate opacity-90">
                  {b.method} {b.endpoint}
                </span>
                {b.status && <span className="opacity-70">{b.status}</span>}
                {b.source === "replay" && <span className="rounded-sm bg-pp/15 px-1 text-[0.6rem] uppercase tracking-wide">rec</span>}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

// ------------------------------------------------------------------------------------- results

function IdleCard() {
  const sources: [string, string, string][] = [
    ["paypal", "PayPal Disputes, Orders, Payments and Tracking", "the dispute, the order, the payment and tracking on file"],
    ["carrier", "Carrier scans (mock carrier)", "only for tracking numbers PayPal has on file for this payment"],
    ["store", "Your store and chat logs (sample data)", "packing notes, listing, buyer messages"],
  ];
  return (
    <section className="rounded-2xl border border-dashed border-line-strong bg-surface/60 p-5 sm:p-6">
      <h2 className="font-display text-[1.3rem] leading-none">What the agent will check</h2>
      <ul className="mt-4 flex flex-col gap-3">
        {sources.map(([p, title, note]) => (
          <li key={p} className="flex gap-3">
            <span className={`mt-1.5 size-2 shrink-0 rounded-full ${PROVENANCE_DOT[p as "paypal"]}`} aria-hidden="true" />
            <span className="text-sm">
              <span className="font-medium">{title}</span>
              <span className="block text-muted">{note}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted">Every claim it makes links to one of these sources. It never invents evidence, and it tells you when the buyer is right.</p>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i} className="h-36 animate-pulse rounded-2xl border border-line bg-surface" />
      ))}
    </div>
  );
}

const STRATEGY: Record<Assessment["recommendation"]["strategy"], { title: string; tone: string }> = {
  FIGHT: { title: "Defend with evidence", tone: "text-win" },
  OFFER: { title: "Make a fair offer", tone: "text-amber" },
  REFUND: { title: "Refund the buyer", tone: "text-ink" },
};

const ACTION: Record<string, { label: string; path: string }> = {
  provide_evidence: { label: "Provide evidence", path: "provide-evidence" },
  send_message: { label: "Message the buyer", path: "send-message" },
  make_offer: { label: "Make an offer", path: "make-offer" },
  accept_claim: { label: "Accept the claim and refund", path: "accept-claim" },
  escalate: { label: "Escalate to PayPal", path: "escalate" },
};

const LEVEL_TONE = { HIGH: "text-win border-win/40 bg-win-soft", MEDIUM: "text-amber border-amber/40 bg-amber-soft", LOW: "text-loss border-loss/40 bg-loss-soft" };

function Recommendation({ a, closed }: { a: Assessment; closed?: boolean }) {
  const rec = a.recommendation;
  const s = STRATEGY[rec.strategy];
  const act = rec.action ? ACTION[rec.action.kind] : null;
  return (
    <section aria-labelledby="rec-h" className="rise rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted">{closed ? "Hindsight review" : "Recommendation"}</p>
        <span className={`stamp ${LEVEL_TONE[a.strength.level]}`} title="Confidence from the evidence, with reasons below. Not a win probability.">
          Evidence {a.strength.level}
        </span>
        {rec.buyerFair && <span className="stamp text-amber">Buyer is right</span>}
      </div>
      <h2 id="rec-h" className={`mt-2 font-display text-[1.8rem] leading-none sm:text-[2.1rem] ${s.tone}`}>
        {s.title}
      </h2>
      <ul className="mt-3 flex flex-col gap-1 text-[0.92rem] leading-relaxed text-ink-2">
        {rec.why.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>

      {a.strength.reasons.length > 0 && (
        <>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-muted">Why, with sources</h3>
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {a.strength.reasons.map((r) => (
              <ReasonRow key={r.id} r={r} />
            ))}
          </ul>
        </>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-surface-2 p-3">
          <p className="text-[0.7rem] uppercase tracking-wider text-muted">Next PayPal action</p>
          {act ? (
            <>
              <p className="mt-1 text-sm font-semibold">
                {act.label}
                {rec.action?.amount && ` · ${money(Number(rec.action.amount.value), rec.action.amount.currency_code)}`}
              </p>
              <p className="mt-0.5 truncate font-mono text-[0.68rem] text-pp">POST /v1/customer/disputes/{"{id}"}/{act.path}</p>
              <p className="text-[0.68rem] text-muted">allowed by PayPal on this dispute right now</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-2">{closed ? "None: the case is closed." : "None allowed by PayPal right now."}</p>
          )}
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <p className="text-[0.7rem] uppercase tracking-wider text-muted">Cost to fight</p>
          <p className="mt-1 text-sm font-semibold">
            ~{money(a.costToFight, a.currency)} of your time <span className="font-normal text-muted">vs {money(a.amount, a.currency)} disputed</span>
          </p>
          <p className="text-[0.68rem] text-muted">30 min at $25/h (editable later)</p>
        </div>
      </div>
    </section>
  );
}

function ReasonRow({ r }: { r: Reason }) {
  const seller = r.supports === "seller";
  return (
    <li className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:gap-3">
      <span className="flex min-w-0 flex-1 items-start gap-2 text-sm">
        <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[0.7rem] font-bold ${seller ? "bg-win-soft text-win" : "bg-loss-soft text-loss"}`} aria-label={seller ? "Supports you" : "Supports the buyer"}>
          {seller ? "+" : "−"}
        </span>
        <span>
          {r.text}
          {r.decisive && <span className="ml-1.5 text-xs font-semibold text-amber">decisive</span>}
        </span>
      </span>
      <span className="flex flex-wrap gap-x-1 pl-7 sm:pl-0">
        {r.sourceRefs.map((ref) => (
          <SourceChip key={ref} sourceRef={ref} />
        ))}
      </span>
    </li>
  );
}

function Evidence({ items, packRefs }: { items: EvidenceItem[]; packRefs: string[] }) {
  const pack = new Set(packRefs);
  const sorted = [...items].sort((a, b) => (a.at ?? "9").localeCompare(b.at ?? "9"));
  return (
    <section aria-labelledby="ev-h" className="rise rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="ev-h" className="font-display text-[1.3rem] leading-none">
          Evidence timeline
        </h2>
        <p className="text-xs text-muted">
          {items.length} items · {pack.size} in the pack
        </p>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.7rem] text-muted">
        {(["paypal", "carrier", "store"] as const).map((p) => (
          <span key={p} className="inline-flex items-center gap-1.5">
            <span className={`size-1.5 rounded-full ${PROVENANCE_DOT[p]}`} aria-hidden="true" />
            {PROVENANCE_LABEL[p]}
          </span>
        ))}
      </div>
      <ol className="mt-3 flex flex-col gap-1.5">
        {sorted.map((e) => {
          const p = provenanceOf(e.kind);
          return (
            <li key={e.sourceRef} id={evidenceAnchor(e.sourceRef)} className="ev-item grid grid-cols-[0.5rem_1fr] gap-x-3 rounded-lg px-2 py-2">
              <span className={`mt-1.5 size-2 rounded-full ${PROVENANCE_DOT[p]}`} aria-hidden="true" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <p className="text-sm font-medium">{e.label}</p>
                  <span className="font-mono text-[0.68rem] text-muted">{utcStamp(e.at)}</span>
                </div>
                {e.text && <p className="text-[0.82rem] leading-snug text-ink-2">{e.text}</p>}
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[0.66rem] text-muted">
                  <span className="break-all">{e.sourceRef}</span>
                  <span className="font-sans">· {PROVENANCE_LABEL[p]}</span>
                  {pack.has(e.sourceRef) && <span className="rounded-sm bg-ink px-1 font-sans text-[0.6rem] font-semibold uppercase tracking-wide text-bg">in pack</span>}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
