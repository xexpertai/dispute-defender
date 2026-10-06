// Tiny JSON state for the spike (order/capture/dispute ids). No secrets stored here.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const P = new URL('./state.json', import.meta.url);
export const load = () => (existsSync(P) ? JSON.parse(readFileSync(P, 'utf8')) : {});
export const save = (patch) => { const s = { ...load(), ...patch }; writeFileSync(P, JSON.stringify(s, null, 2)); return s; };
