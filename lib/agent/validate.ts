import type { EvidenceItem } from "../evidence/types";
import type { Draft } from "../llm/draft";
import type { DisputeContext } from "../strategy/rules";
import { protectionBacked } from "./note-sources";

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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const clock = (h: number, m: number) => `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;

/**
 * Prose shown to people (and sent to PayPal) reads like a person wrote it: ISO dates/times become
 * "5 Oct, 6:58 PM UTC", and raw source refs in parentheses ("(capture:5HF8…)") are removed;
 * citations live in the source chips and ids in the PayPal payload.
 */
export function humanizeProse(text: string): string {
  return text
    .replace(/\s*\((?:capture|order|dispute|pptrack|track|store|chat|listing):[^)\s]+\)/g, "")
    .replace(/(?:\bon\s+)?\b(20\d\d)-(\d\d)-(\d\d)(?:(?:T|\s+at\s+|\s+)(\d\d):(\d\d)(?::\d\d(?:\.\d+)?)?(?:Z|\s*UTC)?)?/g, (m, _y, mo, d, h, mi) => {
      const on = /^on\s/i.test(m) ? "on " : "";
      const day = `${Number(d)} ${MONTHS[Number(mo) - 1]}`;
      return h ? `${on}${day}, ${clock(Number(h), Number(mi))} UTC` : `${on}${day}`;
    })
    .replace(MONTH_DAY, (_m, mon: string, d: string) => `${Number(d)} ${MONTHS[MONTH_INDEX[mon.slice(0, 3).toLowerCase()]]}`)
    .replace(/\b(\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))(?:,? 20\d\d)?,?\s+at\s+(\d{1,2}:\d\d\s*[AP]M)/g, "$1, $2")
    .replace(/\b(\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)),? 20\d\d\b/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
}

const MONTH_INDEX: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// "October 5th", "Oct 5", "October 5, 2026" (English only; other languages keep their own style)
const MONTH_DAY = /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.? (\d{1,2})(?:st|nd|rd|th)?\b/g;

export interface ValidationIssue {
  code: "ai_fallback" | "policy_claim" | "unknown_source" | "uncited_claim" | "action_not_allowed" | "amount_exceeds_dispute" | "unknown_tracking" | "note_too_long";
  message: string;
}

const ACTION_LINK: Record<string, string> = {
  provide_evidence: "provide_evidence",
  provide_supporting_info: "provide_supporting_info",
  make_offer: "make_offer",
  accept_claim: "accept_claim",
  send_message: "send_message",
  escalate: "escalate",
};

export function validateDraft(draft: Draft, evidence: EvidenceItem[], ctx: DisputeContext): { draft: Draft; issues: ValidationIssue[]; ok: boolean } {
  const issues: ValidationIssue[] = [];
  const refs = new Set(evidence.map((e) => e.sourceRef));

  const policy = (where: string, removed: string[]) => removed.forEach((r) => issues.push({ code: "policy_claim", message: `Removed a policy/legal outcome from the ${where}: "${r}"` }));
  draft = {
    ...draft,
    sellerNote: humanizeProse(draft.sellerNote),
    rationale: humanizeProse(draft.rationale),
    claims: draft.claims.map((c) => ({ ...c, text: humanizeProse(c.text) })),
    buyerMessage: draft.buyerMessage && { ...draft.buyerMessage, text: humanizeProse(draft.buyerMessage.text), englishGloss: draft.buyerMessage.englishGloss && humanizeProse(draft.buyerMessage.englishGloss) },
  };
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

  // Seller Protection may only be mentioned when PayPal's capture record says ELIGIBLE.
  const unbacked = (t: string) => {
    if (protectionBacked(evidence)) return { text: t, removed: [] as string[] };
    const removed: string[] = [];
    const kept = t
      .split(/(?<=[.!?])\s+/)
      .filter((x) => (/seller protection/i.test(x) ? (removed.push(x.trim()), false) : true))
      .join(" ");
    removed.forEach((r) => issues.push({ code: "policy_claim", message: `Removed a Seller Protection statement PayPal's record doesn't back: "${r}"` }));
    return { text: kept, removed };
  };
  const noteClean = stripPolicyClaims(unbacked(draft.sellerNote).text);
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
