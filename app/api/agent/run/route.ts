import { agentDeps, currentMode } from "@/lib/agent/deps";
import { persistDrafts } from "@/lib/agent/persist";
import { sharedDb } from "@/lib/store/shared";
import { runAgent } from "@/lib/agent/run";
import { encodeSse } from "@/lib/agent/trace";
import { aiEnabled } from "@/lib/agent/deps";
import { clientKey, limiter, tooMany } from "@/lib/guard/rate-limit";

/**
 * GET /api/agent/run?dispute=<id>[&pace=<0..5>][&ai=live][&rewind=1]
 * ai=live asks for a fresh Claude draft (needs DD_LLM=claude; per-IP limited + global daily cap).
 * Otherwise Replay uses the recorded real Claude draft for the fixture at $0.
 * Streams the agent trace as Server-Sent Events (contract: lib/agent/trace.ts).
 * GET so the browser's EventSource can consume it; the run itself is read-only.
 */
export const runtime = "nodejs";

const DISPUTE_ID = /^PP-[A-Z0-9-]{3,40}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const disputeId = url.searchParams.get("dispute") ?? "";
  if (!DISPUTE_ID.test(disputeId)) return Response.json({ error: "invalid dispute id" }, { status: 400 });
  const paceParam = url.searchParams.get("pace");
  const pace = paceParam === null ? undefined : Number(paceParam);
  if (pace !== undefined && !Number.isFinite(pace)) return Response.json({ error: "invalid pace" }, { status: 400 });

  const key = clientKey(request);
  const wait = limiter.check("run", key);
  if (wait) return tooMany(wait);
  const liveAi = url.searchParams.get("ai") === "live" && aiEnabled();
  if (liveAi) {
    const aiWait = limiter.check("ai", key);
    if (aiWait) return tooMany(aiWait);
  }

  // Replay only: work the case as it stood before PayPal's decision (the run shown in the video).
  const rewind = url.searchParams.get("rewind") === "1" && currentMode() === "replay" ? disputeId : undefined;
  const encoder = new TextEncoder();
  const events = persistDrafts(runAgent(disputeId, agentDeps({ pace, liveAi, rewind })), sharedDb(), { disputeId, mode: currentMode() });
  let seq = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await events.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(encodeSse(next.value, seq++)));
    },
    async cancel() {
      await events.return(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
