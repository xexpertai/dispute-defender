import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { applyEdits, approveAndSubmit, type RunTool } from "@/lib/agent/approve";
import { ReplayGateway } from "@/lib/agent/gateway";
import { persistDrafts } from "@/lib/agent/persist";
import { runAgent } from "@/lib/agent/run";
import { assertPlanValid, planSubmission, previewRequest } from "@/lib/agent/submission";
import { MockCarrier } from "@/lib/carrier/mock";
import { wordDiff } from "@/lib/diff";
import { FakeProvider, type Draft } from "@/lib/llm/draft";
import { renderEvidencePack, winAnsi } from "@/lib/pdf/evidence-pack";
import { loadFixtures } from "@/lib/replay/fixtures";
import { SampleStore } from "@/lib/samples/store";
import { openDb } from "@/lib/store/db";
import { getDraft, submissionsForDispute } from "@/lib/store/drafts";

const f = loadFixtures(undefined, { withArchive: true });

/** Runs the agent over a fixture and stores the draft as if it came from the given mode. */
async function storedDraft(id: string, mode: "live" | "replay") {
  const db = openDb(":memory:");
  const events = runAgent(id, { gateway: new ReplayGateway(f), carrier: new MockCarrier(f.carrier), store: new SampleStore(f.store), provider: new FakeProvider(), runId: `r_${id}` });
  for await (const e of persistDrafts(events, db, { disputeId: id, mode })) void e;
  return { db, draftId: `r_${id}_d1` };
}

const base = (over: Partial<Draft>): Draft => ({ origin: "template", strategy: "FIGHT", action: null, rationale: "", claims: [], sellerNote: "Note.", evidence: [], ...over });

describe("submission plan = preview = request", () => {
  it.each([
    [base({ action: { kind: "provide_evidence" }, evidence: [{ evidence_type: "PROOF_OF_FULFILLMENT", tracking_info: [{ carrier_name: "USPS", tracking_number: "9400" }], sourceRefs: [] }, { evidence_type: "OTHER", sourceRefs: ["x"] }] }), "provide_dispute_evidence", "provide-evidence", "multipart", 1],
    [base({ action: { kind: "send_message" }, buyerMessage: { language: "es", text: "¡Hola!" } }), "send_dispute_message", "send-message", "multipart", 0],
    [base({ action: { kind: "make_offer", offerType: "REFUND", amount: { value: "5.00", currency_code: "USD" } } }), "make_dispute_offer", "make-offer", "json", 0],
    [base({ action: { kind: "accept_claim", acceptClaimType: "REFUND" } }), "accept_dispute_claim_with_terms", "accept-claim", "multipart", 0],
    [base({ action: { kind: "escalate" } }), "escalate_dispute", "escalate", "json", 0],
  ])("%#: %s", (draft, tool, path, encoding, files) => {
    const plan = planSubmission("PP-R-X-1", draft, 3)!;
    expect(plan.tool).toBe(tool);
    expect(() => assertPlanValid(plan)).not.toThrow();
    const p = previewRequest(plan, 1234);
    expect(p).toMatchObject({ method: "POST", endpoint: `/v1/customer/disputes/PP-R-X-1/${path}`, encoding });
    expect(p.files).toHaveLength(files);
    expect(p.input).not.toHaveProperty("dispute_id");
  });

  it("sends the buyer message (in the buyer's language) for send_message", () => {
    const plan = planSubmission("PP-R-X-1", base({ action: { kind: "send_message" }, buyerMessage: { language: "es", text: "¡Hola! Su pedido llegó." } }), 0)!;
    expect(plan.args).toEqual({ dispute_id: "PP-R-X-1", message: "¡Hola! Su pedido llegó." });
  });

  it("no action → nothing to submit", () => {
    expect(planSubmission("PP-R-X-1", base({}), 0)).toBeNull();
  });
});

describe("evidence pack PDF", () => {
  it("renders a valid PDF that lists every cited record, under PayPal's 10 MB limit", async () => {
    const { db, draftId } = await storedDraft("PP-R-MQR-10190375", "replay");
    const d = getDraft(db, draftId)!;
    const bytes = await renderEvidencePack({ disputeId: d.disputeId, reason: d.reason, amount: d.amount, currency: d.currency, draft: d.draft, items: d.packItems, generatedAt: "2026-10-06T10:00:00Z" });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(bytes.byteLength).toBeLessThan(10 * 1024 * 1024);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe("Evidence pack PP-R-MQR-10190375");
    expect(d.packItems.map((i) => i.sourceRef).sort()).toEqual([...d.packRefs].sort());
  });

  it("refuses to render a pack whose claims cite records that are not in it", async () => {
    await expect(renderEvidencePack({ disputeId: "D", reason: "OTHER", amount: 1, currency: "USD", draft: base({ claims: [{ text: "x", sourceRefs: ["order:NOPE"] }] }), items: [], generatedAt: "2026-10-06T10:00:00Z" })).rejects.toThrow(/missing cited records/);
  });

  it("keeps Latin-1 text (Spanish) and replaces symbols the PDF fonts can't draw", () => {
    expect(winAnsi("¿Dónde está? → ✓ “ok” — 漢")).toBe("¿Dónde está? -> OK “ok” — ?");
  });
});

describe("approve and submit", () => {
  const okTool = (calls: unknown[]): RunTool => async (tool, args, opts) => {
    calls.push({ tool, args, opts });
    return { status: 200, debugId: "dbg1", data: { links: [] } };
  };

  it("replay drafts are never sent", async () => {
    const { db, draftId } = await storedDraft("PP-R-MQR-10190375", "replay");
    const calls: unknown[] = [];
    const r = await approveAndSubmit(draftId, { reviewed: true }, { db, mode: "replay", runTool: okTool(calls) });
    expect(r).toMatchObject({ ok: false, httpStatus: 409 });
    expect(calls).toHaveLength(0);
  });

  it("requires the review flag", async () => {
    const { db, draftId } = await storedDraft("PP-R-MQR-10190375", "live");
    expect(await approveAndSubmit(draftId, { reviewed: false }, { db, mode: "live", runTool: okTool([]) })).toMatchObject({ ok: false, httpStatus: 400 });
  });

  it("stores the approval first, submits once with the approval id as idempotency key, records the result", async () => {
    const { db, draftId } = await storedDraft("PP-R-MQR-10190375", "live");
    const calls: { tool: string; args: Record<string, unknown>; opts: { idempotencyKey: string } }[] = [];
    const r = await approveAndSubmit(draftId, { reviewed: true, edits: { buyerMessage: "Hi! Tracking shows it was delivered to your mailbox on Oct 5." } }, { db, mode: "live", runTool: okTool(calls) as RunTool });
    expect(r).toMatchObject({ ok: true, status: 200, debugId: "dbg1", preview: { endpoint: "/v1/customer/disputes/PP-R-MQR-10190375/send-message" } });
    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe("send_dispute_message");
    expect(calls[0].args.message).toBe("Hi! Tracking shows it was delivered to your mailbox on Oct 5.");
    expect(calls[0].opts.idempotencyKey).toBe(r.ok ? r.approvalId : "");
    expect(submissionsForDispute(db, "PP-R-MQR-10190375")).toMatchObject([{ statusCode: 200, debugId: "dbg1", origin: "template", action: "send_message" }]);
    // second approval of the same draft is refused
    expect(await approveAndSubmit(draftId, { reviewed: true }, { db, mode: "live", runTool: okTool(calls) as RunTool })).toMatchObject({ ok: false, httpStatus: 409 });
    expect(calls).toHaveLength(1);
  });

  it("attaches the evidence pack PDF for provide-evidence", async () => {
    const { db, draftId } = await storedDraft("PP-R-MQR-10190375", "live");
    const stored = getDraft(db, draftId)!;
    // turn the stored draft into a provide_evidence draft (as on a seller-move dispute)
    db.prepare("UPDATE drafts SET payload = ? WHERE id = ?").run(JSON.stringify({ ...stored, draft: { ...stored.draft, action: { kind: "provide_evidence" } } }), draftId);
    const calls: { args: { files?: { filename: string; data: Uint8Array }[]; evidences?: unknown[] } }[] = [];
    const r = await approveAndSubmit(draftId, { reviewed: true }, { db, mode: "live", runTool: okTool(calls) as RunTool });
    expect(r.ok).toBe(true);
    expect(calls[0].args.files?.[0].filename).toBe("evidence-pack.pdf");
    expect(calls[0].args.evidences?.[0]).toMatchObject({ evidence_type: "PROOF_OF_FULFILLMENT", evidence_info: { tracking_info: [{ carrier_name: "USPS", tracking_number: "9400111899223197428491" }] } });
  });

  it("records PayPal's refusal (debug_id) without throwing", async () => {
    const { db, draftId } = await storedDraft("PP-R-MQR-10190375", "live");
    const failing: RunTool = async () => {
      throw Object.assign(new Error("PayPal 422 UNPROCESSABLE_ENTITY ACTION_NOT_ALLOWED"), { status: 422, debugId: "dbg9", issues: ["ACTION_NOT_ALLOWED"] });
    };
    const r = await approveAndSubmit(draftId, { reviewed: true }, { db, mode: "live", runTool: failing });
    expect(r).toMatchObject({ ok: false, httpStatus: 502, debugId: "dbg9" });
    expect(submissionsForDispute(db, "PP-R-MQR-10190375")[0]).toMatchObject({ statusCode: 422, debugId: "dbg9" });
  });

  it("rejects text over PayPal's 2000-char limit before anything is stored", async () => {
    const { db, draftId } = await storedDraft("PP-R-MQR-10190375", "live");
    expect(await approveAndSubmit(draftId, { reviewed: true, edits: { sellerNote: "x".repeat(2001) } }, { db, mode: "live", runTool: okTool([]) })).toMatchObject({ ok: false, httpStatus: 400 });
  });

  it("applyEdits keeps the original when an edit is blank", () => {
    const d = base({ sellerNote: "orig", buyerMessage: { language: "en", text: "hi" } });
    expect(applyEdits(d, { sellerNote: "  ", buyerMessage: "hello" })).toMatchObject({ sellerNote: "orig", buyerMessage: { text: "hello" } });
  });
});

describe("wordDiff", () => {
  it("marks added and removed words", () => {
    expect(wordDiff("Your package was delivered.", "Your package was delivered on Oct 5.")).toEqual([
      { op: "same", text: "Your package was " },
      { op: "del", text: "delivered." },
      { op: "add", text: "delivered on Oct 5." },
    ]);
    expect(wordDiff("same", "same")).toEqual([{ op: "same", text: "same" }]);
  });
});

describe("provide-supporting-info (a claim already under PayPal review)", () => {
  it("plans the multipart call with the notes and the evidence pack under the tool's file field", async () => {
    const { planSubmission, previewRequest, assertPlanValid } = await import("@/lib/agent/submission");
    const draft = { origin: "template", strategy: "FIGHT", action: { kind: "provide_supporting_info" }, rationale: "r", claims: [], sellerNote: "Delivered with signature to the ship-to ZIP.", evidence: [] } as never;
    const plan = planSubmission("PP-R-X", draft, 6)!;
    expect(plan).toMatchObject({ tool: "provide_dispute_supporting_info", args: { dispute_id: "PP-R-X", notes: "Delivered with signature to the ship-to ZIP." }, attachPack: true });
    assertPlanValid(plan);
    const p = previewRequest(plan, 1234);
    expect(p).toMatchObject({ method: "POST", endpoint: "/v1/customer/disputes/PP-R-X/provide-supporting-info", encoding: "multipart", input: { notes: "Delivered with signature to the ship-to ZIP." } });
    expect(p.files).toEqual([{ field: "file1", filename: "evidence-pack.pdf", type: "application/pdf", bytes: 1234 }]);
  });
});
