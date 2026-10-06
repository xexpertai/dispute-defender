/**
 * Evidence model. Every fact the agent (or a draft) may cite is an EvidenceItem with a stable
 * `sourceRef`. Drafts may only reference sourceRefs that exist in the gathered set, so we can
 * never cite evidence we do not have.
 *
 * sourceRef grammar (stable across runs for the same underlying data):
 *   dispute:<dispute_id>                 dispute summary
 *   dispute:<dispute_id>#msg<n>          n-th dispute message (0-based)
 *   order:<order_id>                     Orders v2 order
 *   capture:<capture_id>                 payment capture
 *   pptrack:<transaction_id>:<number>    tracking record stored in PayPal (Add Tracking API)
 *   track:<CARRIER>:<number>#ev<n>       n-th carrier scan event (0-based, chronological)
 *   store:<order_ref>#line<n>            seller store/order log line
 *   chat:<thread_id>#line<n>             seller ↔ buyer chat line (outside PayPal)
 *   listing:<sku>                        product listing snapshot
 */

export type EvidenceKind =
  | "dispute"
  | "dispute_message"
  | "order"
  | "capture"
  | "paypal_tracking"
  | "carrier_event"
  | "store_log"
  | "chat"
  | "listing";

export type CarrierEventCode =
  | "LABEL_CREATED"
  | "ACCEPTED"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "DELIVERY_ATTEMPTED"
  | "EXCEPTION"
  | "RETURNED_TO_SENDER";

/** Typed, machine-checkable facts the rules use. Text is for humans and the LLM. */
export interface EvidenceFacts {
  // order / capture
  amount?: number;
  currency?: string;
  shipToPostalCode?: string;
  shipToCountry?: string;
  orderedAt?: string;
  captureStatus?: string;
  sellerProtection?: string;
  // tracking
  carrier?: string;
  trackingNumber?: string;
  eventCode?: CarrierEventCode;
  eventPostalCode?: string;
  signatureObtained?: boolean;
  // logs / chat / listing
  author?: "seller" | "buyer" | "system";
  sellerAdmitsFault?: boolean;
  buyerPriorOrders?: number;
  photosBeforeShipping?: boolean;
  // dispute message
  postedBy?: "BUYER" | "SELLER" | "ARBITER";
}

export interface EvidenceItem {
  sourceRef: string;
  kind: EvidenceKind;
  /** Short human label, e.g. "USPS scan: Delivered (95014)". */
  label: string;
  /** Redacted text safe for UI, logs and the LLM. */
  text: string;
  /** ISO timestamp of the underlying event, if any. */
  at?: string;
  facts: EvidenceFacts;
}

export function byRef(items: EvidenceItem[]): Map<string, EvidenceItem> {
  return new Map(items.map((i) => [i.sourceRef, i]));
}
