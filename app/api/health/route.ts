import { aiEnabled, currentMode } from "@/lib/agent/deps";

/** GET /api/health: Render health check. No secrets, no PayPal call. */
export const runtime = "nodejs";

export function GET() {
  return Response.json({ ok: true, mode: currentMode(), ai: aiEnabled() ? "claude" : "recorded/template" });
}
