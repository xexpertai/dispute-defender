/**
 * "PayPal API response" proof panel data. Only whitelisted, non-personal fields from PayPal's real
 * response are kept: HTTP status, dispute id, status/stage/outcome, PayPal's debug_id and times.
 * Shown after a live approve, after a sandbox decision, and on demand ("Verify with PayPal").
 */
export interface ApiProof {
  source: "live" | "replay";
  method: "GET" | "POST";
  endpoint: string;
  httpStatus: number;
  disputeId: string;
  status?: string;
  stage?: string;
  /** e.g. "RESOLVED_SELLER_FAVOUR" */
  outcome?: string;
  updatedAt?: string;
  /** PayPal's own request id for this response (lets PayPal trace it). */
  debugId: string | null;
  fetchedAt: string;
}

export function proofFromDispute(
  d: { dispute_id?: string; status?: string; dispute_life_cycle_stage?: string; dispute_outcome?: { outcome_code?: string }; update_time?: string } & Record<string, unknown>,
  meta: { source: "live" | "replay"; httpStatus: number; debugId: string | null; fetchedAt: string; disputeId: string },
): ApiProof {
  return {
    source: meta.source,
    method: "GET",
    endpoint: `/v1/customer/disputes/${meta.disputeId}`,
    httpStatus: meta.httpStatus,
    disputeId: d.dispute_id ?? meta.disputeId,
    status: d.status,
    stage: d.dispute_life_cycle_stage,
    outcome: d.dispute_outcome?.outcome_code,
    updatedAt: d.update_time,
    debugId: meta.debugId,
    fetchedAt: meta.fetchedAt,
  };
}

/** "RESOLVED · SELLER_FAVOUR" style headline for the panel. */
export function proofHeadline(p: Pick<ApiProof, "status" | "outcome">): string {
  if (p.outcome) return `${p.status ?? "RESOLVED"} · ${p.outcome.replace(/^RESOLVED_/, "")}`;
  return p.status ?? "UNKNOWN";
}
