"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TraceState } from "@/lib/agent/trace-state";
import { provenanceOf } from "@/lib/disputes/model";
import type { EvidenceItem } from "@/lib/evidence/types";
import { humanLabel } from "@/lib/format";
import { VERDICT_WORD, verdictOf, type VerdictKey } from "@/lib/strategy/verdict";
import { PROVENANCE_DOT, SourceChip } from "./SourceChip";
import { useEvidence } from "./EvidenceContext";

/**
 * The signature moment: "the case file closes". Evidence is filed as the agent finds it; after
 * validation, each claim is connected by a line to the records it cites (claims the validator
 * removed are struck through); then the verdict stamp lands. Reduced motion: no animation.
 */
const VERDICT_TONE: Record<VerdictKey, string> = { FIGHT: "text-win", OFFER: "text-amber", REFUND: "text-loss", HOLD: "text-ink-2", WAIT: "text-amber" };

const MAX_FILED = 10;

export function CaseFile({ state, disputeId, closed, stampRef }: { state: TraceState; disputeId: string; closed?: boolean; stampRef?: React.Ref<HTMLDivElement> }) {
  const { byRef } = useEvidence();
  const draft = state.draft;
  const a = state.assessment;
  const approvalStep = state.steps[8];
  const verdictReady = Boolean(a) && approvalStep && approvalStep.status !== "pending" && approvalStep.status !== "running";
  const dropped = state.issues.filter((i) => i.code === "unknown_source" || i.code === "uncited_claim" || i.code === "policy_claim");

  const cited = useMemo(() => {
    const refs: string[] = [];
    for (const c of draft?.claims ?? []) for (const r of c.sourceRefs) if (!refs.includes(r)) refs.push(r);
    return refs;
  }, [draft]);

  const box = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ d: string; key: string; delay: number }[]>([]);

  useEffect(() => {
    const el = box.current;
    if (!el || !draft) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      // Rects are in zoomed (visual) px when the page uses CSS zoom; the SVG draws in local px.
      const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      if (base.width / z < 700) return setPaths([]);
      const out: { d: string; key: string; delay: number }[] = [];
      draft.claims.forEach((c, i) => {
        const from = el.querySelector<HTMLElement>(`[data-claim="${i}"]`)?.getBoundingClientRect();
        if (!from) return;
        c.sourceRefs.forEach((r, j) => {
          const to = el.querySelector<HTMLElement>(`[data-card="${CSS.escape(r)}"]`)?.getBoundingClientRect();
          if (!to) return;
          const x1 = (from.right - base.left) / z + 6;
          const y1 = (from.top - base.top) / z + Math.min(from.height / z / 2, 18);
          const x2 = (to.left - base.left) / z - 6;
          const y2 = (to.top - base.top + to.height / 2) / z;
          const k = Math.max(30, (x2 - x1) / 2);
          out.push({ d: `M${x1},${y1} C${x1 + k},${y1} ${x2 - k},${y2} ${x2},${y2}`, key: `${i}-${j}`, delay: 0.25 + i * 0.35 + j * 0.12 });
        });
      });
      setPaths(out);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [draft]);

  const filed = state.evidence;
  const phase = draft ? "claims" : filed.length ? "filing" : state.phase === "idle" ? "idle" : "waiting";

  return (
    <section aria-labelledby="casefile-h" className="case-wrap">
      <div ref={box} className="case relative min-h-[22rem] p-4 sm:p-5">
        <span className="case-tab">Case file · {disputeId}</span>
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div>
            <h2 id="casefile-h" className="font-display text-[1.15rem]">
              {phase === "claims" ? "Claims, each tied to its record" : "Evidence on file"}
            </h2>
            <p className="text-xs text-muted" aria-live="polite">
              {filed.length ? `${filed.length} records filed${a ? ` · ${a.strength.level === "HIGH" ? "strong" : a.strength.level === "MEDIUM" ? "mixed" : "weak"} evidence` : ""}` : phase === "idle" ? "Start the agent to open the file" : "Opening the file…"}
            </p>
            {verdictReady && a && (
              <p className="mt-1 text-sm text-ink-2">
                {closed
                  ? "Hindsight review: this case is closed."
                  : a.recommendation.unprovable
                    ? "You can't prove delivery: no tracking on record."
                    : a.recommendation.buyerFair
                    ? "The buyer is right."
                    : a.recommendation.wait === "awaiting_delivery"
                      ? "On hold: no delivery scan yet, so nothing is sent."
                      : a.recommendation.wait === "no_allowed_action"
                        ? "On hold: PayPal allows no matching response yet."
                        : "Verdict from the rules, with every claim tied to a record."}
              </p>
            )}
          </div>
          {verdictReady && a && (
            <div ref={stampRef} className="shrink-0 py-2 pr-2">
              <span className={`stamp stamp-xl stamp-land ${VERDICT_TONE[verdictOf(a.recommendation)]}`} role="status" aria-label={`Verdict: ${VERDICT_WORD[verdictOf(a.recommendation)]}`}>
                {VERDICT_WORD[verdictOf(a.recommendation)]}
              </span>
            </div>
          )}
        </div>

        {phase === "idle" && (
          <p className="mt-6 max-w-md text-sm text-ink-2">
            The agent files every record it finds here: PayPal data, carrier scans and your store records. Then it ties each claim to its record, and stamps a verdict.
          </p>
        )}

        {phase === "waiting" && (
          <p className="mt-6 flex items-center gap-2 text-sm text-ink-2">
            <span className="spin inline-block size-4 rounded-full border-2 border-line-strong border-t-ink" aria-hidden="true" /> Reading the dispute from PayPal…
          </p>
        )}

        {phase === "filing" && (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {filed.slice(0, MAX_FILED).map((e, i) => (
              <EvidenceCard key={e.sourceRef} e={e} delay={i * 0.05} />
            ))}
            {filed.length > MAX_FILED && <li className="self-center text-xs text-muted">+{filed.length - MAX_FILED} more records</li>}
          </ul>
        )}

        {phase === "claims" && draft && (
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_5.5rem_1fr] lg:gap-0">
            <ol className="flex flex-col gap-3">
              {draft.claims.map((c, i) => (
                <li key={i} data-claim={i} className="drop-in rounded-lg border border-win/35 bg-win-soft/40 p-2.5 text-sm" style={{ animationDelay: `${0.15 + i * 0.35}s` }}>
                  <span className="mr-1.5 font-bold text-win" aria-hidden="true">
                    ✓
                  </span>
                  {c.text}
                  <span className="mt-1 flex flex-wrap gap-x-1 lg:hidden">
                    {c.sourceRefs.map((r) => (
                      <SourceChip key={r} sourceRef={r} />
                    ))}
                  </span>
                </li>
              ))}
              {dropped.map((d, i) => (
                <li key={`x${i}`} className="drop-in rounded-lg border border-loss/35 bg-loss-soft/40 p-2.5 text-sm text-loss" style={{ animationDelay: `${0.15 + (draft.claims.length + i) * 0.35}s` }}>
                  <span className="line-through decoration-2">{d.message.replace(/^[^"]*"?|"$/g, "") || d.message}</span>
                  <span className="mt-0.5 block text-xs no-underline">Removed by our server: {d.code === "policy_claim" ? "states an outcome only PayPal can decide" : "no matching record"}</span>
                </li>
              ))}
              {draft.claims.length === 0 && dropped.length === 0 && <li className="text-sm text-muted">No factual claims in this response.</li>}
              {verdictReady && state.draftId && <CheckerTest draftId={state.draftId} />}
            </ol>
            <div aria-hidden="true" className="hidden lg:block" />
            <ul className="hidden flex-col gap-2 lg:flex">
              {cited.map((r, i) => (
                <EvidenceCard key={r} e={byRef.get(r)} refId={r} delay={0.1 + i * 0.08} cited />
              ))}
              {filed.length > cited.length && <li className="text-xs text-muted">+{filed.length - cited.length} other records on file (see the timeline)</li>}
            </ul>
            <svg className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block" aria-hidden="true">
              {paths.map((p) => (
                <path key={p.key} d={p.d} className="connector" stroke="var(--win)" style={{ animationDelay: `${p.delay}s` }} />
              ))}
            </svg>
          </div>
        )}

      </div>
    </section>
  );
}

function EvidenceCard({ e, refId, delay = 0, cited }: { e?: EvidenceItem; refId?: string; delay?: number; cited?: boolean }) {
  const ref = e?.sourceRef ?? refId ?? "";
  const p = provenanceOf(e?.kind ?? "dispute");
  return (
    <li data-card={ref} className={`drop-in flex items-start gap-2 rounded-lg border bg-surface p-2.5 text-sm shadow-sm ${cited ? "border-line-strong" : "border-line"}`} style={{ animationDelay: `${delay}s` }}>
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${PROVENANCE_DOT[p]}`} aria-hidden="true" />
      <span className="min-w-0">
        <span className="block font-medium leading-snug">{humanLabel(e, ref)}</span>
        {e?.text && <span className="line-clamp-2 block text-xs text-muted">{e.text}</span>}
      </span>
    </li>
  );
}

/**
 * "Test our checker": the server injects two claims an AI might make up into this draft and runs the
 * same validation every real draft goes through. Read-only; the test claims are labelled as such.
 */
function CheckerTest({ draftId }: { draftId: string }) {
  const [res, setRes] = useState<{ claim: string; caught: boolean; reason: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const r = await fetch(`/api/drafts/${draftId}/check`, { method: "POST" });
      if (r.ok) setRes(((await r.json()) as { results: { claim: string; caught: boolean; reason: string }[] }).results);
    } finally {
      setBusy(false);
    }
  }
  if (!res)
    return (
      <li className="list-none">
        <button type="button" onClick={run} disabled={busy} className="inline-flex min-h-11 items-center rounded-full border border-dashed border-line-strong px-4 text-xs font-semibold text-ink-2 hover:bg-surface-2 disabled:opacity-60">
          {busy ? "Checking…" : "Test our checker: add two made-up claims"}
        </button>
      </li>
    );
  return (
    <>
      {res.map((t, i) => (
        <li key={i} data-checker-test className="drop-in rounded-lg border border-loss/35 bg-loss-soft/40 p-2.5 text-sm text-loss" style={{ animationDelay: `${i * 0.25}s` }}>
          <span className="mr-1.5 rounded bg-loss/10 px-1 text-[0.68rem] font-semibold uppercase tracking-wide no-underline">Test claim</span>
          <span className={t.caught ? "line-through decoration-2" : ""}>{t.claim}</span>
          <span className="mt-0.5 block text-xs">{t.caught ? `Removed by our server: ${t.reason}` : "Not caught"}</span>
        </li>
      ))}
    </>
  );
}
