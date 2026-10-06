# Dispute Defender: demo video script v1

Target: under 2:30. Draft v1 runs **96 s**. Voice: Kokoro-82M `af_heart` (local, Apache-2.0). There is no music, and captions are burned in (an `.srt` is also produced for YouTube CC).

**Source of truth:** `video/scenes.json`. The spoken lines below are generated from it, and `tests/video-script.test.ts` keeps them in sync. To rebuild the whole draft (voice, takes, captions, assembly), run:

```
scripts/video/make-draft.sh [out_dir]
```

**Style:** short sentences, one idea each, about 0.35 s pauses between lines. No invented claims: the hook cites its source on screen, and every product claim is visible in the shot.

## Scenes

### 1. hook · 0:00–0:08

**Visual:** A closed case's file closing (records drop in, DEFEND lands) is on screen from frame one; for the first 2.6 s it sits blurred behind a scrim under the $5.13 stat (neutral source line; full citation in the video description).

**Voice:**

> For every dollar a US online seller loses to fraud, the real cost is about five dollars.
> Chargeback fraud is part of that bill.

### 2. problem · 0:08–0:15

**Visual:** The $9.50 case on a phone (large, in a device frame) beside the same case on desktop: the deadline clock is visible.

**Voice:**

> A PayPal dispute opens. A deadline starts.
> It's easy to refund when you could have won, or to fight when the buyer is right.

### 3. dashboard · 0:15–0:22

**Visual:** The case board (gentle push-in); the cursor moves to "Watch the agent work a case" and clicks it.

**Voice:**

> This is Dispute Defender.
> It reads your PayPal disputes and shows what's at risk, and which deadline matters most.

### 4. agent · 0:22–0:34

**Visual:** From the moment the first record lands: records drop into the case file, claims tie to their records with drawn lines, and the DEFEND stamp lands.

**Voice:**

> One click, and the agent gets to work.
> It reads the dispute, the order and the tracking from PayPal.
> Every step reads PayPal's dispute APIs, recorded from the sandbox for this demo.

### 5. draft · 0:34–0:45

**Visual:** Same case: the AI-written (recorded) response types in; the buyer wrote in Spanish, so the reply is Spanish with an English gloss.

**Voice:**

> On this case, tracking shows delivery to the right ZIP code.
> Claude drafts the response, and every claim links to its source.
> The buyer wrote in Spanish, so the reply is in Spanish.

### 6. sources · 0:45–0:52

**Visual:** The cursor taps a plain-language source chip; the matching record in the timeline highlights. Then the claims with their checkmarks.

**Voice:**

> Tap a source to see the exact record behind a claim.
> Nothing is invented. Our server checks every claim before you see it.

### 7. paypal · 0:52–0:59

**Visual:** The cursor clicks "What PayPal receives": the exact POST endpoint and JSON body.

**Voice:**

> Before anything is sent, you see exactly what PayPal will receive.
> The exact request, word for word.

### 8. refund · 0:59–1:10

**Visual:** The $9.50 case: the cursor clicks "Start the agent"; the REFUND stamp lands; the recommendation explains the cost to fight.

**Voice:**

> Here the package is still on its way, and the case is for nine dollars fifty.
> Fighting would cost more of your time than the refund.
> So it says: refund. It tells you when a fight isn't worth it.

### 9. outcome · 1:10–1:17

**Visual:** Band label "Earlier, on the $12.75 case" over its History row (POST …/send-message · 200); then Outcomes with the WON row highlighted while it's named.

**Voice:**

> You approve, and it goes through PayPal's dispute API.
> Then you see the outcome. In the sandbox, this one was won.

### 10. insights · 1:17–1:23

**Visual:** Insights: the first pattern (buyers open cases before delivery) and the suggested changes in focus.

**Voice:**

> Then it helps you prevent the next dispute.
> Patterns across your cases, each with its evidence, and what to change.

### 11. architecture · 1:23–1:28

**Visual:** Architecture card builds left → right (PayPal APIs, then the agent, then the honesty guarantees).

**Voice:**

> Under the hood: six PayPal APIs and an extended PayPal Agent Toolkit.

### 12. close · 1:28–1:32

**Visual:** Close card: the tagline, with one marker stroke on "fairly".

**Voice:**

> Win the disputes worth fighting, and settle the rest fairly.

### 13. endcard · 1:32–1:36

**Visual:** End card: Thanks for watching · Built by Harsha Shinde · xexpertai · demo URL · repo URL (from video/config.json; the final render fails if either is missing).

**Voice:**

> Try the demo store, no login needed. Thanks for watching.

## Re-shoot plan for 15 Oct (Kiln & Clay data)

1. Run `npm run seed:disputes` (12–15 Oct), then `npm run ai:record` and `npm run ai:record -- --insights`.
2. **Buyer-is-right moment.** Add a scene after *refund*: the KC planter (returned to sender, plus the seller's own note about a missing apartment number). The agent says "The buyer is right", decisive, and refunds. Line: *"And when the evidence says the buyer is right, it tells you to refund. No tricks."*
3. **Live approve → WON.** Re-shoot *outcome* in Live mode on a pre-staged KC claim: tick the review box, approve, use SANDBOX "Seller wins" (adjudicate). Then show 2 s of the PayPal sandbox Resolution Center with the same case resolved (by hand, no automation).
4. Swap the D3/D4 takes for KC disputes (real product names, realistic 3–6 day timelines).
5. Add the hosted URL to the close card, and the demo + repo URLs to the end card, after the user approves the deploy and the public repo.

## Facts checked for this script

- **$5.13 per $1 lost.** On screen the source reads "2026 industry fraud-cost study" (no third-party marks in the video). The full citation is in `docs/YOUTUBE.md`: the LexisNexis Risk Solutions press release of 24 June 2026 ("approximately $5.13 in the US"), which lists chargeback fraud among the fraud types. We say "fraud", not "disputes".
- **Six PayPal APIs:** OAuth 2.0, Disputes v1 (including the sandbox simulations), Orders v2, Payments v2, Shipment Tracking, Webhooks. Transaction Search is not in the app, so it is not claimed.
- **"Six dispute tools":** the custom tools in `lib/paypal/disputes.ts`, which are also exposed by `npm run mcp`.
- **"Recorded from the sandbox":** Replay plays recorded, redacted sandbox responses; Live mode (README) makes the same calls for real.
- **"This one was won":** D1 `PP-R-CMR-10190364` → RESOLVED_SELLER_FAVOUR on the real sandbox.
