import { execFile } from "node:child_process";
import type { TokenUsage } from "../agent/trace";
import { SYSTEM_PROMPT, toDraft, userPrompt, type DraftToolInput } from "./claude";
import type { Draft, DraftInput, DraftProvider } from "./draft";

/**
 * DEV-ONLY draft provider: runs the prompt through the local Claude Code CLI (`claude -p`) so
 * prompts can be iterated without API credits. Never available in a hosted or production build:
 * assertCliAllowed() refuses NODE_ENV=production (which includes `next start`), Render, and the
 * public demo flag. The output still goes through validateDraft like any AI draft.
 */
export class CliProviderForbidden extends Error {}

export function assertCliAllowed(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV === "production" || env.RENDER || env.DD_PUBLIC_DEMO === "1") {
    throw new CliProviderForbidden("DD_LLM=cli is a local development tool and is disabled in hosted/production builds");
  }
}

export type CliRunner = (prompt: string) => Promise<string>;

export const runClaudeCli: CliRunner = (prompt) =>
  new Promise((resolve, reject) =>
    execFile("claude", ["-p", prompt, "--output-format", "json"], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout))),
  );

const FORMAT = `Reply with ONLY one JSON object (no prose, no code fence) with exactly these keys:
{"strategy":"FIGHT|OFFER|REFUND","action":"<one of allowed_actions or none>","offer_type":"REFUND|none","amount":"","rationale":"","claims":[{"text":"","source_refs":["<evidence ref>"]}],"seller_note_to_paypal":"","buyer_message":{"language":"","text":"","english_gloss":""}}`;

export function parseCliDraft(stdout: string): DraftToolInput {
  const outer = JSON.parse(stdout) as { result?: string };
  const body = outer.result ?? stdout;
  const json = body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1);
  return JSON.parse(json) as DraftToolInput;
}

export class CliProvider implements DraftProvider {
  readonly name = "claude-cli (dev)";
  constructor(private readonly run: CliRunner = runClaudeCli) {
    assertCliAllowed();
  }

  async draft(input: DraftInput): Promise<{ draft: Draft; usage?: TokenUsage }> {
    const prompt = `${SYSTEM_PROMPT.replace("Respond only by calling the draft_response tool.", "")}\n${FORMAT}\n\n${userPrompt(input, input.allowedActions)}`;
    const out = parseCliDraft(await this.run(prompt));
    return { draft: { ...toDraft(out, input, "claude-cli (dev)") } };
  }
}
