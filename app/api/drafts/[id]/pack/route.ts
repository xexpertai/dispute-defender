import { packFor } from "@/lib/agent/approve";
import { DRAFT_ID } from "@/lib/http";
import { getDraft } from "@/lib/store/drafts";
import { sharedDb } from "@/lib/store/shared";

/** GET /api/drafts/:id/pack: the evidence pack PDF exactly as it would be attached. */
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!DRAFT_ID.test(id)) return Response.json({ error: "invalid draft id" }, { status: 400 });
  const stored = getDraft(sharedDb(), id);
  if (!stored) return Response.json({ error: "draft not found" }, { status: 404 });
  const pdf = await packFor(stored, stored.draft, stored.createdAt);
  return new Response(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="evidence-pack-${stored.disputeId}.pdf"`, "Cache-Control": "no-store" },
  });
}
