# Deploying the hosted demo (Google Cloud Run)

Nothing here has been run yet. **Deploying makes the demo public, so it needs your approval.** It goes in the same Google Cloud project as Tour Scout (region `us-central1`; the project id is in the private notes) and touches none of Tour Scout's resources.

## What the hosted demo is

- **Replay mode only** (`DD_MODE=replay`): the recorded, redacted PayPal sandbox data and the recorded real Claude drafts. No login, nothing is ever written to PayPal, $0 per visitor.
- **No secrets in the service.** No PayPal credentials; no Claude key unless you approve the optional live-AI button (`live-ai-on`, capped at 30 calls a day).
- **Ephemeral store:** SQLite at `/tmp/dd.db` per instance; "Reset demo" and a restart rebuild it from the fixtures.
- **Rate limits** (in the app): runs 20/min/IP, writes 5/min/IP, reset 3/min/IP.

## How long it stays up

**The hosted demo must stay up, unchanged and working, until the Judging Period ends: 15 Dec 2026, 8:00 am Pacific (21:30 IST)** (the rules: available "until the Judging Period ends", not just until submission). So:
- run `judging-on` before submission and leave it on until 15 Dec; run `judging-off` (or delete the service) only after 15 Dec;
- never delete the service, the image or the project before then; roll back (below) instead of tearing down;
- the budget stays alert-only, never a cap, so judges never hit an error.

## Cost guard

- An **alert-only** budget (`dispute-defender`, ₹850, label `app=dispute-defender`) emails at 50%, 90% and 100%. It is **never a cap**: judges must never hit errors, so nothing is switched off automatically.
- Scale to zero (min 0, max 1 instance, 1 vCPU, 512 MiB; in-memory rate limits assume one instance) until judging; `judging-on` sets min instances 1 so judges never wait for a cold start, `judging-off` sets it back.

## Steps (`scripts/deploy-cloudrun.sh`)

```bash
gcloud auth login && gcloud config set project <PROJECT_ID>
scripts/deploy-cloudrun.sh plan                                  # prints everything below, changes nothing
scripts/deploy-cloudrun.sh setup                                 # APIs, build permissions, runtime service account
BILLING_ACCOUNT=<BILLING_ACCOUNT_ID> scripts/deploy-cloudrun.sh budget
CONFIRM_PUBLIC=1 scripts/deploy-cloudrun.sh deploy               # Cloud Build from ./Dockerfile, then the smoke test
scripts/deploy-cloudrun.sh verify                                # /api/health, pages, one Replay agent run
scripts/deploy-cloudrun.sh judging-on                            # before judging starts; judging-off after
```

The smoke test checks `/api/health` (`{"ok":true,"mode":"replay",...}`), `/`, `/insights`, `/outcomes`, the café case page and one agent run that streams a draft. Then check it by hand on a phone and a laptop.

After the deploy: put the URL in `video/config.json` (`demoUrl`, with `repoUrl` once the repo is public), the README and `docs/SUBMISSION.md`, then render the final cut with `FINAL=1 REPLAY_TAKES=0 SKIP_VOICE=1 scripts/video/make-story.sh`.

## Optional: live AI on the hosted demo

`LIVE_AI=1 scripts/deploy-cloudrun.sh live-ai-on` stores `CLAUDE_API_KEY` (from `.env.local`, never printed) as the secret `dd-claude-api-key` and turns on the "Fresh draft with live AI" button, capped at 30 Claude Haiku calls a day. The key's credit is shared with other projects, so only with your OK. `live-ai-off` removes it.

## Webhooks

Not needed for Replay. Live mode on a host would need `/api/webhooks/paypal` registered on the sandbox app by hand on developer.paypal.com (no automation there) and `PAYPAL_WEBHOOK_ID` set.

## Rollback

Cloud Run keeps every revision: `gcloud run services update-traffic dispute-defender --region us-central1 --to-revisions <REVISION>=100`.

## Alternative: Render

`render.yaml` is the earlier Render Blueprint (Starter plan). It is kept for reference only; the plan of record is Cloud Run.
