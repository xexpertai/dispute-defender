import { applyEdits, packFor, type ApproveRequest } from "@/lib/agent/approve";
import { planSubmission, previewRequest } from "@/lib/agent/submission";
import { DRAFT_ID, jsonBody } from "@/lib/http";
import { getApprovalForDraft, getDraft } from "@/lib/store/drafts";
import { sharedDb } from "@/lib/store/shared";

/** POST /api/drafts/:id/preview {edits?}: "What PayPal receives" for the current text. Read-only. */
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!DRAFT_ID.test(id)) return Response.json({ error: "invalid draft id" }, { status: 400 });
  const db = sharedDb();
  const stored = getDraft(db, id);
  if (!stored) return Response.json({ error: "draft not found" }, { status: 404 });
  const body = (await jsonBody<Pick<ApproveRequest, "edits">>(req)) ?? {};
  const draft = applyEdits(stored.draft, body.edits);
  const plan = planSubmission(stored.disputeId, draft, stored.packItems.length);
  const pdf = plan?.attachPack ? await packFor(stored, draft, stored.createdAt) : undefined;
  return Response.json({
    mode: stored.mode,
    preview: plan ? previewRequest(plan, pdf?.byteLength) : null,
    approval: getApprovalForDraft(db, id) ? "approved" : null,
  });
}
