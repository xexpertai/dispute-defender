// Loads ../../.env.local without printing anything; forces sandbox.
import { readFileSync } from 'node:fs';
const raw = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8');
export const env = Object.fromEntries(raw.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
if (env.PAYPAL_ENV !== 'sandbox') throw new Error('PAYPAL_ENV must be sandbox');
export const BASE = 'https://api-m.sandbox.paypal.com';
const secrets = [env.PAYPAL_CLIENT_ID, env.PAYPAL_CLIENT_SECRET].filter(Boolean);
export const scrub = (s) => { s = typeof s === 'string' ? s : JSON.stringify(s, null, 2); for (const x of secrets) s = s.split(x).join('[REDACTED]'); return s.replace(/Bearer [A-Za-z0-9._-]+/g, 'Bearer [REDACTED]'); };
export const log = (...a) => console.log(...a.map(scrub));
let tok;
export async function token() {
  if (tok) return tok;
  const r = await fetch(BASE + '/v1/oauth2/token', { method: 'POST', body: 'grant_type=client_credentials',
    headers: { Authorization: 'Basic ' + Buffer.from(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET).toString('base64') } });
  if (!r.ok) throw new Error('token failed ' + r.status);
  return (tok = (await r.json()).access_token);
}
export async function pp(method, path, body, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : (typeof body === 'string' || body instanceof FormData ? body : JSON.stringify(body)) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, debug_id: r.headers.get('paypal-debug-id'), json };
}
