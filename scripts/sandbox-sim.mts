// npm run sandbox:sim -- <dispute_id> require-evidence [SELLER_EVIDENCE|BUYER_EVIDENCE]
// npm run sandbox:sim -- <dispute_id> adjudicate <SELLER_FAVOR|BUYER_FAVOR>
// Sandbox-only lifecycle simulation (PayPal's documented sandbox endpoints), HATEOAS-gated.
import { PayPalClient } from "../lib/paypal/client";
import { sandboxSimulate } from "../lib/paypal/disputes";

const [id, kind, arg] = process.argv.slice(2);
if (!id || (kind !== "require-evidence" && kind !== "adjudicate")) {
  console.error("Usage: npm run sandbox:sim -- <dispute_id> require-evidence|adjudicate [arg]");
  process.exit(1);
}
const client = new PayPalClient();
const res =
  kind === "adjudicate"
    ? await sandboxSimulate(client, id, { kind: "adjudicate", outcome: arg === "BUYER_FAVOR" ? "BUYER_FAVOR" : "SELLER_FAVOR" })
    : await sandboxSimulate(client, id, { kind: "require_evidence", action: arg === "BUYER_EVIDENCE" ? "BUYER_EVIDENCE" : "SELLER_EVIDENCE" });
console.log(`${kind} ${id}: ${res.status} debug_id=${res.debugId}`);
