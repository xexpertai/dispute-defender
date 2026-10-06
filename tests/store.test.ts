import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/store/db";
import { getDisputeSnapshot, listDisputeSnapshots, llmTotals, recordLlmCall, upsertDispute } from "@/lib/store/repo";

describe("store", () => {
  it("upserts dispute snapshots and orders by deadline", () => {
    const db = openDb(":memory:");
    upsertDispute(db, { dispute_id: "B", status: "OPEN", seller_response_due_date: "2026-10-25T00:00:00Z", dispute_amount: { value: "12.50", currency_code: "USD" } });
    upsertDispute(db, { dispute_id: "A", status: "OPEN", seller_response_due_date: "2026-10-16T00:00:00Z" });
    upsertDispute(db, { dispute_id: "B", status: "RESOLVED", seller_response_due_date: "2026-10-25T00:00:00Z" });
    expect(listDisputeSnapshots(db).map((d) => d.dispute_id)).toEqual(["A", "B"]);
    expect(getDisputeSnapshot(db, "B")?.status).toBe("RESOLVED");
  });

  it("totals LLM token usage for milestone reports and the daily cap", () => {
    const db = openDb(":memory:");
    recordLlmCall(db, { model: "claude-haiku-4-5-20251001", purpose: "draft", inputTokens: 3500, outputTokens: 1000, costUsd: 0.0085 }, new Date("2026-10-06T10:00:00Z"));
    recordLlmCall(db, { model: "claude-haiku-4-5-20251001", purpose: "insights", inputTokens: 2000, outputTokens: 500, costUsd: 0.0045 }, new Date("2026-10-07T10:00:00Z"));
    expect(llmTotals(db)).toMatchObject({ calls: 2, input_tokens: 5500, output_tokens: 1500 });
    expect(llmTotals(db, "2026-10-07T00:00:00Z").calls).toBe(1);
  });
});
