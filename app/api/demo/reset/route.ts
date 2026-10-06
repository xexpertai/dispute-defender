import { currentMode } from "@/lib/agent/deps";
import { resetReplayState } from "@/lib/demo/reset";
import { clientKey, limiter, tooMany } from "@/lib/guard/rate-limit";
import { isAppAction } from "@/lib/http";
import { resetFixtures } from "@/lib/replay/fixtures";
import { sharedDb } from "@/lib/store/shared";

/** POST /api/demo/reset: Replay only. Re-seeds the demo from the recorded fixtures. */
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isAppAction(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const wait = limiter.check("reset", clientKey(req));
  if (wait) return tooMany(wait);
  if (currentMode() !== "replay") return Response.json({ error: "Reset only applies to the Replay demo; PayPal is the source of truth in Live mode" }, { status: 409 });
  const cleared = resetReplayState(sharedDb());
  resetFixtures();
  return Response.json({ ok: true, cleared });
}
