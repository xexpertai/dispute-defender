#!/bin/zsh
# Seed one real sandbox dispute and stop once it is open for the seller (WAITING_FOR_SELLER_RESPONSE),
# then record redacted fixtures (dispute, order, trackers) for Replay.
# Usage: seed-open.sh <scenario_name> <REASON> <amount> [tracking_number]
set -e
cd "$(dirname "$0")"
NAME=$1; REASON=$2; AMOUNT=$3; TRACK=$4
echo "=== $NAME: $REASON \$$AMOUNT ${TRACK:+tracking $TRACK}"
node -e "require('fs').writeFileSync('./state.json','{}')"
npx tsx 03-order.mjs $AMOUNT
python3 sbbuyer.py approve "$(node -e "console.log(require('./state.json').approve)")"
npx tsx 04-capture.mjs
[[ -n "$TRACK" ]] && npx tsx 09-add-tracking.mjs "$TRACK" USPS
TXN=$(python3 sbbuyer.py txns 1 | sed -n "s/.*\['\([0-9A-Z]\{17\}\)'.*/\1/p")
echo "buyer txn: $TXN"
BUYER_EMAIL=$(grep '^PAYPAL_SANDBOX_BUYER_EMAIL=' ../../.env.local | cut -d= -f2) npx tsx 05-create-dispute.mjs "$REASON" "$TXN"
DID=$(node -e "const s=require('./state.json');if(!s.dispute_id)process.exit(1);console.log(s.dispute_id)")
for i in {1..30}; do
  ST=$(npx tsx 06-lifecycle.mjs show "$DID" 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s.slice(s.indexOf('{'))).status)}catch{console.log('?')}})")
  echo "$(date -u +%H:%M:%S) $DID $ST"
  [[ "$ST" == "WAITING_FOR_SELLER_RESPONSE" ]] && break
  sleep 20
done
OID=$(node -e "console.log(require('./state.json').order_id)"); CAP=$(node -e "console.log(require('./state.json').capture_id)")
(cd ../.. && npm run -s fixtures:record -- "$DID" "order:$OID" "trackers:$CAP" | grep wrote)
echo "$NAME $DID $OID $CAP $REASON $AMOUNT ${TRACK:-none}" >> seeded.txt
echo "=== done $NAME"
