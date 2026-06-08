#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-edge-functions.sh
# Deploys all Supabase Edge Functions to production.
#
# Usage:
#   ./scripts/deploy-edge-functions.sh <project-ref>
#   ./scripts/deploy-edge-functions.sh <project-ref> chat-ai   # single function
#
# Prerequisites:
#   npm install -g supabase
#   supabase login
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_REF="${1:-}"
TARGET_FN="${2:-all}"

if [[ -z "$PROJECT_REF" ]]; then
  echo "Usage: $0 <project-ref> [function-name|all]"
  echo ""
  echo "Find your project ref in:"
  echo "  Supabase Dashboard → Project Settings → General → Reference ID"
  exit 1
fi

FUNCTIONS=(chat-ai generate-embedding send-email)

deploy_fn() {
  local fn="$1"
  echo "→ Deploying $fn ..."
  supabase functions deploy "$fn" \
    --project-ref "$PROJECT_REF" \
    --no-verify-jwt
  echo "  ✓ $fn deployed"
}

if [[ "$TARGET_FN" == "all" ]]; then
  for fn in "${FUNCTIONS[@]}"; do
    deploy_fn "$fn"
  done
else
  deploy_fn "$TARGET_FN"
fi

echo ""
echo "✓ Done. Set secrets in Supabase Dashboard:"
echo "  Dashboard → Edge Functions → Manage Secrets"
echo ""
echo "  Required secrets:"
echo "    ANTHROPIC_API_KEY   → for chat-ai"
echo "    OPENAI_API_KEY      → for generate-embedding"
echo "    RESEND_API_KEY      → for send-email"
echo "    FROM_EMAIL          → e.g. reports@yourdomain.com"
