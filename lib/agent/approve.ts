import { randomUUID } from "node:crypto";
import type { Draft } from "../llm/draft";
import type { CustomToolName } from "../paypal/disputes";
import { scrub } from "../log/scrub";
import { renderEvidencePack } from "../pdf/evidence-pack";
import type { DB } from "../store/db";
import { getApprovalForDraft, getDraft, insertApproval, insertSubmission, type StoredDraft } from "../store/drafts";
import { assertPlanValid, PACK_FILENAME, planSubmission, previewRequest, type RequestPreview } from "./submission";

/**
 * Human-in-the-loop submit (PLAN §5 step 8):
 *   1. the seller has reviewed the draft (explicit flag) and may have edited the text
 *   2. an approval record is stored BEFORE anything is sent
 *   3. the custom toolkit tool re-reads the dispute and passes the HATEOAS gate, then submits
 *      (PayPal-Request-Id = approval id, so a retry can't double-submit)
 *   4. the PayPal response (status, debug_id) is stored as a submission
 * Replay drafts can never be submitted.
 */
export interface ApproveRequest {
  reviewed: boolean;
  approvedBy?: string;
  edits?: { sellerNote?: string; buyerMessage?: string };
}

export type RunTool = (
  tool: CustomToolName,
  args: Record<string, unknown>,
  opts: { idempotencyKey: string },
) => Promise<{ status: number; debugId: string | null; data: unknown }>;

export interface ApproveDeps {
  db: DB;
  mode: "live" | "replay";
  runTool: RunTool;
  now?: () => Date;
}

export type ApproveResult =
  | { ok: true; approvalId: string; preview: RequestPreview; status: number; debugId: string | null }
  | { ok: false; httpStatus: number; error: string; debugId?: string | null };

export function applyEdits(draft: Draft, edits: ApproveRequest["edits"]): Draft {
  if (!edits) return draft;
  const note = edits.sellerNote?.trim();
  const msg = edits.buyerMessage?.trim();
  return {
    ...draft,
    sellerNote: note || draft.sellerNote,
    buyerMessage: draft.buyerMessage && msg ? { ...draft.buyerMessage, text: msg } : draft.buyerMessage,
  };
}

export async function packFor(stored: StoredDraft, draft: Draft, at: string) {
  return renderEvidencePack({ disputeId: stored.disputeId, reason: stored.reason, amount: stored.amount, currency: stored.currency, draft, items: stored.packItems, generatedAt: at });
}

export async function approveAndSubmit(draftId: string, req: ApproveRequest, deps: ApproveDeps): Promise<ApproveResult> {
  const now = deps.now ?? (() => new Date());
  const stored = getDraft(deps.db, draftId);
  if (!stored) return { ok: false, httpStatus: 404, error: "Draft not found" };
  if (deps.mode !== "live" || stored.mode !== "live") return { ok: false, httpStatus: 409, error: "Replay drafts are never sent to PayPal" };
  if (!req.reviewed) return { ok: false, httpStatus: 400, error: "Review the draft before approving" };
  if (getApprovalForDraft(deps.db, draftId)) return { ok: false, httpStatus: 409, error: "This draft was already approved" };
  for (const [k, v] of Object.entries(req.edits ?? {})) if (typeof v === "string" && v.length > 2000) return { ok: false, httpStatus: 400, error: `${k} is over PayPal's 2000-character limit` };

  const draft = applyEdits(stored.draft, req.edits);
  const plan = planSubmission(stored.disputeId, draft, stored.packItems.length);
  if (!plan) return { ok: false, httpStatus: 409, error: "This draft has no PayPal action to submit" };
  try {
    assertPlanValid(plan);
  } catch (e) {
    return { ok: false, httpStatus: 400, error: `Draft does not match the PayPal request schema: ${scrub(e instanceof Error ? e.message : e).slice(0, 300)}` };
  }

  const at = now().toISOString();
  const pdf = plan.attachPack ? await packFor(stored, draft, at) : undefined;
  const preview = previewRequest(plan, pdf?.byteLength);
  const approvalId = `apr_${randomUUID()}`;
  insertApproval(deps.db, { id: approvalId, draftId, approvedBy: req.approvedBy ?? "seller", approvedAt: at, finalPayload: { tool: plan.tool, preview, draft } });

  const args = { ...plan.args, ...(pdf ? { files: [{ filename: PACK_FILENAME, type: "application/pdf", data: pdf }] } : {}) };
  try {
    const res = await deps.runTool(plan.tool, args, { idempotencyKey: approvalId });
    insertSubmission(deps.db, { id: `sub_${randomUUID()}`, approvalId, endpoint: preview.endpoint, statusCode: res.status, debugId: res.debugId, response: res.data, createdAt: now().toISOString() });
    return { ok: true, approvalId, preview, status: res.status, debugId: res.debugId };
  } catch (e) {
    const err = e as { status?: number; debugId?: string | null; issues?: string[]; message?: string };
    insertSubmission(deps.db, { id: `sub_${randomUUID()}`, approvalId, endpoint: preview.endpoint, statusCode: err.status ?? null, debugId: err.debugId ?? null, response: { error: scrub(err.message ?? "error"), issues: err.issues ?? [] }, createdAt: now().toISOString() });
    return { ok: false, httpStatus: 502, error: `PayPal refused the request: ${scrub(err.message ?? "error").slice(0, 300)}`, debugId: err.debugId ?? null };
  }
}
