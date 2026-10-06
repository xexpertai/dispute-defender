// Writes the sandbox buyer-consent URL (Log in with PayPal, scope disputes/create) to consent-url.txt.
// The client ID is not printed; the user opens the file's URL in the browser.
import { writeFileSync } from 'node:fs';
import { env } from './env.mjs';
const p = new URLSearchParams({ flowEntry: 'static', client_id: env.PAYPAL_CLIENT_ID, response_type: 'code',
  scope: 'openid https://uri.paypal.com/services/disputes/create', redirect_uri: process.argv[2] || 'https://example.com/return' });
writeFileSync(new URL('./consent-url.txt', import.meta.url), `https://www.sandbox.paypal.com/connect?${p}\n`, { mode: 0o600 });
console.log('Wrote spikes/m0/consent-url.txt');
