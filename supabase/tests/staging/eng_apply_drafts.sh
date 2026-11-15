#!/usr/bin/env bash
# Rebuild the engineering staging copy and apply the engineering drafts in order.
# LOCAL staging only (PostgreSQL on 127.0.0.1). Never point this at a hosted project.
#   supabase/tests/staging/eng_apply_drafts.sh
# Then: node --test supabase/tests/staging/eng_round2_staging.mjs
set -euo pipefail
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-54329}" PGUSER="${PGUSER:-postgres}"
case "$PGHOST" in 127.0.0.1|localhost|::1) ;; *) echo "refusing host $PGHOST: local staging only" >&2; exit 1;; esac
BASE="${ENG_BASELINE_DB:-tyrepulse_staging}"
DB="${ENG_DB:-tp_eng}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DRAFTS="$HERE/../../pending_migrations"
dropdb --if-exists "$DB"
createdb -T "$BASE" "$DB"
for f in "$DRAFTS"/2026111312[0-5]000_eng*.sql; do
  echo "applying $(basename "$f")"
  psql -X -q -v ON_ERROR_STOP=1 -1 -d "$DB" -f "$f" 2>&1 | grep -v 'NOTICE' || true
done
echo "drafts applied on $DB: $(psql -X -At -d "$DB" -c "select count(*) from _bak.fn_defs_eng_20261113") saved definitions"
