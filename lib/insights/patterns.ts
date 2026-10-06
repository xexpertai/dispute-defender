import type { EvidenceItem } from "../evidence/types";
import type { Assessment } from "../strategy/rules";
import { REASON_LABEL } from "../disputes/model";

/**
 * Prevention insights, step 1: deterministic pattern stats over the seller's disputes. Every
 * insight lists the disputes it comes from, so nothing is claimed without its cases. Claude only
 * turns these into seller actions afterwards (lib/insights/actions.ts), citing insight ids.
 */
export interface DisputeFacts {
  id: string;
  reason: string;
  amount: number;
  currency: string;
  outcome: "won" | "lost" | "settled" | "open";
  sku?: string;
  paidAt?: string;
  openedAt?: string;
  trackingNumbers: string[];
  delivered: boolean;
  signature: boolean;
  openedBeforeDelivery: boolean;
  noTracking: boolean;
  belowCostToFight: boolean;
}

export interface Insight {
  id: string;
  title: string;
  detail: string;
  count: number;
  total: number;
  disputeIds: string[];
  severity: "high" | "medium" | "low";
  /** Dispute reasons behind this pattern (used to keep advice on-topic). */
  reasons: string[];
  /** Deterministic suggestion (shown as TEMPLATE when no AI actions exist). */
  hint: string;
}

const INR = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED";
const HIGH_VALUE = 75;

export function factsFrom(id: string, outcome: DisputeFacts["outcome"], evidence: EvidenceItem[], a: Assessment): DisputeFacts {
  const dispute = evidence.find((e) => e.kind === "dispute");
  const capture = evidence.find((e) => e.kind === "capture");
  const listing = evidence.find((e) => e.kind === "listing");
  const scans = evidence.filter((e) => e.kind === "carrier_event");
  const delivered = scans.filter((e) => e.facts.eventCode === "DELIVERED").at(-1);
  const tracking = evidence.filter((e) => e.kind === "paypal_tracking").map((e) => e.facts.trackingNumber!).filter(Boolean);
  return {
    id,
    reason: a.reason,
    amount: a.amount,
    currency: a.currency,
    outcome,
    sku: listing?.sourceRef.replace(/^listing:/, ""),
    paidAt: capture?.at,
    openedAt: dispute?.at,
    trackingNumbers: [...new Set(tracking)],
    delivered: Boolean(delivered),
    signature: Boolean(delivered?.facts.signatureObtained),
    openedBeforeDelivery: a.strength.reasons.some((r) => r.id === "opened_before_delivery"),
    noTracking: tracking.length === 0,
    belowCostToFight: a.amount <= a.costToFight,
  };
}

const share = (n: number, t: number) => `${n} of ${t}`;
const reasonsOf = (all: DisputeFacts[], ids: string[]) => [...new Set(all.filter((d) => ids.includes(d.id)).map((d) => d.reason))];

export function findPatterns(all: DisputeFacts[]): Insight[] {
  const out: Omit<Insight, "reasons">[] = [];
  const total = all.length;
  if (!total) return [];
  const inr = all.filter((d) => d.reason === INR);

  const early = inr.filter((d) => d.openedBeforeDelivery);
  if (early.length)
    out.push({
      id: "opened_before_delivery",
      title: "Buyers open cases before the package arrives",
      detail: `${share(early.length, inr.length)} "item not received" cases were opened before the carrier delivered the package.`,
      count: early.length,
      total: inr.length,
      disputeIds: early.map((d) => d.id),
      severity: early.length / inr.length >= 0.5 ? "high" : "medium",
      hint: "Email tracking and the expected delivery date as soon as you ship.",
    });

  const fast = all.filter((d) => d.paidAt && d.openedAt && Date.parse(d.openedAt) - Date.parse(d.paidAt) < 48 * 3_600_000);
  if (fast.length)
    out.push({
      id: "filed_within_48h",
      title: "Cases filed within 48 hours of payment",
      detail: `${share(fast.length, total)} disputes were opened less than 48 hours after the buyer paid.`,
      count: fast.length,
      total,
      disputeIds: fast.map((d) => d.id),
      severity: fast.length / total >= 0.5 ? "medium" : "low",
      hint: "State your handling time and shipping estimate clearly at checkout.",
    });

  const noSig = inr.filter((d) => d.delivered && !d.signature && d.amount >= HIGH_VALUE);
  if (noSig.length)
    out.push({
      id: "high_value_no_signature",
      title: `Orders over $${HIGH_VALUE} delivered without a signature`,
      detail: `${share(noSig.length, inr.length)} "item not received" cases over $${HIGH_VALUE} had no signature on delivery.`,
      count: noSig.length,
      total: inr.length,
      disputeIds: noSig.map((d) => d.id),
      severity: "high",
      hint: `Use signature confirmation for orders over $${HIGH_VALUE}.`,
    });

  const untracked = all.filter((d) => d.noTracking);
  if (untracked.length)
    out.push({
      id: "no_tracking_at_paypal",
      title: "No tracking on file at PayPal",
      detail: `${share(untracked.length, total)} disputes had no tracking number added to the PayPal transaction.`,
      count: untracked.length,
      total,
      disputeIds: untracked.map((d) => d.id),
      severity: "high",
      hint: "Add tracking to every PayPal order (Add Tracking API) when the label is printed.",
    });

  const byTracking = new Map<string, string[]>();
  for (const d of all) for (const t of d.trackingNumbers) byTracking.set(t, [...(byTracking.get(t) ?? []), d.id]);
  const reused = [...byTracking.entries()].filter(([, ids]) => ids.length > 1);
  if (reused.length) {
    const ids = [...new Set(reused.flatMap(([, x]) => x))];
    out.push({
      id: "tracking_reused",
      title: "One tracking number used on several payments",
      detail: `${reused.length === 1 ? "1 tracking number was" : `${reused.length} tracking numbers were`} added to ${ids.length} different payments. PayPal can't tell which order it proves.`,
      count: ids.length,
      total,
      disputeIds: ids,
      severity: "high",
      hint: "Print one label per order and double-check the tracking number before adding it.",
    });
  }

  const bySku = new Map<string, string[]>();
  for (const d of all) if (d.sku) bySku.set(d.sku, [...(bySku.get(d.sku) ?? []), d.id]);
  for (const [sku, ids] of bySku)
    if (ids.length >= 2 && ids.length / total >= 0.5)
      out.push({
        id: `sku_${sku}`,
        title: `Disputes cluster on ${sku}`,
        detail: `${share(ids.length, total)} disputes involve the same product (${sku}).`,
        count: ids.length,
        total,
        disputeIds: ids,
        severity: "medium",
        hint: reasonsOf(all, ids).every((r) => r === INR)
          ? `Check the shipping method and tracking for ${sku}: all of its cases are "item not received".`
          : `Review the listing, photos and packaging for ${sku}.`,
      });

  const small = all.filter((d) => d.belowCostToFight);
  if (small.length)
    out.push({
      id: "below_cost_to_fight",
      title: "Small disputes cost more to fight than to refund",
      detail: `${share(small.length, total)} disputes were for less than the ~$12.50 of your time a response takes.`,
      count: small.length,
      total,
      disputeIds: small.map((d) => d.id),
      severity: "low",
      hint: "Consider offering a quick refund on small, low-evidence cases (you still approve each one).",
    });

  const rank = { high: 0, medium: 1, low: 2 };
  return out.map((i): Insight => ({ ...i, reasons: reasonsOf(all, i.disputeIds) })).sort((a, b) => rank[a.severity] - rank[b.severity] || b.count / b.total - a.count / a.total);
}

export const reasonText = (r: string) => REASON_LABEL[r] ?? r;
