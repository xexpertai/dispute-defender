// Poll a dispute until its links include something beyond "self" or the status changes from a given value.
import { pp } from './env.mjs';
import { load } from './state.mjs';
const id = process.argv[2] || load().dispute_id; const maxS = +(process.argv[3] || 240);
const t0 = Date.now(); let last = '';
while ((Date.now() - t0) / 1000 < maxS) {
  const d = (await pp('GET', `/v1/customer/disputes/${id}`)).json;
  const line = [d.status, d.dispute_life_cycle_stage, d.dispute_state, d.dispute_outcome?.outcome_code || '', (d.links || []).map(l => l.rel).join(',')].join(' | ');
  if (line !== last) { console.log(Math.round((Date.now() - t0) / 1000) + 's', line); last = line; }
  if ((d.links || []).length > 1 || d.status === 'RESOLVED') break;
  await new Promise(r => setTimeout(r, 10000));
}
