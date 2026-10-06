import type { TokenUsage } from "../agent/trace";
import type { DB } from "../store/db";
import { llmTotals, recordLlmCall } from "../store/repo";

/**
 * Hard daily cap on Claude calls (LLM_MAX_CALLS_PER_DAY, default 40) plus per-call token logging.
 * Every call is recorded in llm_calls, which is where milestone reports read cumulative spend.
 */
export class LlmBudgetExceeded extends Error {
  constructor(readonly calls: number, readonly max: number) {
    super(`Daily AI call limit reached (${calls}/${max}); using the TEMPLATE draft`);
    this.name = "LlmBudgetExceeded";
  }
}

export class LlmBudget {
  constructor(
    private readonly db: DB,
    private readonly maxPerDay = Number(process.env.LLM_MAX_CALLS_PER_DAY ?? 40),
    private readonly now: () => Date = () => new Date(),
  ) {}

  private dayStart() {
    const d = this.now();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
  }

  today() {
    return llmTotals(this.db, this.dayStart());
  }

  assertAvailable() {
    const { calls } = this.today();
    if (calls >= this.maxPerDay) throw new LlmBudgetExceeded(calls, this.maxPerDay);
  }

  record(usage: TokenUsage, purpose = "draft", runId?: string) {
    recordLlmCall(this.db, { runId, model: usage.model, purpose, inputTokens: usage.input, outputTokens: usage.output, costUsd: usage.costUsd }, this.now());
  }

  allTime() {
    return llmTotals(this.db);
  }
}
