import type { Draft, DraftInput, DraftProvider } from "./draft";

/**
 * Replays a real Claude draft captured once per fixture (`npm run ai:record`). The hosted demo
 * shows genuine AI output at $0 per visitor; the UI labels it "AI-written (recorded)". The draft
 * still goes through validateDraft, so a recording that no longer matches the evidence falls back
 * to the TEMPLATE automatically. Disputes without a recording use the fallback provider.
 */
export interface RecordedDraft {
  _meta: { source: "claude"; model: string; recorded_at: string; usage: { input: number; output: number; costUsd: number } };
  disputeId: string;
  draft: Draft;
}

export class RecordedProvider implements DraftProvider {
  readonly name = "recorded";
  constructor(
    private readonly recordings: Map<string, RecordedDraft>,
    private readonly fallback: DraftProvider,
  ) {}

  async draft(input: DraftInput) {
    const rec = this.recordings.get(input.disputeId);
    if (!rec) return this.fallback.draft(input);
    const { usage, model, recorded_at } = rec._meta;
    // No usage returned: replaying costs nothing and must not count toward spend.
    return { draft: { ...rec.draft, origin: "ai" as const, model, recorded: { at: recorded_at, model, ...usage } } };
  }
}
