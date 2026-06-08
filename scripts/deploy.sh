#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — Full deployment: build + push to main (Vercel auto-deploys)
#
# Usage: ./scripts/deploy.sh "commit message"
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

MSG="${1:-Deploy: $(date +%Y-%m-%d)}"
BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo "── Building ..."
npm run build

echo "── Committing on $BRANCH ..."
git add -A
git commit -m "$MSG" --allow-empty

echo "── Pushing $BRANCH ..."
git push -u origin "$BRANCH"

if [[ "$BRANCH" != "main" ]]; then
  echo "── Merging to main for Vercel deployment ..."
  git checkout main
  git pull origin main --rebase
  git merge "$BRANCH" --no-edit
  git push origin main
  git checkout "$BRANCH"
fi

echo ""
echo "✓ Deployed. Vercel will auto-build from main."
