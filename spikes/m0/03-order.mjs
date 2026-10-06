// Create a CAPTURE order on the seller app; prints the buyer approval link.  Usage: tsx 03-order.mjs [amount]
// Optional env: DD_DESC (product name), DD_SKU, DD_INVOICE_PREFIX
import { randomUUID } from 'node:crypto';
import { pp, log } from './env.mjs';
import { save } from './state.mjs';
const amount = process.argv[2] || '12.00';
const o = await pp('POST', '/v2/checkout/orders', {
  intent: 'CAPTURE',
  purchase_units: [{ reference_id: process.env.DD_SKU || 'DD-SPIKE', invoice_id: (process.env.DD_INVOICE_PREFIX || 'DD-SPIKE') + '-' + Date.now(), description: process.env.DD_DESC || 'Spike: Ceramic mug set',
    ...(process.env.DD_SKU ? { items: [{ name: process.env.DD_DESC, sku: process.env.DD_SKU, quantity: '1', category: 'PHYSICAL_GOODS', unit_amount: { currency_code: 'USD', value: amount } }] } : {}),
    amount: { currency_code: 'USD', value: amount, ...(process.env.DD_SKU ? { breakdown: { item_total: { currency_code: 'USD', value: amount } } } : {}) } }],
  payment_source: { paypal: { experience_context: { shipping_preference: 'GET_FROM_FILE', user_action: 'PAY_NOW',
    return_url: 'https://example.com/return', cancel_url: 'https://example.com/cancel' } } },
}, { 'PayPal-Request-Id': randomUUID() });
log('create order:', o.status, o.json.id, o.json.status, o.debug_id);
const approve = (o.json.links || []).find(l => l.rel === 'payer-action')?.href;
if (o.status < 300) save({ order_id: o.json.id, amount, approve });
log('APPROVE LINK:', approve);
