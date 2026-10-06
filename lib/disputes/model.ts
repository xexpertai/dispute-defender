import type { DisputeLike } from "../evidence/sources";
import type { EvidenceKind } from "../evidence/types";
import { availableActions } from "../paypal/links";
import type { DisputeContext } from "../strategy/rules";

/**
 * The subset of a PayPal Disputes v1 dispute (details or list item) the app reads.
 * Pure helpers only: no network, no fs, safe for client and server.
 */
export interface DisputeRecord extends DisputeLike {
  update_time?: string;
  buyer_response_due_date?: string;
  dispute_state?: string;
  dispute_outcome?: { outcome_code?: string; outcome_reason?: string; amount_refunded?: { value: string; currency_code: string } };
  allowed_response_options?: {
    make_offer?: { offer_types?: string[] };
    accept_claim?: { accept_claim_types?: string[] };
  };
  links?: { rel: string; href?: string; method?: string }[];
}

export const REASON_LABEL: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Item not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorized payment",
  CREDIT_NOT_PROCESSED: "Credit not processed",
  DUPLICATE_TRANSACTION: "Duplicate charge",
  INCORRECT_AMOUNT: "Incorrect amount",
  PAYMENT_BY_OTHER_MEANS: "Paid by other means",
  CANCELED_RECURRING_BILLING: "Canceled subscription",
  PROBLEM_WITH_REMITTANCE: "Remittance problem",
  OTHER: "Other",
};

export const reasonLabel = (reason?: string) => (reason ? (REASON_LABEL[reason] ?? reason.replace(/_/g, " ").toLowerCase()) : "Unknown reason");

/** INQUIRY is between buyer and seller; CHARGEBACK here is PayPal's claim stage (M0 finding). */
export const stageLabel = (stage?: string) => (stage === "INQUIRY" ? "Inquiry" : stage === "CHARGEBACK" ? "PayPal claim" : stage === "PRE_ARBITRATION" ? "Pre-arbitration" : stage === "ARBITRATION" ? "Arbitration" : (stage ?? "Unknown"));

export type ClockOwner = "seller" | "buyer" | "paypal" | "closed";

export interface Clock {
  owner: ClockOwner;
  /** Deadline for the owner, when PayPal gives one. */
  dueAt?: string;
  label: string;
}

/** Who has to act next, and by when. Drives the deadline guardian. */
export function clockOf(d: DisputeRecord): Clock {
  switch (d.status) {
    case "RESOLVED":
      return { owner: "closed", label: "Closed" };
    case "WAITING_FOR_SELLER_RESPONSE":
      return { owner: "seller", dueAt: d.seller_response_due_date, label: "Your move" };
    case "WAITING_FOR_BUYER_RESPONSE":
      return { owner: "buyer", dueAt: d.buyer_response_due_date, label: "Buyer to reply" };
    default:
      return { owner: "paypal", label: "PayPal reviewing" };
  }
}

export type Outcome = "won" | "lost" | "settled" | "open";

export function outcomeOf(d: DisputeRecord): Outcome {
  if (d.status !== "RESOLVED") return "open";
  const code = d.dispute_outcome?.outcome_code ?? "";
  if (code === "RESOLVED_SELLER_FAVOUR" || code === "CANCELED_BY_BUYER") return "won";
  if (code === "RESOLVED_BUYER_FAVOUR") return "lost";
  return "settled";
}

export const amountOf = (d: DisputeRecord) => Number(d.dispute_amount?.value ?? 0);
export const currencyOf = (d: DisputeRecord) => d.dispute_amount?.currency_code ?? "USD";
export const captureIdOf = (d: DisputeRecord) => d.disputed_transactions?.[0]?.seller_transaction_id;
export const invoiceOf = (d: DisputeRecord) => d.disputed_transactions?.[0]?.invoice_number;

/** Strategy-engine input from a dispute's details. Allowed actions come only from HATEOAS links. */
export function toContext(d: DisputeRecord): DisputeContext {
  return {
    disputeId: d.dispute_id,
    reason: d.reason ?? "OTHER",
    amount: amountOf(d),
    currency: currencyOf(d),
    stage: d.dispute_life_cycle_stage,
    status: d.status,
    sellerResponseDueDate: d.seller_response_due_date,
    allowedActions: availableActions(d),
    allowedOfferTypes: d.allowed_response_options?.make_offer?.offer_types,
    allowedAcceptClaimTypes: d.allowed_response_options?.accept_claim?.accept_claim_types,
  };
}

/** Where an evidence item came from. Shown on every item so nothing sample-based passes as PayPal data. */
export type Provenance = "paypal" | "carrier" | "store";

export function provenanceOf(kind: EvidenceKind): Provenance {
  switch (kind) {
    case "carrier_event":
      return "carrier";
    case "store_log":
    case "chat":
    case "listing":
      return "store";
    default:
      return "paypal";
  }
}

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  paypal: "PayPal",
  carrier: "Carrier (mock)",
  store: "Store (sample)",
};
