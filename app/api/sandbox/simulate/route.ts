import { currentMode } from "@/lib/agent/deps";
import { DISPUTE_ID, isAppAction, jsonBody } from "@/lib/http";
import { clientKey, limiter, tooMany } from "@/lib/guard/rate-limit";
import { scrub } from "@/lib/log/scrub";
import { getPayPalClient } from "@/lib/paypal/client";
import { sandboxSimulate } from "@/lib/paypal/disputes";

/**
 * POST /api/sandbox/simulate {disputeId, kind: "adjudicate"|"require_evidence", outcome?}
 * PayPal's sandbox-only lifecycle endpoints (labelled SANDBOX in the UI). HATEOAS-gated.
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isAppAction(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const wait = limiter.check("write", clientKey(req));
  if (wait) return tooMany(wait);
  if (currentMode() !== "live") return Response.json({ error: "Replay mode never calls PayPal" }, { status: 409 });
  const body = await jsonBody<{ disputeId?: string; kind?: string; outcome?: string }>(req);
  if (!body?.disputeId || !DISPUTE_ID.test(body.disputeId)) return Response.json({ error: "invalid dispute id" }, { status: 400 });
  try {
    const res =
      body.kind === "adjudicate"
        ? await sandboxSimulate(getPayPalClient(), body.disputeId, { kind: "adjudicate", outcome: body.outcome === "BUYER_FAVOR" ? "BUYER_FAVOR" : "SELLER_FAVOR" })
        : body.kind === "require_evidence"
          ? await sandboxSimulate(getPayPalClient(), body.disputeId, { kind: "require_evidence", action: "SELLER_EVIDENCE" })
          : null;
    if (!res) return Response.json({ error: "unknown simulation" }, { status: 400 });
    return Response.json({ ok: true, status: res.status, debugId: res.debugId });
  } catch (e) {
    const err = e as { status?: number; debugId?: string | null; message?: string };
    return Response.json({ ok: false, error: scrub(err.message ?? "error"), debugId: err.debugId ?? null }, { status: err.status === 422 || err.status === 400 ? 409 : 502 });
  }
}
