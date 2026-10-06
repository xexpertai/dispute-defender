import { amountOf, clockOf, currencyOf, outcomeOf, reasonLabel, stageLabel, type Clock, type DisputeRecord, type Outcome } from "../disputes/model";
import { availableActions } from "../paypal/links";
import type { DeadlineBucket } from "../strategy/rules";

/**
 * Deadline guardian: ranks disputes by money at risk × urgency.
 *
 *   priority = amount × urgency
 *   urgency (your move)      overdue 3 · < 48h 2 · < 7d 1.2 · later 1 · no deadline 1
 *   urgency (buyer / PayPal) 0.5 — money is still at risk, but nothing is due from you
 *   urgency (closed)         0
 *
 * Pure: the clock is passed in, so Replay can freeze it at the snapshot time.
 */

export interface GuardianRow {
  id: string;
  reason: string;
  reasonLabel: string;
  stage: string;
  status: string;
  amount: number;
  currency: string;
  clock: Clock;
  hoursLeft: number | null;
  bucket: DeadlineBucket;
  priority: number;
  outcome: Outcome;
  refunded?: number;
  /** HATEOAS rels PayPal currently allows (what the seller can do now). */
  actions: string[];
  createdAt?: string;
}

export interface GuardianSummary {
  now: string;
  currency: string;
  atRisk: number;
  openCount: number;
  yourMove: number;
  dueSoon: number;
  won: { count: number; amount: number };
  lost: { count: number; amount: number };
  /** Open disputes, highest priority first. */
  open: GuardianRow[];
  /** Resolved disputes, newest first. */
  closed: GuardianRow[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function bucketOf(hoursLeft: number | null): DeadlineBucket {
  if (hoursLeft === null) return "none";
  return hoursLeft < 0 ? "overdue" : hoursLeft < 48 ? "due_48h" : hoursLeft < 168 ? "due_7d" : "later";
}

const SELLER_URGENCY: Record<DeadlineBucket, number> = { overdue: 3, due_48h: 2, due_7d: 1.2, later: 1, none: 1 };

export function urgency(owner: Clock["owner"], bucket: DeadlineBucket): number {
  if (owner === "closed") return 0;
  if (owner === "seller") return SELLER_URGENCY[bucket];
  return 0.5;
}

export function hoursUntil(dueIso: string | undefined, now: Date): number | null {
  if (!dueIso) return null;
  const t = Date.parse(dueIso);
  return Number.isNaN(t) ? null : Math.round(((t - now.getTime()) / 3_600_000) * 10) / 10;
}

export function toRow(d: DisputeRecord, now: Date): GuardianRow {
  const clock = clockOf(d);
  const hoursLeft = hoursUntil(clock.dueAt, now);
  const bucket = clock.owner === "closed" ? "none" : bucketOf(hoursLeft);
  const amount = amountOf(d);
  const outcome = outcomeOf(d);
  const refunded = d.dispute_outcome?.amount_refunded ? Number(d.dispute_outcome.amount_refunded.value) : undefined;
  return {
    id: d.dispute_id,
    reason: d.reason ?? "OTHER",
    reasonLabel: reasonLabel(d.reason),
    stage: stageLabel(d.dispute_life_cycle_stage),
    status: d.status ?? "UNKNOWN",
    amount,
    currency: currencyOf(d),
    clock,
    hoursLeft,
    bucket,
    priority: round2(amount * urgency(clock.owner, bucket)),
    outcome,
    refunded,
    actions: availableActions(d).filter((a) => a !== "require_evidence" && a !== "adjudicate"),
    createdAt: d.create_time,
  };
}

/** Highest priority first; ties broken by the nearest deadline, then the larger amount. */
export function rank(rows: GuardianRow[]): GuardianRow[] {
  return [...rows].sort(
    (a, b) => b.priority - a.priority || (a.hoursLeft ?? Infinity) - (b.hoursLeft ?? Infinity) || b.amount - a.amount || a.id.localeCompare(b.id),
  );
}

export function summarize(disputes: DisputeRecord[], now: Date): GuardianSummary {
  const rows = disputes.map((d) => toRow(d, now));
  const open = rank(rows.filter((r) => r.outcome === "open"));
  const OUTCOME_ORDER = { won: 0, settled: 1, lost: 2, open: 3 } as const;
  // Wins first (what the seller kept), then newest first.
  const closed = rows.filter((r) => r.outcome !== "open").sort((a, b) => OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const won = closed.filter((r) => r.outcome === "won");
  const lost = closed.filter((r) => r.outcome === "lost");
  return {
    now: now.toISOString(),
    currency: rows[0]?.currency ?? "USD",
    atRisk: round2(open.reduce((s, r) => s + r.amount, 0)),
    openCount: open.length,
    yourMove: open.filter((r) => r.clock.owner === "seller").length,
    dueSoon: open.filter((r) => r.clock.owner === "seller" && (r.bucket === "overdue" || r.bucket === "due_48h")).length,
    won: { count: won.length, amount: round2(won.reduce((s, r) => s + r.amount, 0)) },
    lost: { count: lost.length, amount: round2(lost.reduce((s, r) => s + (r.refunded ?? r.amount), 0)) },
    open,
    closed,
  };
}

/** "19d 22h", "5h 12m", "overdue 3h". Pure so server render and client ticking agree. */
export function formatCountdown(hoursLeft: number | null): string {
  if (hoursLeft === null) return "no deadline";
  const overdue = hoursLeft < 0;
  const mins = Math.round(Math.abs(hoursLeft) * 60);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const body = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return overdue ? `overdue ${body}` : body;
}
