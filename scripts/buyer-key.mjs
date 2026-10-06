// npm run buyer:key: prompt (hidden) for the SANDBOX personal (buyer) account login used by the
// seeding automation on sandbox.paypal.com. Written to .env.local (chmod 600); never printed.
import { askHidden, requireTty, updateEnvFile } from "./lib/env-file.mjs";

requireTty();
const email = await askHidden("Sandbox BUYER email (hidden): ");
const password = await askHidden("Sandbox BUYER password (hidden): ");
if (!/@personal\.example\.com$/.test(email)) {
  console.error("Expected a sandbox personal account (…@personal.example.com). Nothing written.");
  process.exit(1);
}
if (!password) {
  console.error("Password is required. Nothing written.");
  process.exit(1);
}
updateEnvFile({ PAYPAL_SANDBOX_BUYER_EMAIL: email, PAYPAL_SANDBOX_BUYER_PASSWORD: password });
console.log("Saved sandbox buyer login to .env.local (chmod 600).");
