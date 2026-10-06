import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import type { TokenUsage } from "../agent/trace";
import { costUsd, CLAUDE_MODEL } from "../llm/claude";
import type { DB } from "../store/db";
import type { Insight } from "./patterns";

/**
 * Prevention insights, step 2: one Claude call per portfolio turns the deterministic patterns into
 * concrete seller actions. Each action must cite insight ids (an enum), and each insight already
 * lists its disputes, so every action traces back to real cases. Cached by input hash.
 */
export interface SellerAction {
  title: string;
  why: string;
  insightIds: string[];
  effort: "low" | "medium" | "high";
}

export type ActionsOrigin = "ai" | "ai-recorded" | "template";

export interface ActionsResult {
  origin: ActionsOrigin;
  actions: SellerAction[];
  model?: string;
  recordedAt?: string;
  usage?: TokenUsage;
}

export const insightsHash = (insights: Insight[]) =>
  createHash("sha256")
    .update(JSON.stringify(insights.map((i) => [i.id, i.count, i.total, [...i.disputeIds].sort()])))
    .digest("hex")
    .slice(0, 16);

export function actionsTool(ids: string[]): Anthropic.Tool {
  return {
    name: "seller_actions",
    description: "Turn dispute patterns into at most 4 concrete actions a small seller can take to prevent future disputes.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["actions"],
      properties: {
        actions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "why", "insight_ids", "effort"],
            properties: {
              title: { type: "string", description: "Imperative, specific, under 12 words." },
              why: { type: "string", description: "One sentence on why this helps, with no numbers (the app shows the cited statistics)." },
              insight_ids: { type: "array", items: { type: "string", enum: ids } },
              effort: { type: "string", enum: ["low", "medium", "high"] },
            },
          },
        },
      },
    },
  };
}

const SYSTEM = `You advise a small online seller on preventing PayPal disputes.
Use only the patterns given. Cite the pattern ids each action is based on.
Do not write any numbers, percentages or fractions: the app shows each pattern's exact statistics next to your action. Prefer cheap, specific actions. At most 4 actions, most impactful first.
Respond only by calling the seller_actions tool.`;

type MessagesClient = { messages: Pick<Anthropic["messages"], "create"> };

export async function aiActions(client: MessagesClient, insights: Insight[], model = CLAUDE_MODEL): Promise<{ actions: SellerAction[]; usage: TokenUsage }> {
  const ids = insights.map((i) => i.id);
  const res = await client.messages.create({
    model,
    max_tokens: 1200,
    system: SYSTEM,
    tools: [actionsTool(ids)],
    tool_choice: { type: "tool", name: "seller_actions" },
    messages: [{ role: "user", content: `Seller's dispute patterns:\n${JSON.stringify(insights.map(({ id, title, detail, severity }) => ({ id, title, detail, severity })), null, 1)}` }],
  });
  const usage: TokenUsage = { model, input: res.usage.input_tokens, output: res.usage.output_tokens, costUsd: costUsd(res.usage.input_tokens, res.usage.output_tokens) };
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const raw = ((block?.input as { actions?: { title: string; why: string; insight_ids: string[]; effort: SellerAction["effort"] }[] })?.actions ?? []).slice(0, 4);
  const byId = new Map(insights.map((i) => [i.id, i]));
  const actions: SellerAction[] = [];
  for (const a of raw) {
    const cited = [...new Set(a.insight_ids.filter((x) => byId.has(x)))];
    if (!cited.length || !a.title.trim()) continue;
    const sources = cited.map((x) => byId.get(x)!);
    if (!numbersSupported(a.title, sources)) continue; // a made-up number in the headline: drop it
    const why = numbersSupported(a.why, sources) ? a.why : sources.map((x) => x.detail).join(" ");
    actions.push({ title: a.title, why, effort: a.effort, insightIds: cited });
  }
  return { actions, usage };
}

/** Every number in `text` must appear in the cited insights (or be a percentage of their counts). */
export function numbersSupported(text: string, cited: Insight[]): boolean {
  const allowed = new Set<string>();
  for (const i of cited) {
    for (const n of `${i.title} ${i.detail} ${i.hint}`.match(/\d+(?:\.\d+)?/g) ?? []) allowed.add(String(Number(n)));
    [i.count, i.total, Math.round((i.count / Math.max(1, i.total)) * 100)].forEach((n) => allowed.add(String(n)));
  }
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).every((n) => allowed.has(String(Number(n))));
}

export function templateActions(insights: Insight[]): SellerAction[] {
  return insights.slice(0, 4).map((i) => ({ title: i.hint, why: i.detail, insightIds: [i.id], effort: "low" as const }));
}

export function readCache(db: DB, hash: string): ActionsResult | null {
  const row = db.prepare("SELECT payload FROM insights_cache WHERE input_hash = ?").get(hash) as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as ActionsResult) : null;
}

export function writeCache(db: DB, hash: string, r: ActionsResult) {
  db.prepare("INSERT OR REPLACE INTO insights_cache (input_hash, model, payload, created_at) VALUES (?, ?, ?, ?)").run(hash, r.model ?? "template", JSON.stringify(r), new Date().toISOString());
}
