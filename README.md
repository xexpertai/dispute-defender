# Dispute Defender

**An honest AI agent that helps small online sellers win, or wisely settle, PayPal disputes.**

A buyer opens a PayPal dispute and a deadline starts. Dispute Defender:

1. reads the case from PayPal;
2. gathers the seller's evidence (order, payment, tracking at PayPal, carrier scans, store and chat logs);
3. decides whether to **fight, offer, or refund**, with reasons;
4. drafts the response with Claude, where every claim links to its source;
5. shows exactly what PayPal will receive;
6. submits through PayPal's Disputes API **only after the seller approves**.

It also tells you when the buyer is right, and finds patterns that prevent the next dispute.

Built for the PayPal AI Hackathon. PayPal **sandbox** only.

*Transparency: built with AI coding assistance. The video voiceover is synthetic (Kokoro TTS).*

![How it works](docs/architecture.png)

## Try it in 60 seconds (no login)

The hosted demo URL will be added after deployment. Locally:

```bash
npm ci && npm run build && npm start      # http://localhost:3000, Replay mode, no keys needed
```

1. **Case board:** $ at risk, whose move it is, and your next deadline. Open disputes are case files, most urgent first ($ × urgency).
2. **"Watch the agent work a case":** the 9-step trace runs live, and records from PayPal, the carrier and your store drop into the case file.
3. **The case file closes:** each claim is tied to its record by a drawn line (claims the server rejects are struck through), and a **DEFEND / OFFER / REFUND** stamp lands.
4. **Response:** an AI-written draft (labelled *recorded*: a real Claude run, replayed at $0). The buyer wrote in Spanish, so the reply is in Spanish with an English gloss. Tap a source ("USPS scan · Delivered 5 Oct") to jump to the record.
5. **"What PayPal receives":** the exact request (endpoint + JSON) and the evidence-pack PDF.
6. **"…and one where refunding is the smart call":** a $9.50 case where the agent says refund, because your time costs more than the dispute.
7. **Insights:** patterns across your cases, each with its cases, and what to change (you approve everything).

Replay uses recorded, redacted responses from the real PayPal sandbox. Carrier scans come from a mock carrier and store logs are sample data; both are labelled wherever they appear.

## Proof: real PayPal sandbox responses

All dispute outcomes in the demo video are real responses from PayPal's sandbox Disputes API (IDs shown on screen). We don't show PayPal's own website to avoid using its brand.

In Live mode, every approve and every sandbox decision shows a **"PayPal API response"** panel with PayPal's actual response: HTTP status, dispute ID, status/outcome and PayPal's `debug_id`, with no personal data. Any case can be re-read with **Verify with PayPal**. Disputes used in the video, for cross-checking:

| Dispute ID | What it shows | PayPal result |
|---|---|---|
| `PP-R-CMR-10190364` | Defended, then decided by PayPal (sandbox adjudicate) | `RESOLVED · SELLER_FAVOUR` (won) |
| `PP-R-RFI-10190369` | Decided for the buyer | `RESOLVED · BUYER_FAVOUR` (lost, $12.50 refunded) |
| `PP-R-MQR-10190375` | Approve and submit: send-message | `200` from `POST …/send-message` |
| *(KC cases, added 12–15 Oct)* | The approve and WON shots in the final video | to be filled from the live shoot |

## How it uses PayPal

| PayPal API | Used for | Where |
|---|---|---|
| **OAuth 2.0** | Client-credentials token, cached server-side | `lib/paypal/client.ts` |
| **Disputes v1** | List and read disputes. Actions: provide evidence (multipart with PDF), make offer, send message, escalate, accept claim, acknowledge return. **HATEOAS-gated**: an action is offered only if PayPal's `links` allow it right now | `lib/paypal/disputes.ts`, `lib/paypal/links.ts` |
| Disputes v1 (sandbox) | `require-evidence`, `adjudicate`, to show the full lifecycle on the real sandbox | "Simulate PayPal's decision" panel |
| **Orders v2** | The order "truth": item, amount, ship-to ZIP (redacted for the AI) | `lib/agent/gateway.ts` |
| **Payments v2** | Capture lookup (capture → order); seller-protection status; funds on hold | `lib/agent/gateway.ts` |
| **Shipment Tracking** | Tracking recorded at PayPal (Add Tracking API). Only these numbers are checked with the carrier | `lib/agent/run.ts` |
| **Webhooks** | `CUSTOMER.DISPUTE.*`, verified with `verify-webhook-signature` (fails closed). `npm run poll` is the local fallback | `app/api/webhooks/paypal` |

**PayPal Agent Toolkit.** We wrap `@paypal/agent-toolkit` with the sandbox forced; its default is *live*, and a test checks this. We extend it with **six custom dispute tools** in the toolkit's own tool shape: provide evidence, make offer, send message, escalate, accept claim with terms, acknowledge return.

`npm run mcp` serves the toolkit's read tools (disputes, orders, shipment tracking, transactions; outputs redacted) plus our six tools as an **MCP server**, for Claude Desktop or any MCP client. Write tools are off unless `DD_MCP_ALLOW_WRITES=1`, and are always HATEOAS-gated.

In Live sandbox mode, the in-app agent reads disputes, orders and shipment tracking **through the Agent Toolkit**; the trace badges say "via Agent Toolkit". The capture → order lookup (Payments, not in the toolkit) uses our sandbox-forced REST client. Every write goes through our six custom tools, HATEOAS-gated. In Replay, the same steps read recorded sandbox responses.

## How it uses AI (Claude)

| Call | When | Guarantees |
|---|---|---|
| **Draft** (Haiku 4.5, 1 call per dispute) | After the rules decide | One forced **strict** tool call. Actions are limited to what PayPal allows now, and citations to gathered evidence refs (both are schema enums). Tracking numbers come from the rules, never from the model |
| **Prevention insights** (Haiku 4.5, 1 call per portfolio, cached) | `/insights` | Actions may cite only pattern ids; any number in the AI text must exist in the cited data |

**Server validation runs on every draft, AI or template.** It:
- drops claims with unknown or missing sources;
- blocks actions PayPal doesn't currently allow, and offers above the disputed amount;
- removes tracking numbers we never gathered;
- enforces PayPal's 2000-character limits;
- removes any **policy or legal outcome** stated as fact ("Seller Protection applies", "you will win", "PayPal must…").

If an AI draft fails validation, the deterministic **TEMPLATE** draft is used and labelled as such.

Claude API spend is logged per call. The totals are in [docs/SPEND.md](docs/SPEND.md), generated by `npm run spend` (the single source of truth). Tests and the public demo cost $0 per visitor: they use the FakeProvider and the recorded drafts.

## Honesty and safety by design

- **No invented evidence.** Every claim cites a `sourceRef` (e.g. `track:USPS:9400…#ev4`), and the UI shows a chip for it.
- **Buyer-fair rules.** If tracking never shows delivery, the item went to another ZIP, or the seller's own records admit a fault, the agent recommends a refund.
- **Confidence, not a fake "win %".** Evidence strength is High, Medium or Low, with reasons.
- **Labels everywhere:**
  - drafts are *AI-written*, *AI-written · recorded*, or *TEMPLATE*;
  - data is *Replay* or *Live sandbox*;
  - each record is *PayPal*, *Carrier (mock)* or *Store (sample)*.
- **Human in the loop.**
  - The seller must tick "I have read this draft"; an approval record is stored **before** any write.
  - PayPal-Request-Id = approval id, so a retry can't double-submit.
  - Replay never writes.
- **Sandbox forced in three places** (env check, toolkit context, base-URL assertion), with tests.
- **Privacy.** Secrets live only in server code, and logs are scrubbed. Buyer emails, addresses, phone numbers and names are redacted before reaching the AI, the logs or the fixtures (fixtures are PII-scanned by the test suite).
- **Public demo guards.** Per-IP rate limits, a daily AI-call cap, a CSRF header on mutating routes, and "Reset demo".

## Architecture

```
Next.js 16 (App Router, TypeScript, Tailwind)
├─ app/                    dashboard · dispute detail + live trace · insights · outcomes
├─ app/api/                agent/run (SSE) · drafts/:id/{preview,pack,approve} · sandbox/simulate
│                          webhooks/paypal · disputes · demo/reset · health
├─ lib/agent/              9-step loop, trace contract, gateway (Replay | Live), validation, approval
├─ lib/paypal/             sandbox-forced client, Agent Toolkit (Live reads + MCP), 6 custom tools, HATEOAS, webhooks
├─ lib/strategy/           rules: evidence strength, buyer-fair, cost to fight, deadline priority
├─ lib/llm/                Claude provider (strict tool), recorded provider, budget + daily cap
├─ lib/insights/           deterministic patterns + one cached AI call
├─ lib/pdf/                evidence pack (pdf-lib)
├─ lib/mcp/                MCP server for the dispute tools
└─ fixtures/               recorded, redacted sandbox responses + recorded AI output
```

## Run locally

Requires Node ≥ 22.12.

```bash
npm ci
npm run build && npm start            # Replay mode: no keys needed
npm test                              # 300+ Vitest tests (no network, FakeProvider)
```

### Live sandbox mode (reproduces the approve flow shown in the video)

You need your own [PayPal sandbox](https://developer.paypal.com) REST app (sandbox credentials only; the app refuses anything but `api-m.sandbox.paypal.com`), with **Customer disputes** enabled, and a sandbox seller account that has disputes. Sandbox buyers can open them on sandbox.paypal.com, and `spikes/m0/` has the seeding scripts we used.

```bash
npm run paypal:key            # hidden input: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV=sandbox → .env.local
npm run build
DD_MODE=live npm start        # reads your real sandbox disputes (via the Agent Toolkit)
# optional: live AI drafts instead of the rules-based TEMPLATE (Claude Haiku 4.5)
npm run claude:key -- /path/to/file-with-CLAUDE_API_KEY && DD_LLM=claude DD_MODE=live npm start
```

What Live mode can write, all to the **sandbox** only, and only actions PayPal currently allows on that dispute (HATEOAS):
- **Approve and submit** (dispute page → tick "I have read this draft…" → Approve): one of send message, make offer, provide evidence (with the evidence-pack PDF), accept claim, or escalate. An approval record is stored first; PayPal-Request-Id = approval id.
- **Simulate PayPal's decision** (sandbox-only panel, shown only when PayPal offers it): `require-evidence`, `adjudicate` (seller or buyer wins).
- Nothing else writes. Replay never writes.

**Other tools:**

```bash
npm run fixtures:record -- <dispute_id> order:<id> trackers:<capture_id>
npm run sandbox:sim -- <dispute_id> adjudicate SELLER_FAVOR
npm run ai:record                     # re-record the AI drafts used by Replay
scripts/video/make-draft.sh           # demo video: Kokoro voice + scripted takes + captions
```

## Limitations

- **Sandbox only.** Some sandbox timings differ from production; for example, `adjudicate` becomes available about 24 min after claim evidence.
- **Demo store data:** carrier scans come from a mock carrier and store/chat logs are sample data. Real integrations would implement `CarrierAdapter` / `StoreAdapter`.
- **Transaction Search** is not used yet (sandbox indexing lag).
- **Validation scope.** The AI's wording is validated for sources, numbers and policy claims, but tone and adjectives still need the seller's review (which approval requires).
- **One instance.** Rate limits are in-memory, which is fine for a single Render instance.
- **Early fixtures.** The first sandbox fixtures carried internal test prefixes ("Spike:", invoice "DD-SPIKE-…"). Replay strips the prefix and shows those invoices as "KC-…" for display; no data is invented.

## License

[MIT](LICENSE) © 2026 Harsha Shinde
