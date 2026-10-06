# Deploying the hosted demo (Render): steps for the user

Nothing here has been run. The Blueprint is `render.yaml`. **Deploying costs money and makes the demo public, so it needs your approval.** PLAN §8 budget: Starter ($7/month, prorated per second) from about 10 Nov to 21 Dec ≈ **$9.50**.

## What the hosted demo is

- **Replay mode** (`DD_MODE=replay`): the recorded, redacted PayPal sandbox data. No login, and nothing is ever written to PayPal.
- **AI drafts** are the recorded real Claude runs, so they cost $0 per visitor. The "Fresh draft with live AI" button makes a real Haiku call; it is limited per IP (3 per 10 min) and globally (`LLM_MAX_CALLS_PER_DAY=40`, at most ≈ $0.30/day).
- **Rate limits:** runs 20/min/IP, writes 5/min/IP, reset 3/min/IP. The SQLite store is ephemeral (`/tmp`) by design.

## Steps (you, in a browser; about 15 minutes)

1. **GitHub.** The code needs to be on GitHub under `xexpertai`. Render can deploy a *private* repo through its GitHub app, so the repo does not have to be public before the deploy. Making it public is a separate step you approve, and it's required for the Devpost submission.
2. **Render account.** Sign in at dashboard.render.com, then add a payment method (needed for Starter).
3. **New → Blueprint →** pick the `dispute-defender` repo. Render reads `render.yaml` and shows one web service, `dispute-defender` (Starter, Oregon).
4. **Enter the secret env vars** when prompted. They are never committed:
   - `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`: the **sandbox** app "Dispute Defender" (developer.paypal.com → Apps & Credentials → Sandbox).
   - `CLAUDE_API_KEY`: the same key as in `.env.local`. Leave it empty to turn off live AI; recorded drafts still work.
   - `PAYPAL_WEBHOOK_ID`: leave empty for now (step 7).
5. **Apply.** The first build takes about 3–5 min. Then open `https://<service>.onrender.com/api/health`. It should say `{"ok":true,"mode":"replay",...}`.
6. **Smoke test** on a phone and a laptop:
   - dashboard → "Watch the agent defend a dispute" → trace → AI-written (recorded) draft;
   - `/insights`;
   - `/outcomes`;
   - "Reset demo".
7. **Webhook** (optional for Replay; needed if you later run Live on Render):
   - developer.paypal.com → your sandbox app → **Add Webhook**;
   - URL `https://<service>.onrender.com/api/webhooks/paypal`;
   - events `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`, `CUSTOMER.DISPUTE.RESOLVED`;
   - copy the Webhook ID into `PAYPAL_WEBHOOK_ID` on Render and redeploy.

   Please do this by hand: automation on developer.paypal.com is not allowed.
8. **Keep it up through judging** (1–15 Dec) and the winner announcement. Then downgrade or suspend the service to stop billing.

## Notes

- **Free tier.** Change `plan: starter` to `plan: free` to try it at $0. It sleeps after 15 min idle (about 1 min cold start for judges) and has no keep-alive ping (Render's terms don't explicitly allow one).
- **Node version:** `NODE_VERSION=22.12.0` (the app needs ≥ 22.12). `better-sqlite3` builds natively on Render's image.
- **Rollback:** Render keeps previous deploys, so "Rollback" in the service's Events tab.
