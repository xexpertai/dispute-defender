// Walk a dispute: tsx 06-lifecycle.mjs <show|escalate|require-evidence|provide-evidence|adjudicate-seller|adjudicate-buyer|offer|message> [dispute_id]
import { pp, log, token } from './env.mjs';
import { load } from './state.mjs';
const [cmd = 'show', idArg] = process.argv.slice(2);
const id = idArg || load().dispute_id;
const show = async () => { const d = (await pp('GET', `/v1/customer/disputes/${id}`)).json;
  log({ id: d.dispute_id, reason: d.reason, status: d.status, stage: d.dispute_life_cycle_stage, state: d.dispute_state, due: d.seller_response_due_date,
    outcome: d.dispute_outcome?.outcome_code, txn: d.disputed_transactions?.map(t => t.seller_transaction_id + '/' + t.buyer_transaction_id),
    requested: d.evidences?.filter(e => e.source === 'REQUESTED_FROM_SELLER').map(e => e.evidence_type),
    allowed: d.allowed_response_options, links: d.links?.map(l => l.rel) }); return d; };
const post = async (path, body) => { const r = await pp('POST', `/v1/customer/disputes/${id}/${path}`, body); log(path, r.status, r.debug_id, r.status >= 300 ? r.json : 'ok'); };
const multipart = async (path, input) => { const fd = new FormData(); fd.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }));
  const r = await fetch(`https://api-m.sandbox.paypal.com/v1/customer/disputes/${id}/${path}`, { method: 'POST', body: fd, headers: { Authorization: 'Bearer ' + await token() } });
  log(path, r.status, r.headers.get('paypal-debug-id'), r.status >= 300 ? await r.text() : 'ok'); };
switch (cmd) {
  case 'show': break;
  case 'escalate': await post('escalate', { note: 'Seller escalating to PayPal review: shipment was delivered (spike).' }); break;
  case 'require-evidence': await post('require-evidence', { action: 'SELLER_EVIDENCE' }); break;
  case 'provide-evidence': await multipart('provide-evidence', { evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT',
      evidence_info: { tracking_info: [{ carrier_name: 'USPS', tracking_number: '9400111899223197428490' }] },
      notes: 'Spike: package delivered to the address on the order. Tracking attached.' }] }); break;
  case 'offer': await post('make-offer', { note: 'Spike: partial refund offer.', offer_type: 'REFUND', offer_amount: { currency_code: 'USD', value: '5.00' } }); break;
  case 'message': await multipart('send-message', { message: 'Spike: Hi, your order shipped and shows delivered. Can you check with neighbours?' }); break;
  case 'adjudicate-seller': await post('adjudicate', { adjudication_outcome: 'SELLER_FAVOR' }); break;
  case 'adjudicate-buyer': await post('adjudicate', { adjudication_outcome: 'BUYER_FAVOR' }); break;
  default: throw new Error('unknown cmd ' + cmd);
}
await show();
