import type { DisputeGateway } from "../agent/gateway";
import { runAgent } from "../agent/run";
import type { CarrierAdapter } from "../evidence/sources";
import { FakeProvider } from "../llm/draft";
import type { StoreAdapter } from "../samples/store";
import { money } from "../format";
import { scoreMath } from "../strategy/checklist";
import { verdictOf, verdictTitle, type VerdictKey } from "../strategy/verdict";

/**
 * One row per case for the "verify" page: the agent's call, how much of the proof for the PayPal
 * reason code is on file, the score arithmetic, and the fact that decided it. Fixed rules, no AI,
 * no writes (the draft step uses the TEMPLATE writer and is ignored).
 */
export interface MatrixRow {
  id: string;
  reason: string;
  amount: number;
  currency: string;
  verdict: VerdictKey;
  headline: string;
  have: number;
  of: number;
  /** Proof items whose records show the opposite of the seller's case. */
  against: number;
  /** Proof items not there yet (e.g. still in transit). */
  pending: number;
  score: string;
  /** The decisive buyer-side fact, else the heaviest reason. */
  decidedBy: string;
  closed: boolean;
}

export async function caseMatrix(ids: string[], deps: { gateway: DisputeGateway; carrier: CarrierAdapter; store: StoreAdapter }): Promise<MatrixRow[]> {
  const rows: MatrixRow[] = [];
  for (const id of ids.slice(0, 12)) {
    for await (const e of runAgent(id, { ...deps, provider: new FakeProvider(), runId: "verify" })) {
      if (e.type !== "assessment") continue;
      const a = e.assessment;
      const rec = a.recommendation;
      const reasons = a.strength.reasons;
      const decisive = reasons.find((r) => r.decisive && r.supports === "buyer");
      const heaviest = [...reasons].sort((x, y) => y.weight - x.weight)[0];
      rows.push({
        id,
        reason: a.reason,
        amount: a.amount,
        currency: a.currency,
        verdict: verdictOf(rec),
        headline: verdictTitle(rec),
        have: a.checklist.have,
        of: a.checklist.of,
        against: a.checklist.items.filter((i) => i.status === "against").length,
        pending: a.checklist.items.filter((i) => i.status === "pending").length,
        score: scoreMath(reasons),
        decidedBy: decisive
          ? decisive.text
          : rec.wait === "awaiting_delivery"
            ? "Still moving: no delivery scan yet"
            : rec.strategy === "OFFER"
              ? "Mixed evidence: a fair offer usually settles it faster than a claim"
              : rec.strategy === "REFUND" && a.amount <= a.costToFight
                ? `Your time (~${money(a.costToFight, a.currency)}) costs more than the ${money(a.amount, a.currency)} refund`
                : (heaviest?.text ?? "No reasons on file"),
        closed: rec.considered === undefined,
      });
      break;
    }
  }
  return rows;
}
