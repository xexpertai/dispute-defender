// Record shipment tracking with PayPal (Add Tracking API) for the captured payment in state.json.
// Usage: tsx 09-add-tracking.mjs <tracking_number> [carrier]
import { pp, log } from './env.mjs';
import { load, save } from './state.mjs';
const { capture_id } = load();
const [tracking_number, carrier = 'USPS'] = process.argv.slice(2);
const r = await pp('POST', '/v1/shipping/trackers-batch', { trackers: [{ transaction_id: capture_id, tracking_number, status: 'SHIPPED', carrier }] });
log('add tracking:', r.status, r.debug_id, r.json.errors?.length ? r.json.errors : 'ok');
if (r.status < 300) save({ tracking_number, carrier });
