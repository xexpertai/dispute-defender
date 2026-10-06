import { currentMode } from "@/lib/agent/deps";
import { approveAndSubmit, type ApproveRequest } from "@/lib/agent/approve";
import { DRAFT_ID, isAppAction, jsonBody } from "@/lib/http";
import { clientKey, limiter, tooMany } from "@/lib/guard/rate-limit";
import { getPayPalClient } from "@/lib/paypal/client";
import { runCustomDisputeTool } from "@/lib/paypal/disputes";
import { sharedDb } from "@/lib/store/shared";

/** POST /api/drafts/:id/approve {reviewed, edits?}: approval record first, then the sandbox write. */
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAppAction(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const wait = limiter.check("write", clientKey(req));
  if (wait) return tooMany(wait);
  const { id } = await params;
  if (!DRAFT_ID.test(id)) return Response.json({ error: "invalid draft id" }, { status: 400 });
  const body = await jsonBody<ApproveRequest>(req);
  if (!body) return Response.json({ error: "invalid body" }, { status: 400 });
  const mode = currentMode();
  const result = await approveAndSubmit(id, { reviewed: body.reviewed === true, edits: body.edits }, {
    db: sharedDb(),
    mode,
    runTool: async (tool, args, opts) => {
      const res = await runCustomDisputeTool(getPayPalClient(), tool, args, opts);
      return { status: res.status, debugId: res.debugId, data: res.data };
    },
  });
  return Response.json(result, { status: result.ok ? 200 : result.httpStatus });
}
