#!/usr/bin/env bash
# Settings for the stored-PDF storage test stack. No key or password is stored here; everything
# generated (JWT secret, keys, logs, build, stored files) is written OUTSIDE the repository.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PDF_E2E_DIR="$HERE"
export PDF_E2E_REPO="$(cd "$HERE/../.." && pwd)"
export PDF_E2E_RUN="${PDF_E2E_RUN:?set PDF_E2E_RUN to a folder outside the repository}"
export PGHOST_E2E="${PGHOST_E2E:-127.0.0.1}"
export PGPORT_E2E="${PGPORT_E2E:-54329}"
export PDF_E2E_TEMPLATE_DB="${PDF_E2E_TEMPLATE_DB:-tyrepulse_staging}"
export PDF_E2E_DB="${PDF_E2E_DB:-tp_pdf_e2e}"
export PGRST_PORT="${PGRST_PORT:-54340}"
export STORAGE_PORT="${STORAGE_PORT:-54341}"
export GATEWAY_PORT="${GATEWAY_PORT:-54343}"
export WEB_PORT="${WEB_PORT:-5197}"
export POSTGREST_BIN="${POSTGREST_BIN:?set POSTGREST_BIN to a PostgREST 12 binary}"
# A checkout of github.com/supabase/storage (tag v1.11.13) with `npm ci` done. See README.
export STORAGE_API_SRC="${STORAGE_API_SRC:?set STORAGE_API_SRC to a supabase/storage checkout with node_modules}"
export E2E_ACCOUNTS_FILE="${E2E_ACCOUNTS_FILE:?set E2E_ACCOUNTS_FILE to the synthetic staging accounts file}"
PROD_REF="jhssdmeruxtrlqnwfksc"
case "$PGHOST_E2E" in 127.0.0.1|localhost) ;; *) echo "Refusing: the test stack only runs against a local database" >&2; exit 1;; esac
case "$PDF_E2E_RUN/" in "$PDF_E2E_REPO"/*) echo "Refusing: run folder must be outside the repository" >&2; exit 1;; esac
if env | grep -q "$PROD_REF"; then echo "Refusing: an environment variable names the production project" >&2; exit 1; fi
psqle() { psql -X -q -v ON_ERROR_STOP=1 -h "$PGHOST_E2E" -p "$PGPORT_E2E" -U postgres "$@"; }
