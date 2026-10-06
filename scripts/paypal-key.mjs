// npm run paypal:key: prompt (hidden) for the PayPal SANDBOX Client ID + Secret, verify them with a
// sandbox OAuth call, then write them to .env.local (chmod 600). Never prints the values.
import { askHidden, requireTty, updateEnvFile } from "./lib/env-file.mjs";

requireTty();
const clientId = await askHidden("PayPal SANDBOX Client ID (hidden): ");
const secret = await askHidden("PayPal SANDBOX Client Secret (hidden): ");
if (!clientId || !secret) {
  console.error("Both values are required. Nothing written.");
  process.exit(1);
}

const res = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
  method: "POST",
  body: "grant_type=client_credentials",
  headers: { Authorization: "Basic " + Buffer.from(`${clientId}:${secret}`).toString("base64") },
});
if (!res.ok) {
  console.error(`Sandbox OAuth check failed (HTTP ${res.status}). Nothing written.`);
  process.exit(1);
}
const { scope = "" } = await res.json();
updateEnvFile({ PAYPAL_CLIENT_ID: clientId, PAYPAL_CLIENT_SECRET: secret, PAYPAL_ENV: "sandbox" });
const disputeScopes = scope.split(" ").filter((s) => s.includes("disputes")).map((s) => s.split("/").pop());
console.log("Saved to .env.local (chmod 600). Sandbox OAuth OK.");
console.log("Dispute scopes:", disputeScopes.join(", ") || "none");
