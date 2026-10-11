import type { EvidenceItem } from "../evidence/types";
import type { Assessment, EvidenceToSubmit, PlannedAction, Strategy } from "../strategy/rules";
import type { TokenUsage } from "../agent/trace";
import type { Lang } from "../lang/detect";

/**
 * Draft = what the seller reviews and approves. `origin` is shown in the UI:
 *   "ai"       → written by Claude (labelled "AI-written")
 *   "template" → written by our deterministic template (labelled "TEMPLATE")
 */
export interface Claim {
  text: string;
  sourceRefs: string[];
}

export interface Draft {
  origin: "ai" | "template";
  model?: string;
  strategy: Strategy;
  action: PlannedAction | null;
  rationale: string;
  claims: Claim[];
  /** Note to PayPal (provide-evidence notes / offer note / accept-claim note). ≤ 2000 chars. */
  sellerNote: string;
  /** Message to the buyer, when the action is send_message or an offer. `language` is an ISO 639-1 code. */
  buyerMessage?: { language: string; text: string; englishGloss?: string };
  /** Set when this AI draft is a replay of a real, earlier Claude run (hosted demo: $0 per visitor). */
  recorded?: { at: string; model: string; input: number; output: number; costUsd: number };
  /** The language the buyer wrote in (detected deterministically), so the UI can flag a mismatch. */
  buyerLanguage?: Lang;
  evidence: EvidenceToSubmit[];
}

export interface DraftInput {
  disputeId: string;
  reason: string;
  amount: number;
  currency: string;
  assessment: Assessment;
  evidence: EvidenceItem[];
  /** Redacted buyer messages, newest last (the LLM uses them for language + tone). */
  buyerMessages: string[];
  sellerTone: "friendly" | "formal";
  /** HATEOAS rels currently allowed on the dispute (the AI may only pick among these). */
  allowedActions: string[];
  /** Detected from buyerMessages; the AI replies in it, the template flags it. */
  buyerLanguage?: Lang;
}

export interface DraftProvider {
  readonly name: string;
  draft(input: DraftInput): Promise<{ draft: Draft; usage?: TokenUsage }>;
}

// ------------------------------------------------------------------ deterministic template

function claimsFor(input: DraftInput): Claim[] {
  const { assessment } = input;
  const side = assessment.recommendation.buyerFair || assessment.recommendation.strategy === "REFUND" ? "buyer" : "seller";
  return assessment.strength.reasons
    .filter((r) => r.supports === side && r.sourceRefs.length)
    .map((r) => ({ text: r.text, sourceRefs: r.sourceRefs }));
}

function noteFor(input: DraftInput, claims: Claim[]): string {
  const { assessment, currency, amount } = input;
  const facts = claims.map((c) => `- ${c.text}.`).join("\n");
  switch (assessment.recommendation.strategy) {
    case "FIGHT":
      return `We fulfilled this order and the records below show it.\n${facts}\nTracking details are attached. We are happy to help the buyer if anything else is needed.`;
    case "OFFER":
      return `We want to resolve this fairly and are offering ${currency} ${(assessment.recommendation.action?.amount?.value ?? amount.toFixed(2))}.\n${facts}`;
    case "REFUND":
      return assessment.recommendation.unprovable
        ? `We have no tracking on record for this order, so we can't prove delivery and are refunding the buyer.\n${facts}`
        : assessment.recommendation.buyerFair
        ? `We reviewed our records and agree the buyer should be refunded.\n${facts}`
        : `We are refunding ${currency} ${amount.toFixed(2)} to resolve this quickly.`;
  }
}

function buyerMessageFor(input: DraftInput): Draft["buyerMessage"] {
  const kind = input.assessment.recommendation.action?.kind;
  if (kind !== "send_message" && kind !== "make_offer") return undefined;
  const tracking = input.assessment.strength.reasons.find((r) => r.id === "in_transit");
  const notAsDescribed = input.assessment.reason === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED";
  const text =
    kind === "make_offer"
      ? "Hi! We're sorry about the trouble with your order. We've sent an offer through PayPal to make this right."
      : notAsDescribed
        ? "Hi! Thanks for letting us know, and sorry about the trouble. Could you send a photo of the problem? We photograph every order before it ships and want to put this right."
        : tracking
          ? "Hi! Thanks for reaching out. Your package is on its way. The latest carrier scan is attached to this case, and we'll keep an eye on it until it arrives."
          : "Hi! Thanks for reaching out. Our records show your order was delivered. Could you check with neighbours or your building's mail room? We're happy to help further.";
  return { language: "en", text };
}

export function templateDraft(input: DraftInput): Draft {
  const claims = claimsFor(input);
  return {
    origin: "template",
    strategy: input.assessment.recommendation.strategy,
    action: input.assessment.recommendation.action,
    rationale: input.assessment.recommendation.why.join(" "),
    claims,
    sellerNote: noteFor(input, claims).slice(0, 2000),
    buyerMessage: buyerMessageFor(input),
    buyerLanguage: input.buyerLanguage,
    evidence: input.assessment.evidenceToSubmit,
  };
}

/** Development / test provider: no network, no cost. Output is labelled TEMPLATE, never "AI". */
export class FakeProvider implements DraftProvider {
  readonly name = "fake";
  constructor(private readonly delayMs = 0) {}

  async draft(input: DraftInput) {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    return { draft: templateDraft(input) };
  }
}
