// Poll a dispute every 2 min; when the sandbox `adjudicate` link appears, adjudicate with the given outcome
// and keep polling until RESOLVED. Logs state changes with timestamps.  Usage: node auto-adjudicate.mjs <id> <SELLER_FAVOR|BUYER_FAVOR> [maxMin]
import { pp } from './env.mjs';
const [id, outcome, maxMin = '60'] = process.argv.slice(2);
const t0 = Date.now(); let last = ''; let done = false;
while ((Date.now() - t0) / 60000 < +maxMin) {
  const d = (await pp('GET', `/v1/customer/disputes/${id}`)).json;
  const rels = (d.links || []).map(l => l.rel);
  const line = [d.status, d.dispute_life_cycle_stage, JSON.stringify(d.dispute_outcome || ''), rels.join(',')].join(' | ');
  if (line !== last) { console.log(new Date().toISOString().slice(11, 19), line); last = line; }
  if (d.status === 'RESOLVED') break;
  if (!done && rels.includes('adjudicate')) {
    const r = await pp('POST', `/v1/customer/disputes/${id}/adjudicate`, { adjudication_outcome: outcome });
    console.log(new Date().toISOString().slice(11, 19), 'adjudicate', outcome, r.status, r.json?.details?.[0]?.issue || 'ok'); done = r.status < 300;
  }
  await new Promise(r => setTimeout(r, done ? 20000 : 120000));
}
console.log('done');
