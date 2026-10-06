# Devpost submission text (draft; submitting needs the user's approval)

Entrant: **Harsha Shinde** · Repo owner: **xexpertai** · Fill in every `…_URL` before submitting.

## Project name
Dispute Defender

## Tagline (elevator pitch)
An honest AI agent that helps small sellers win, or fairly settle, PayPal disputes, with every claim tied to its record and nothing sent without your approval.

## Links
- Demo (hosted, no login): DEMO_URL
- Code (public, MIT): REPO_URL
- Video (under 3 minutes): VIDEO_URL

## Inspiration
When a buyer opens a PayPal dispute, a small seller has days to answer with the right evidence. Most don't know what PayPal needs, so they refund cases they could have won, or fight cases where the buyer is right. Fraud costs US online businesses about $5.13 for every $1 lost, and chargeback fraud is part of that (2026 industry study; citation in the README).

## What it does
- **Case board:** money at risk, whose move it is, and your next deadline. Disputes are ranked by money × urgency.
- **Agent run (9 visible steps):** reads the dispute, order, payment and tracking from PayPal; checks carrier scans and the store's own records; weighs the evidence with fixed rules, including a **buyer-fair** rule: if the evidence says the buyer is right, it recommends a refund.
- **Draft with Claude:** the response and a buyer message, in the buyer's language with an English gloss. Every claim is tied to its record and checked on our server; unsupported claims, invented numbers and policy outcomes ("protection applies") are removed.
- **What PayPal receives:** the exact request (endpoint and JSON) plus an evidence-pack PDF, before anything is sent.
- **Approve and submit:** nothing is sent until the seller ticks "I have read this draft" and approves. Then it goes through PayPal's Disputes API, HATEOAS-gated.
- **Outcomes and prevention:** won/lost history, and patterns across cases (e.g. "buyers open cases before the package arrives") with suggested changes that cite those patterns.

## How we built it
Next.js 16 (App Router, TypeScript, Tailwind), SQLite, Vitest (350+ tests), Playwright (layout and video checks).
- The agent loop is deterministic code; the AI writes text only.
- Claude gets one strict tool call per dispute. Its schema allows only the actions PayPal permits right now and only citations to gathered records.
- A server-side validator re-checks every draft.
- A Replay mode serves recorded, redacted sandbox responses, so judges can try it with no account and no cost.

## Tools used and how
| Tool | How we used it |
|---|---|
| **PayPal REST APIs (sandbox)** | OAuth 2.0; **Disputes v1** (list, details, and six actions: send message, make offer, provide evidence with PDF, accept claim, escalate, acknowledge return; plus the sandbox `require-evidence` / `adjudicate` simulations); **Orders v2**; **Payments v2** (capture lookup); **Shipment Tracking**; **Webhooks** (signature verification). Actions are offered only when PayPal's HATEOAS links allow them. |
| **PayPal Agent Toolkit** | In Live mode the agent reads disputes, orders and tracking through the toolkit (sandbox forced; its default is live, and a test checks this). We extended it with six dispute tools in the toolkit's tool shape, and serve the toolkit's read tools plus our six tools as an **MCP server** (`npm run mcp`) for Claude Desktop or any MCP client. |
| **Claude Haiku 4.5 (Anthropic API)** | One strict, forced tool call per dispute to draft the response and buyer message; one cached call per portfolio for prevention insights. Prompts are PII-redacted, and every call's tokens and cost are logged (total spend in `docs/SPEND.md`, under $0.10). The public demo replays recorded real AI output at $0 per visitor. |
| **Kokoro-82M TTS (af_heart)** | Synthetic voiceover for the demo video, generated locally (Apache-2.0). |
| **Next.js, Tailwind, SQLite, pdf-lib** | App, UI, local store for drafts/approvals/submissions, evidence-pack PDF. |
| **Playwright, ffmpeg** | Scripted, repeatable video takes with burned-in captions, and automated layout/video QA. |
| **Render** (planned) | Hosting for the no-login demo (Blueprint in `render.yaml`). |

## Proof that the outcomes are real
All dispute outcomes in the demo video are real responses from PayPal's sandbox Disputes API (IDs shown on screen). We don't show PayPal's own website to avoid using its brand.

In Live mode, the app shows a "PayPal API response" panel after every approve and sandbox decision: HTTP status, dispute ID, status/outcome and PayPal's `debug_id`, with no personal data.

| Dispute ID | What it shows | PayPal result |
|---|---|---|
| `PP-R-CMR-10190364` | Defended, then decided by PayPal (sandbox adjudicate) | `RESOLVED · SELLER_FAVOUR` (won) |
| `PP-R-RFI-10190369` | Decided for the buyer | `RESOLVED · BUYER_FAVOUR` (lost, $12.50 refunded) |
| `PP-R-MQR-10190375` | Approve and submit: send-message | `200` from `POST …/send-message` |
| *(KC cases, added 12–15 Oct)* | The approve and WON shots in the final video | to be filled from the live shoot |

## Challenges we ran into
- Seeding realistic disputes in the sandbox: each needs a real buyer-side transaction and buyer approval. Some steps only unlock ~24 minutes later (`adjudicate`).
- Making AI output provably grounded: we moved citations into the tool schema (enums of real record ids), then added server checks for numbers and policy claims after catching an invented "99%".
- PayPal's Agent Toolkit defaults to the live environment; we force and assert sandbox in three places.

## Accomplishments that we're proud of
- The full real dispute lifecycle on the PayPal sandbox: create → message → evidence → escalate → claim evidence → adjudicate → resolved (won and lost).
- "The case file closes": you can watch each claim tie to its record before the verdict stamp lands.
- An agent that tells you when the buyer is right.

## What we learned
Honest AI for money decisions is mostly about what you don't let the model do: it doesn't choose tracking numbers, invent citations, or promise outcomes. And the human approves every write.

## What's next for Dispute Defender
Real carrier and store integrations (Shopify, WooCommerce), live webhooks on the hosted app, more dispute reasons, and a seller-tone setting for buyer messages.

## Built with
nextjs, typescript, tailwindcss, sqlite, paypal-rest-api, paypal-agent-toolkit, mcp, anthropic-claude, claude-haiku, kokoro-tts, playwright, ffmpeg, render

## Transparency
Built with AI coding assistance. The video voiceover is synthetic (Kokoro TTS). PayPal sandbox only; no real money moves.
