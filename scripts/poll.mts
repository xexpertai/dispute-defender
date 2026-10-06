// npm run poll [-- <seconds>]   Live sandbox polling fallback for webhooks (read-only GETs).
import { LiveGateway } from "../lib/agent/gateway";
import { pollOnce } from "../lib/agent/poller";
import { PayPalClient } from "../lib/paypal/client";
import { openDb } from "../lib/store/db";

const every = Math.max(30, Number(process.argv[2] ?? 60)) * 1000;
const gateway = new LiveGateway(new PayPalClient());
const db = openDb();
for (;;) {
  const changes = await pollOnce(gateway, db);
  for (const c of changes) console.log(`${new Date().toISOString()} ${c.id} ${c.kind === "new" ? "new" : `${c.from} -> ${c.to}`}`);
  await new Promise((r) => setTimeout(r, every));
}
