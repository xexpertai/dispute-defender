"use client";

import { useEffect, useMemo, useState } from "react";
import type { RequestPreview } from "@/lib/agent/submission";
import { wordDiff } from "@/lib/diff";
import type { Draft } from "@/lib/llm/draft";
import { SourceChip } from "./SourceChip";

interface Props {
  onSubmitted?: (detail: string) => void;
  draft: Draft;
  draftId?: string;
  fallbackReason?: string;
  issues: number;
  mode: "live" | "replay";
  closed?: boolean;
}

type SubmitState = { phase: "idle" } | { phase: "sending" } | { phase: "done"; status: number; debugId: string | null; endpoint: string } | { phase: "error"; message: string; debugId?: string | null };

const ACTION_LABEL: Record<string, string> = {
  provide_evidence: "Approve · submit evidence",
  send_message: "Approve · send message",
  make_offer: "Approve · send offer",
  accept_claim: "Approve · refund buyer",
  escalate: "Approve · escalate",
};

export function DraftPanel({ onSubmitted, draft, draftId, fallbackReason, issues, mode, closed }: Props) {
  const ai = draft.origin === "ai";
  const [tab, setTab] = useState<"draft" | "paypal">("draft");
  const [note, setNote] = useState(draft.sellerNote);
  const [msg, setMsg] = useState(draft.buyerMessage?.text ?? "");
  const [reviewed, setReviewed] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [preview, setPreview] = useState<RequestPreview | null>(null);
  const [submit, setSubmit] = useState<SubmitState>({ phase: "idle" });
  const typed = useTyping(ai ? draft.sellerNote : "", ai);

  const edits = useMemo(() => ({ sellerNote: note !== draft.sellerNote ? note : undefined, buyerMessage: draft.buyerMessage && msg !== draft.buyerMessage.text ? msg : undefined }), [note, msg, draft]);
  const edited = Boolean(edits.sellerNote || edits.buyerMessage);
  const lang = draft.buyerLanguage;
  const langMismatch = lang && lang.code !== "en" && (!draft.buyerMessage || draft.buyerMessage.language === "en");
  const canSubmit = mode === "live" && !closed && Boolean(draft.action) && Boolean(draftId) && reviewed && submit.phase !== "sending" && submit.phase !== "done";

  useEffect(() => {
    if (tab !== "paypal" || !draftId) return;
    const ctrl = new AbortController();
    fetch(`/api/drafts/${draftId}/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ edits }), signal: ctrl.signal })
      .then((r) => r.json())
      .then((j: { preview: RequestPreview | null }) => setPreview(j.preview))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [tab, draftId, edits]);

  async function approve() {
    if (!draftId) return;
    setSubmit({ phase: "sending" });
    try {
      const r = await fetch(`/api/drafts/${draftId}/approve`, { method: "POST", headers: { "content-type": "application/json", "x-dd-action": "1" }, body: JSON.stringify({ reviewed, edits }) });
      const j = (await r.json()) as { ok: boolean; status?: number; debugId?: string | null; error?: string; preview?: RequestPreview };
      if (j.ok) {
        setSubmit({ phase: "done", status: j.status ?? r.status, debugId: j.debugId ?? null, endpoint: j.preview?.endpoint ?? "" });
        onSubmitted?.(`Approved by you and sent to PayPal (${j.status ?? r.status}${j.debugId ? `, debug_id ${j.debugId}` : ""})`);
      }
      else setSubmit({ phase: "error", message: j.error ?? "Submit failed", debugId: j.debugId });
    } catch {
      setSubmit({ phase: "error", message: "Network error. Nothing was confirmed by PayPal." });
    }
  }

  return (
    <section aria-labelledby="draft-h" className="rise rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5 sm:px-6">
        <h2 id="draft-h" className="font-display text-[1.3rem] leading-none">
          Response
        </h2>
        {ai ? (
          <span className="stamp stamp-tilt text-ai">{draft.recorded ? "AI-written · recorded" : "AI-written"}</span>
        ) : (
          <span className="stamp stamp-tilt text-ink-2" title="Written by deterministic rules, not by an AI model">
            Template
          </span>
        )}
      </div>
      <p className="px-5 pt-1 text-xs text-muted sm:px-6">
        {draft.recorded
          ? `Recorded from a real ${draft.recorded.model} run on ${draft.recorded.at.slice(0, 10)} and replayed here at $0. Every claim was re-checked against its source just now.`
          : ai
            ? `Drafted by ${draft.model ?? "Claude"}. Every claim was checked against its source on our server.`
            : "Written by the rules engine from your evidence. No AI was used for this text."}
      </p>
      {fallbackReason && <p className="mx-5 mt-3 rounded-lg border border-amber/40 bg-amber-soft p-2.5 text-xs text-amber sm:mx-6">{fallbackReason}. The TEMPLATE draft is shown instead.</p>}

      <div role="tablist" aria-label="Draft views" className="mt-4 flex gap-1 border-b border-line px-4 sm:px-5">
        {(
          [
            ["draft", "Draft"],
            ["paypal", "What PayPal receives"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`min-h-11 rounded-t-lg px-3 text-sm font-medium ${tab === k ? "border-b-2 border-primary text-ink" : "text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="px-5 pb-5 pt-4 sm:px-6">
        {tab === "draft" ? (
          <>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted" htmlFor="note">
              Note to PayPal <span className="font-normal normal-case tracking-normal">(you can edit)</span>
            </label>
            <textarea
              id="note"
              value={typed ?? note}
              readOnly={typed !== null}
              aria-busy={typed !== null}
              onChange={(e) => setNote(e.target.value)}
              maxLength={2000}
              disabled={submit.phase === "done" || closed}
              rows={Math.min(10, Math.max(4, note.split("\n").length + Math.ceil(note.length / 75)))}
              className="mt-1.5 w-full rounded-xl border border-line bg-surface-2 p-3 text-[0.9rem] leading-relaxed text-ink focus:border-line-strong"
            />
            <p className="text-right font-mono text-[0.66rem] text-muted">{note.length}/2000</p>

            {draft.claims.length > 0 && (
              <>
                <h3 className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted">Claims · each one cited</h3>
                <ul className="mt-1 flex flex-col divide-y divide-line">
                  {draft.claims.map((c, i) => (
                    <li key={i} className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:items-center sm:gap-3">
                      <span className="flex-1 text-sm">{c.text}</span>
                      <span className="flex flex-wrap gap-x-1">
                        {c.sourceRefs.map((ref) => (
                          <SourceChip key={ref} sourceRef={ref} />
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {draft.buyerMessage && (
              <>
                <label className="mt-4 block text-xs font-semibold uppercase tracking-wider text-muted" htmlFor="msg">
                  Message to the buyer{draft.buyerMessage.language !== "en" ? ` · ${lang?.name ?? draft.buyerMessage.language}` : ""}
                </label>
                <textarea
                  id="msg"
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                  maxLength={2000}
                  disabled={submit.phase === "done" || closed}
                  rows={3}
                  className="mt-1.5 w-full rounded-xl border-l-4 border-primary bg-surface-2 p-3 text-[0.9rem] leading-relaxed"
                />
                {draft.buyerMessage.englishGloss && (
                  <p className="mt-1 text-xs text-muted">
                    <span className="font-semibold">In English:</span> {draft.buyerMessage.englishGloss}
                  </p>
                )}
              </>
            )}
            {langMismatch && (
              <p className="mt-3 rounded-lg border border-amber/40 bg-amber-soft p-2.5 text-xs text-amber">
                The buyer wrote in {lang?.name}. This {ai ? "draft" : "TEMPLATE"} reply is in English. {ai ? "" : "The AI draft replies in the buyer's language with an English gloss for you."}
              </p>
            )}

            {edited && (
              <div className="mt-3 text-xs">
                <button type="button" onClick={() => setShowDiff((v) => !v)} className="min-h-11 font-semibold text-primary underline-offset-2 hover:underline">
                  {showDiff ? "Hide" : "Show"} your changes vs the {ai ? "AI" : "TEMPLATE"} version
                </button>
                {showDiff && (
                  <div className="mt-1 flex flex-col gap-2">
                    {edits.sellerNote && <Diff before={draft.sellerNote} after={note} />}
                    {edits.buyerMessage && draft.buyerMessage && <Diff before={draft.buyerMessage.text} after={msg} />}
                  </div>
                )}
              </div>
            )}

            <p className={`mt-3 flex items-center gap-2 text-sm ${issues ? "text-amber" : "text-win"}`}>
              <span aria-hidden="true">{issues ? "!" : "✓"}</span>
              {issues ? `${issues} validation ${issues === 1 ? "note" : "notes"}: unsupported content was removed.` : "Every claim cites a source we actually have."}
            </p>
          </>
        ) : (
          <PayPalPreview preview={preview} draftId={draftId} edited={edited} hasAction={Boolean(draft.action)} />
        )}

        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          {mode === "live" && !closed && draft.action && submit.phase !== "done" && (
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="size-5 accent-[var(--primary)]" />
              I have read this draft and the evidence, and I want it sent.
            </label>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted">
              {closed
                ? "This case is closed; nothing will be sent."
                : mode === "replay"
                  ? "Replay mode: nothing is ever sent to PayPal."
                  : !draft.action
                    ? "PayPal allows no matching action right now."
                    : "Sandbox only. An approval record is saved before anything is sent."}
            </p>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={approve}
              className="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-primary px-5 text-sm font-semibold text-on-primary transition enabled:hover:opacity-90 disabled:border disabled:border-line-strong disabled:bg-transparent disabled:text-muted"
            >
              {submit.phase === "sending" ? "Sending…" : submit.phase === "done" ? "Sent" : draft.action ? (ACTION_LABEL[draft.action.kind] ?? "Approve and send") : "Approve and send"}
            </button>
          </div>
          {submit.phase === "done" && (
            <p className="rounded-lg border border-win/40 bg-win-soft p-3 text-sm text-win" role="status">
              Sent to PayPal sandbox · {submit.status} · <span className="font-mono text-xs">{submit.endpoint}</span>
              {submit.debugId && <span className="block font-mono text-[0.7rem] opacity-80">debug_id {submit.debugId}</span>}
            </p>
          )}
          {submit.phase === "error" && (
            <p className="rounded-lg border border-loss/40 bg-loss-soft p-3 text-sm text-loss" role="alert">
              {submit.message}
              {submit.debugId && <span className="block font-mono text-[0.7rem] opacity-80">debug_id {submit.debugId}</span>}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/** Reveals AI text word by word (about 1.5 s) so the draft visibly "streams in". Skipped for reduced motion. */
function useTyping(text: string, enabled: boolean): string | null {
  const [shown, setShown] = useState<string | null>(() => (enabled && text ? "" : null));
  useEffect(() => {
    if (!enabled || !text) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const t = window.setTimeout(() => setShown(null), 0);
      return () => window.clearTimeout(t);
    }
    const words = text.split(/(\s+)/);
    const step = Math.max(1, Math.ceil(words.length / 45));
    let i = 0;
    const id = window.setInterval(() => {
      i += step;
      if (i >= words.length) {
        window.clearInterval(id);
        setShown(null);
      } else setShown(words.slice(0, i).join(""));
    }, 33);
    return () => window.clearInterval(id);
  }, [text, enabled]);
  return shown;
}

function Diff({ before, after }: { before: string; after: string }) {
  return (
    <p className="whitespace-pre-wrap rounded-lg border border-line bg-surface-2 p-2.5 leading-relaxed">
      {wordDiff(before, after).map((p, i) =>
        p.op === "same" ? (
          <span key={i}>{p.text}</span>
        ) : p.op === "del" ? (
          <del key={i} className="bg-loss-soft text-loss">
            {p.text}
          </del>
        ) : (
          <ins key={i} className="bg-win-soft text-win no-underline">
            {p.text}
          </ins>
        ),
      )}
    </p>
  );
}

function PayPalPreview({ preview, draftId, edited, hasAction }: { preview: RequestPreview | null; draftId?: string; edited: boolean; hasAction: boolean }) {
  if (!hasAction) return <p className="text-sm text-muted">There is no PayPal request to preview: PayPal allows no matching action on this dispute right now.</p>;
  if (!preview) return <div className="h-40 animate-pulse rounded-xl bg-surface-2" aria-label="Loading preview" />;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-2">This is the exact request that is sent when you approve. Nothing is added after your approval.</p>
      <p className="flex flex-wrap items-center gap-2 font-mono text-[0.75rem]">
        <span className="rounded-md bg-pp px-1.5 py-0.5 font-bold text-white">{preview.method}</span>
        <span className="break-all text-pp">{preview.endpoint}</span>
        <span className="text-muted">· {preview.encoding === "multipart" ? "multipart/form-data, part `input`" : "application/json"}</span>
      </p>
      <pre className="max-h-80 overflow-auto rounded-xl border border-line bg-surface-2 p-3 font-mono text-[0.72rem] leading-relaxed text-ink">{JSON.stringify(preview.input, null, 2)}</pre>
      {preview.files.length > 0 && (
        <div className="rounded-xl border border-line p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Attached files</p>
          {preview.files.map((f) => (
            <p key={f.filename} className="mt-1 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-mono text-[0.75rem]">
                {f.field}: {f.filename} · {f.type}
                {f.bytes ? ` · ${(f.bytes / 1024).toFixed(1)} KB` : ""}
              </span>
              {draftId && (
                <a href={`/api/drafts/${draftId}/pack`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-4 text-xs font-semibold hover:bg-surface-2">
                  Open PDF{edited ? " (original text)" : ""}
                </a>
              )}
            </p>
          ))}
          <p className="mt-1 text-[0.7rem] text-muted">PayPal limits: under 10 MB per file, 50 MB per request.</p>
        </div>
      )}
    </div>
  );
}
