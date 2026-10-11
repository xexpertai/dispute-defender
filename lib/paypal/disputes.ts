import { z } from "zod";
import type { PayPalClient } from "./client";
import { assertAllowed, type DisputeAction, type HasLinks } from "./links";

/**
 * Dispute actions the PayPal Agent Toolkit does not ship (it has list/get/accept-claim only).
 * Each is defined in the toolkit's tool shape ({method, name, description, parameters}) so the
 * agent sees one uniform tool set. Every action re-reads the dispute and passes the HATEOAS gate
 * before writing.
 */

export const Money = z.object({
  currency_code: z.string().length(3),
  value: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

const id = z.string().regex(/^[A-Za-z0-9_-]{1,255}$/);

export const EVIDENCE_TYPES = [
  "PROOF_OF_FULFILLMENT",
  "PROOF_OF_REFUND",
  "PROOF_OF_DELIVERY_SIGNATURE",
  "PROOF_OF_RECEIPT_COPY",
  "RETURN_POLICY",
  "ITEM_DESCRIPTION",
  "PROOF_OF_SHIPMENT_POSTAGE",
  "ONLINE_TRACKING_INFORMATION",
  "DELIVERY_RECEIPT",
  "PHOTOS_OF_SHIPPED_ITEM",
  "ORDER_DETAILS",
  "LISTING_URL",
  "OTHER",
] as const;

const Evidence = z.object({
  evidence_type: z.enum(EVIDENCE_TYPES),
  evidence_info: z
    .object({
      tracking_info: z.array(z.object({ carrier_name: z.string(), tracking_number: z.string() })).optional(),
      refund_ids: z.array(z.object({ refund_id: z.string() })).optional(),
    })
    .optional(),
  notes: z.string().max(2000).optional(),
});

export const EvidenceFile = z.object({
  filename: z.string(),
  type: z.enum(["application/pdf", "image/png", "image/jpeg", "image/gif"]),
  data: z.instanceof(Uint8Array),
});

/** PayPal limits (docs, 2026-10): < 10 MB per file, <= 50 MB per call. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_CALL_BYTES = 50 * 1024 * 1024;

export const customDisputeTools = {
  provide_dispute_evidence: {
    method: "provide_dispute_evidence",
    name: "Provide dispute evidence",
    description: "Submit seller evidence (tracking, refund ids, notes, files) for a dispute awaiting the seller.",
    parameters: z.object({ dispute_id: id, evidences: z.array(Evidence).min(1), files: z.array(EvidenceFile).optional() }),
    action: "provide_evidence",
  },
  provide_dispute_supporting_info: {
    method: "provide_dispute_supporting_info",
    name: "Provide dispute supporting info",
    description: "Add the seller's notes and documents to a claim that PayPal is already reviewing (UNDER_REVIEW).",
    parameters: z.object({ dispute_id: id, notes: z.string().min(1).max(2000), files: z.array(EvidenceFile).optional() }),
    action: "provide_supporting_info",
  },
  make_dispute_offer: {
    method: "make_dispute_offer",
    name: "Make dispute offer",
    description: "Offer the buyer a refund (full/partial, with return or replacement) to resolve an INQUIRY-stage dispute.",
    parameters: z.object({
      dispute_id: id,
      note: z.string().min(1).max(2000),
      offer_type: z.enum(["REFUND", "REFUND_WITH_RETURN", "REFUND_WITH_REPLACEMENT", "REPLACEMENT_WITHOUT_REFUND"]),
      offer_amount: Money.optional(),
    }),
    action: "make_offer",
  },
  send_dispute_message: {
    method: "send_dispute_message",
    name: "Send dispute message",
    description: "Send a message to the buyer on an INQUIRY-stage dispute.",
    parameters: z.object({ dispute_id: id, message: z.string().min(1).max(2000) }),
    action: "send_message",
  },
  escalate_dispute: {
    method: "escalate_dispute",
    name: "Escalate dispute",
    description: "Escalate an INQUIRY-stage dispute to a PayPal claim for PayPal to decide.",
    parameters: z.object({ dispute_id: id, note: z.string().min(1).max(2000) }),
    action: "escalate",
  },
  acknowledge_return_item: {
    method: "acknowledge_return_item",
    name: "Acknowledge returned item",
    description: "Confirm the buyer returned the item (not-as-described disputes).",
    parameters: z.object({ dispute_id: id, note: z.string().min(1).max(2000), acknowledgement_type: z.string().optional() }),
    action: "acknowledge_return_item",
  },
  accept_dispute_claim_with_terms: {
    method: "accept_dispute_claim_with_terms",
    name: "Accept dispute claim",
    description: "Accept liability and refund the buyer (full or partial).",
    parameters: z.object({
      dispute_id: id,
      note: z.string().min(1).max(2000),
      accept_claim_type: z.enum(["REFUND", "PARTIAL_REFUND", "REFUND_WITH_RETURN"]).optional(),
      refund_amount: Money.optional(),
    }),
    action: "accept_claim",
  },
} as const satisfies Record<string, { method: string; parameters: z.ZodTypeAny; action: DisputeAction; name: string; description: string }>;

export type CustomToolName = keyof typeof customDisputeTools;

/** Endpoint and body encoding per action (verified in sandbox M0 where noted). */
export const TOOL_ENDPOINTS: Record<CustomToolName, { path: string; encoding: "json" | "multipart"; fileField?: string }> = {
  provide_dispute_evidence: { path: "provide-evidence", encoding: "multipart", fileField: "evidence-file" }, // M0 ✅
  provide_dispute_supporting_info: { path: "provide-supporting-info", encoding: "multipart", fileField: "file1" }, // PayPal docs example: -F input={notes} -F file1=@doc.pdf
  make_dispute_offer: { path: "make-offer", encoding: "json" },
  send_dispute_message: { path: "send-message", encoding: "multipart" }, // M0 ✅
  escalate_dispute: { path: "escalate", encoding: "json" }, // M0 ✅
  acknowledge_return_item: { path: "acknowledge-return-item", encoding: "multipart" },
  accept_dispute_claim_with_terms: { path: "accept-claim", encoding: "multipart" },
};

export async function getDispute(client: PayPalClient, disputeId: string) {
  return (await client.request<HasLinks & Record<string, unknown>>("GET", `/v1/customer/disputes/${id.parse(disputeId)}`)).data;
}

export async function runCustomDisputeTool(
  client: PayPalClient,
  tool: CustomToolName,
  rawArgs: unknown,
  opts: { idempotencyKey?: string } = {},
) {
  const def = customDisputeTools[tool];
  const args = def.parameters.parse(rawArgs) as { dispute_id: string; files?: z.infer<typeof EvidenceFile>[] } & Record<string, unknown>;
  const dispute = await getDispute(client, args.dispute_id);
  assertAllowed(dispute, def.action);

  const { dispute_id, files, ...input } = args;
  const { path, encoding, fileField = "evidence-file" } = TOOL_ENDPOINTS[tool];
  const url = `/v1/customer/disputes/${dispute_id}/${path}`;

  if (files?.length) {
    const total = files.reduce((n, f) => n + f.data.byteLength, 0);
    const tooBig = files.find((f) => f.data.byteLength >= MAX_FILE_BYTES);
    if (tooBig) throw new Error(`Evidence file ${tooBig.filename} is >= 10 MB`);
    if (total > MAX_CALL_BYTES) throw new Error("Evidence files exceed 50 MB per call");
  }

  if (encoding === "multipart") {
    return client.request("POST", url, {
      idempotencyKey: opts.idempotencyKey,
      multipart: {
        input,
        files: files?.map((f) => ({ field: fileField, filename: f.filename, type: f.type, data: f.data })),
      },
    });
  }
  return client.request("POST", url, { json: input, idempotencyKey: opts.idempotencyKey });
}

/** Sandbox-only lifecycle simulation (used by seeding scripts and the SANDBOX outcome button). */
export async function sandboxSimulate(
  client: PayPalClient,
  disputeId: string,
  step: { kind: "require_evidence"; action: "SELLER_EVIDENCE" | "BUYER_EVIDENCE" } | { kind: "adjudicate"; outcome: "SELLER_FAVOR" | "BUYER_FAVOR" },
) {
  const dispute = await getDispute(client, disputeId);
  assertAllowed(dispute, step.kind);
  if (step.kind === "adjudicate") {
    return client.request("POST", `/v1/customer/disputes/${disputeId}/adjudicate`, { json: { adjudication_outcome: step.outcome } });
  }
  return client.request("POST", `/v1/customer/disputes/${disputeId}/require-evidence`, { json: { action: step.action } });
}
