import type { EvidenceItem } from "../evidence/types";
import { bucketOf, hoursUntil, urgency } from "../dashboard/guardian";

/**
 * Deterministic strategy engine (no LLM). It explains its evidence strength with reasons that each
 * cite sourceRefs, applies the buyer-fair principle (if the evidence says the buyer is right, we
 * recommend a refund — never invent evidence or pressure the buyer), weighs the cost to fight, and
 * maps the recommendation onto an action PayPal currently allows (HATEOAS).
 */

export type Strategy = "FIGHT" | "OFFER" | "REFUND";
export type StrengthLevel = "HIGH" | "MEDIUM" | "LOW";
export type ActionKind = "provide_evidence" | "provide_supporting_info" | "make_offer" | "accept_claim" | "send_message" | "escalate";

export interface Reason {
  id: string;
  text: string;
  /** Who this fact supports. */
  supports: "seller" | "buyer";
  weight: number;
  /** A buyer-side reason that, on its own, means a refund (the buyer is right, or the seller has no proof of delivery). */
  decisive?: boolean;
  sourceRefs: string[];
}

export interface PlannedAction {
  kind: ActionKind;
  offerType?: "REFUND" | "REFUND_WITH_RETURN" | "REFUND_WITH_REPLACEMENT" | "REPLACEMENT_WITHOUT_REFUND";
  acceptClaimType?: "REFUND" | "PARTIAL_REFUND";
  amount?: { value: string; currency_code: string };
}

export interface EvidenceToSubmit {
  evidence_type: "PROOF_OF_FULFILLMENT" | "OTHER";
  tracking_info?: { carrier_name: string; tracking_number: string }[];
  sourceRefs: string[];
}

/**
 * Why the agent holds back on an open case (shown instead of a DEFEND verdict, with no Approve):
 *  - awaiting_delivery: the package is still moving; PayPal may allow a response, but there's no
 *    delivery proof to send yet.
 *  - no_allowed_action: PayPal lists no seller action that fits (often: it hasn't opened a response
 *    window yet).
 *  - message_first: the only step now is a message to the buyer with the tracking; then wait.
 */
export type WaitKind = "awaiting_delivery" | "no_allowed_action" | "message_first";

/** Seller-side actions PayPal can list on a dispute (the sandbox simulation rels are not seller actions). */
const SELLER_ACTIONS = ["provide_evidence", "provide_supporting_info", "make_offer", "accept_claim", "send_message", "escalate", "acknowledge_return_item", "appeal"];

/** One seller action PayPal lists on the dispute right now (a HATEOAS link), and why the rules did or didn't pick it. */
export interface ConsideredAction {
  kind: string;
  chosen: boolean;
  note: string;
}

export type DeadlineBucket = "overdue" | "due_48h" | "due_7d" | "later" | "none";

export interface Assessment {
  disputeId: string;
  reason: string;
  amount: number;
  currency: string;
  strength: { level: StrengthLevel; score: number; reasons: Reason[] };
  recommendation: {
    strategy: Strategy;
    action: PlannedAction | null;
    why: string[];
    /** A decisive buyer-side fact means a refund. */
    buyerFair: boolean;
    /**
     * Set with buyerFair when the only decisive fact is missing proof (no tracking on record): the seller
     * can't prove delivery. That is not proof the buyer is right, and the app never says it is.
     */
    unprovable?: boolean;
    wait?: WaitKind;
    considered?: ConsideredAction[];
  };
  costToFight: number;
  priority: { score: number; bucket: DeadlineBucket; hoursLeft: number | null };
  evidenceToSubmit: EvidenceToSubmit[];
}

export interface DisputeContext {
  disputeId: string;
  reason: string;
  amount: number;
  currency: string;
  stage?: string;
  status?: string;
  sellerResponseDueDate?: string;
  /** HATEOAS rels currently present on the dispute. */
  allowedActions: string[];
  /** From allowed_response_options.make_offer.offer_types, when present. */
  allowedOfferTypes?: string[];
  /** From allowed_response_options.accept_claim.accept_claim_types, when present. */
  allowedAcceptClaimTypes?: string[];
}

export interface StrategyConfig {
  /** What an hour of the seller's time is worth, for cost-to-fight. */
  sellerHourlyValue: number;
  minutesToFight: number;
  /** Fraction of the dispute amount offered as a partial refund. */
  partialOfferRatio: number;
}

export const DEFAULT_CONFIG: StrategyConfig = { sellerHourlyValue: 25, minutesToFight: 30, partialOfferRatio: 0.5 };

const HIGH_AT = 3;
const MEDIUM_AT = 1;

// ---------------------------------------------------------------- reasons per dispute reason

function trackingReasons(ctx: DisputeContext, ev: EvidenceItem[]): Reason[] {
  const reasons: Reason[] = [];
  const order = ev.find((e) => e.kind === "order");
  const scans = ev.filter((e) => e.kind === "carrier_event");
  const delivered = scans.filter((e) => e.facts.eventCode === "DELIVERED").at(-1);
  const last = scans.at(-1);
  const ppTrack = ev.filter((e) => e.kind === "paypal_tracking");

  if (!scans.length && !ppTrack.length) {
    reasons.push({
      id: "no_tracking",
      text: "No tracking or proof of shipment on file",
      supports: "buyer",
      weight: 3,
      decisive: ctx.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
      sourceRefs: order ? [order.sourceRef] : [],
    });
    return reasons;
  }
  if (ppTrack.length) {
    reasons.push({ id: "tracking_at_paypal", text: "Tracking number is recorded with PayPal", supports: "seller", weight: 1, sourceRefs: ppTrack.map((t) => t.sourceRef) });
  }
  if (delivered) {
    reasons.push({ id: "delivered_scan", text: "Carrier shows the package as delivered", supports: "seller", weight: 3, sourceRefs: [delivered.sourceRef] });
    const shipZip = order?.facts.shipToPostalCode;
    const scanZip = delivered.facts.eventPostalCode;
    if (shipZip && scanZip) {
      if (shipZip === scanZip) {
        reasons.push({ id: "zip_match", text: `Delivery ZIP ${scanZip} matches the order's ship-to ZIP`, supports: "seller", weight: 1, sourceRefs: [delivered.sourceRef, order!.sourceRef] });
      } else {
        reasons.push({ id: "zip_mismatch", text: `Delivered to ZIP ${scanZip}, but the order ships to ${shipZip}`, supports: "buyer", weight: 4, decisive: true, sourceRefs: [delivered.sourceRef, order!.sourceRef] });
      }
    }
    const opened = ev.find((e) => e.kind === "dispute");
    if (opened?.at && delivered.at && delivered.at > opened.at) {
      reasons.push({ id: "opened_before_delivery", text: "The buyer opened the case before the package arrived; it was delivered afterwards", supports: "seller", weight: 1, sourceRefs: [opened.sourceRef, delivered.sourceRef] });
    }
    if (delivered.facts.signatureObtained) {
      reasons.push({ id: "signature", text: "Signature obtained on delivery", supports: "seller", weight: 1, sourceRefs: [delivered.sourceRef] });
    }
  } else if (last?.facts.eventCode === "RETURNED_TO_SENDER" || last?.facts.eventCode === "EXCEPTION") {
    reasons.push({ id: "not_delivered", text: `Latest carrier scan is "${last.label.split(": ").pop()}", with no delivery`, supports: "buyer", weight: 4, decisive: true, sourceRefs: [last.sourceRef] });
  } else if (last) {
    reasons.push({ id: "in_transit", text: "Package is still moving and not delivered yet", supports: "buyer", weight: 1, sourceRefs: [last.sourceRef] });
  }
  return reasons;
}

function sellerFaultReasons(ev: EvidenceItem[]): Reason[] {
  const admits = ev.filter((e) => e.facts.sellerAdmitsFault);
  return admits.length
    ? [{ id: "seller_admits_fault", text: "Seller's own records acknowledge the problem", supports: "buyer", weight: 4, decisive: true, sourceRefs: admits.map((e) => e.sourceRef) }]
    : [];
}

function reasonsFor(ctx: DisputeContext, ev: EvidenceItem[]): Reason[] {
  const reasons: Reason[] = [...sellerFaultReasons(ev)];
  // The buyer's own words: in the PayPal case, or in the store chat (e.g. a complaint before opening it).
  const buyerMsgs = ev.filter((e) => (e.kind === "dispute_message" && e.facts.postedBy === "BUYER") || (e.kind === "chat" && e.facts.author === "buyer"));

  switch (ctx.reason) {
    case "MERCHANDISE_OR_SERVICE_NOT_RECEIVED":
      reasons.push(...trackingReasons(ctx, ev));
      break;
    case "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED": {
      const listing = ev.filter((e) => e.kind === "listing");
      const photos = ev.filter((e) => e.facts.photosBeforeShipping);
      if (listing.length) reasons.push({ id: "listing_snapshot", text: "Original listing description is on file", supports: "seller", weight: 1, sourceRefs: listing.map((e) => e.sourceRef) });
      if (photos.length) reasons.push({ id: "photos_before_shipping", text: "Photos of the item were taken before shipping", supports: "seller", weight: 2, sourceRefs: photos.map((e) => e.sourceRef) });
      if (buyerMsgs.length) reasons.push({ id: "buyer_describes_issue", text: "Buyer describes what is wrong with the item", supports: "buyer", weight: 1, sourceRefs: buyerMsgs.map((e) => e.sourceRef) });
      break;
    }
    case "UNAUTHORISED": {
      reasons.push(...trackingReasons(ctx, ev).filter((r) => r.id !== "no_tracking" && r.id !== "in_transit"));
      const repeat = ev.filter((e) => (e.facts.buyerPriorOrders ?? 0) > 0);
      if (repeat.length) reasons.push({ id: "repeat_buyer", text: "Same buyer account has completed earlier orders", supports: "seller", weight: 2, sourceRefs: repeat.map((e) => e.sourceRef) });
      break;
    }
    default:
      if (buyerMsgs.length) reasons.push({ id: "buyer_describes_issue", text: "Buyer explains the problem", supports: "buyer", weight: 1, sourceRefs: buyerMsgs.map((e) => e.sourceRef) });
  }
  return reasons;
}

// ---------------------------------------------------------------- priority

export function deadlinePriority(amount: number, dueIso: string | undefined, status: string | undefined, now: Date) {
  if (!dueIso || status === "RESOLVED") return { score: 0, bucket: "none" as const, hoursLeft: null };
  const hoursLeft = hoursUntil(dueIso, now);
  const bucket = bucketOf(hoursLeft);
  return { score: Math.round(amount * urgency("seller", bucket) * 100) / 100, bucket, hoursLeft };
}

// ---------------------------------------------------------------- action mapping

const money = (v: number, currency: string) => ({ value: v.toFixed(2), currency_code: currency });

function planAction(strategy: Strategy, ctx: DisputeContext, cfg: StrategyConfig): PlannedAction | null {
  const can = (a: string) => ctx.allowedActions.includes(a);
  const offerOk = (t: string) => !ctx.allowedOfferTypes || ctx.allowedOfferTypes.includes(t);
  const claimOk = (t: string) => !ctx.allowedAcceptClaimTypes || ctx.allowedAcceptClaimTypes.includes(t);

  if (strategy === "FIGHT") {
    if (can("provide_evidence")) return { kind: "provide_evidence" };
    // A claim already under PayPal review: the seller's evidence goes in as supporting info.
    if (can("provide_supporting_info")) return { kind: "provide_supporting_info" };
    if (can("send_message")) return { kind: "send_message" };
    if (can("escalate")) return { kind: "escalate" };
    return null;
  }
  if (strategy === "OFFER") {
    const partial = money(ctx.amount * cfg.partialOfferRatio, ctx.currency);
    // A partial refund, no return: PayPal requires a return shipping address for REFUND_WITH_RETURN,
    // which this app does not collect, so it never proposes one.
    if (can("make_offer") && offerOk("REFUND")) return { kind: "make_offer", offerType: "REFUND", amount: partial };
    if (can("accept_claim") && claimOk("PARTIAL_REFUND")) return { kind: "accept_claim", acceptClaimType: "PARTIAL_REFUND", amount: partial };
    return null;
  }
  // REFUND
  if (can("accept_claim") && claimOk("REFUND")) return { kind: "accept_claim", acceptClaimType: "REFUND" };
  if (can("make_offer") && offerOk("REFUND")) return { kind: "make_offer", offerType: "REFUND", amount: money(ctx.amount, ctx.currency) };
  return null;
}

/**
 * Every seller action PayPal lists right now, with the reason the rules picked one and passed over the
 * rest. Deterministic: it explains the choice planAction()/assess() already made; it decides nothing.
 */
export function consideredActions(
  allowed: string[],
  strategy: Strategy,
  action: PlannedAction | null,
  wait: WaitKind | undefined,
  buyerFair: boolean,
  unprovable = false,
): ConsideredAction[] {
  const fairRefund = unprovable ? "You can't prove delivery (no tracking on record)" : "The buyer is right";
  const favours = unprovable ? "You can't prove delivery (no tracking on record)" : "The evidence favours the buyer";
  const listed = SELLER_ACTIONS.filter((a) => allowed.includes(a));
  const evidenceKinds = ["provide_evidence", "provide_supporting_info"];
  const chosenWhy = (k: string): string => {
    if (k === "send_message") return wait === "message_first" ? "The package is still on its way: tell the buyer with the tracking first." : "The only fitting step PayPal allows now.";
    if (k === "provide_supporting_info") return "PayPal is already reviewing the claim, so the evidence goes in as supporting info.";
    if (k === "provide_evidence") return "Strong evidence: send the proof PayPal asked for.";
    if (k === "make_offer") return strategy === "REFUND" ? `${fairRefund}: refund in full through an offer.` : "Evidence is mixed: a fair partial refund usually settles it faster.";
    if (k === "accept_claim") return strategy === "OFFER" ? "Evidence is mixed: accept with a partial refund." : buyerFair ? `${favours}: refund.` : "Refunding costs less than fighting.";
    return "Picked by the rules.";
  };
  const skippedWhy = (k: string): string => {
    if (evidenceKinds.includes(k)) {
      if (wait === "awaiting_delivery") return "Held: there is no delivery scan yet, so nothing proves delivery.";
      if (action && evidenceKinds.includes(action.kind)) return "Same evidence, other route: the one above fits this stage.";
      if (strategy === "REFUND") return buyerFair ? `${favours}: nothing honest to send.` : "Not worth it: fighting costs more than the refund.";
      if (strategy === "OFFER") return "Evidence is mixed: a claim could be lost.";
      return "Not needed for this step.";
    }
    if (wait === "message_first" && (k === "accept_claim" || k === "make_offer")) return "Don't pay out yet: the package is on its way; tell the buyer first.";
    if (k === "accept_claim") {
      if (strategy === "FIGHT") return wait === "awaiting_delivery" ? "Don't refund yet: the package is on its way with tracking." : "Refunding would give up a case the evidence supports.";
      if (strategy === "OFFER") return "An offer comes first; a full refund isn't needed.";
      return "Same refund, other route: the one above fits.";
    }
    if (k === "make_offer") return strategy === "FIGHT" ? "No reason to give money back: the evidence supports you." : strategy === "REFUND" ? `${fairRefund}: refund in full, don't bargain.` : "Same offer, other route: the one above fits.";
    if (k === "send_message") return action && evidenceKinds.includes(action.kind) ? "PayPal is deciding: the evidence answers its review, a message doesn't." : "The chosen action already tells the buyer.";
    if (k === "escalate") return "Not needed: the chosen action resolves it without escalating.";
    if (k === "acknowledge_return_item") return "No return was asked for.";
    if (k === "appeal") return "There is no decision to appeal.";
    return "Not part of this plan.";
  };
  return listed.map((k) => (action?.kind === k ? { kind: k, chosen: true, note: chosenWhy(k) } : { kind: k, chosen: false, note: skippedWhy(k) }));
}

// ---------------------------------------------------------------- main

export function assess(ctx: DisputeContext, evidence: EvidenceItem[], now = new Date(), cfg: StrategyConfig = DEFAULT_CONFIG): Assessment {
  const reasons = reasonsFor(ctx, evidence);
  const score = reasons.reduce((s, r) => s + (r.supports === "seller" ? r.weight : -r.weight), 0);
  const decisive = reasons.filter((r) => r.decisive && r.supports === "buyer");
  const buyerFair = decisive.length > 0;
  // No tracking on record: the seller can't prove delivery. That is missing proof, not proof for the buyer.
  const unprovable = buyerFair && decisive.every((r) => r.id === "no_tracking");
  const level: StrengthLevel = buyerFair ? "LOW" : score >= HIGH_AT ? "HIGH" : score >= MEDIUM_AT ? "MEDIUM" : "LOW";
  const costToFight = Math.round((cfg.sellerHourlyValue * cfg.minutesToFight) / 60 * 100) / 100;

  const why: string[] = [];
  let strategy: Strategy;
  if (buyerFair) {
    strategy = "REFUND";
    why.push(
      unprovable
        ? "There is no tracking on record, so you can't prove delivery. A refund is the honest outcome."
        : "The evidence supports the buyer, so a refund is the fair outcome.",
    );
  } else if (level === "HIGH") {
    strategy = "FIGHT";
    why.push("Strong evidence supports the seller.");
  } else if (ctx.amount <= costToFight) {
    strategy = "REFUND";
    const moving = reasons.some((r) => r.id === "in_transit");
    why.push(
      moving
        ? `Tracking is on file and the package is moving, so you could defend this once it's delivered. But at ${ctx.currency} ${ctx.amount.toFixed(2)}, your time (~${ctx.currency} ${costToFight.toFixed(2)}) costs more than the refund.`
        : `At ${ctx.currency} ${ctx.amount.toFixed(2)}, fighting (~${ctx.currency} ${costToFight.toFixed(2)} of your time) costs more than refunding.`,
    );
  } else if (level === "MEDIUM") {
    strategy = "OFFER";
    why.push("Evidence is mixed; a fair offer usually resolves this faster than a claim.");
  } else {
    strategy = "REFUND";
    why.push("Evidence is weak; losing a claim would cost more than refunding now.");
  }
  // Package still moving during an inquiry: the fair first step is to tell the buyer, not refund.
  const inTransit = reasons.some((r) => r.id === "in_transit");
  const messageFirst = inTransit && !buyerFair && ctx.allowedActions.includes("send_message");
  if (messageFirst) {
    strategy = "FIGHT";
    why.unshift("The package is still on its way: tell the buyer with tracking before refunding.");
  }
  // Still moving, but messaging isn't open (e.g. PayPal is already reviewing): refunding a package
  // that is on its way isn't the smart call unless the amount is below the cost to fight.
  const holdForDelivery = inTransit && !buyerFair && !messageFirst && strategy === "REFUND" && ctx.amount > costToFight;
  if (holdForDelivery) {
    strategy = "FIGHT";
    why.splice(0, why.length, "The package is on its way and its tracking is on file: don't refund yet. Defend with the tracking once it's delivered.");
  }

  // Still in transit: nothing to send until it's delivered (the evidence isn't there yet).
  const action = holdForDelivery ? null : messageFirst ? { kind: "send_message" as const } : planAction(strategy, ctx, cfg);
  const open = ctx.status !== "RESOLVED";
  const sellerActions = ctx.allowedActions.filter((a) => SELLER_ACTIONS.includes(a));
  let wait: WaitKind | undefined;
  if (holdForDelivery) {
    wait = "awaiting_delivery";
    why.push(
      ctx.allowedActions.includes("provide_supporting_info") || ctx.allowedActions.includes("provide_evidence")
        ? "PayPal would accept evidence now, but the agent holds it: there is no delivery scan yet, so there's nothing that proves delivery. It will build the evidence once the carrier shows the delivery."
        : "Nothing to send yet: the agent will build the evidence once the carrier shows the delivery.",
    );
  } else if (messageFirst) {
    wait = "message_first";
  } else if (!action) {
    if (open) wait = "no_allowed_action";
    why.push(
      !open
        ? "This case is closed, so there is nothing to submit; this is a hindsight review."
        : sellerActions.length === 0
          ? "PayPal hasn't opened a response window yet: it lists no action you can take on this case. The agent will check again when the dispute changes."
          : "PayPal does not allow this action right now; we will check again when the dispute changes.",
    );
  }

  const evidenceToSubmit: EvidenceToSubmit[] = [];
  if (strategy === "FIGHT") {
    const delivered = evidence.filter((e) => e.kind === "carrier_event" && e.facts.eventCode === "DELIVERED").at(-1);
    const trackRef = delivered ?? evidence.find((e) => e.kind === "paypal_tracking");
    if (trackRef?.facts.carrier && trackRef.facts.trackingNumber) {
      evidenceToSubmit.push({
        evidence_type: "PROOF_OF_FULFILLMENT",
        tracking_info: [{ carrier_name: trackRef.facts.carrier, tracking_number: trackRef.facts.trackingNumber }],
        sourceRefs: [trackRef.sourceRef],
      });
    }
    const supporting = reasons.filter((r) => r.supports === "seller").flatMap((r) => r.sourceRefs);
    if (supporting.length) evidenceToSubmit.push({ evidence_type: "OTHER", sourceRefs: [...new Set(supporting)] });
  }

  return {
    disputeId: ctx.disputeId,
    reason: ctx.reason,
    amount: ctx.amount,
    currency: ctx.currency,
    strength: { level, score, reasons },
    recommendation: {
      strategy,
      action,
      why,
      buyerFair,
      ...(unprovable ? { unprovable } : {}),
      ...(wait ? { wait } : {}),
      ...(open ? { considered: consideredActions(ctx.allowedActions, strategy, action, wait, buyerFair, unprovable) } : {}),
    },
    costToFight,
    priority: deadlinePriority(ctx.amount, ctx.sellerResponseDueDate, ctx.status, now),
    evidenceToSubmit,
  };
}
