#!/bin/zsh
# Seed one realistic demo-store order (no dispute yet): order -> buyer approval (headed, human
# pacing) -> capture -> optional tracking with PayPal -> wait for the buyer-side txn id.
# Disputes are opened later (after a realistic delivery gap) with 05-create-dispute.mjs.
# Usage: seed-store.sh <SKU> "<product name>" <amount> [tracking_number]
set -e
cd "$(dirname "$0")"
SKU=$1; DESC=$2; AMOUNT=$3; TRACK=$4
echo "=== $SKU \$$AMOUNT $DESC ${TRACK:+tracking $TRACK}"
node -e "require('fs').writeFileSync('./state.json','{}')"
DD_SKU=$SKU DD_DESC="$DESC" DD_INVOICE_PREFIX=KC npx tsx 03-order.mjs $AMOUNT
python3 sbbuyer.py approve "$(node -e "console.log(require('./state.json').approve)")"
npx tsx 04-capture.mjs
[[ -n "$TRACK" ]] && npx tsx 09-add-tracking.mjs "$TRACK" USPS
touch known-txns.txt
TXN=$(python3 sbbuyer.py txns-new known-txns.txt $AMOUNT 480 | sed -n 's/^NEW_TXN \([0-9A-Z]\{17\}\)$/\1/p')
[[ -n "$TXN" ]] && echo "$TXN" >> known-txns.txt
node -e "
const s=require('./state.json'); const fs=require('fs'); const f='./store-seeds.json';
const all=fs.existsSync(f)?JSON.parse(fs.readFileSync(f)):[];
all.push({sku:'$SKU',desc:'$DESC',amount:'$AMOUNT',tracking:'${TRACK:-}'||null,order_id:s.order_id,capture_id:s.capture_id,buyer_txn:'$TXN'||null,seeded_at:new Date().toISOString()});
fs.writeFileSync(f, JSON.stringify(all,null,2)+'\n');"
echo "=== done $SKU buyer txn: ${TXN:-NOT FOUND}"
