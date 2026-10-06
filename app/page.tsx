import Link from "next/link";
import { currentMode, gatewayFor } from "@/lib/agent/deps";
import { summarize, type GuardianRow } from "@/lib/dashboard/guardian";
import { money } from "@/lib/format";
import { ClockChip } from "./_components/ClockChip";
import { DemoBanner } from "./_components/DemoBanner";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  send_message: "Message buyer",
  make_offer: "Make offer",
  escalate: "Escalate",
  provide_evidence: "Provide evidence",
  accept_claim: "Accept claim",
  acknowledge_return_item: "Acknowledge return",
  provide_supporting_info: "Supporting info",
  appeal: "Appeal",
};

const OUTCOME_REASON: Record<string, string> = {
  INELIGIBLE_BUYER_PROTECTION_POLICY: "Buyer not covered by PayPal Purchase Protection",
  INELIGIBLE_SELLER_PROTECTION_POLICY: "Not covered by PayPal Seller Protection",
};

export default async function Dashboard() {
  const mode = currentMode();
  const gateway = gatewayFor(mode);
  const disputes = await gateway.listDisputes();
  const s = summarize(disputes, gateway.now());
  const top = s.open[0];
  const maxPriority = Math.max(...s.open.map((r) => r.priority), 1);
  const nothingDue = s.yourMove === 0;

  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      {mode === "replay" && <DemoBanner />}
      {/* ---------------------------------------------------------------- hero */}
      <section className="grid gap-4 lg:grid-cols-12 lg:gap-6" aria-labelledby="at-risk">
        <div className="rise relative overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7 lg:col-span-7">
          <p className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted">Deadline guardian</p>
          <h1 id="at-risk" className="mt-2 flex flex-wrap items-baseline gap-x-3 font-display leading-[0.95] text-ink">
            <span className="text-[3rem] tabular-nums sm:text-[4rem]">{money(s.atRisk, s.currency)}</span>
            <em className="text-[1.35rem] font-semibold tracking-normal text-loss sm:text-[1.6rem]">at risk</em>
          </h1>
          <p className="mt-3 max-w-prose text-[0.95rem] leading-relaxed text-ink-2">
            Across {s.openCount} open {s.openCount === 1 ? "dispute" : "disputes"}.{" "}
            {nothingDue ? "Nothing is waiting on you right now: the buyer or PayPal has the next move." : `${s.yourMove} ${s.yourMove === 1 ? "needs" : "need"} your response.`}
          </p>
          {top && (
            <Link
              href={`/disputes/${top.id}?run=1`}
              className="group mt-5 flex min-h-14 w-full items-center justify-between gap-3 rounded-xl bg-primary px-5 py-3 text-on-primary transition hover:translate-y-[-1px] sm:w-auto sm:min-w-[22rem]"
            >
              <span className="flex flex-col text-left">
                <span className="text-[1.02rem] font-semibold">Watch the agent defend a dispute</span>
                <span className="text-xs opacity-70">
                  {top.reasonLabel} · {money(top.amount, top.currency)} · 9 steps, live trace
                </span>
              </span>
              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-on-primary/15 text-lg text-on-primary transition group-hover:translate-x-0.5">
                →
              </span>
            </Link>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-3 lg:col-span-5 lg:gap-4">
          <Stat label="Your move" value={String(s.yourMove)} note={nothingDue ? "nothing due from you" : "waiting on you"} tone={nothingDue ? "muted" : "signal"} />
          <Stat label="Due < 48 h" value={String(s.dueSoon)} note="your deadlines" tone={s.dueSoon ? "signal" : "muted"} />
          <Stat label="Won" value={money(s.won.amount, s.currency)} note={`${s.won.count} ${s.won.count === 1 ? "case" : "cases"} kept`} tone="win" />
          <Stat label="Lost" value={money(s.lost.amount, s.currency)} note={`${s.lost.count} refunded by PayPal`} tone="loss" />
        </dl>
      </section>

      {/* ---------------------------------------------------------------- open */}
      <section aria-labelledby="open-h">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <h2 id="open-h" className="font-display text-[1.5rem] leading-none">
            Open disputes
          </h2>
          <p className="text-xs text-muted">Ranked by priority = $ at risk × urgency (your deadlines count most)</p>
        </div>
        {s.open.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong p-6 text-sm text-muted">No open disputes. Nice.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {s.open.map((r, i) => (
              <OpenRow key={r.id} row={r} rank={i + 1} share={r.priority / maxPriority} frozen={mode === "replay"} />
            ))}
          </ol>
        )}
      </section>

      {/* ---------------------------------------------------------------- prevention */}
      <Link href="/insights" className="group flex min-h-16 items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card hover:border-line-strong sm:p-5">
        <span>
          <span className="block font-semibold">Prevent the next dispute</span>
          <span className="block text-sm text-ink-2">Patterns across all {disputes.length} of your disputes, each with the cases it comes from, plus what to change.</span>
        </span>
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary transition group-hover:translate-x-0.5">
          →
        </span>
      </Link>

      {/* ---------------------------------------------------------------- closed */}
      {s.closed.length > 0 && (
        <section aria-labelledby="closed-h">
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 id="closed-h" className="font-display text-[1.5rem] leading-none">
              Outcomes
            </h2>
            <Link href="/outcomes" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink">
              Kept vs refunded <span aria-hidden="true">→</span>
            </Link>
          </div>
          <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
            {s.closed.map((r, i) => {
              const d = disputes.find((x) => x.dispute_id === r.id);
              const reason = d?.dispute_outcome?.outcome_reason;
              return (
                <li key={r.id} className={i ? "border-t border-line" : ""}>
                  <Link href={`/disputes/${r.id}`} className="grid min-h-16 grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2 sm:flex sm:gap-x-4 sm:px-5">
                    <span className={`stamp stamp-tilt ${r.outcome === "won" ? "text-win" : r.outcome === "lost" ? "text-loss" : "text-ink-2"}`}>{r.outcome}</span>
                    <span className="font-display text-2xl tabular-nums">{money(r.outcome === "lost" ? (r.refunded ?? r.amount) : r.amount, r.currency)}</span>
                    <span className="col-span-3 min-w-0 text-sm text-ink-2 sm:flex-1">
                      {r.reasonLabel}
                      {reason && <span className="block text-xs text-muted">{OUTCOME_REASON[reason] ?? reason}</span>}
                    </span>
                    <span className="col-start-3 row-start-1 justify-self-end font-mono text-[0.68rem] text-muted sm:text-xs">{r.id}</span>
                    <span aria-hidden="true" className="hidden text-muted sm:inline">
                      →
                    </span>
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

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone: "muted" | "signal" | "win" | "loss" }) {
  const color = { muted: "text-ink", signal: "text-amber", win: "text-win", loss: "text-loss" }[tone];
  return (
    <div className="rise flex flex-col justify-between rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <dt className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted">{label}</dt>
      <dd className="mt-2">
        <span className={`block font-display text-[1.8rem] leading-none tabular-nums sm:text-[2.1rem] ${color}`}>{value}</span>
        <span className="mt-1.5 block text-xs text-muted">{note}</span>
      </dd>
    </div>
  );
}

function OpenRow({ row: r, rank, share, frozen }: { row: GuardianRow; rank: number; share: number; frozen: boolean }) {
  return (
    <li className="rise rounded-2xl border border-line bg-surface shadow-card">
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 p-4 sm:p-5 md:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-center">
        <span className="grid size-9 place-items-center rounded-full border border-line-strong font-mono text-sm font-semibold text-ink-2" aria-label={`Priority ${rank}`}>
          {rank}
        </span>

        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-display text-[1.6rem] leading-none tabular-nums">{money(r.amount, r.currency)}</span>
            <span className="text-[0.95rem] font-medium">{r.reasonLabel}</span>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted">
            {r.id} · {r.stage}
          </p>
        </div>

        <div className="col-span-2 flex min-w-0 flex-col gap-2 md:col-span-1">
          <ClockChip clock={r.clock} hoursLeft={r.hoursLeft} bucket={r.bucket} frozen={frozen} />
          <div className="flex items-center gap-2" title={`Priority score ${r.priority}`}>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(6, Math.round(share * 100))}%` }} />
            </span>
            <span className="font-mono text-[0.7rem] tabular-nums text-muted">P {r.priority.toFixed(2)}</span>
          </div>
        </div>

        <div className="col-span-2 flex flex-col gap-3 md:col-span-1 md:flex-row md:items-center md:justify-end">
          <span className="flex flex-wrap gap-1 md:hidden">
            {r.actions.slice(0, 3).map((a) => (
              <span key={a} className="rounded-md border border-line px-1.5 py-0.5 text-[0.7rem] text-ink-2">
                {ACTION_LABEL[a] ?? a}
              </span>
            ))}
          </span>
          <Link
            href={`/disputes/${r.id}?run=1`}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-on-primary hover:opacity-90"
          >
            Defend <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
      <div className="hidden flex-wrap items-center gap-1.5 border-t border-line px-5 py-2.5 md:flex">
        <span className="text-[0.7rem] uppercase tracking-wider text-muted">PayPal allows now</span>
        {r.actions.map((a) => (
          <span key={a} className="rounded-md border border-line px-1.5 py-0.5 text-[0.72rem] text-ink-2">
            {ACTION_LABEL[a] ?? a}
          </span>
        ))}
      </div>
    </li>
  );
}
