import type { DisputeGateway } from "../agent/gateway";
import { runAgent } from "../agent/run";
import { PROVENANCE_LABEL, provenanceOf } from "../disputes/model";
import type { CarrierAdapter } from "../evidence/sources";
import type { EvidenceItem } from "../evidence/types";
import { FakeProvider } from "../llm/draft";
import type { StoreAdapter } from "../samples/store";
import { DEFAULT_CONFIG, type Assessment } from "../strategy/rules";
import { VERDICT_WORD, verdictOf, verdictTitle } from "../strategy/verdict";

/** What the agent needs to judge a case: the same gateway, carrier and store adapters the app uses. */
export interface AssessDeps {
  gateway: DisputeGateway;
  carrier: CarrierAdapter;
  store: StoreAdapter;
}

/**
 * The agent's verdict on one dispute, from the fixed rules only (lib/strategy/rules.ts): no AI call,
 * no writes. The draft step uses the deterministic TEMPLATE writer, and its output is not returned.
 * Returns null when the dispute can't be found.
 */
export async function assessDispute(disputeId: string, deps: AssessDeps) {
  let assessment: Assessment | null = null;
  let evidence: EvidenceItem[] = [];
  for await (const e of runAgent(disputeId, { ...deps, provider: new FakeProvider(), runId: "mcp_assess" })) {
    if (e.type === "evidence") evidence = e.items;
    if (e.type === "assessment") {
      assessment = e.assessment;
      break;
    }
    if (e.type === "error") throw new Error(e.message);
  }
  if (!assessment) return null;
  const a = assessment;
  const rec = a.recommendation;
  const source = new Map(evidence.map((e) => [e.sourceRef, PROVENANCE_LABEL[provenanceOf(e.kind)]]));
  return {
    dispute_id: a.disputeId,
    data: deps.gateway.mode === "replay" ? "Replay (recorded PayPal sandbox responses)" : "Live PayPal sandbox",
    decided_by: "Fixed rules, no AI",
    verdict: VERDICT_WORD[verdictOf(rec)],
    headline: verdictTitle(rec),
    amount: `${a.currency} ${a.amount.toFixed(2)}`,
    evidence_strength: a.strength.level,
    buyer_is_right: rec.buyerFair && !rec.unprovable,
    seller_cannot_prove_delivery: Boolean(rec.unprovable),
    why: rec.why,
    reasons: a.strength.reasons.map((r) => ({
      text: r.text,
      supports: r.supports,
      decisive: Boolean(r.decisive),
      sources: r.sourceRefs.map((ref) => ({ ref, from: source.get(ref) ?? "PayPal" })),
    })),
    recommended_action: rec.action,
    actions_paypal_allows_now: (rec.considered ?? []).map((c) => ({ action: c.kind, picked: c.chosen, why: c.note })),
    ...(rec.wait ? { on_hold: rec.wait } : {}),
    cost_to_fight: `${a.currency} ${a.costToFight.toFixed(2)} (assumes ${DEFAULT_CONFIG.minutesToFight} min of the seller's time at ${a.currency} ${DEFAULT_CONFIG.sellerHourlyValue}/h)`,
    note: "A second opinion before acting. The seller decides; PayPal decides the case.",
  };
}
