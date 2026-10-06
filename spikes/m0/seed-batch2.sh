#!/bin/zsh
# Higher-value Kiln & Clay Studio orders (design review: stakes a seller would lose sleep over).
cd "$(dirname "$0")"
./seed-store.sh KC-PLATTER-3 "Serving platter set of 3, hand-glazed" 142.00 9405511899223197428605
./seed-store.sh KC-DINNER-16 "Stoneware dinnerware set, 16 pieces" 186.00 9405511899223197428606
./seed-store.sh KC-CAFE-24 "Café order: 24 espresso cups, wholesale" 312.00 9405511899223197428607
echo "=== batch2 finished"
