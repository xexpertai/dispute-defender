// Sandbox-only: create a dispute as the buyer via API (PayPal-Auth-Assertion, unsigned JWT).
// Usage: BUYER_EMAIL=... tsx 05-create-dispute.mjs [REASON] [buyer_transaction_id]
import { pp, log, env } from './env.mjs';
import { load, save } from './state.mjs';
const st = load();
const reason = process.argv[2] || 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED';
const txn = process.argv[3] || st.capture_id;
const email = process.env.BUYER_EMAIL; if (!email) throw new Error('BUYER_EMAIL required');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iss: env.PAYPAL_CLIENT_ID, email })}.`;
const input = { disputed_transactions: [{ buyer_transaction_id: txn }], reason,
  dispute_amount: { currency_code: 'USD', value: st.amount || '12.00' },
  extensions: { merchant_contacted: true, merchant_contacted_outcome: 'NO_RESPONSE', merchandize_dispute_properties: { issue_type: 'PRODUCT' } } };
const fd = new FormData(); fd.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }));
const r = await fetch('https://api-m.sandbox.paypal.com/v1/customer/disputes', { method: 'POST', body: fd,
  headers: { Authorization: 'Bearer ' + await (await import('./env.mjs')).token(), 'PayPal-Auth-Assertion': jwt } });
const text = await r.text();
log('create dispute:', r.status, r.headers.get('paypal-debug-id'), text.slice(0, 800));
const id = text.match(/disputes\/([A-Z0-9-]+)/)?.[1]; if (id) save({ dispute_id: id });
