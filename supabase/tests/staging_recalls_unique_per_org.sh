#!/usr/bin/env bash
# 20261117102000_recalls_number_unique_per_org: recall numbers unique per company, country-less
# duplicates refused. Runs on a PRIVATE COPY of the LOCAL staging mirror only (127.0.0.1).
# Nothing here touches production.
#
#   supabase/tests/staging_recalls_unique_per_org.sh
#   TEMPLATE_DB=tp_mirror2 TEST_DB=tp_recalls_test ...   # optional names
#
# Order: assertions (expected FAIL on cases 1 and 3) -> migration -> assertions (PASS) -> a re-run
# changes nothing -> the ROLLBACK block from the migration header restores the old constraint
# byte-identical -> re-apply identical.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PENDING="$HERE/../pending_migrations"
export PGHOST=127.0.0.1 PGPORT="${STAGING_PORT:-54329}" PGUSER=postgres
TEMPLATE_DB="${TEMPLATE_DB:-tp_mirror2}"
TEST_DB="${TEST_DB:-tp_recalls_test}"
case "$TEST_DB" in tp_*) ;; *) echo "TEST_DB must start with tp_"; exit 2;; esac
MIG="$PENDING/20261117102000_recalls_number_unique_per_org.sql"

q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$TEST_DB" "$@"; }
assertions() { psql -X -q -At -d "$TEST_DB" -f "$HERE/staging_recalls_unique_per_org.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p;/ERROR/p'; }
keys() { q -c "select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname) from pg_constraint where conrelid = 'public.recalls'::regclass and contype = 'u'"; }
keys_md5() { q -c "select md5(string_agg(conname || ' ' || pg_get_constraintdef(oid) || ' ' || pg_get_indexdef(conindid), ' | ' order by conname)) from pg_constraint where conrelid = 'public.recalls'::regclass and contype = 'u'"; }
apply_file() { if q -f "$1" >/dev/null 2>&1; then echo "applied: ${2:-$(basename "$1")}"; else echo "FAILED: $1"; q -f "$1" 2>&1 | grep -m3 -E 'ERROR|FATAL'; exit 1; fi; }

# The rollback is the commented block at the foot of the migration: test that exact text.
ROLLBACK_SQL="$(mktemp)"; trap 'rm -f "$ROLLBACK_SQL"' EXIT
sed -n '/^-- ROLLBACK/,$p' "$MIG" | sed -n 's/^--   //p' > "$ROLLBACK_SQL"
grep -q 'add constraint recall_number_country_uniq unique (recall_number, country)' "$ROLLBACK_SQL" || { echo "could not extract the rollback block"; exit 1; }

t0=$(date +%s)
psql -X -q -d postgres -c "drop database if exists $TEST_DB" >/dev/null
psql -X -q -d postgres -c "create database $TEST_DB template $TEMPLATE_DB" >/dev/null
echo "copy: $TEST_DB from $TEMPLATE_DB"
echo "recalls rows: $(q -c 'select count(*) from public.recalls')"
echo "key before: $(keys)"
orig_md5="$(keys_md5)"

echo "--- before the migration"
before="$(assertions)"; echo "$before"
[ "$(echo "$before" | grep -c '^FAIL' || true)" -eq 2 ] || { echo "expected 2 FAIL lines before (cases 1 and 3)"; exit 1; }

apply_file "$MIG"
echo "key after: $(keys)"
echo "--- after the migration"
after="$(assertions)"; echo "$after"
if echo "$after" | grep -q '^FAIL'; then echo "assertions failed"; exit 1; fi
[ "$(echo "$after" | grep -c '^PASS')" -eq 4 ] || { echo "expected 4 PASS lines"; exit 1; }

new_md5="$(keys_md5)"
# The migration drops and re-adds its own constraint, so a second run is a no-op.
if rerun="$(q -f "$MIG" 2>&1)"; then
  echo "re-run succeeded (migration became idempotent)"
else
  echo "$rerun" | grep -q 'recalls_org_number_country_uniq" already exists' || { echo "re-run failed for another reason: $rerun"; exit 1; }
  echo "re-run refused cleanly: relation recalls_org_number_country_uniq already exists"
fi
[ "$(keys_md5)" = "$new_md5" ] && echo "re-run leaves the key unchanged: yes" || { echo "re-run changed the key"; exit 1; }

apply_file "$ROLLBACK_SQL" "ROLLBACK block from the migration header"
[ "$(keys_md5)" = "$orig_md5" ] && echo "rollback restores the old constraint byte-identical: yes ($(keys))" || { echo "rollback mismatch: $(keys)"; exit 1; }

apply_file "$MIG"
[ "$(keys_md5)" = "$new_md5" ] && echo "re-apply after rollback: identical" || { echo "re-apply mismatch"; exit 1; }

psql -X -q -d postgres -c "drop database if exists $TEST_DB" >/dev/null
echo "elapsed: $(( $(date +%s) - t0 ))s"
echo "ALL OK"
