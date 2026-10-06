import Link from "next/link";
import { currentMode, gatewayFor } from "@/lib/agent/deps";
import { summarize } from "@/lib/dashboard/guardian";
import { money, utcStamp } from "@/lib/format";
import { submissionsForDispute } from "@/lib/store/drafts";
import { sharedDb } from "@/lib/store/shared";

export const dynamic = "force-dynamic";

const OUTCOME_REASON: Record<string, string> = {
  INELIGIBLE_BUYER_PROTECTION_POLICY: "Buyer not covered by PayPal Purchase Protection",
  INELIGIBLE_SELLER_PROTECTION_POLICY: "Not covered by PayPal Seller Protection",
};

export default async function Outcomes() {
  const gateway = gatewayFor(currentMode());
  const disputes = await gateway.listDisputes();
  const s = summarize(disputes, gateway.now());
  const total = s.won.amount + s.lost.amount || 1;
  const db = sharedDb();

  return (
    <div className="flex flex-col gap-6">
      <Link href="/" className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-ink-2 hover:text-ink">
        <span aria-hidden="true">←</span> All disputes
      </Link>
      <section className="rise rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
        <p className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted">Outcomes</p>
        <h1 className="mt-2 font-display text-[2.1rem] leading-none sm:text-[2.6rem]">
          {money(s.won.amount, s.currency)} <em className="text-win">kept</em> · {money(s.lost.amount, s.currency)} <em className="text-loss">refunded</em>
        </h1>
        <p className="mt-2 text-sm text-ink-2">
          {s.closed.length} closed {s.closed.length === 1 ? "case" : "cases"}: {s.won.count} won, {s.lost.count} lost. {s.openCount} still open ({money(s.atRisk, s.currency)} at risk).
        </p>
        <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`Kept ${money(s.won.amount)} versus refunded ${money(s.lost.amount)}`}>
          <span className="h-full bg-win" style={{ width: `${(s.won.amount / total) * 100}%` }} />
          <span className="h-full bg-loss" style={{ width: `${(s.lost.amount / total) * 100}%` }} />
        </div>
        <p className="mt-2 text-[0.7rem] text-muted">Real PayPal sandbox outcomes. A count, not a prediction: we never show a win probability.</p>
      </section>

      <ul className="flex flex-col gap-3">
        {s.closed.map((r) => {
          const d = disputes.find((x) => x.dispute_id === r.id);
          const subs = submissionsForDispute(db, r.id);
          const reason = d?.dispute_outcome?.outcome_reason;
          return (
            <li key={r.id} className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`stamp stamp-tilt ${r.outcome === "won" ? "text-win" : r.outcome === "lost" ? "text-loss" : "text-ink-2"}`}>{r.outcome}</span>
                <span className="font-display text-[1.5rem] leading-none tabular-nums">{money(r.outcome === "lost" ? (r.refunded ?? r.amount) : r.amount, r.currency)}</span>
                <span className="text-sm font-medium">{r.reasonLabel}</span>
                <span className="ml-auto font-mono text-xs text-muted">{r.id}</span>
              </div>
              <p className="mt-2 text-sm text-ink-2">
                {reason ? (OUTCOME_REASON[reason] ?? reason) : "Resolved"} · {d?.dispute_outcome?.outcome_code} · resolved by {utcStamp(d?.update_time)}
              </p>
              {subs.length > 0 && <p className="mt-1 text-xs text-muted">{subs.length} response(s) sent through Dispute Defender.</p>}
              <Link href={`/disputes/${r.id}?run=1`} className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                Hindsight review: what would the agent do? <span aria-hidden="true">→</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
