import Anthropic from "@anthropic-ai/sdk";
import type { TokenUsage } from "../agent/trace";
import { redactText } from "../redact";
import type { ActionKind, PlannedAction, Strategy } from "../strategy/rules";
import type { Draft, DraftInput, DraftProvider } from "./draft";

/**
 * Claude draft provider (PLAN §5, call #1). One request, one forced tool call with a strict schema.
 * Claude only writes text and picks among options the rules and PayPal already allow:
 *  - `action` is an enum of the HATEOAS-allowed actions (+ "none")
 *  - every claim's `source_refs` is an enum of the gathered evidence refs, so a citation to
 *    evidence we don't have can't even be expressed; validateDraft() re-checks anyway
 *  - the evidence to submit (tracking numbers) comes from the rules, never from the model
 * Inputs are redacted. Token usage is returned for logging and the trace.
 */
export const CLAUDE_MODEL = process.env.DD_CLAUDE_MODEL ?? "claude-haiku-4-5-20251001";
/** Haiku 4.5 list price, USD per token. */
const PRICE = { input: 1 / 1_000_000, output: 5 / 1_000_000 };
export const costUsd = (input: number, output: number) => Math.round((input * PRICE.input + output * PRICE.output) * 1e6) / 1e6;

const ACTIONS: ActionKind[] = ["provide_evidence", "make_offer", "accept_claim", "send_message", "escalate"];
const OFFER_TYPES = ["REFUND", "REFUND_WITH_RETURN", "REFUND_WITH_REPLACEMENT", "REPLACEMENT_WITHOUT_REFUND"] as const;

export interface DraftToolInput {
  strategy: Strategy;
  action: ActionKind | "none";
  offer_type: (typeof OFFER_TYPES)[number] | "none";
  amount: string;
  rationale: string;
  claims: { text: string; source_refs: string[] }[];
  seller_note_to_paypal: string;
  buyer_message: { language: string; text: string; english_gloss: string };
}

export function draftTool(allowed: string[], refs: string[]): Anthropic.Tool {
  const actions = [...ACTIONS.filter((a) => allowed.includes(a)), "none"];
  return {
    name: "draft_response",
    description: "Draft the seller's response to a PayPal dispute. Cite only the given source refs. Never invent facts.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["strategy", "action", "offer_type", "amount", "rationale", "claims", "seller_note_to_paypal", "buyer_message"],
      properties: {
        strategy: { type: "string", enum: ["FIGHT", "OFFER", "REFUND"] },
        action: { type: "string", enum: actions, description: "PayPal action to take next; only these are allowed right now." },
        offer_type: { type: "string", enum: [...OFFER_TYPES, "none"], description: "Only for make_offer; otherwise none." },
        amount: { type: "string", description: 'Decimal amount like "12.50" for make_offer / partial refund, else "".' },
        rationale: { type: "string", description: "One or two sentences for the seller: why this action." },
        claims: {
          type: "array",
          description: "Factual claims for PayPal, each citing at least one source ref.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["text", "source_refs"],
            properties: {
              text: { type: "string" },
              source_refs: { type: "array", items: { type: "string", enum: refs } },
            },
          },
        },
        seller_note_to_paypal: { type: "string", description: "Note to PayPal, max 2000 characters, plain and factual." },
        buyer_message: {
          type: "object",
          additionalProperties: false,
          required: ["language", "text", "english_gloss"],
          properties: {
            language: { type: "string", description: "ISO 639-1 code of the buyer's language." },
            text: { type: "string", description: 'Message to the buyer in the buyer\'s language, or "" if none is needed.' },
            english_gloss: { type: "string", description: 'English translation for the seller, or "" if the text is English or empty.' },
          },
        },
      },
    },
  };
}

export const SYSTEM_PROMPT = `You help a small online seller respond to a PayPal dispute.
Rules:
- Only state facts that appear in the evidence list, and cite each claim with its source ref(s).
- Never invent evidence, tracking events, dates or promises. If evidence is missing, say less.
- Be fair to the buyer: if the evidence shows the buyer is right, recommend a refund. Never pressure the buyer.
- Prefer the rules engine's recommendation unless the evidence clearly supports a different allowed action.
- Write the buyer message in the buyer's language (given), warm and brief, plus an English gloss for the seller.
- The note to PayPal is plain, factual English, under 2000 characters.
- Write dates and times for people, like "5 Oct, 6:58 PM UTC" (never ISO formats), and never put source refs or ids in parentheses in your prose: citations go only in source_refs.
- Never state a policy or legal outcome: do not say Seller Protection applies or covers this, that the seller will win, or what PayPal must do. PayPal decides. You may say "eligible for Seller Protection per PayPal's record" when the evidence shows ELIGIBLE.
Respond only by calling the draft_response tool.`;

export function userPrompt(input: DraftInput, allowed: string[]): string {
  const a = input.assessment;
  const payload = {
    dispute: { id: input.disputeId, reason: input.reason, amount: `${input.currency} ${input.amount.toFixed(2)}` },
    allowed_actions: allowed,
    rules_recommendation: {
      strategy: a.recommendation.strategy,
      action: a.recommendation.action,
      buyer_is_right: a.recommendation.buyerFair,
      evidence_strength: a.strength.level,
      reasons: a.strength.reasons.map((r) => ({ text: r.text, supports: r.supports, source_refs: r.sourceRefs })),
      cost_to_fight: `${input.currency} ${a.costToFight.toFixed(2)}`,
    },
    evidence: input.evidence.map((e) => ({ ref: e.sourceRef, label: e.label, text: redactText(e.text), at: e.at ?? null })),
    buyer_messages: input.buyerMessages.map(redactText),
    buyer_language: input.buyerLanguage ?? { code: "en", name: "English" },
    seller_tone: input.sellerTone,
  };
  return `Draft the response for this dispute.\n\n${JSON.stringify(payload, null, 1)}`;
}

/** Map the tool output onto our Draft shape. Validation (validateDraft) runs after this. */
export function toDraft(out: DraftToolInput, input: DraftInput, model: string): Draft {
  let action: PlannedAction | null = null;
  const amount = /^\d+(\.\d{1,2})?$/.test(out.amount) ? { value: Number(out.amount).toFixed(2), currency_code: input.currency } : undefined;
  if (out.action === "make_offer") action = { kind: "make_offer", offerType: out.offer_type === "none" ? "REFUND" : out.offer_type, amount };
  else if (out.action === "accept_claim") action = amount && Number(amount.value) < input.amount ? { kind: "accept_claim", acceptClaimType: "PARTIAL_REFUND", amount } : { kind: "accept_claim", acceptClaimType: "REFUND" };
  else if (out.action !== "none") action = { kind: out.action };
  const msg = out.buyer_message;
  return {
    origin: "ai",
    model,
    strategy: out.strategy,
    action,
    rationale: out.rationale,
    claims: out.claims.map((c) => ({ text: c.text, sourceRefs: c.source_refs })),
    sellerNote: out.seller_note_to_paypal,
    buyerMessage: msg.text ? { language: msg.language, text: msg.text, englishGloss: msg.english_gloss || undefined } : undefined,
    buyerLanguage: input.buyerLanguage,
    evidence: input.assessment.evidenceToSubmit,
  };
}

type MessagesClient = { messages: Pick<Anthropic["messages"], "create"> };

export interface ClaudeProviderOptions {
  client: MessagesClient;
  model?: string;
  /** Throws to refuse the call (daily cap). */
  beforeCall?: () => void;
  /** Called with token usage after every call (persist to llm_calls). */
  afterCall?: (usage: TokenUsage) => void;
}

export class ClaudeProvider implements DraftProvider {
  readonly name = "claude";
  private readonly model: string;
  constructor(private readonly opts: ClaudeProviderOptions) {
    this.model = opts.model ?? CLAUDE_MODEL;
  }

  async draft(input: DraftInput): Promise<{ draft: Draft; usage: TokenUsage }> {
    this.opts.beforeCall?.();
    const allowedActions = input.allowedActions;
    const refs = input.evidence.map((e) => e.sourceRef);
    const res = await this.opts.client.messages.create({
      model: this.model,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      tools: [draftTool(allowedActions, refs)],
      tool_choice: { type: "tool", name: "draft_response" },
      messages: [{ role: "user", content: userPrompt(input, allowedActions) }],
    });
    const usage: TokenUsage = { model: this.model, input: res.usage.input_tokens, output: res.usage.output_tokens, costUsd: costUsd(res.usage.input_tokens, res.usage.output_tokens) };
    this.opts.afterCall?.(usage);
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "draft_response");
    if (res.stop_reason === "max_tokens" || !block) throw new ClaudeDraftError(`No complete draft_response tool call (stop_reason ${res.stop_reason})`, usage);
    return { draft: toDraft(block.input as DraftToolInput, input, this.model), usage };
  }
}

/** Carries usage so the trace can still report tokens spent on a failed draft. */
export class ClaudeDraftError extends Error {
  constructor(
    message: string,
    readonly usage: TokenUsage,
  ) {
    super(message);
    this.name = "ClaudeDraftError";
  }
}
