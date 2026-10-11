#!/usr/bin/env bash
# Dispute Defender on Google Cloud Run: the public demo in Replay mode (docs/DEPLOY.md has the guide).
# Nothing here runs without being asked; `plan` (the default) changes nothing.
#
#   scripts/deploy-cloudrun.sh plan                       print what would be created, change nothing
#   scripts/deploy-cloudrun.sh setup                      APIs, build permissions, runtime service account
#   BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX scripts/deploy-cloudrun.sh budget   alert-only budget (never a cap)
#   CONFIRM_PUBLIC=1 scripts/deploy-cloudrun.sh deploy    build from source (Dockerfile) and deploy, public URL
#   scripts/deploy-cloudrun.sh verify                     health check and a Replay smoke test
#   scripts/deploy-cloudrun.sh judging-on | judging-off   min instances 1 for the judging window, then back to 0
#   LIVE_AI=1 scripts/deploy-cloudrun.sh live-ai-on       optional: the capped "fresh draft" button (needs the user's OK)
#   scripts/deploy-cloudrun.sh live-ai-off                remove it again (Replay drafts stay)
#
# bash on Linux (incl. WSL2) or macOS. Needs gcloud, logged in, with the project set.
# The public service carries NO PayPal secrets: Replay serves recorded, redacted sandbox data and never
# writes to PayPal. The only optional secret is the Claude key for live-ai-on, read from the environment or
# .env.local and piped to Secret Manager, never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=${PROJECT:-$(gcloud config get-value project 2>/dev/null)}
REGION=${REGION:-us-central1}
SERVICE=${SERVICE:-dispute-defender}
SA_NAME=dispute-defender-run
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
SECRET=dd-claude-api-key
LABEL="app=dispute-defender"
# Alert-only budget in the billing account's currency (INR for this account), for this service's label only.
BUDGET_AMOUNT=${BUDGET_AMOUNT:-850}
[[ -n "$PROJECT" ]] || { echo "No project: run gcloud config set project <PROJECT_ID>" >&2; exit 1; }

say() { printf '\n== %s\n' "$*"; }

secret_value() {
  local key=$1 v=${!1:-}
  if [[ -z "$v" && -f .env.local ]]; then v=$(tr -d '\r' < .env.local | grep -E "^${key}=" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'); fi
  printf '%s' "$v"
}

plan() {
  cat <<EOF
Project        $PROJECT
Region         $REGION
Service        $SERVICE  (min 0, max 1 instance; 1 vCPU, 512 MiB; request-based CPU; public; label $LABEL)
Image          built by Cloud Build from ./Dockerfile (Node 22, next start; fixtures baked in; no secrets)
Env            deploy/cloudrun.env.yaml: PAYPAL_ENV=sandbox, DD_MODE=replay, DD_DB_PATH=/tmp/dd.db (ephemeral by design)
Secrets        none. Optional live-ai-on: $SECRET <- CLAUDE_API_KEY, plus DD_LLM=claude, LLM_MAX_CALLS_PER_DAY=30
Service acct   $SA  (no roles; secret accessor on $SECRET only if live-ai-on)
Build perms    default compute SA: roles/cloudbuild.builds.builder + roles/run.builder (source deploys)
Budget         alert-only budget "dispute-defender", ${BUDGET_AMOUNT} in the account's currency, label $LABEL,
               alerts at 50%, 90%, 100% (email to billing admins). No cap, nothing is ever switched off.
Judging        judging-on sets min instances 1 (no cold start for judges); judging-off sets it back to 0.
Not touched    Tour Scout's service, bucket, secrets and budget in the same project.
EOF
}

setup() {
  say "APIs"
  gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
    secretmanager.googleapis.com iam.googleapis.com billingbudgets.googleapis.com --project "$PROJECT"
  say "Build permissions (source deploys build as the default compute service account)"
  local number
  number=$(gcloud projects describe "$PROJECT" --format 'value(projectNumber)')
  for role in roles/cloudbuild.builds.builder roles/run.builder; do
    gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:${number}-compute@developer.gserviceaccount.com" \
      --role "$role" --condition None >/dev/null
  done
  say "Runtime service account (no roles)"
  gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1 \
    || gcloud iam service-accounts create "$SA_NAME" --display-name "Dispute Defender (Cloud Run runtime)" --project "$PROJECT"
}

budget() {
  [[ -n "${BILLING_ACCOUNT:-}" ]] || { echo "Set BILLING_ACCOUNT (gcloud billing accounts list)" >&2; exit 1; }
  if gcloud billing budgets list --billing-account "$BILLING_ACCOUNT" --format 'value(displayName)' | grep -qx "dispute-defender"; then
    echo "budget dispute-defender exists"; return
  fi
  local currency=${BUDGET_CURRENCY:-$(gcloud billing accounts describe "$BILLING_ACCOUNT" --format 'value(currencyCode)')}
  # Alerts only: a budget never stops spending.
  gcloud billing budgets create --billing-account "$BILLING_ACCOUNT" --display-name dispute-defender \
    --budget-amount "${BUDGET_AMOUNT}${currency:-INR}" --filter-projects "projects/$PROJECT" --filter-labels "$LABEL" \
    --threshold-rule percent=0.5 --threshold-rule percent=0.9 --threshold-rule percent=1.0
}

deploy() {
  [[ "${CONFIRM_PUBLIC:-}" == "1" ]] || { echo "Deploying makes the demo public. Re-run with CONFIRM_PUBLIC=1 once approved." >&2; exit 1; }
  say "Build (Cloud Build, Dockerfile) and deploy"
  gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" --source . \
    --service-account "$SA" --allow-unauthenticated --labels "$LABEL" \
    --cpu 1 --memory 512Mi --cpu-boost --min-instances 0 --max-instances 1 --concurrency 80 --timeout 300 \
    --env-vars-file deploy/cloudrun.env.yaml
  verify
}

verify() {
  local url
  url=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')
  say "Health: $url/api/health"
  curl -fsS "$url/api/health"; echo
  say "Replay smoke test (no PayPal or Claude calls)"
  for p in / /insights /outcomes /disputes/PP-R-FWW-10190477 "/disputes/PP-R-FWW-10190477?rewind=1"; do
    curl -fsS -o /dev/null -w "$p %{http_code} in %{time_total}s\n" "$url$p"
  done
  curl -fsS --max-time 60 "$url/api/agent/run?dispute=PP-R-FWW-10190477&pace=0" | grep -c '^event: draft' | sed 's/^/agent run drafts: /'
  # The featured case ("Watch the agent work a case"), rewound to before PayPal's decision: must end ready to approve.
  curl -fsS --max-time 60 "$url/api/agent/run?dispute=PP-R-FWW-10190477&pace=0&rewind=1" | grep -c 'Ready for you to review' | sed 's/^/featured run ready for approval: /'
}

live_ai() {
  if [[ "$1" == on ]]; then
    [[ "${LIVE_AI:-}" == "1" ]] || { echo "Live AI spends Claude credit. Re-run with LIVE_AI=1 once approved." >&2; exit 1; }
    if ! gcloud secrets describe "$SECRET" --project "$PROJECT" >/dev/null 2>&1; then
      local value; value=$(secret_value CLAUDE_API_KEY)
      [[ -n "$value" ]] || { echo "CLAUDE_API_KEY is not set (env or .env.local)" >&2; exit 1; }
      printf '%s' "$value" | gcloud secrets create "$SECRET" --project "$PROJECT" --replication-policy automatic --data-file=- >/dev/null
      echo "created secret $SECRET"
    fi
    gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT" --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor >/dev/null
    gcloud run services update "$SERVICE" --project "$PROJECT" --region "$REGION" \
      --update-env-vars "DD_LLM=claude,LLM_MAX_CALLS_PER_DAY=30" --update-secrets "CLAUDE_API_KEY=${SECRET}:latest"
  else
    gcloud run services update "$SERVICE" --project "$PROJECT" --region "$REGION" \
      --remove-env-vars "DD_LLM,LLM_MAX_CALLS_PER_DAY" --remove-secrets "CLAUDE_API_KEY"
  fi
  verify
}

judging() {
  gcloud run services update "$SERVICE" --project "$PROJECT" --region "$REGION" --min-instances "$([[ "$1" == on ]] && echo 1 || echo 0)"
  verify
}

case "${1:-plan}" in
  plan) plan ;;
  setup) plan; setup ;;
  budget) budget ;;
  deploy) deploy ;;
  verify) verify ;;
  judging-on) judging on ;;
  judging-off) judging off ;;
  live-ai-on) live_ai on ;;
  live-ai-off) live_ai off ;;
  *) echo "usage: $0 plan|setup|budget|deploy|verify|judging-on|judging-off|live-ai-on|live-ai-off" >&2; exit 2 ;;
esac
