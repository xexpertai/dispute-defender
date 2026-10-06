import type { DB } from "../store/db";
import { getDisputeSnapshot, upsertDispute } from "../store/repo";
import type { DisputeRecord } from "../disputes/model";
import type { DisputeGateway } from "./gateway";

/**
 * Local fallback for webhooks (no public URL needed): list disputes, store snapshots, and report
 * what changed since the last poll. The hosted app uses the webhook; both update the same store.
 */
export interface DisputeChange {
  id: string;
  from: string | null;
  to: string;
  kind: "new" | "status";
}

export async function pollOnce(gateway: DisputeGateway, db: DB): Promise<DisputeChange[]> {
  const changes: DisputeChange[] = [];
  for (const d of await gateway.listDisputes()) {
    const prev = getDisputeSnapshot(db, d.dispute_id);
    const status = d.status ?? "UNKNOWN";
    if (!prev) changes.push({ id: d.dispute_id, from: null, to: status, kind: "new" });
    else if (prev.status !== status) changes.push({ id: d.dispute_id, from: prev.status ?? null, to: status, kind: "status" });
    upsertDispute(db, d as DisputeRecord & Record<string, unknown>, gateway.mode, gateway.now());
  }
  return changes;
}
