import type { PayPalClient } from "./client";

/**
 * PayPal webhook verification (POST /v1/notifications/verify-webhook-signature). We only act on
 * events PayPal itself confirms. Webhook-simulator events are mock payloads and do not verify.
 */
export const DISPUTE_EVENTS = ["CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED"] as const;

const HEADERS = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"] as const;

export interface WebhookEvent {
  id?: string;
  event_type?: string;
  resource?: { dispute_id?: string; [k: string]: unknown };
}

export function webhookHeaders(h: Headers): Record<(typeof HEADERS)[number], string> | null {
  const out = {} as Record<(typeof HEADERS)[number], string>;
  for (const k of HEADERS) {
    const v = h.get(k);
    if (!v) return null;
    out[k] = v;
  }
  return out;
}

export async function verifyWebhook(client: Pick<PayPalClient, "request">, headers: Headers, event: WebhookEvent, webhookId: string): Promise<boolean> {
  const h = webhookHeaders(headers);
  if (!h) return false;
  const res = await client.request<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    json: {
      auth_algo: h["paypal-auth-algo"],
      cert_url: h["paypal-cert-url"],
      transmission_id: h["paypal-transmission-id"],
      transmission_sig: h["paypal-transmission-sig"],
      transmission_time: h["paypal-transmission-time"],
      webhook_id: webhookId,
      webhook_event: event,
    },
  });
  return res.data.verification_status === "SUCCESS";
}

export const disputeIdOf = (e: WebhookEvent) => (DISPUTE_EVENTS as readonly string[]).includes(e.event_type ?? "") ? e.resource?.dispute_id : undefined;
