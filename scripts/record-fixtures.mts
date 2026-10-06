// npm run fixtures:record -- <dispute_id | order:<order_id> | trackers:<capture_id>> [...]
// Fetches real sandbox data, redacts PII, and writes fixtures/paypal/{disputes,orders,trackers}/
// for tests and Replay mode. Run `npm run fixtures:scan` before committing fixtures.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PayPalClient } from "../lib/paypal/client";
import { getDispute } from "../lib/paypal/disputes";
import { redactObject } from "../lib/redact";

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error("Usage: npm run fixtures:record -- <dispute_id> [...]");
  process.exit(1);
}
const client = new PayPalClient();
const meta = () => ({ source: "paypal-sandbox", recorded_at: new Date().toISOString(), redacted: true });

function write(kind: "disputes" | "orders" | "trackers", name: string, data: Record<string, unknown>, note: string) {
  const dir = path.join(process.cwd(), "fixtures/paypal", kind);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify({ _meta: meta(), ...redactObject(data) }, null, 2) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), file)} (${note})`);
}

for (const arg of ids) {
  if (arg.startsWith("order:")) {
    const id = arg.slice(6);
    const { data } = await client.request<Record<string, unknown>>("GET", `/v2/checkout/orders/${id}`);
    write("orders", id, data, `status ${String(data.status)}`);
  } else if (arg.startsWith("trackers:")) {
    const captureId = arg.slice(9);
    const { data } = await client.request<Record<string, unknown>>("GET", `/v1/shipping/trackers?transaction_id=${captureId}`);
    write("trackers", captureId, data, `${((data.trackers as unknown[]) ?? []).length} trackers`);
  } else {
    const dispute = await getDispute(client, arg);
    write("disputes", arg, dispute, `status ${String(dispute.status)}`);
  }
}
