#!/usr/bin/env bash
# Launch the GTM trigger service locally, pointed at the live gtm-crm Supabase
# project, so the CRM's "Run pipeline / AI Search" buttons work.
#
#   bash gtm_service/run-local.sh
#
# Then make sure pipero.in/.env.local has:
#   GTM_SERVICE_URL=http://localhost:8080
#   GTM_SERVICE_TOKEN=gtm-local-dev-token
# and restart `npm run dev`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Pull the keys this shell needs from the root .env: the phase API keys plus the
# scheduler's CRM-worker wiring (CRM_BASE_URL, ENGAGE_WORKER_TOKEN, SCHEDULER_ENABLED).
# NOTE: a `source <(grep ... .env)` block silently exports NOTHING under this
# script's `set -euo pipefail` on macOS bash 3.2 — which used to leave
# CRM_BASE_URL empty so the scheduler never pinged the CRM worker. Read line by
# line and export explicitly so it works regardless of shell.
while IFS= read -r _envline; do
  [ -n "$_envline" ] && export "$_envline"
done < <(grep -E '^(OPENAI_API_KEY|SERP_API_KEY|HUNTER_API_KEY|CRM_BASE_URL|ENGAGE_WORKER_TOKEN|SCHEDULER_ENABLED)=' .env)

# ... then OVERRIDE Supabase + org so everything writes to the fresh gtm-crm project.
export SUPABASE_URL="https://afgdasedvgrtmdiqqeen.supabase.co"
export SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZ2Rhc2VkdmdydG1kaXFxZWVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1ODY1NzgsImV4cCI6MjA5NjE2MjU3OH0.TJTnpUJjX9-0OyFqOIwZVOpGj9-J4e5ZHBnpknFiu5c"
export SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_KEY"
export GTM_ORG_ID="479f7925-1495-4be4-9c86-cf489442ee4a"
export GTM_TRIGGER_TOKEN="gtm-local-dev-token"
export GTM_PYTHON_BIN="$REPO_ROOT/.venv/bin/python"

echo "Starting gtm_service on http://localhost:${PORT:-8080}  (project: gtm-crm)"
exec "$REPO_ROOT/.venv/bin/python" -m uvicorn gtm_service.app:app --host 0.0.0.0 --port "${PORT:-8080}"
