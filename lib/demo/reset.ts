import type { DB } from "../store/db";

/**
 * "Reset demo" for the public Replay demo: forget visitors' replay drafts and cached insight
 * actions so the next visitor starts from the recorded fixtures. Live-sandbox approvals and
 * submissions are an audit trail and are never deleted.
 */
export function resetReplayState(db: DB): { drafts: number; insights: number } {
  const drafts = db.prepare(`DELETE FROM drafts WHERE json_extract(payload, '$.mode') = 'replay' AND id NOT IN (SELECT draft_id FROM approvals)`).run().changes;
  const insights = db.prepare("DELETE FROM insights_cache").run().changes;
  return { drafts, insights };
}
