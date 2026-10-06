import type { Draft } from "../llm/draft";
import { customDisputeTools, TOOL_ENDPOINTS, type CustomToolName } from "../paypal/disputes";

/**
 * One SubmissionPlan drives both the "What PayPal receives" preview and the real call
 * (runCustomDisputeTool), so the preview can never drift from what is sent.
 */
export interface SubmissionPlan {
  tool: CustomToolName;
  /** Tool arguments exactly as validated by the tool's zod schema (files are added at submit time). */
  args: Record<string, unknown> & { dispute_id: string };
  /** Attach the evidence pack PDF as `evidence-file`. */
  attachPack: boolean;
}

export const PACK_FILENAME = "evidence-pack.pdf";

export function planSubmission(disputeId: string, draft: Draft, packItemCount: number): SubmissionPlan | null {
  const a = draft.action;
  if (!a) return null;
  const note = draft.sellerNote.slice(0, 2000);
  switch (a.kind) {
    case "provide_evidence": {
      const evidences = draft.evidence.map((e, i) => ({
        evidence_type: e.evidence_type,
        ...(e.tracking_info?.length ? { evidence_info: { tracking_info: e.tracking_info } } : {}),
        notes: i === 0 ? note : `Supporting records: see ${PACK_FILENAME} (${packItemCount} sourced items).`,
      }));
      if (!evidences.length) evidences.push({ evidence_type: "OTHER", notes: note });
      return { tool: "provide_dispute_evidence", args: { dispute_id: disputeId, evidences }, attachPack: true };
    }
    case "send_message": {
      const message = (draft.buyerMessage?.text || note).slice(0, 2000);
      return { tool: "send_dispute_message", args: { dispute_id: disputeId, message }, attachPack: false };
    }
    case "make_offer":
      return {
        tool: "make_dispute_offer",
        args: { dispute_id: disputeId, note, offer_type: a.offerType ?? "REFUND", ...(a.amount ? { offer_amount: a.amount } : {}) },
        attachPack: false,
      };
    case "accept_claim":
      return {
        tool: "accept_dispute_claim_with_terms",
        args: { dispute_id: disputeId, note, accept_claim_type: a.acceptClaimType ?? "REFUND", ...(a.acceptClaimType === "PARTIAL_REFUND" && a.amount ? { refund_amount: a.amount } : {}) },
        attachPack: false,
      };
    case "escalate":
      return { tool: "escalate_dispute", args: { dispute_id: disputeId, note }, attachPack: false };
  }
}

/** Throws if the plan would be rejected by our own tool schema (same check the submit path runs). */
export function assertPlanValid(plan: SubmissionPlan): void {
  customDisputeTools[plan.tool].parameters.parse(plan.args);
}

export interface RequestPreview {
  method: "POST";
  endpoint: string;
  encoding: "json" | "multipart";
  /** The JSON body, or the multipart `input` part. */
  input: Record<string, unknown>;
  files: { field: "evidence-file"; filename: string; type: "application/pdf"; bytes?: number }[];
}

export function previewRequest(plan: SubmissionPlan, packBytes?: number): RequestPreview {
  const { dispute_id, ...input } = plan.args;
  const ep = TOOL_ENDPOINTS[plan.tool];
  return {
    method: "POST",
    endpoint: `/v1/customer/disputes/${dispute_id}/${ep.path}`,
    encoding: ep.encoding,
    input,
    files: plan.attachPack ? [{ field: "evidence-file", filename: PACK_FILENAME, type: "application/pdf", ...(packBytes ? { bytes: packBytes } : {}) }] : [],
  };
}
