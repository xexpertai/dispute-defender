import { fromCarrierTracking, fromDispute, fromOrder, fromPayPalTrackers, type CarrierAdapter } from "../evidence/sources";
import type { EvidenceItem } from "../evidence/types";
import { captureIdOf, clockOf, invoiceOf, reasonLabel, stageLabel, toContext } from "../disputes/model";
import { templateDraft, type Draft, type DraftInput, type DraftProvider } from "../llm/draft";
import type { StoreAdapter } from "../samples/store";
import { assess, type Assessment } from "../strategy/rules";
import type { DisputeGateway } from "./gateway";
import { STEPS, stepNumber, type PayPalCallBadge, type StepKey, type TokenUsage, type TraceEvent } from "./trace";
import { validateDraft } from "./validate";
import { scrub } from "../log/scrub";
import { detectLanguage } from "../lang/detect";

/**
 * The agent loop (PLAN §5). Code gathers evidence and applies the rules; the provider only drafts
 * text (FakeProvider in M2 → a TEMPLATE draft, zero tokens). Every step is streamed as a numbered
 * trace event with the PayPal calls it made. Nothing is ever submitted here: the run stops at
 * "Wait for your approval".
 */
export interface AgentDeps {
  gateway: DisputeGateway;
  carrier: CarrierAdapter;
  store: StoreAdapter;
  provider: DraftProvider;
  /** Optional pause before a step completes (Replay pacing so people can follow the trace). */
  pace?: (key: StepKey) => Promise<void>;
  runId?: string;
  sellerTone?: "friendly" | "formal";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const STRATEGY_TEXT: Record<Assessment["recommendation"]["strategy"], string> = {
  FIGHT: "defend with evidence",
  OFFER: "make a fair offer",
  REFUND: "refund the buyer",
};

const ACTION_TEXT: Record<string, string> = {
  provide_evidence: "provide evidence",
  send_message: "message the buyer",
  make_offer: "make an offer",
  accept_claim: "accept and refund",
  escalate: "escalate to PayPal",
};

export async function* runAgent(disputeId: string, deps: AgentDeps): AsyncGenerator<TraceEvent> {
  const { gateway } = deps;
  const runId = deps.runId ?? `run_${Date.now().toString(36)}`;
  const clockNow = () => new Date().toISOString();
  const t0 = Date.now();
  const totals = { paypalCalls: 0, llmCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };

  let stepStart = 0;
  const start = (key: StepKey): TraceEvent => {
    stepStart = Date.now();
    return { v: 1, type: "step", runId, step: stepNumber(key), key, title: STEPS[stepNumber(key) - 1].title, status: "running", at: clockNow() };
  };
  const finish = async (
    key: StepKey,
    detail: string,
    extra: { paypal?: PayPalCallBadge[]; sourceRefs?: string[]; tokens?: TokenUsage; status?: "done" | "skipped" | "waiting" | "error" } = {},
  ): Promise<TraceEvent> => {
    if (deps.pace) await deps.pace(key);
    totals.paypalCalls += extra.paypal?.length ?? 0;
    return {
      v: 1,
      type: "step",
      runId,
      step: stepNumber(key),
      key,
      title: STEPS[stepNumber(key) - 1].title,
      status: extra.status ?? "done",
      detail,
      ...(extra.paypal?.length ? { paypal: extra.paypal } : {}),
      ...(extra.sourceRefs?.length ? { sourceRefs: extra.sourceRefs } : {}),
      ...(extra.tokens ? { tokens: extra.tokens } : {}),
      ms: Date.now() - stepStart,
      at: clockNow(),
    };
  };
  const fail = (message: string): TraceEvent => ({ v: 1, type: "error", runId, message, at: clockNow() });
  const finished = (): TraceEvent => ({ v: 1, type: "run_finished", runId, ms: Date.now() - t0, totals: { ...totals }, at: clockNow() });

  yield { v: 1, type: "run_started", runId, disputeId, mode: gateway.mode, at: clockNow() };

  try {
    // 1. Read the dispute
    yield start("fetch_dispute");
    const { data: dispute, calls: disputeCalls } = await gateway.getDispute(disputeId);
    if (!dispute) {
      yield await finish("fetch_dispute", `PayPal has no dispute ${disputeId}`, { paypal: disputeCalls, status: "error" });
      yield fail(`Dispute ${disputeId} not found`);
      yield finished();
      return;
    }
    const disputeEv = fromDispute(dispute);
    const soFar = (...groups: EvidenceItem[][]): TraceEvent => ({ v: 1, type: "evidence", runId, items: groups.flat() });
    const clock = clockOf(dispute);
    yield await finish(
      "fetch_dispute",
      `${reasonLabel(dispute.reason)} · ${dispute.dispute_amount?.currency_code ?? ""} ${dispute.dispute_amount?.value ?? "?"} · ${stageLabel(dispute.dispute_life_cycle_stage)} · ${clock.label}`,
      { paypal: disputeCalls, sourceRefs: [disputeEv[0].sourceRef] },
    );
    yield soFar(disputeEv);

    // 2. Order + payment
    yield start("gather_order");
    const captureId = captureIdOf(dispute);
    let orderEv: EvidenceItem[] = [];
    if (captureId) {
      const { data: order, calls } = await gateway.findOrderByCapture(captureId);
      orderEv = order ? fromOrder(order) : [];
      const o = orderEv.find((e) => e.kind === "order");
      yield await finish("gather_order", o ? `${o.text}` : `No order found for payment ${captureId}`, { paypal: calls, sourceRefs: orderEv.map((e) => e.sourceRef) });
    } else {
      yield await finish("gather_order", "The dispute names no seller transaction", { status: "skipped" });
    }
    yield soFar(disputeEv, orderEv);

    // 3. Tracking: only numbers registered with PayPal for this payment are looked up at the carrier.
    yield start("gather_tracking");
    let trackingEv: EvidenceItem[] = [];
    let trackingCalls: PayPalCallBadge[] = [];
    const scanSummaries: string[] = [];
    if (captureId) {
      const { data: trackers, calls } = await gateway.getTrackers(captureId);
      trackingCalls = calls;
      trackingEv = fromPayPalTrackers(trackers);
      for (const t of trackers) {
        const scans = await deps.carrier.track(t.carrier, t.tracking_number);
        if (!scans) {
          scanSummaries.push(`${t.carrier} has no record of ${t.tracking_number}`);
          continue;
        }
        // A carrier can't report the future: drop sample scans dated after the app clock.
        const asOf = gateway.now().toISOString();
        const items = fromCarrierTracking({ ...scans, events: scans.events.filter((e) => e.at <= asOf) });
        trackingEv.push(...items);
        const last = items.at(-1);
        if (last) scanSummaries.push(`${plural(items.length, "scan")}, latest: ${last.label.replace(`${t.carrier} scan: `, "")}`);
      }
    }
    const ppCount = trackingEv.filter((e) => e.kind === "paypal_tracking").length;
    yield await finish(
      "gather_tracking",
      ppCount ? `${plural(ppCount, "tracking number")} on file at PayPal · ${scanSummaries.join("; ") || "no carrier scans"}` : "No tracking on file at PayPal for this payment",
      { paypal: trackingCalls, sourceRefs: trackingEv.map((e) => e.sourceRef), ...(captureId ? {} : { status: "skipped" as const }) },
    );
    yield soFar(disputeEv, orderEv, trackingEv);

    // 4. Seller's own store + chat logs
    yield start("gather_logs");
    const invoice = invoiceOf(dispute);
    // Like carrier scans, the seller's records can't be from the future relative to the app clock.
    const storeEv = (invoice ? await deps.store.evidenceFor(invoice) : []).filter((e) => !e.at || e.at <= gateway.now().toISOString());
    const logLines = storeEv.filter((e) => e.kind === "store_log").length;
    const chatLines = storeEv.filter((e) => e.kind === "chat").length;
    const logParts = [logLines && plural(logLines, "store log line"), chatLines && plural(chatLines, "chat line"), storeEv.some((e) => e.kind === "listing") && "listing snapshot"].filter(Boolean);
    yield await finish("gather_logs", logParts.length ? logParts.join(", ") : "No store records for this order", { sourceRefs: storeEv.map((e) => e.sourceRef) });

    const evidence = [...disputeEv, ...orderEv, ...trackingEv, ...storeEv];
    yield soFar(evidence);

    // 5. Rules
    yield start("assess");
    const ctx = toContext(dispute);
    const assessment = assess(ctx, evidence, gateway.now());
    const rec = assessment.recommendation;
    yield await finish(
      "assess",
      `Evidence ${assessment.strength.level.toLowerCase()} · recommend: ${STRATEGY_TEXT[rec.strategy]}${rec.action ? ` (${ACTION_TEXT[rec.action.kind] ?? rec.action.kind})` : ""}${rec.buyerFair ? " · buyer is right" : ""}`,
      { sourceRefs: [...new Set(assessment.strength.reasons.flatMap((r) => r.sourceRefs))] },
    );
    yield { v: 1, type: "assessment", runId, assessment };

    // 6. Draft
    yield start("draft");
    const buyerMessages = evidence.filter((e) => (e.kind === "dispute_message" && e.facts.postedBy === "BUYER") || (e.kind === "chat" && e.facts.author === "buyer")).map((e) => e.text);
    const draftInput: DraftInput = {
      disputeId,
      reason: ctx.reason,
      amount: ctx.amount,
      currency: ctx.currency,
      assessment,
      evidence,
      buyerMessages,
      buyerLanguage: detectLanguage(buyerMessages),
      allowedActions: ctx.allowedActions,
      sellerTone: deps.sellerTone ?? "friendly",
    };
    let draft: Draft;
    let usage: TokenUsage | undefined;
    let fallbackReason: string | undefined;
    try {
      ({ draft, usage } = await deps.provider.draft(draftInput));
    } catch (err) {
      usage = (err as { usage?: TokenUsage }).usage;
      fallbackReason = `AI draft unavailable (${scrub(err instanceof Error ? err.message : "error").slice(0, 160)})`;
      draft = templateDraft(draftInput);
    }
    if (usage) {
      totals.llmCalls += 1;
      totals.inputTokens += usage.input;
      totals.outputTokens += usage.output;
      totals.costUsd += usage.costUsd;
    }
    yield await finish(
      "draft",
      fallbackReason
        ? `${fallbackReason} · using the TEMPLATE draft`
        : draft.recorded
          ? `AI-written draft, recorded from a real ${draft.recorded.model} run on ${draft.recorded.at.slice(0, 10)} (${draft.recorded.input + draft.recorded.output} tokens, $${draft.recorded.costUsd.toFixed(4)} then; $0 now)`
          : draft.origin === "ai"
          ? `AI-written draft (${usage?.model ?? draft.model ?? "model"}, ${usage ? `${usage.input + usage.output} tokens, $${usage.costUsd.toFixed(4)}` : "no usage"})`
          : `TEMPLATE draft from the rules (${deps.provider.name} provider, no AI call)`,
      { tokens: usage, ...(fallbackReason ? { status: "done" as const } : {}) },
    );

    // 7. Validate every claim against its source. A blocked AI draft falls back to the TEMPLATE.
    yield start("validate");
    let checked = validateDraft(draft, evidence, ctx);
    if (draft.origin === "ai" && (!checked.ok || (draft.claims.length > 0 && checked.draft.claims.length === 0))) {
      const reasons = checked.issues.map((i) => i.message).join("; ");
      fallbackReason = `AI draft failed validation (${reasons || "no supported claims"})`;
      const t = validateDraft(templateDraft(draftInput), evidence, ctx);
      checked = { ...t, issues: [{ code: "ai_fallback", message: fallbackReason }, ...checked.issues, ...t.issues] };
    }
    const dropped = checked.issues.filter((i) => i.code === "unknown_source" || i.code === "uncited_claim").length;
    yield await finish(
      "validate",
      `${plural(checked.draft.claims.length, "claim")} cited and verified${dropped ? ` · ${dropped} dropped` : ""}${checked.ok ? "" : " · action blocked"}${fallbackReason && draft.origin === "ai" ? " · AI draft rejected, TEMPLATE used" : ""}`,
      { sourceRefs: [...new Set(checked.draft.claims.flatMap((c) => c.sourceRefs))] },
    );

    // 8. Package
    yield start("package");
    const packRefs = [...new Set([...checked.draft.claims.flatMap((c) => c.sourceRefs), ...checked.draft.evidence.flatMap((e) => e.sourceRefs)])];
    const trackingNumbers = checked.draft.evidence.flatMap((e) => e.tracking_info ?? []).length;
    yield await finish("package", `Evidence pack: ${plural(packRefs.length, "sourced item")}${trackingNumbers ? `, ${plural(trackingNumbers, "tracking number")}` : ""}`, { sourceRefs: packRefs });
    yield { v: 1, type: "draft", runId, draftId: `${runId}_d1`, origin: checked.draft.origin, draft: checked.draft, issues: checked.issues, packRefs, ...(fallbackReason ? { fallbackReason } : {}) };

    // 9. Approval gate
    yield start("await_approval");
    if (clock.owner === "closed") {
      yield await finish("await_approval", `Case closed (${dispute.dispute_outcome?.outcome_code ?? "RESOLVED"}). Nothing to submit; this is a hindsight review.`, { status: "skipped" });
    } else if (!checked.draft.action) {
      yield await finish("await_approval", "PayPal allows no matching action right now. The agent will check again when the dispute changes.", { status: "skipped" });
    } else {
      yield await finish("await_approval", `Ready for you to review: ${ACTION_TEXT[checked.draft.action.kind] ?? checked.draft.action.kind}. Nothing is sent without your approval.`, { status: "waiting" });
    }
  } catch (err) {
    yield fail(scrub(err instanceof Error ? err.message : "Agent run failed"));
  }
  yield finished();
}
