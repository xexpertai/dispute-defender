import type { EvidenceItem } from "../evidence/types";
import type { DB } from "../store/db";
import { saveDraft } from "../store/drafts";
import type { TraceEvent } from "./trace";

/**
 * Passes trace events through unchanged and saves each validated draft (with the exact evidence
 * items its pack cites) so the PDF, the request preview and approval can be served later.
 */
export async function* persistDrafts(events: AsyncGenerator<TraceEvent>, db: DB, ctx: { disputeId: string; mode: "live" | "replay" }): AsyncGenerator<TraceEvent> {
  let evidence: EvidenceItem[] = [];
  let meta = { reason: "OTHER", amount: 0, currency: "USD" };
  for await (const e of events) {
    if (e.type === "evidence") evidence = e.items;
    if (e.type === "assessment") meta = { reason: e.assessment.reason, amount: e.assessment.amount, currency: e.assessment.currency };
    if (e.type === "draft" && e.draft) {
      const refs = new Set(e.packRefs ?? []);
      saveDraft(db, {
        id: e.draftId,
        runId: e.runId,
        disputeId: ctx.disputeId,
        mode: ctx.mode,
        ...meta,
        draft: e.draft,
        packRefs: [...refs],
        packItems: evidence.filter((i) => refs.has(i.sourceRef)),
        createdAt: new Date().toISOString(),
      });
    }
    yield e;
  }
}
