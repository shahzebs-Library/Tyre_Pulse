#!/usr/bin/env bash
# Shared settings for the local browser test stack. No key or password is stored here.
# Everything generated (JWT secret, anon key, logs, build output) is written OUTSIDE the repository.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export E2E_DIR="$HERE"
export REPO_ROOT="$(cd "$HERE/../.." && pwd)"
export E2E_RUN="${E2E_RUN:-/tmp/claude-0/-home-user-Tyre-Pulse/f5f47d6f-b333-5be3-b15d-8e39da2bbfea/scratchpad/e2e}"
export PGHOST_E2E="${PGHOST_E2E:-127.0.0.1}"
export PGPORT_E2E="${PGPORT_E2E:-54329}"
export E2E_TEMPLATE_DB="${E2E_TEMPLATE_DB:-tyrepulse_staging}"
export E2E_DB="${E2E_DB:-tyrepulse_e2e}"
export PGRST_PORT="${PGRST_PORT:-54330}"
export GATEWAY_PORT="${GATEWAY_PORT:-54331}"
export WEB_PORT="${WEB_PORT:-5199}"
export POSTGREST_BIN="${POSTGREST_BIN:-$E2E_RUN/dl/postgrest}"
export E2E_ACCOUNTS_FILE="${E2E_ACCOUNTS_FILE:-/tmp/claude-0/-home-user-Tyre-Pulse/f5f47d6f-b333-5be3-b15d-8e39da2bbfea/scratchpad/staging_test_accounts.txt}"
PROD_REF="jhssdmeruxtrlqnwfksc"
case "$PGHOST_E2E" in 127.0.0.1|localhost) ;; *) echo "Refusing: the test stack only runs against a local database" >&2; exit 1;; esac
case "$E2E_RUN/" in "$REPO_ROOT"/*) echo "Refusing: run folder must be outside the repository" >&2; exit 1;; esac
if env | grep -q "$PROD_REF"; then echo "Refusing: an environment variable names the production project" >&2; exit 1; fi
psqle() { psql -X -q -v ON_ERROR_STOP=1 -h "$PGHOST_E2E" -p "$PGPORT_E2E" -U postgres "$@"; }
