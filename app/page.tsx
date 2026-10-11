import Link from "next/link";
import { currentMode, gatewayFor } from "@/lib/agent/deps";
import { MockCarrier } from "@/lib/carrier/mock";
import { formatCountdown, summarize, type GuardianRow } from "@/lib/dashboard/guardian";
import { portfolioCalls, type CallGroup } from "@/lib/dashboard/calls";
import { pickShowcase, rulesStrategies } from "@/lib/dashboard/showcase";
import { money } from "@/lib/format";
import { reasonLabel, SANDBOX_DECISION_LABEL, sandboxDecided } from "@/lib/disputes/model";
import { toRow } from "@/lib/dashboard/guardian";
import { fixtures } from "@/lib/replay/fixtures";
import { SampleStore } from "@/lib/samples/store";
import { DEFAULT_CONFIG } from "@/lib/strategy/rules";
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
  // Rules-only call on every case (open and closed): the showcase uses the open ones, the board card all of them.
  const strategies = await rulesStrategies(
    [...s.open, ...s.closed].map((r) => r.id),
    { gateway, carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store) },
  );
  // Replay: lead with the case from the video, worked as it stood before PayPal's decision.
  const rewindId = mode === "replay" ? [...f.rewinds.keys()][0] : undefined;
  const rewound = rewindId ? (await gatewayFor(mode, { rewind: rewindId }).getDispute(rewindId)).data : null;
  const { lead, settle } = pickShowcase(s.open, strategies, rewound ? toRow(rewound, gateway.now()) : undefined);
  const decidedByUs = s.closed.filter((r) => {
    const d = disputes.find((x) => x.dispute_id === r.id);
    return d && sandboxDecided(d);
  }).length;
  const calls = portfolioCalls([...s.open, ...s.closed], strategies);
  const sandboxWon = new Set(s.closed.filter((r) => r.outcome === "won" && sandboxDecided(disputes.find((x) => x.dispute_id === r.id) ?? { status: "" })).map((r) => r.id));
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
              <Fact label="Next deadline (yours)" value={yours ? `${formatCountdown(yours.hoursLeft)}${mode === "replay" ? " at snapshot" : ""}` : "nothing due"} tone={yours && (yours.bucket === "due_48h" || yours.bucket === "overdue") ? "amber" : undefined} note={yours ? "PayPal's due date for that case" : undefined} />
              <Fact
                label="Kept / refunded"
                value={`${money(s.won.amount, s.currency)} / ${money(s.lost.amount, s.currency)}`}
                note={decidedByUs ? (decidedByUs === s.closed.length ? "sandbox test decisions (we triggered them)" : `${decidedByUs} by sandbox test decision (we triggered them)`) : undefined}
              />
            </dl>
          </div>
          {lead && (
            <div className="flex flex-col gap-2">
              <Link
                href={`/disputes/${lead.id}?run=1${rewound ? "&rewind=1" : ""}`}
                className="group flex min-h-16 items-center justify-between gap-3 rounded-xl bg-primary px-5 py-3 text-on-primary transition hover:translate-y-[-1px]"
              >
                <span className="flex flex-col text-left">
                  <span className="text-[1.05rem] font-semibold">Watch the agent work a case</span>
                  <span className="text-xs opacity-80">
                    {rewound
                      ? `${reasonLabel(rewound.reason)} · ${money(lead.amount, lead.currency)} · the case from our video, replayed from before PayPal's decision`
                      : `${lead.reasonLabel} · ${money(lead.amount, lead.currency)} · ${mode === "replay" ? "replayed" : "live"}, step by step`}
                  </span>
                </span>
                <span aria-hidden="true" className="text-2xl transition group-hover:translate-x-0.5">
                  →
                </span>
              </Link>
              {settle && (
                <Link href={`/disputes/${settle.id}?run=1`} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                  …and one where {strategies.get(settle.id)?.strategy === "OFFER" ? "a fair offer" : "refunding"} is the smart call ({money(settle.amount, settle.currency)}) <span aria-hidden="true">→</span>
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      {calls.total > 0 && <CallsCard calls={calls} replay={mode === "replay"} sandboxWon={sandboxWon} />}

      {/* ------------------------------------------------------------ case board */}
      <section aria-labelledby="open-h">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <h2 id="open-h" className="font-display text-[1.5rem] leading-none">
            Open cases
          </h2>
          <p className="text-xs text-muted">Your move first, then money at risk × deadline</p>
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
                      {d && sandboxDecided(d) && <span className="block text-xs font-semibold text-ink-2">{SANDBOX_DECISION_LABEL}</span>}
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

function Fact({ label, value, tone, note }: { label: string; value: string; tone?: "amber"; note?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`font-semibold tabular-nums ${tone === "amber" ? "text-amber" : "text-ink"}`}>{value}</dd>
      {note && <dd className="text-[0.68rem] leading-tight text-muted">{note}</dd>}
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

const CALL_LABEL: Record<CallGroup["kind"], string> = { defend: "Defend", offer: "Fair offer", refund: "Refund", hold: "Hold" };
const CALL_TONE: Record<CallGroup["kind"], string> = { defend: "text-win", offer: "text-amber", refund: "text-loss", hold: "text-ink-2" };

function callNote(g: CallGroup, currency: string, sandboxWon: Set<string>): string {
  if (g.kind === "defend") {
    if (!g.won) return "your evidence supports you";
    const all = g.won === g.ids.length ? (g.won === 2 ? "both" : "all") : String(g.won);
    return `${all} won${g.ids.filter((id) => sandboxWon.has(id)).length === g.won ? ` (sandbox test ${g.won === 1 ? "decision" : "decisions"} we triggered)` : ""}`;
  }
  if (g.kind === "offer") return g.offered !== undefined ? `offer ${money(g.offered, currency)} back` : "a partial refund";
  if (g.kind === "refund") {
    const fair = g.buyerFair ?? 0;
    const unprovable = g.unprovable ?? 0;
    const cheap = g.ids.length - fair - unprovable;
    return [
      fair ? `${fair} where the buyer is right` : "",
      unprovable ? `${unprovable} where you can't prove delivery` : "",
      cheap ? `${cheap} where your time costs more` : "",
    ]
      .filter(Boolean)
      .join(", ");
  }
  return "nothing PayPal can receive yet";
}

/** The agent's call on every case, from the fixed rules: one line a seller can read at a glance. */
function CallsCard({ calls, replay, sandboxWon }: { calls: ReturnType<typeof portfolioCalls>; replay: boolean; sandboxWon: Set<string> }) {
  return (
    <section aria-labelledby="calls-h" className="rise case p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="calls-h" className="font-semibold">
          The agent&apos;s call on all {calls.total} of your cases
        </h2>
        <p className="text-xs text-muted">From the fixed rules, no AI{replay ? " · Replay data" : ""} · you approve every action</p>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {calls.groups.map((g) => (
          <li key={g.kind} className="min-w-0 border-l-2 border-line-strong pl-3">
            <p className={`text-xs font-semibold uppercase tracking-wide ${CALL_TONE[g.kind]}`}>
              {CALL_LABEL[g.kind]} · {g.ids.length}
            </p>
            <p className="font-display text-[1.35rem] leading-tight tabular-nums">{money(g.amount, calls.currency)}</p>
            <p className="text-xs leading-snug text-ink-2">{callNote(g, calls.currency, sandboxWon)}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-snug text-muted">
        By hand, all {calls.total} cases would take about {calls.total} × {DEFAULT_CONFIG.minutesToFight} min ≈ {fmtHours((calls.total * DEFAULT_CONFIG.minutesToFight) / 60)}.{" "}
        <span className="italic">An assumption (the app&apos;s cost-to-fight figure), not a measured time.</span>
      </p>
    </section>
  );
}

const fmtHours = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
