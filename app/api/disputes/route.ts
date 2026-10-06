import { currentMode, gatewayFor } from "@/lib/agent/deps";
import { summarize } from "@/lib/dashboard/guardian";

/** GET /api/disputes: the deadline-guardian summary for the current mode. */
export const runtime = "nodejs";

export async function GET() {
  const gateway = gatewayFor();
  const summary = summarize(await gateway.listDisputes(), gateway.now());
  return Response.json({ mode: currentMode(), ...summary });
}
