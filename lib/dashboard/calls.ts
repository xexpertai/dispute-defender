import type { GuardianRow } from "./guardian";
import type { RulesVerdict } from "./showcase";

/**
 * The agent's call across the whole portfolio, from the deterministic rules (no AI): how many cases
 * it would defend, settle with a fair offer, refund, or hold, and the money in each. Every number
 * comes from the cases themselves; nothing is estimated.
 */
export type CallKind = "defend" | "offer" | "refund" | "hold";

export interface CallGroup {
  kind: CallKind;
  ids: string[];
  amount: number;
  /** offer: total of the partial refunds the rules would offer. */
  offered?: number;
  /** defend: closed cases among these that were won. */
  won?: number;
  /** refund: how many because the buyer is right (the evidence shows it). */
  buyerFair?: number;
  /** refund: how many because the seller can't prove delivery (no tracking on record). The rest: the refund costs less than the seller's time. */
  unprovable?: number;
}

export interface PortfolioCalls {
  total: number;
  currency: string;
  groups: CallGroup[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function kindOf(v: RulesVerdict): CallKind {
  if (v.wait) return "hold";
  return v.strategy === "FIGHT" ? "defend" : v.strategy === "OFFER" ? "offer" : "refund";
}

export function portfolioCalls(rows: Pick<GuardianRow, "id" | "amount" | "currency" | "outcome">[], verdicts: Map<string, RulesVerdict>): PortfolioCalls {
  const order: CallKind[] = ["defend", "offer", "refund", "hold"];
  const groups = new Map<CallKind, CallGroup>();
  let total = 0;
  for (const r of rows) {
    const v = verdicts.get(r.id);
    if (!v) continue;
    total++;
    const kind = kindOf(v);
    const g = groups.get(kind) ?? { kind, ids: [], amount: 0 };
    g.ids.push(r.id);
    g.amount = round2(g.amount + r.amount);
    if (kind === "offer" && v.offer !== undefined) g.offered = round2((g.offered ?? 0) + v.offer);
    if (kind === "defend" && r.outcome === "won") g.won = (g.won ?? 0) + 1;
    if (kind === "refund" && v.buyerFair && v.unprovable) g.unprovable = (g.unprovable ?? 0) + 1;
    else if (kind === "refund" && v.buyerFair) g.buyerFair = (g.buyerFair ?? 0) + 1;
    groups.set(kind, g);
  }
  return { total, currency: rows[0]?.currency ?? "USD", groups: order.flatMap((k) => (groups.has(k) ? [groups.get(k)!] : [])) };
}
