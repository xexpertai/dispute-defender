import type { EvidenceItem } from "../evidence/types";
import type { Draft } from "../llm/draft";
import type { DB } from "./db";

/** Drafts, approvals and submissions: our own audit trail (PayPal stays the source of truth). */
export interface StoredDraft {
  id: string;
  runId: string;
  disputeId: string;
  mode: "live" | "replay";
  reason: string;
  amount: number;
  currency: string;
  draft: Draft;
  packRefs: string[];
  /** The evidence items referenced by the pack, frozen at draft time. */
  packItems: EvidenceItem[];
  createdAt: string;
}

export function saveDraft(db: DB, d: StoredDraft) {
  const { id, runId, disputeId, draft, createdAt, ...rest } = d;
  db.prepare(
    `INSERT INTO drafts (id, run_id, dispute_id, action, payload, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, action = excluded.action, origin = excluded.origin`,
  ).run(id, runId, disputeId, draft.action?.kind ?? "none", JSON.stringify({ draft, ...rest }), draft.origin, createdAt);
}

export function getDraft(db: DB, id: string): StoredDraft | null {
  const row = db.prepare("SELECT * FROM drafts WHERE id = ?").get(id) as
    | { id: string; run_id: string; dispute_id: string; payload: string; created_at: string }
    | undefined;
  if (!row) return null;
  const p = JSON.parse(row.payload) as Omit<StoredDraft, "id" | "runId" | "disputeId" | "createdAt">;
  return { id: row.id, runId: row.run_id, disputeId: row.dispute_id, createdAt: row.created_at, ...p };
}

export interface Approval {
  id: string;
  draftId: string;
  approvedBy: string;
  approvedAt: string;
  finalPayload: unknown;
}

/** Throws on a second approval of the same draft (UNIQUE draft_id): one draft, one submission. */
export function insertApproval(db: DB, a: Approval) {
  db.prepare("INSERT INTO approvals (id, draft_id, approved_by, approved_at, final_payload) VALUES (?, ?, ?, ?, ?)").run(
    a.id,
    a.draftId,
    a.approvedBy,
    a.approvedAt,
    JSON.stringify(a.finalPayload),
  );
}

export function getApprovalForDraft(db: DB, draftId: string): Approval | null {
  const r = db.prepare("SELECT * FROM approvals WHERE draft_id = ?").get(draftId) as
    | { id: string; draft_id: string; approved_by: string; approved_at: string; final_payload: string }
    | undefined;
  return r ? { id: r.id, draftId: r.draft_id, approvedBy: r.approved_by, approvedAt: r.approved_at, finalPayload: JSON.parse(r.final_payload) } : null;
}

export interface Submission {
  id: string;
  approvalId: string;
  endpoint: string;
  statusCode: number | null;
  debugId: string | null;
  response: unknown;
  createdAt: string;
}

export function insertSubmission(db: DB, s: Submission) {
  db.prepare("INSERT INTO submissions (id, approval_id, endpoint, status_code, debug_id, response, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    s.id,
    s.approvalId,
    s.endpoint,
    s.statusCode,
    s.debugId,
    JSON.stringify(s.response ?? null),
    s.createdAt,
  );
}

export function submissionsForDispute(db: DB, disputeId: string) {
  return db
    .prepare(
      `SELECT s.id, s.endpoint, s.status_code AS statusCode, s.debug_id AS debugId, s.created_at AS createdAt, d.origin, d.action
       FROM submissions s JOIN approvals a ON a.id = s.approval_id JOIN drafts d ON d.id = a.draft_id
       WHERE d.dispute_id = ? ORDER BY s.created_at DESC`,
    )
    .all(disputeId) as { id: string; endpoint: string; statusCode: number | null; debugId: string | null; createdAt: string; origin: string; action: string }[];
}
