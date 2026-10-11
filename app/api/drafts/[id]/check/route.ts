import { testTheChecker } from "@/lib/agent/checker";
import { DRAFT_ID } from "@/lib/http";
import { getDraft } from "@/lib/store/drafts";
import { sharedDb } from "@/lib/store/shared";

/** POST /api/drafts/:id/check: "Test our checker". Injects two made-up claims and validates. Read-only. */
export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!DRAFT_ID.test(id)) return Response.json({ error: "invalid draft id" }, { status: 400 });
  const stored = getDraft(sharedDb(), id);
  if (!stored) return Response.json({ error: "draft not found" }, { status: 404 });
  return Response.json({ results: testTheChecker(stored) });
}
