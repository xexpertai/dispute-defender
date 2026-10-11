import type { EvidenceItem } from "../evidence/types";
import type { Reason } from "./rules";

/**
 * The proof map: for the dispute's PayPal reason code, the proof that answers the buyer's claim, and
 * whether the gathered records have it. Deterministic (no AI). It explains the rules' verdict with the
 * same records the reasons cite; it decides nothing on its own.
 *
 *  - have:    a record on file supports this proof
 *  - against: a record on file shows the opposite (e.g. the carrier returned the package)
 *  - pending: not yet (e.g. the package is still moving)
 *  - missing: no record on file
 *
 * `paypalType` is the Disputes API `evidence_type` this proof would be filed under (lib/paypal/disputes.ts).
 */
export type ProofStatus = "have" | "against" | "pending" | "missing";

export interface ProofItem {
  id: string;
  label: string;
  status: ProofStatus;
  /** One line: what the record shows, or what is missing. */
  note: string;
  paypalType: "PROOF_OF_FULFILLMENT" | "PROOF_OF_DELIVERY_SIGNATURE" | "ITEM_DESCRIPTION" | "OTHER";
  /** Nice to have: its absence doesn't weaken the case on its own. */
  optional?: boolean;
  sourceRefs: string[];
}

export interface ProofChecklist {
  reason: string;
  /** What the buyer is claiming, in plain words. */
  claim: string;
  items: ProofItem[];
  /** Required items on file, of all required items. */
  have: number;
  of: number;
}

const CLAIM: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "The buyer says the item never arrived.",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "The buyer says the item is not as described.",
  UNAUTHORISED: "The buyer says they didn't make this payment.",
};

function deliveryItems(ev: EvidenceItem[], reasons: Reason[], withShipment: boolean): ProofItem[] {
  const items: ProofItem[] = [];
  const has = (id: string) => reasons.find((r) => r.id === id);
  const order = ev.find((e) => e.kind === "order");
  const ppTrack = ev.filter((e) => e.kind === "paypal_tracking");
  const scans = ev.filter((e) => e.kind === "carrier_event");
  const delivered = scans.filter((e) => e.facts.eventCode === "DELIVERED").at(-1);
  const last = scans.at(-1);

  if (withShipment) {
    items.push(
      ppTrack.length
        ? { id: "shipment", label: "Proof of shipment", status: "have", note: "Tracking number recorded with PayPal", paypalType: "PROOF_OF_FULFILLMENT", sourceRefs: ppTrack.map((t) => t.sourceRef) }
        : { id: "shipment", label: "Proof of shipment", status: "missing", note: "No tracking number on record", paypalType: "PROOF_OF_FULFILLMENT", sourceRefs: order ? [order.sourceRef] : [] },
    );
  }

  const notDelivered = has("not_delivered");
  if (delivered) {
    items.push({ id: "delivery", label: "Carrier delivery scan", status: "have", note: "The carrier shows it delivered", paypalType: "PROOF_OF_FULFILLMENT", sourceRefs: [delivered.sourceRef] });
  } else if (notDelivered) {
    items.push({ id: "delivery", label: "Carrier delivery scan", status: "against", note: notDelivered.text, paypalType: "PROOF_OF_FULFILLMENT", sourceRefs: notDelivered.sourceRefs });
  } else if (last) {
    items.push({ id: "delivery", label: "Carrier delivery scan", status: "pending", note: "Still moving: no delivery scan yet", paypalType: "PROOF_OF_FULFILLMENT", sourceRefs: [last.sourceRef] });
  } else {
    items.push({ id: "delivery", label: "Carrier delivery scan", status: "missing", note: "No carrier scans on record", paypalType: "PROOF_OF_FULFILLMENT", sourceRefs: [] });
  }

  // Address and signature can only be shown by a delivery scan.
  const noScanYet: ProofStatus = !delivered && !notDelivered && last ? "pending" : "missing";
  const noScanNote = notDelivered ? "Never delivered" : "Needs a delivery scan first";
  const match = has("zip_match");
  const mismatch = has("zip_mismatch");
  items.push(
    match
      ? { id: "address", label: "Delivered to the order's address", status: "have", note: match.text, paypalType: "PROOF_OF_FULFILLMENT", sourceRefs: match.sourceRefs }
      : mismatch
        ? { id: "address", label: "Delivered to the order's address", status: "against", note: mismatch.text, paypalType: "PROOF_OF_FULFILLMENT", sourceRefs: mismatch.sourceRefs }
        : { id: "address", label: "Delivered to the order's address", status: delivered ? "missing" : noScanYet, note: delivered ? "The scan has no ZIP to compare" : noScanNote, paypalType: "PROOF_OF_FULFILLMENT", sourceRefs: [] },
  );

  const sig = has("signature");
  items.push(
    sig
      ? { id: "signature", label: "Signature on delivery", status: "have", note: sig.text, paypalType: "PROOF_OF_DELIVERY_SIGNATURE", optional: true, sourceRefs: sig.sourceRefs }
      : { id: "signature", label: "Signature on delivery", status: delivered ? "missing" : noScanYet, note: delivered ? "No signature on record (it helps on higher-value orders)" : noScanNote, paypalType: "PROOF_OF_DELIVERY_SIGNATURE", optional: true, sourceRefs: [] },
  );
  return items;
}

/** The proof checklist for this dispute's reason code, from the gathered records and the rules' reasons. */
export function proofChecklist(reason: string, ev: EvidenceItem[], reasons: Reason[]): ProofChecklist {
  const has = (id: string) => reasons.find((r) => r.id === id);
  let items: ProofItem[] = [];

  switch (reason) {
    case "MERCHANDISE_OR_SERVICE_NOT_RECEIVED":
      items = deliveryItems(ev, reasons, true);
      break;
    case "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED": {
      const listing = has("listing_snapshot");
      const photos = has("photos_before_shipping");
      const buyer = has("buyer_describes_issue");
      items.push(
        listing
          ? { id: "listing", label: "The listing as the buyer saw it", status: "have", note: listing.text, paypalType: "ITEM_DESCRIPTION", sourceRefs: listing.sourceRefs }
          : { id: "listing", label: "The listing as the buyer saw it", status: "missing", note: "No listing snapshot on record", paypalType: "ITEM_DESCRIPTION", sourceRefs: [] },
        photos
          ? { id: "photos", label: "Photos of the item before shipping", status: "have", note: photos.text, paypalType: "OTHER", sourceRefs: photos.sourceRefs }
          : { id: "photos", label: "Photos of the item before shipping", status: "missing", note: "No photos taken before shipping on record", paypalType: "OTHER", sourceRefs: [] },
      );
      const delivered = ev.filter((e) => e.kind === "carrier_event" && e.facts.eventCode === "DELIVERED").at(-1);
      items.push(
        delivered
          ? { id: "delivery", label: "The buyer received it", status: "have", note: "The carrier shows it delivered", paypalType: "PROOF_OF_FULFILLMENT", optional: true, sourceRefs: [delivered.sourceRef] }
          : { id: "delivery", label: "The buyer received it", status: "missing", note: "No delivery scan on record", paypalType: "PROOF_OF_FULFILLMENT", optional: true, sourceRefs: [] },
      );
      if (buyer) items.push({ id: "buyer_account", label: "The buyer's account of the problem", status: "against", note: "Not answered by the records: the buyer describes a fault", paypalType: "OTHER", sourceRefs: buyer.sourceRefs });
      break;
    }
    case "UNAUTHORISED": {
      items = deliveryItems(ev, reasons, false).filter((i) => i.id !== "signature");
      const repeat = has("repeat_buyer");
      items.push(
        repeat
          ? { id: "history", label: "The buyer's earlier orders", status: "have", note: repeat.text, paypalType: "OTHER", sourceRefs: repeat.sourceRefs }
          : { id: "history", label: "The buyer's earlier orders", status: "missing", note: "No earlier orders from this account on record", paypalType: "OTHER", sourceRefs: [] },
      );
      break;
    }
    default: {
      const order = ev.find((e) => e.kind === "order");
      items.push(
        order
          ? { id: "order", label: "The order record", status: "have", note: "The order is on record", paypalType: "OTHER", sourceRefs: [order.sourceRef] }
          : { id: "order", label: "The order record", status: "missing", note: "No order on record", paypalType: "OTHER", sourceRefs: [] },
      );
    }
  }

  const fault = has("seller_admits_fault");
  if (fault) items.push({ id: "no_fault", label: "Your own records", status: "against", note: fault.text, paypalType: "OTHER", sourceRefs: fault.sourceRefs });

  const required = items.filter((i) => !i.optional);
  return {
    reason,
    claim: CLAIM[reason] ?? "The buyer has opened a dispute.",
    items,
    have: required.filter((i) => i.status === "have").length,
    of: required.length,
  };
}

/** The strength rule, in words, with this case's arithmetic (e.g. "+3 +1 +1 +1 = +6"). */
export function scoreMath(reasons: Reason[]): string {
  if (!reasons.length) return "0";
  const terms = reasons.map((r) => `${r.supports === "seller" ? "+" : "−"}${r.weight}`);
  const total = reasons.reduce((s, r) => s + (r.supports === "seller" ? r.weight : -r.weight), 0);
  return `${terms.join(" ")} = ${total > 0 ? "+" : total < 0 ? "−" : ""}${Math.abs(total)}`;
}

export const STRENGTH_RULE = "Each fact for you adds its weight; each fact for the buyer subtracts it. +3 or more is strong, +1 to +2 mixed, below that weak. Any decisive fact for the buyer means a refund, whatever the total.";
