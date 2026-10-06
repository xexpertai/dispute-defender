#!/bin/zsh
# npm run seed:disputes   (one command on 12-15 Oct)
# Opens the Kiln & Clay Studio disputes for the orders in store-seeds.json (sandbox, buyer-side
# create via PayPal-Auth-Assertion), waits until each is WAITING_FOR_SELLER_RESPONSE, then records
# redacted fixtures (dispute + order + trackers) for Replay. Idempotent: skips seeds with a dispute_id.
set -e
cd "$(dirname "$0")"
TODAY=$(date -u +%Y-%m-%d)
if [[ "$TODAY" < "2026-10-12" && -z "$FORCE" ]]; then
  echo "Refusing before 2026-10-12 (realistic delivery gap). Set FORCE=1 to override."; exit 1
fi
BUYER_EMAIL=$(grep '^PAYPAL_SANDBOX_BUYER_EMAIL=' ../../.env.local | cut -d= -f2)
# Scenario per order (amounts are the full order totals; $873.50 at stake across 8 cases):
#   bowl $89 INR (delivered, signature)      -> defend     plates $42 INR (no tracking)      -> buyer is right
#   mugs $64 SNAD (photos before shipping)    -> offer      planter $28.50 INR (returned)     -> buyer is right
#   vase $9.50 INR (delivered)                -> cost rule  platter $142 INR (no signature)   -> defend / pattern
#   dinnerware $186 SNAD (photos, buyer chat) -> offer      cafe $312 UNAUTHORISED (repeat buyer, signed) -> defend
reason_for() {
  case $1 in
    KC-MUG-4|KC-DINNER-16) echo MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED;;
    KC-CAFE-24) echo UNAUTHORISED;;
    *) echo MERCHANDISE_OR_SERVICE_NOT_RECEIVED;;
  esac
}
for SKU in $(node -e 'for (const s of require("./store-seeds.json")) if (!s.dispute_id && s.buyer_txn) console.log(s.sku)'); do
  AMOUNT=$(node -e "console.log(require('./store-seeds.json').find(s=>s.sku==='$SKU').amount)")
  TXN=$(node -e "console.log(require('./store-seeds.json').find(s=>s.sku==='$SKU').buyer_txn)")
  node -e "require('fs').writeFileSync('./state.json', JSON.stringify({amount:'$AMOUNT'}))"
  BUYER_EMAIL=$BUYER_EMAIL npx tsx 05-create-dispute.mjs "$(reason_for $SKU)" "$TXN"
  DID=$(node -e "console.log(require('./state.json').dispute_id||'')")
  [[ -z "$DID" ]] && { echo "!! $SKU: dispute not created"; continue; }
  node -e "const f='./store-seeds.json',fs=require('fs');const a=JSON.parse(fs.readFileSync(f));a.find(s=>s.sku==='$SKU').dispute_id='$DID';a.find(s=>s.sku==='$SKU').dispute_opened_at=new Date().toISOString();fs.writeFileSync(f,JSON.stringify(a,null,2)+'\n')"
  echo "=== $SKU -> $DID"
  sleep 20
done
echo "=== waiting for disputes to reach WAITING_FOR_SELLER_RESPONSE (about 3 min each)"
for i in {1..24}; do
  PENDING=0
  for DID in $(node -e 'for (const s of require("./store-seeds.json")) if (s.dispute_id && !s.recorded) console.log(s.dispute_id)'); do
    ST=$(npx tsx 06-lifecycle.mjs show "$DID" 2>/dev/null | grep -o 'WAITING_FOR_SELLER_RESPONSE' | head -1)
    if [[ -n "$ST" ]]; then
      ARGS=$(node -e "const s=require('./store-seeds.json').find(x=>x.dispute_id==='$DID');console.log('$DID order:'+s.order_id+' trackers:'+s.capture_id)")
      (cd ../.. && npm run -s fixtures:record -- ${=ARGS} | grep wrote)
      node -e "const f='./store-seeds.json',fs=require('fs');const a=JSON.parse(fs.readFileSync(f));a.find(s=>s.dispute_id==='$DID').recorded=true;fs.writeFileSync(f,JSON.stringify(a,null,2)+'\n')"
    else PENDING=1; fi
  done
  [[ $PENDING == 0 ]] && { echo "=== all recorded; run: npm run fixtures:scan && npm run ai:record"; exit 0; }
  sleep 30
done
echo "!! some disputes not ready; re-run npm run seed:disputes later"
