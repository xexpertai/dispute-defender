import type { DB } from "./db";

export interface DisputeSnapshot {
  dispute_id: string;
  reason?: string;
  status?: string;
  dispute_life_cycle_stage?: string;
  dispute_amount?: { value: string; currency_code: string };
  seller_response_due_date?: string;
  [key: string]: unknown;
}

export function upsertDispute(db: DB, d: DisputeSnapshot, source: "live" | "replay" = "live", now = new Date()) {
  db.prepare(
    `INSERT INTO disputes (id, reason, status, stage, amount_value, amount_currency, seller_response_due_date, source, json, fetched_at)
     VALUES (@id, @reason, @status, @stage, @amount_value, @amount_currency, @due, @source, @json, @fetched_at)
     ON CONFLICT(id) DO UPDATE SET reason=excluded.reason, status=excluded.status, stage=excluded.stage,
       amount_value=excluded.amount_value, amount_currency=excluded.amount_currency,
       seller_response_due_date=excluded.seller_response_due_date, source=excluded.source,
       json=excluded.json, fetched_at=excluded.fetched_at`,
  ).run({
    id: d.dispute_id,
    reason: d.reason ?? null,
    status: d.status ?? null,
    stage: d.dispute_life_cycle_stage ?? null,
    amount_value: d.dispute_amount?.value ?? null,
    amount_currency: d.dispute_amount?.currency_code ?? null,
    due: d.seller_response_due_date ?? null,
    source,
    json: JSON.stringify(d),
    fetched_at: now.toISOString(),
  });
}

export function getDisputeSnapshot(db: DB, id: string): DisputeSnapshot | null {
  const row = db.prepare("SELECT json FROM disputes WHERE id = ?").get(id) as { json: string } | undefined;
  return row ? (JSON.parse(row.json) as DisputeSnapshot) : null;
}

export function listDisputeSnapshots(db: DB, source?: "live" | "replay"): DisputeSnapshot[] {
  const rows = (
    source
      ? db.prepare("SELECT json FROM disputes WHERE source = ? ORDER BY seller_response_due_date").all(source)
      : db.prepare("SELECT json FROM disputes ORDER BY seller_response_due_date").all()
  ) as { json: string }[];
  return rows.map((r) => JSON.parse(r.json) as DisputeSnapshot);
}

export interface LlmUsage {
  runId?: string;
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export function recordLlmCall(db: DB, u: LlmUsage, now = new Date()) {
  db.prepare(
    `INSERT INTO llm_calls (run_id, model, purpose, input_tokens, output_tokens, cost_usd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(u.runId ?? null, u.model, u.purpose, u.inputTokens, u.outputTokens, u.costUsd, now.toISOString());
}

/** Totals for the token-spend line in milestone reports and the daily cap. */
export function llmTotals(db: DB, sinceIso?: string) {
  return db
    .prepare(
      `SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS input_tokens,
              COALESCE(SUM(output_tokens),0) AS output_tokens, COALESCE(SUM(cost_usd),0) AS cost_usd
       FROM llm_calls WHERE created_at >= COALESCE(?, '')`,
    )
    .get(sinceIso ?? null) as { calls: number; input_tokens: number; output_tokens: number; cost_usd: number };
}
