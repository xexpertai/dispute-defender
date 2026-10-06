# Dispute Defender: demo video script v1

Target: under 2:30 (PLAN §13). Draft v1 runs **125 s**. Voice: Kokoro-82M `af_heart` (local, Apache-2.0). There is no music, and captions are burned in (an `.srt` is also produced for YouTube CC).

**Source of truth:** `video/scenes.json`. The spoken lines below are generated from it, and `tests/video-script.test.ts` keeps them in sync. To rebuild the whole draft (voice, takes, captions, assembly), run:

```
scripts/video/make-draft.sh [out_dir]
```

**Style:** short sentences, one idea each, about 0.35 s pauses between lines. No invented claims: the hook cites its source on screen, and every product claim is visible in the shot.

## Scenes

### 1. hook · 0:00–0:10

**Visual:** Title card: **$5.13 per $1 lost**, with the source on screen (LexisNexis® Risk Solutions, 2026 True Cost of Fraud™ Study for Retail and Ecommerce, press release 24 June 2026).

**Voice:**

> For every dollar a US online seller loses to fraud, the real cost is about five dollars.
> Chargeback fraud is part of that bill.

### 2. problem · 0:10–0:19

**Visual:** Phone take (390 px): the dashboard scrolls; the deadline guardian is visible.

**Voice:**

> A PayPal dispute opens. A deadline starts.
> It's easy to refund when you could have won, or to fight when the buyer is right.

### 3. dashboard · 0:19–0:28

**Visual:** Desktop dashboard: $ at risk, your move / due < 48 h, ranked open disputes; cursor on "Watch the agent defend a dispute".

**Voice:**

> This is Dispute Defender.
> It reads your PayPal disputes and shows what's at risk, and which deadline matters most.

### 4. agent · 0:28–0:39

**Visual:** Click the button: the numbered trace runs live; each step shows its PayPal API badge.

**Voice:**

> One click, and the agent gets to work.
> It reads the dispute, the order and the tracking from PayPal.
> Every step is a real PayPal API call.

### 5. refund · 0:39–0:53

**Visual:** D4 ($9.50, claim stage): recommendation "Refund the buyer", cost to fight $12.50 vs $9.50; scroll to the AI-written draft.

**Voice:**

> Here the package is still on its way, and the case is for nine dollars fifty.
> Fighting would cost more of your time than the refund.
> So it says: refund. It tells you when a fight isn't worth it.

### 6. draft · 0:53–1:07

**Visual:** D3 ($12.75, inquiry): "Defend with evidence"; AI-written (recorded) draft types in; the Spanish buyer reply with its English gloss.

**Voice:**

> On this case, tracking shows delivery to the right ZIP code.
> Claude drafts the response, and every claim links to its source.
> The buyer wrote in Spanish, so the reply is in Spanish.

### 7. sources · 1:07–1:16

**Visual:** Tap the delivery-scan source chip: the page jumps to that record in the evidence timeline and highlights it.

**Voice:**

> Tap a source to see the exact record behind a claim.
> Nothing is invented. Our server checks every claim before you see it.

### 8. paypal · 1:16–1:24

**Visual:** "What PayPal receives" tab: the exact POST endpoint and JSON body (plus the evidence-pack PDF for provide-evidence).

**Voice:**

> Before anything is sent, you see exactly what PayPal will receive.
> The request, and the evidence pack.

### 9. outcome · 1:24–1:33

**Visual:** D3 "Sent to PayPal · 200" (real sandbox submission, debug_id shown), then /outcomes: kept vs refunded with WON / LOST stamps.

**Voice:**

> You approve, and it goes through PayPal's dispute API.
> Then you see the outcome. In the sandbox, this one was won.

### 10. insights · 1:33–1:41

**Visual:** /insights: patterns with their cases, and "What to change" (AI-written · recorded) citing those patterns.

**Voice:**

> Then it helps you prevent the next dispute.
> Patterns across your cases, each with its evidence, and what to change.

### 11. architecture · 1:41–1:55

**Visual:** Architecture card (same image as docs/architecture.png): 6 PayPal APIs, the 9-step loop, honesty guarantees.

**Voice:**

> Under the hood: six PayPal APIs, and PayPal's Agent Toolkit, which we extended with six dispute tools and also serve over MCP.
> Claude writes. Code checks. You decide.

### 12. close · 1:55–2:05

**Visual:** Close card: tagline + "Try the demo store: no login". Add the hosted URL once deployed.

**Voice:**

> Dispute Defender. Win the disputes worth fighting, and settle the rest fairly.
> Try the demo store. No login needed.

### 13. endcard · about 3 s (after close)

**Visual:** End card (text only): "Thanks for watching", "Built by Harsha Shinde · xexpertai", the demo URL and the GitHub repo URL (placeholders until the user approves the deploy and the public repo; edit `DEMO_URL` / `REPO_URL` in `scripts/video/cards.html`).

**Voice:**

> Thanks for watching.

**Rules:** no "hello" or self-introduction at the start (the hook stays first). The AI voice never claims to be a person, and credit is text only. `tests/video-script.test.ts` enforces this.

## Re-shoot plan for 15 Oct (Kiln & Clay data)

1. Run `npm run seed:disputes` (12–15 Oct), then `npm run ai:record` and `npm run ai:record -- --insights`.
2. **Buyer-is-right moment.** Add a scene after *refund*: the KC planter (returned to sender, plus the seller's own note about a missing apartment number). The agent says "The buyer is right", decisive, and refunds. Line: *"And when the evidence says the buyer is right, it tells you to refund. No tricks."*
3. **Live approve → WON.** Re-shoot *outcome* in Live mode on a pre-staged KC claim: tick the review box, approve, use SANDBOX "Seller wins" (adjudicate). Then show 2 s of the PayPal sandbox Resolution Center with the same case resolved (by hand, no automation).
4. Swap the D3/D4 takes for KC disputes (real product names, realistic 3–6 day timelines).
5. Add the hosted URL to the close card, and the demo + repo URLs to the end card, after the user approves the deploy and the public repo.

## Facts checked for this script

- **$5.13 per $1 lost.** LexisNexis® Risk Solutions press release, 24 June 2026, "Retail and Ecommerce Companies Face More Than $5 in Costs for Every $1 Lost to Fraud…": "approximately $5.13 in the US". The release lists chargeback fraud among the fraud types. We say "fraud", not "disputes".
- **Six PayPal APIs:** OAuth 2.0, Disputes v1 (including the sandbox simulations), Orders v2, Payments v2, Shipment Tracking, Webhooks. Transaction Search is not in the app, so it is not claimed.
- **"Six dispute tools":** the custom tools in `lib/paypal/disputes.ts`, which are also exposed by `npm run mcp`.
- **"This one was won":** D1 `PP-R-CMR-10190364` → RESOLVED_SELLER_FAVOUR on the real sandbox.
