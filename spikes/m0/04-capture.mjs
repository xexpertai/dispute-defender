// Capture the approved order; record capture id and shipping info.
import { randomUUID } from 'node:crypto';
import { pp, log } from './env.mjs';
import { load, save } from './state.mjs';
const { order_id } = load();
const c = await pp('POST', `/v2/checkout/orders/${order_id}/capture`, undefined, { 'PayPal-Request-Id': randomUUID() });
const cap = c.json.purchase_units?.[0]?.payments?.captures?.[0];
log('capture:', c.status, c.json.status, c.json.name || '', c.json.details?.[0]?.issue || '', c.debug_id);
log('capture id:', cap?.id, cap?.status, cap?.amount, 'seller_protection:', cap?.seller_protection?.status);
if (cap) save({ capture_id: cap.id, payer_country: c.json.payer?.address?.country_code });
