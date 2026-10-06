import { getPayPalClient } from "@/lib/paypal/client";
import { getDispute } from "@/lib/paypal/disputes";
import { disputeIdOf, verifyWebhook, type WebhookEvent } from "@/lib/paypal/webhooks";
import { redactObject } from "@/lib/redact";
import { upsertDispute } from "@/lib/store/repo";
import { sharedDb } from "@/lib/store/shared";

/**
 * POST /api/webhooks/paypal: CUSTOMER.DISPUTE.CREATED / UPDATED / RESOLVED.
 * Verified with PayPal first (fails closed). On a dispute event we re-read the dispute from
 * PayPal (never trusting the payload) and store the snapshot; the dashboard picks it up.
 * Needs PAYPAL_WEBHOOK_ID (registering the webhook needs the user's approval). Locally, use
 * `npm run poll` instead.
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim();
  if (!webhookId) return Response.json({ error: "webhook not configured" }, { status: 503 });
  let event: WebhookEvent;
  try {
    event = JSON.parse(await req.text()) as WebhookEvent;
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const client = getPayPalClient();
  if (!(await verifyWebhook(client, req.headers, event, webhookId))) return Response.json({ error: "signature not verified" }, { status: 401 });
  const id = disputeIdOf(event);
  if (id && /^PP-[A-Z0-9-]{3,40}$/.test(id)) {
    const dispute = redactObject(await getDispute(client, id));
    upsertDispute(sharedDb(), dispute as Parameters<typeof upsertDispute>[1], "live");
  }
  return Response.json({ received: true, dispute: id ?? null });
}
