"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ApiProof } from "@/lib/paypal/proof";
import { ApiResponsePanel } from "./ApiResponsePanel";

/**
 * PayPal's sandbox-only lifecycle endpoints, shown only when PayPal offers them (HATEOAS) in Live
 * mode. Clearly labelled SANDBOX: in production PayPal makes this decision, not the seller.
 */
export function SandboxSim({ disputeId, canAdjudicate, canRequireEvidence }: { disputeId: string; canAdjudicate: boolean; canRequireEvidence: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; msg?: string; ok?: boolean; sent?: ApiProof }>({ busy: false });
  const [decision, setDecision] = useState<ApiProof | null>(null);

  // After a decision is requested, poll PayPal (every 15 s, up to ~5 min) until the case is resolved.
  useEffect(() => {
    if (!state.sent) return;
    let tries = 0;
    const id = window.setInterval(async () => {
      tries += 1;
      const r = await fetch(`/api/disputes/${disputeId}/proof`).catch(() => null);
      if (r?.ok) {
        const p = (await r.json()) as ApiProof;
        if (p.status === "RESOLVED" || tries >= 20) {
          setDecision(p);
          window.clearInterval(id);
          router.refresh();
        }
      }
    }, 15_000);
    return () => window.clearInterval(id);
  }, [state.sent, disputeId, router]);

  async function sim(kind: "adjudicate" | "require_evidence", outcome?: "SELLER_FAVOR" | "BUYER_FAVOR") {
    setState({ busy: true });
    const r = await fetch("/api/sandbox/simulate", { method: "POST", headers: { "content-type": "application/json", "x-dd-action": "1" }, body: JSON.stringify({ disputeId, kind, outcome }) });
    const j = (await r.json()) as { ok?: boolean; status?: number; debugId?: string | null; error?: string };
    const sent: ApiProof | undefined = j.ok
      ? { source: "live", method: "POST", endpoint: `/v1/customer/disputes/${disputeId}/${kind === "adjudicate" ? "adjudicate" : "require-evidence"}`, httpStatus: j.status ?? 200, disputeId, debugId: j.debugId ?? null, fetchedAt: new Date().toISOString() }
      : undefined;
    setState({ busy: false, ok: Boolean(j.ok), sent, msg: j.ok ? "PayPal accepted the request. Its decision usually appears within 2–3 minutes; checking every 15 s." : (j.error ?? "Failed") });
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
      {state.sent && (
        <div className="mt-3 flex flex-col gap-2">
          <ApiResponsePanel proof={state.sent} />
          {decision && <ApiResponsePanel title="PayPal API response · decision" proof={decision} />}
        </div>
      )}
    </section>
  );
}
