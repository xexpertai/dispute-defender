// Create a CAPTURE order (PayPal wallet) and see what buyer approval needs; also probe Transaction Search.
import { pp, log } from './env.mjs';
import { randomUUID } from 'node:crypto';
const o = await pp('POST', '/v2/checkout/orders', {
  intent: 'CAPTURE',
  purchase_units: [{ reference_id: 'DD-SPIKE-1', invoice_id: 'DD-SPIKE-' + Date.now(), description: 'Spike: Ceramic mug set',
    amount: { currency_code: 'USD', value: '12.00' } }],
  payment_source: { paypal: { experience_context: { shipping_preference: 'GET_FROM_FILE', user_action: 'PAY_NOW', return_url: 'https://example.com/return', cancel_url: 'https://example.com/cancel' } } },
}, { 'PayPal-Request-Id': randomUUID() });
log('create order:', o.status, o.json.id, o.json.status, (o.json.links || []).map(l => l.rel + ' ' + l.href).join('\n'));
const end = new Date(); const start = new Date(Date.now() - 30 * 864e5);
const t = await pp('GET', `/v1/reporting/transactions?start_date=${start.toISOString().slice(0,19)}Z&end_date=${end.toISOString().slice(0,19)}Z&fields=all&page_size=5`);
log('transaction search:', t.status, t.json.total_items ?? '', t.json.name ?? '', t.json.message ?? '', (t.json.transaction_details || []).length);
