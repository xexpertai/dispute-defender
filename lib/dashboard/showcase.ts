import type { DisputeGateway } from "../agent/gateway";
import { runAgent } from "../agent/run";
import type { CarrierAdapter } from "../evidence/sources";
import { FakeProvider } from "../llm/draft";
import type { StoreAdapter } from "../samples/store";
import type { Strategy, StrengthLevel } from "../strategy/rules";
import type { GuardianRow } from "./guardian";

/**
 * Which cases the dashboard showcases (design review): lead with a case the agent DEFENDS (the
 * product's best story), then offer one where refunding is the smart call (the honesty proof).
 * Falls back to priority order. Strategies come from the deterministic rules, not from AI.
 */
export interface Showcase {
  lead?: GuardianRow;
  settle?: GuardianRow;
}

/** Rules verdict per dispute: the strategy and how strong the seller's evidence is. */
export interface RulesVerdict {
  strategy: Strategy;
  strength: StrengthLevel;
  /** Set when the agent holds back on the case (nothing to send yet, or message first). */
  wait?: string;
  /** The partial refund the rules would offer (make-offer / partial accept), when there is one. */
  offer?: number;
  /** A decisive buyer-side fact (e.g. the seller's own records admit a fault) means a refund. */
  buyerFair?: boolean;
  /** With buyerFair: the only decisive fact is no tracking on record, so the seller can't prove delivery. */
  unprovable?: boolean;
}

/** `featured`: a case to lead with regardless (Replay: the video's case, rewound to before PayPal's decision). */
export function pickShowcase(open: GuardianRow[], verdicts: Map<string, RulesVerdict>, featured?: GuardianRow): Showcase {
  // Only a case the agent can act on now leads: a case on hold would end at "nothing to send".
  const fights = open.filter((r) => verdicts.get(r.id)?.strategy === "FIGHT" && !verdicts.get(r.id)?.wait);
  // The strongest defence leads, in priority order.
  const lead = featured ?? fights.find((r) => verdicts.get(r.id)?.strength === "HIGH") ?? fights[0] ?? open.find((r) => !verdicts.get(r.id)?.wait) ?? open[0];
  const settle = open.find((r) => r.id !== lead?.id && (verdicts.get(r.id)?.strategy === "REFUND" || verdicts.get(r.id)?.strategy === "OFFER"));
  return { lead, settle };
}

/** Rules-only strategy per open dispute (no AI, no writes; Replay is instant). */
export async function rulesStrategies(ids: string[], deps: { gateway: DisputeGateway; carrier: CarrierAdapter; store: StoreAdapter }): Promise<Map<string, RulesVerdict>> {
  const out = new Map<string, RulesVerdict>();
  for (const id of ids.slice(0, 12)) {
    for await (const e of runAgent(id, { ...deps, provider: new FakeProvider() })) if (e.type === "assessment") {
      const r = e.assessment.recommendation;
      const offer = r.strategy === "OFFER" && r.action?.amount ? Number(r.action.amount.value) : undefined;
      out.set(id, { strategy: r.strategy, strength: e.assessment.strength.level, wait: r.wait, buyerFair: r.buyerFair, ...(r.unprovable ? { unprovable: true } : {}), ...(offer !== undefined ? { offer } : {}) });
    }
  }
  return out;
}
