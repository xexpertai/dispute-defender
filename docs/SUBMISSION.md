# Devpost submission text (draft; submitting needs the user's approval)

Entrant: **Harsha Shinde** · Repo owner: **xexpertai** · Demo and repo links are filled in; video: https://youtu.be/iJCxNgAvWto

## Project name
Dispute Defender

## Tagline (elevator pitch)
An honest AI agent that helps small sellers win, or fairly settle, PayPal disputes, with every claim tied to its record and nothing sent without your approval.

## Links
- Demo (hosted, no login): https://dispute-defender-vz4eriizbq-uc.a.run.app
- Code (public, MIT): https://github.com/xexpertai/dispute-defender
- Video (under 3 minutes): https://youtu.be/iJCxNgAvWto

## Inspiration
When a buyer opens a PayPal dispute, a small seller has days to answer with the right evidence. Most don't know what PayPal needs, so they refund cases they could have won, or fight cases where the buyer is right.

PayPal's own help page is blunt about it: "You must respond within the first 10 days following a dispute creation", and "If you don't respond within these 10 days and the buyer escalates it to a claim, we will resolve the case in the buyer's favor." The proof it asks for is concrete: "a third-party shipping receipt", a "tracking number - or a signature confirmation" ([PayPal Help Center: responding to Item Not Received and Not As Described disputes](https://www.paypal.com/us/cshelp/article/how-do-i-respond-to-%E2%80%98item-not-received%E2%80%99-and-%E2%80%98significantly-not-as-described%E2%80%99-disputes-help1083)). That evidence usually exists, spread across the order, the carrier and the store's logs. Dispute Defender gathers it in one run and shows the seller's own cost to fight (about 30 minutes of their time) next to the amount at stake. Each case also carries PayPal's own due date (`seller_response_due_date`), and the app counts down to that date. On our sandbox inquiries PayPal set it 20 days after opening, which is why the case chips read "19d … at snapshot" rather than 10 days.

## What it does
- **Case board:** money at risk, whose move it is, and your next deadline. Disputes are ranked by money × urgency.
- **Agent run (9 visible steps):** reads the dispute, order, payment and tracking from PayPal; checks carrier scans and the store's own records; weighs the evidence with fixed rules, including a **buyer-fair** rule: if the evidence says the buyer is right, or the seller can't prove delivery (no tracking on record), it recommends a refund and says which.
- **Draft with Claude:** the response and a buyer message, in the buyer's language with an English gloss. Every claim is tied to its record and checked on our server; unsupported claims, invented numbers and policy outcomes ("protection applies") are removed.
- **What PayPal receives:** the exact request (endpoint and JSON) plus an evidence-pack PDF, before anything is sent.
- **Approve and submit:** nothing is sent until the seller ticks "I have read this draft" and approves. Then it goes through PayPal's Disputes API, HATEOAS-gated.
- **HOLD when there's nothing to send:** if the package is still moving or PayPal hasn't opened a response window, the agent says why and offers nothing to approve, instead of stamping DEFEND on evidence it can't send yet.
- **Outcomes and prevention:** won/lost history (in the sandbox each decision is a test decision we trigger, and the app labels it so), and patterns across cases (e.g. "buyers open cases before the package arrives") with suggested changes that cite those patterns, plus lessons from single cases (an incomplete address that sent a package back; a shipment without tracking), labelled Template.
- **The agent's call on the demo store's 7 cases (Replay data, fixed rules, no AI):** defend 2 ($401, both won by sandbox test decisions we triggered) · fair offer 1 ($64, offering $32 back) · refund 3 ($80: 1 where the buyer is right, 1 where the seller can't prove delivery because there is no tracking on record, 1 where the seller's time costs more) · hold 1 ($142: the package is still on its way, so there is nothing PayPal can receive yet). The board shows this card.
- **By hand vs with the agent (an assumption, not a measurement):** working all 7 cases by hand would take about 7 × 30 min ≈ 3.5 hours, if each takes ~30 min (the same assumption the app uses for the cost to fight). With the agent, the seller reads each verdict, its reasons and the exact request, then approves; we have not timed that.

## What's different

- **It argues against its own user when the evidence says so.** If the buyer is right, or the seller can't prove delivery (no tracking on record), it recommends a refund (REFUND); if there is nothing PayPal can receive yet, it holds (HOLD) instead of sending weak evidence.
- **Its options are exactly the actions PayPal allows on the case right now.** They come from the dispute's own HATEOAS links, and the app shows why each other allowed action was not picked.
- **A server-side checker removes AI claims it can't back up.** A claim with no record behind it, or one that predicts PayPal's decision, is struck before the seller sees the draft. Try it with **"Test our checker"** on the featured case.
- **Any AI assistant gets the same judgement, not just the raw API.** Our MCP server adds an `assess_dispute` tool: the agent's verdict with reasons tied to records, so an assistant hears "refund, you can't prove delivery" before it calls a write tool. Judges can try it with no keys: `npm run mcp:replay`.

## How we built it
Next.js 16 (App Router, TypeScript, Tailwind), SQLite, Vitest (400+ tests), Playwright (layout and video checks).
- The agent loop is deterministic code; the AI writes text only.
- Claude gets one strict tool call per dispute. Its schema allows only the actions PayPal permits right now and only citations to gathered records.
- A server-side validator re-checks every draft.
- A Replay mode serves recorded, redacted sandbox responses, so judges can try it with no account and no cost.

## Tools used and how
| Tool | How we used it |
|---|---|
| **PayPal REST APIs (sandbox)** | OAuth 2.0; **Disputes v1** (list, details, and seven actions: send message, make offer, provide evidence with PDF, provide supporting info with PDF (for claims PayPal is already reviewing), accept claim, escalate, acknowledge return; plus the sandbox `require-evidence` / `adjudicate` simulations); **Orders v2**; **Payments v2** (capture lookup); **Shipment Tracking**; **Webhooks** (signature verification). Actions are offered only when PayPal's HATEOAS links allow them. |
| **PayPal Agent Toolkit** | In Live mode the agent reads disputes, orders and tracking through the toolkit (sandbox forced; its default is live, and a test checks this). The capture lookup (Payments), webhooks and all writes use our own sandbox-forced REST client. We extended the toolkit with seven dispute write tools in its tool shape, and serve the toolkit's read tools, our seven tools and an `assess_dispute` tool (the agent's rules verdict, no AI) as an **MCP server** (`npm run mcp`; keyless on the Replay data with `npm run mcp:replay`, where writes return the would-be request and send nothing) for Claude Desktop or any MCP client (setup in the README, "Use the dispute tools from any AI assistant"). |
| **Claude Haiku 4.5 (Anthropic API)** | One strict, forced tool call per dispute to draft the response and buyer message; one cached call per portfolio for prevention insights. Prompts are PII-redacted, and every call's tokens and cost are logged (total spend in `docs/SPEND.md`, under $0.20). The public demo replays recorded real AI output at $0 per visitor. |
| **Kokoro-82M TTS (af_heart)** | Synthetic voiceover for the demo video, generated locally (Apache-2.0). |
| **Remotion** | The story video's edit and motion graphics in React (free license for individuals), with real app footage and an original CC0 score. |
| **Next.js, Tailwind, SQLite, pdf-lib** | App, UI, local store for drafts/approvals/submissions, evidence-pack PDF. |
| **Playwright, ffmpeg** | Scripted, repeatable app footage (Chrome screencast), loudness/QA, and automated layout checks. |
| **Google Cloud Run** | Hosting for the no-login demo (Replay mode, no secrets; `Dockerfile`, `scripts/deploy-cloudrun.sh`). |

## Proof that the outcomes are real
All dispute outcomes in the demo video are real responses from PayPal's sandbox Disputes API (IDs shown on screen). The café case's win comes from a sandbox-only test endpoint that we trigger (in production PayPal decides); PayPal's API then records it. We don't show PayPal's own website to avoid using its brand.

In Live mode, the app shows a "PayPal API response" panel after every approve and sandbox decision: HTTP status, dispute ID, status/outcome and PayPal's `debug_id`, with no personal data.

| Dispute ID | What it shows | PayPal result |
|---|---|---|
| `PP-R-CMR-10190364` | Earlier test (M0, not in the video): defended, then decided by PayPal (sandbox adjudicate) | `RESOLVED · SELLER_FAVOUR` (won) |
| `PP-R-RFI-10190369` | Earlier test (M0, not in the video): decided for the buyer | `RESOLVED · BUYER_FAVOUR` (lost, $12.50 refunded) |
| `PP-R-MQR-10190375` | Earlier test (M0, not in the video): approve and submit, send-message | `200` from `POST …/send-message` |
| `PP-R-KFL-10190426` | Kiln & Clay mugs (not as described): live approve, make-offer of $32.00, 6 Oct (in the video as Replay, 1:17–1:27) | `200` from `POST …/make-offer` (debug_id `f6208691a8dc2`), re-read `UNDER_REVIEW` |
| `PP-R-FWW-10190477` | Kiln & Clay café order (not received, $312): the DEFEND case end to end, 7 Oct (video 0:27–1:17: the agent's run as Replay, then the live approve and decision from 0:55). Approve sends the note + evidence-pack PDF; then the sandbox decision, which we trigger | `200` from `POST …/provide-supporting-info` (debug_id `f1143964ab522`, re-read `UNDER_REVIEW`); `200` from `POST …/adjudicate` (sandbox test endpoint, debug_id `ca46df7dd6ffe`); then `RESOLVED · SELLER_FAVOUR` (debug_id `ca46dfc26cf8f`) |
| `PP-R-WEO-10190424` | Kiln & Clay bowl (not received, $89): an earlier DEFEND case decided in the sandbox, 6 Oct (on the board and the before/after card) | `200` from `POST …/adjudicate` (debug_id `f23189873b5c3`), then `RESOLVED · SELLER_FAVOUR` (debug_id `f503902a1d26c`) |
| `PP-R-FDW-10190427` | Kiln & Clay planter: returned to sender, the store's own fault (REFUND) | open, `UNDER_REVIEW` (Replay) |
| `PP-R-KWQ-10190429` | Kiln & Clay platter: off-camera check of provide-supporting-info (notes + a 1-page PDF), 6 Oct. The Replay snapshot of this case was recorded before that call, so in the app it shows nothing sent | `200` from `POST …/provide-supporting-info` (debug_id `f889732f476a4`); a re-read lists the note and `supporting-info.pdf` under `supporting_info`, `SUBMITTED_BY_SELLER` |
| `PP-R-VYZ-10190425`, `PP-R-OZN-10190428` | Kiln & Clay plates, vase (on the case board) | open (Replay) |

## Challenges we ran into
- Seeding realistic disputes in the sandbox: each needs a real buyer-side transaction and buyer approval. Some steps only unlock ~24 minutes later (`adjudicate`).
- Making AI output provably grounded: we moved citations into the tool schema (enums of real record ids), then added server checks for numbers and policy claims after catching an invented "99%".
- PayPal's Agent Toolkit defaults to the live environment; we force and assert sandbox in three places.

## Accomplishments that we're proud of
- The full real dispute lifecycle on the PayPal sandbox: create → message → evidence → escalate → claim evidence → adjudicate → resolved (won and lost).
- "The case file closes": you can watch each claim tie to its record before the verdict stamp lands.
- An agent that tells you when the buyer is right, and when you simply can't prove your case.

## What we learned
Honest AI for money decisions is mostly about what you don't let the model do: it doesn't choose tracking numbers, invent citations, or promise outcomes. And the human approves every write.

## What's next for Dispute Defender
Real carrier and store integrations (Shopify, WooCommerce), live webhooks on the hosted app, more dispute reasons, and a seller-tone setting for buyer messages.

## Built with
nextjs, typescript, tailwindcss, sqlite, paypal-rest-api, paypal-agent-toolkit, mcp, anthropic-claude, claude-haiku, kokoro-tts, remotion, playwright, ffmpeg, google-cloud-run

## Transparency
Built with AI coding assistance. The video voiceover is synthetic (Kokoro TTS). PayPal sandbox only; no real money moves.
