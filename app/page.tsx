import Link from "next/link";
import { currentMode, gatewayFor } from "@/lib/agent/deps";
import { MockCarrier } from "@/lib/carrier/mock";
import { formatCountdown, summarize, type GuardianRow } from "@/lib/dashboard/guardian";
import { pickShowcase, rulesStrategies } from "@/lib/dashboard/showcase";
import { money } from "@/lib/format";
import { fixtures } from "@/lib/replay/fixtures";
import { SampleStore } from "@/lib/samples/store";
import { ClockChip } from "./_components/ClockChip";
import { DemoBanner } from "./_components/DemoBanner";

export const dynamic = "force-dynamic";

const OUTCOME_REASON: Record<string, string> = {
  INELIGIBLE_BUYER_PROTECTION_POLICY: "Buyer not covered by PayPal Purchase Protection",
  INELIGIBLE_SELLER_PROTECTION_POLICY: "Not covered by PayPal Seller Protection",
};

export default async function Dashboard() {
  const mode = currentMode();
  const gateway = gatewayFor(mode);
  const disputes = await gateway.listDisputes();
  const s = summarize(disputes, gateway.now());
  const f = fixtures();
  const strategies = await rulesStrategies(
    s.open.map((r) => r.id),
    { gateway, carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store) },
  );
  const { lead, settle } = pickShowcase(s.open, strategies);
  const maxPriority = Math.max(...s.open.map((r) => r.priority), 1);
  const yours = s.open.filter((r) => r.clock.owner === "seller" && r.hoursLeft !== null).sort((a, b) => (a.hoursLeft ?? 0) - (b.hoursLeft ?? 0))[0];

  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      {mode === "replay" && <DemoBanner />}

      {/* ------------------------------------------------------------ docket */}
      <section aria-labelledby="at-risk" className="rise case p-5 sm:p-7">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <h1 id="at-risk" className="flex flex-wrap items-baseline gap-x-3 font-display leading-[0.95]">
              <span className="text-[3rem] sm:text-[4.2rem]">{money(s.atRisk, s.currency)}</span>
              <span className="font-sans text-[1.15rem] font-semibold tracking-normal text-loss sm:text-[1.35rem]">at risk</span>
            </h1>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:flex sm:flex-wrap sm:gap-x-8">
              <Fact label="Open cases" value={String(s.openCount)} />
              <Fact label="Your move" value={s.yourMove ? `${s.yourMove} ${s.yourMove === 1 ? "case" : "cases"}` : "none"} tone={s.yourMove ? "amber" : undefined} />
              <Fact label="Next deadline (yours)" value={yours ? formatCountdown(yours.hoursLeft) : "nothing due"} tone={yours && (yours.bucket === "due_48h" || yours.bucket === "overdue") ? "amber" : undefined} />
              <Fact label="Kept / refunded" value={`${money(s.won.amount, s.currency)} / ${money(s.lost.amount, s.currency)}`} />
            </dl>
          </div>
          {lead && (
            <div className="flex flex-col gap-2">
              <Link
                href={`/disputes/${lead.id}?run=1`}
                className="group flex min-h-16 items-center justify-between gap-3 rounded-xl bg-primary px-5 py-3 text-on-primary transition hover:translate-y-[-1px]"
              >
                <span className="flex flex-col text-left">
                  <span className="text-[1.05rem] font-semibold">Watch the agent work a case</span>
                  <span className="text-xs opacity-80">
                    {lead.reasonLabel} · {money(lead.amount, lead.currency)} · {mode === "replay" ? "replayed" : "live"}, step by step
                  </span>
                </span>
                <span aria-hidden="true" className="text-2xl transition group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
              {settle && (
                <Link href={`/disputes/${settle.id}?run=1`} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                  …and one where refunding is the smart call ({money(settle.amount, settle.currency)}) <span aria-hidden="true">→</span>
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------ case board */}
      <section aria-labelledby="open-h">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <h2 id="open-h" className="font-display text-[1.5rem] leading-none">
            Open cases
          </h2>
          <p className="text-xs text-muted">Most urgent first: money at risk × deadline (yours count most)</p>
        </div>
        {s.open.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong p-6 text-sm text-muted">No open disputes right now.</p>
        ) : (
          <ol className="grid gap-x-5 gap-y-10 md:grid-cols-2">
            {s.open.map((r, i) => (
              <CaseCard key={r.id} row={r} rank={i + 1} share={r.priority / maxPriority} frozen={mode === "replay"} />
            ))}
          </ol>
        )}
      </section>

      <Link href="/insights" className="group case flex min-h-16 items-center justify-between gap-4 p-4 hover:border-line-strong sm:p-5">
        <span>
          <span className="block font-semibold">Prevent the next dispute</span>
          <span className="block text-sm text-ink-2">Patterns across all {disputes.length} of your cases, each with the cases it comes from, plus what to change.</span>
        </span>
        <span aria-hidden="true" className="text-xl text-ink transition group-hover:translate-x-0.5">
          →
        </span>
      </Link>

      {s.closed.length > 0 && (
        <section aria-labelledby="closed-h">
          <div className="mb-8 flex items-end justify-between gap-3">
            <h2 id="closed-h" className="font-display text-[1.5rem] leading-none">
              Closed cases
            </h2>
            <Link href="/outcomes" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink">
              Kept vs refunded <span aria-hidden="true">→</span>
            </Link>
          </div>
          <ul className="grid gap-x-5 gap-y-10 md:grid-cols-2">
            {s.closed.map((r) => {
              const d = disputes.find((x) => x.dispute_id === r.id);
              const reason = d?.dispute_outcome?.outcome_reason;
              return (
                <li key={r.id} className="case-wrap">
                  <Link href={`/disputes/${r.id}`} className="case flex min-h-24 items-center gap-4 p-4 hover:border-line-strong sm:p-5">
                    <span className="case-tab">{r.id}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-[1.6rem] leading-none">{money(r.outcome === "lost" ? (r.refunded ?? r.amount) : r.amount, r.currency)}</span>
                      <span className="mt-1 block text-sm text-ink-2">{r.reasonLabel}</span>
                      {reason && <span className="block text-xs text-muted">{OUTCOME_REASON[reason] ?? reason}</span>}
                    </span>
                    <span className={`stamp stamp-tilt text-[1rem] ${r.outcome === "won" ? "text-win" : r.outcome === "lost" ? "text-loss" : "text-ink-2"}`}>{r.outcome}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: "amber" }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`font-semibold tabular-nums ${tone === "amber" ? "text-amber" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

function CaseCard({ row: r, rank, share, frozen }: { row: GuardianRow; rank: number; share: number; frozen: boolean }) {
  return (
    <li className="case-wrap rise">
      <div className="case flex h-full flex-col gap-3 p-4 sm:p-5">
        <span className="case-tab">
          {r.id} <span className="opacity-70">· #{rank}</span>
        </span>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="font-display text-[2rem] leading-none">{money(r.amount, r.currency)}</span>
          <span className="text-sm text-muted">{r.stage}</span>
        </div>
        <p className="text-[0.95rem] font-medium">{r.reasonLabel}</p>
        <div className="flex flex-wrap items-center gap-2">
          <ClockChip clock={r.clock} hoursLeft={r.hoursLeft} bucket={r.bucket} frozen={frozen} />
        </div>
        <span className="h-1 overflow-hidden rounded-full bg-surface-2" title={`Priority score ${r.priority}`} aria-hidden="true">
          <span className="block h-full rounded-full bg-ink/70" style={{ width: `${Math.max(6, Math.round(share * 100))}%` }} />
        </span>
        <Link href={`/disputes/${r.id}?run=1`} className="mt-auto inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-full border border-ink/25 px-4 text-sm font-semibold text-ink hover:bg-surface-2">
          Open case <span aria-hidden="true">→</span>
        </Link>
      </div>
    </li>
  );
}
