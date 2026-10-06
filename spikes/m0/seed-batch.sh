#!/bin/zsh
# Kiln & Clay Studio demo orders (sandbox). Disputes open 12-15 Oct.
cd "$(dirname "$0")"
./seed-store.sh KC-BOWL-10 "Hand-thrown serving bowl, 10 in" 89.00 9405511899223197428601
./seed-store.sh KC-PLATE-6 "Matte glaze dinner plates, set of 6" 42.00
./seed-store.sh KC-MUG-4 "Speckled stoneware mugs, set of 4" 64.00 9405511899223197428602
./seed-store.sh KC-PLANTER "Ceramic planter with drainage tray" 28.50 9405511899223197428603
./seed-store.sh KC-VASE "Small bud vase, celadon" 9.50 9405511899223197428604
echo "=== batch finished"
