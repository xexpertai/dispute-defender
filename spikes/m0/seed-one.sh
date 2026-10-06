#!/bin/zsh
# Seed one fresh INR dispute end to end and run the PDF evidence check. Logs to seed-one.log.
set -e
cd "$(dirname "$0")"
node -e "const f='./state.json',fs=require('fs');if(fs.existsSync(f)){const s=JSON.parse(fs.readFileSync(f));delete s.dispute_id;fs.writeFileSync(f,JSON.stringify(s,null,2))}"
npx tsx 03-order.mjs ${1:-12.75}
python3 sbbuyer.py approve "$(node -e "console.log(require('./state.json').approve)")"
npx tsx 04-capture.mjs
TXN=$(python3 sbbuyer.py txns 1 | sed -n "s/.*\['\([0-9A-Z]\{17\}\)'.*/\1/p")
echo "buyer txn: $TXN"
BUYER_EMAIL=$(grep '^PAYPAL_SANDBOX_BUYER_EMAIL=' ../../.env.local | cut -d= -f2) npx tsx 05-create-dispute.mjs MERCHANDISE_OR_SERVICE_NOT_RECEIVED "$TXN"
DID=$(node -e "console.log(require('./state.json').dispute_id)")
npx tsx --env-file=../../.env.local 08-pdf-evidence.mts "$DID"
