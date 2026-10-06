import { currentMode } from "@/lib/agent/deps";
import { clientKey, limiter, tooMany } from "@/lib/guard/rate-limit";
import { DISPUTE_ID } from "@/lib/http";
import { scrub } from "@/lib/log/scrub";
import { getPayPalClient } from "@/lib/paypal/client";
import { proofFromDispute } from "@/lib/paypal/proof";
import { fixtures } from "@/lib/replay/fixtures";

/**
 * GET /api/disputes/:id/proof: re-read the dispute from PayPal and return only the proof fields
 * (HTTP status, dispute id, status/stage/outcome, PayPal's debug_id, times). Live mode makes a real
 * sandbox GET (REST, so PayPal's debug_id is captured); Replay returns the recorded snapshot,
 * marked source: "replay" with no debug_id.
 */
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!DISPUTE_ID.test(id)) return Response.json({ error: "invalid dispute id" }, { status: 400 });
  const wait = limiter.check("run", clientKey(req));
  if (wait) return tooMany(wait);
  const fetchedAt = new Date().toISOString();
  if (currentMode() !== "live") {
    const d = fixtures().disputes.get(id);
    if (!d) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json(proofFromDispute(d as never, { source: "replay", httpStatus: 200, debugId: null, fetchedAt, disputeId: id }));
  }
  try {
    const res = await getPayPalClient().request<Record<string, unknown>>("GET", `/v1/customer/disputes/${id}`);
    return Response.json(proofFromDispute(res.data as never, { source: "live", httpStatus: res.status, debugId: res.debugId, fetchedAt, disputeId: id }));
  } catch (e) {
    const err = e as { status?: number; debugId?: string | null; message?: string };
    return Response.json({ error: scrub(err.message ?? "PayPal request failed"), httpStatus: err.status ?? null, debugId: err.debugId ?? null }, { status: 502 });
  }
}
