"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * PayPal's sandbox-only lifecycle endpoints, shown only when PayPal offers them (HATEOAS) in Live
 * mode. Clearly labelled SANDBOX: in production PayPal makes this decision, not the seller.
 */
export function SandboxSim({ disputeId, canAdjudicate, canRequireEvidence }: { disputeId: string; canAdjudicate: boolean; canRequireEvidence: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; msg?: string; ok?: boolean }>({ busy: false });

  async function sim(kind: "adjudicate" | "require_evidence", outcome?: "SELLER_FAVOR" | "BUYER_FAVOR") {
    setState({ busy: true });
    const r = await fetch("/api/sandbox/simulate", { method: "POST", headers: { "content-type": "application/json", "x-dd-action": "1" }, body: JSON.stringify({ disputeId, kind, outcome }) });
    const j = (await r.json()) as { ok?: boolean; status?: number; debugId?: string | null; error?: string };
    setState({ busy: false, ok: Boolean(j.ok), msg: j.ok ? `PayPal accepted (${j.status}). The new status appears in about 2–3 minutes; refresh to see it.` : (j.error ?? "Failed") });
    if (j.ok) window.setTimeout(() => router.refresh(), 1500);
  }

  return (
    <section className="rounded-xl border border-dashed border-amber/60 bg-amber-soft/40 p-4 sm:p-5" aria-labelledby="sim-h">
      <div className="flex flex-wrap items-center gap-2">
        <span className="stamp text-amber">Sandbox</span>
        <h2 id="sim-h" className="font-display text-[1.15rem] leading-none">
          Simulate PayPal&apos;s decision
        </h2>
      </div>
      <p className="mt-1.5 text-xs text-ink-2">PayPal offers these test-only endpoints on this sandbox case right now. In production, PayPal decides.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {canAdjudicate && (
          <>
            <button type="button" disabled={state.busy} onClick={() => sim("adjudicate", "SELLER_FAVOR")} className="min-h-11 rounded-full border border-win/50 bg-surface px-4 text-sm font-semibold text-win disabled:opacity-50">
              Seller wins
            </button>
            <button type="button" disabled={state.busy} onClick={() => sim("adjudicate", "BUYER_FAVOR")} className="min-h-11 rounded-full border border-loss/50 bg-surface px-4 text-sm font-semibold text-loss disabled:opacity-50">
              Buyer wins
            </button>
          </>
        )}
        {canRequireEvidence && (
          <button type="button" disabled={state.busy} onClick={() => sim("require_evidence")} className="min-h-11 rounded-full border border-line-strong bg-surface px-4 text-sm font-semibold disabled:opacity-50">
            Ask seller for evidence
          </button>
        )}
      </div>
      {state.msg && <p className={`mt-2 text-xs ${state.ok ? "text-win" : "text-loss"}`}>{state.msg}</p>}
    </section>
  );
}
