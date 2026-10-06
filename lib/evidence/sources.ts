import { redactText } from "../redact";
import type { CarrierEventCode, EvidenceItem } from "./types";

/**
 * Pure mappers from source data to EvidenceItems. Network access lives in the agent loop;
 * these functions only translate (and redact) what was fetched, so they are fully testable
 * against recorded fixtures.
 */

// ---------- PayPal dispute ----------

export interface DisputeLike {
  dispute_id: string;
  reason?: string;
  status?: string;
  dispute_life_cycle_stage?: string;
  dispute_amount?: { value: string; currency_code: string };
  seller_response_due_date?: string;
  create_time?: string;
  messages?: { posted_by?: string; time_posted?: string; content?: string }[];
  disputed_transactions?: { seller_transaction_id?: string; buyer_transaction_id?: string; invoice_number?: string; seller_protection_eligible?: boolean }[];
}

export function fromDispute(d: DisputeLike): EvidenceItem[] {
  const amount = d.dispute_amount ? Number(d.dispute_amount.value) : undefined;
  const items: EvidenceItem[] = [
    {
      sourceRef: `dispute:${d.dispute_id}`,
      kind: "dispute",
      label: "Dispute opened",
      text: `Reason ${d.reason ?? "unknown"}, ${d.dispute_amount?.currency_code ?? ""} ${d.dispute_amount?.value ?? "?"}, stage ${d.dispute_life_cycle_stage ?? "?"}, status ${d.status ?? "?"}.`,
      at: d.create_time,
      facts: { amount, currency: d.dispute_amount?.currency_code },
    },
  ];
  (d.messages ?? []).forEach((m, i) => {
    const postedBy = (m.posted_by ?? "BUYER") as "BUYER" | "SELLER" | "ARBITER";
    items.push({
      sourceRef: `dispute:${d.dispute_id}#msg${i}`,
      kind: "dispute_message",
      label: `${postedBy === "SELLER" ? "Seller" : postedBy === "ARBITER" ? "PayPal" : "Buyer"} message`,
      text: redactText(m.content ?? ""),
      at: m.time_posted,
      facts: { postedBy },
    });
  });
  return items;
}

// ---------- Orders v2 ----------

export interface OrderLike {
  id: string;
  create_time?: string;
  purchase_units?: {
    invoice_id?: string;
    description?: string;
    amount?: { value: string; currency_code: string };
    shipping?: { address?: { postal_code?: string; country_code?: string } };
    payments?: { captures?: { id: string; status?: string; status_details?: { reason?: string }; create_time?: string; amount?: { value: string; currency_code: string }; seller_protection?: { status?: string } }[] };
  }[];
}

export function fromOrder(o: OrderLike): EvidenceItem[] {
  const pu = o.purchase_units?.[0];
  if (!pu) return [];
  const zip = pu.shipping?.address?.postal_code;
  const country = pu.shipping?.address?.country_code;
  const items: EvidenceItem[] = [
    {
      sourceRef: `order:${o.id}`,
      kind: "order",
      label: `Order ${o.id}`,
      text: redactText(
        `${pu.description ?? "Order"} for ${pu.amount?.currency_code ?? ""} ${pu.amount?.value ?? "?"}` +
          (zip ? `, ship-to ZIP ${zip} ${country ?? ""}` : ", no shipping address on order") +
          (pu.invoice_id ? `, invoice ${pu.invoice_id}` : ""),
      ).trim(),
      at: o.create_time,
      facts: {
        amount: pu.amount ? Number(pu.amount.value) : undefined,
        currency: pu.amount?.currency_code,
        shipToPostalCode: zip,
        shipToCountry: country,
        orderedAt: o.create_time,
      },
    },
  ];
  for (const c of pu.payments?.captures ?? []) {
    const amt = `${c.amount?.currency_code ?? ""} ${c.amount?.value ?? "?"}`;
    const onHold = c.status === "PENDING" && c.status_details?.reason === "BUYER_COMPLAINT";
    items.push({
      sourceRef: `capture:${c.id}`,
      kind: "capture",
      label: onHold ? "Payment captured · funds on hold" : `Payment ${(c.status ?? "").toLowerCase()}`.trim(),
      text: onHold
        ? `Buyer paid ${amt}. PayPal is holding the funds while the buyer's complaint is open (PENDING: BUYER_COMPLAINT). Seller protection ${c.seller_protection?.status ?? "unknown"}.`
        : `Payment of ${amt}, status ${c.status ?? "?"}${c.status_details?.reason ? ` (${c.status_details.reason})` : ""}, seller protection ${c.seller_protection?.status ?? "unknown"}.`,
      at: c.create_time,
      facts: { captureStatus: c.status, sellerProtection: c.seller_protection?.status, amount: c.amount ? Number(c.amount.value) : undefined },
    });
  }
  return items;
}

// ---------- PayPal tracking (Add Tracking API) ----------

export interface PayPalTrackerLike {
  transaction_id: string;
  tracking_number: string;
  carrier: string;
  status?: string;
  last_updated_time?: string;
}

/** PayPal trackers report last_updated_time as epoch-millis strings; normalise to ISO. */
export function toIso(t: string | undefined): string | undefined {
  if (!t) return undefined;
  if (/^\d{12,14}$/.test(t)) return new Date(Number(t)).toISOString();
  return Number.isNaN(Date.parse(t)) ? undefined : t;
}

export function fromPayPalTrackers(trackers: PayPalTrackerLike[]): EvidenceItem[] {
  return trackers.map((t) => ({
    sourceRef: `pptrack:${t.transaction_id}:${t.tracking_number}`,
    kind: "paypal_tracking" as const,
    label: `Tracking on file at PayPal (${t.carrier})`,
    text: `${t.carrier} ${t.tracking_number} recorded with PayPal for transaction ${t.transaction_id}, status ${t.status ?? "SHIPPED"}.`,
    at: toIso(t.last_updated_time),
    facts: { carrier: t.carrier, trackingNumber: t.tracking_number },
  }));
}

// ---------- Carrier (mock adapter in the demo) ----------

export interface CarrierEvent {
  code: CarrierEventCode;
  at: string;
  postalCode?: string;
  description?: string;
  signature?: boolean;
}

export interface CarrierTracking {
  carrier: string;
  trackingNumber: string;
  events: CarrierEvent[];
}

export interface CarrierAdapter {
  /** Returns null when the carrier has no record of the tracking number. */
  track(carrier: string, trackingNumber: string): Promise<CarrierTracking | null>;
}

const EVENT_LABEL: Record<CarrierEventCode, string> = {
  LABEL_CREATED: "Label created",
  ACCEPTED: "Accepted by carrier",
  IN_TRANSIT: "In transit",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  DELIVERY_ATTEMPTED: "Delivery attempted",
  EXCEPTION: "Exception",
  RETURNED_TO_SENDER: "Returned to sender",
};

export function fromCarrierTracking(t: CarrierTracking): EvidenceItem[] {
  return [...t.events]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((e, i) => ({
      sourceRef: `track:${t.carrier}:${t.trackingNumber}#ev${i}`,
      kind: "carrier_event" as const,
      label: `${t.carrier} scan: ${EVENT_LABEL[e.code]}${e.postalCode ? ` (${e.postalCode})` : ""}`,
      text: redactText(`${EVENT_LABEL[e.code]}${e.description ? `: ${e.description}` : ""}${e.signature ? ", signature obtained" : ""}.`),
      at: e.at,
      facts: {
        carrier: t.carrier,
        trackingNumber: t.trackingNumber,
        eventCode: e.code,
        eventPostalCode: e.postalCode,
        signatureObtained: e.signature,
      },
    }));
}

// ---------- Seller's own logs (sample data in the demo) ----------

export interface LogLine {
  at?: string;
  author: "seller" | "buyer" | "system";
  text: string;
  /** Optional structured hints set by the seller's system or our sample data. */
  tags?: { sellerAdmitsFault?: boolean; buyerPriorOrders?: number; photosBeforeShipping?: boolean };
}

export function fromStoreLog(orderRef: string, lines: LogLine[]): EvidenceItem[] {
  return lines.map((l, i) => ({
    sourceRef: `store:${orderRef}#line${i}`,
    kind: "store_log" as const,
    label: "Store log",
    text: redactText(l.text),
    at: l.at,
    facts: { author: l.author, ...l.tags },
  }));
}

export function fromChat(threadId: string, lines: LogLine[]): EvidenceItem[] {
  return lines.map((l, i) => ({
    sourceRef: `chat:${threadId}#line${i}`,
    kind: "chat" as const,
    label: l.author === "seller" ? "Seller chat" : l.author === "buyer" ? "Buyer chat" : "Chat",
    text: redactText(l.text),
    at: l.at,
    facts: { author: l.author, ...l.tags },
  }));
}
