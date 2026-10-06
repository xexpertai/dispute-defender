import type { DisputeGateway } from "../agent/gateway";
import { runAgent } from "../agent/run";
import type { CarrierAdapter } from "../evidence/sources";
import { FakeProvider } from "../llm/draft";
import type { StoreAdapter } from "../samples/store";
import type { Strategy } from "../strategy/rules";
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

export function pickShowcase(open: GuardianRow[], strategy: Map<string, Strategy>): Showcase {
  const lead = open.find((r) => strategy.get(r.id) === "FIGHT") ?? open[0];
  const settle = open.find((r) => r.id !== lead?.id && (strategy.get(r.id) === "REFUND" || strategy.get(r.id) === "OFFER"));
  return { lead, settle };
}

/** Rules-only strategy per open dispute (no AI, no writes; Replay is instant). */
export async function rulesStrategies(ids: string[], deps: { gateway: DisputeGateway; carrier: CarrierAdapter; store: StoreAdapter }): Promise<Map<string, Strategy>> {
  const out = new Map<string, Strategy>();
  for (const id of ids.slice(0, 12)) {
    for await (const e of runAgent(id, { ...deps, provider: new FakeProvider() })) if (e.type === "assessment") out.set(id, e.assessment.recommendation.strategy);
  }
  return out;
}
