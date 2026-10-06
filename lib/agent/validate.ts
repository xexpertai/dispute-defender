import type { EvidenceItem } from "../evidence/types";
import type { Draft } from "../llm/draft";
import type { DisputeContext } from "../strategy/rules";

/**
 * Server-side checks on any draft (AI or template) before a seller can approve it:
 * - every claim cites at least one sourceRef that exists in the gathered evidence (else dropped)
 * - the action is one PayPal currently allows (HATEOAS)
 * - offers / partial refunds never exceed the disputed amount
 * - tracking submitted as evidence must come from gathered tracking items
 * - PayPal text limits (notes ≤ 2000 chars)
 * - no policy or legal outcome stated as fact ("Seller Protection applies", "you will win",
 *   "PayPal must…"): PayPal decides; we only report what its records say ("eligible for Seller
 *   Protection per PayPal's record" is fine). Offending sentences are removed; such claims dropped.
 */
export const POLICY_CLAIMS: RegExp[] = [
  /\b(seller|purchase|buyer)\s+protection\s+(applies|apply|covers?|will\s+(apply|cover|protect)|is\s+guaranteed|protects)\b/i,
  /\b(strong|full|clear)\s+(seller|purchase|buyer)\s+protection\b/i,
  /\b(you|we|the\s+seller)\s+(will|are\s+going\s+to|is\s+going\s+to|should)\s+win\b/i,
  /\b(will|is\s+going\s+to)\s+be\s+(won|decided|resolved)\s+in\s+(your|our|the\s+seller'?s)\s+favou?r\b/i,
  /\bpaypal\s+(must|has\s+to|is\s+(required|obligated)\s+to|will\s+(rule|side|decide))\b/i,
  /\bguarantee[sd]?\b/i,
  /\b(you\s+are|we\s+are|the\s+seller\s+is)\s+(fully\s+)?(protected|covered)\b/i,
  /\b(legally\s+(entitled|required|obliged)|by\s+law)\b/i,
];

export const findPolicyClaim = (text: string) => POLICY_CLAIMS.map((r) => text.match(r)?.[0]).find(Boolean);

/** Removes sentences that state a policy/legal outcome; returns the cleaned text and what was removed. */
export function stripPolicyClaims(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const kept = text
    .split(/(?<=[.!?])(\s+)/)
    .filter((part) => {
      if (/^\s+$/.test(part)) return true;
      const hit = findPolicyClaim(part);
      if (hit) removed.push(part.trim());
      return !hit;
    })
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^\s+|\s+$/g, "");
  return { text: kept, removed };
}
export interface ValidationIssue {
  code: "ai_fallback" | "policy_claim" | "unknown_source" | "uncited_claim" | "action_not_allowed" | "amount_exceeds_dispute" | "unknown_tracking" | "note_too_long";
  message: string;
}

const ACTION_LINK: Record<string, string> = {
  provide_evidence: "provide_evidence",
  make_offer: "make_offer",
  accept_claim: "accept_claim",
  send_message: "send_message",
  escalate: "escalate",
};

export function validateDraft(draft: Draft, evidence: EvidenceItem[], ctx: DisputeContext): { draft: Draft; issues: ValidationIssue[]; ok: boolean } {
  const issues: ValidationIssue[] = [];
  const refs = new Set(evidence.map((e) => e.sourceRef));

  const policy = (where: string, removed: string[]) => removed.forEach((r) => issues.push({ code: "policy_claim", message: `Removed a policy/legal outcome from the ${where}: "${r}"` }));
  const claims = draft.claims.filter((c) => {
    const hit = findPolicyClaim(c.text);
    if (hit) {
      issues.push({ code: "policy_claim", message: `Dropped claim stating a policy outcome ("${hit}"): "${c.text}"` });
      return false;
    }
    const unknown = c.sourceRefs.filter((r) => !refs.has(r));
    if (unknown.length) {
      issues.push({ code: "unknown_source", message: `Dropped claim citing unknown source ${unknown.join(", ")}: "${c.text}"` });
      return false;
    }
    if (!c.sourceRefs.length) {
      issues.push({ code: "uncited_claim", message: `Dropped claim without a source: "${c.text}"` });
      return false;
    }
    return true;
  });

  let action = draft.action;
  if (action && !ctx.allowedActions.includes(ACTION_LINK[action.kind])) {
    issues.push({ code: "action_not_allowed", message: `PayPal does not currently allow ${action.kind} on this dispute` });
    action = null;
  }
  if (action?.amount && Number(action.amount.value) > ctx.amount + 1e-9) {
    issues.push({ code: "amount_exceeds_dispute", message: `Amount ${action.amount.value} exceeds the disputed ${ctx.amount.toFixed(2)}` });
    action = null;
  }

  const knownTracking = new Set(evidence.filter((e) => e.facts.trackingNumber).map((e) => `${e.facts.carrier}:${e.facts.trackingNumber}`));
  const evidenceOut = draft.evidence
    .map((e) => {
      const tracking = e.tracking_info?.filter((t) => knownTracking.has(`${t.carrier_name}:${t.tracking_number}`));
      if (e.tracking_info && tracking?.length !== e.tracking_info.length) {
        issues.push({ code: "unknown_tracking", message: "Removed tracking numbers that were not found in gathered evidence" });
      }
      return { ...e, tracking_info: tracking, sourceRefs: e.sourceRefs.filter((r) => refs.has(r)) };
    })
    .filter((e) => (e.tracking_info?.length ?? 0) > 0 || e.evidence_type === "OTHER");

  const noteClean = stripPolicyClaims(draft.sellerNote);
  policy("note to PayPal", noteClean.removed);
  const rationaleClean = stripPolicyClaims(draft.rationale);
  policy("rationale", rationaleClean.removed);
  let buyerMessage = draft.buyerMessage;
  if (buyerMessage) {
    const t = stripPolicyClaims(buyerMessage.text);
    const g = buyerMessage.englishGloss ? stripPolicyClaims(buyerMessage.englishGloss) : null;
    policy("buyer message", [...t.removed, ...(g?.removed ?? [])]);
    buyerMessage = { ...buyerMessage, text: t.text, ...(g ? { englishGloss: g.text } : {}) };
  }
  let sellerNote = noteClean.text;
  if (sellerNote.length > 2000) {
    issues.push({ code: "note_too_long", message: "Seller note trimmed to PayPal's 2000-character limit" });
    sellerNote = sellerNote.slice(0, 2000);
  }

  const blocking = issues.some((i) => i.code === "action_not_allowed" || i.code === "amount_exceeds_dispute") || !sellerNote.trim();
  return { draft: { ...draft, claims, action, evidence: evidenceOut, sellerNote, rationale: rationaleClean.text, buyerMessage }, issues, ok: !blocking };
}
