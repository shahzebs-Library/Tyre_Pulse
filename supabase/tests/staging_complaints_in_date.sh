#!/usr/bin/env bash
# process_stg_complaints: a blank / unreadable Vehicle In Date skips that row with a
# recorded reason instead of aborting the whole batch. Runs on a PRIVATE COPY of the
# LOCAL staging mirror only (127.0.0.1). Nothing here touches production.
#
#   supabase/tests/staging_complaints_in_date.sh
#   TEMPLATE_DB=tp_mirror2 TEST_DB=tp_cmp_indate ...   # optional names
#
# Order: by-number draft -> assertions (expected FAIL: batch aborts) -> this fix ->
# assertions (expected PASS) -> re-run is a no-op -> rollback restores the by-number
# text byte-identical -> re-apply.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PENDING="$HERE/../pending_migrations"
export PGHOST=127.0.0.1 PGPORT="${STAGING_PORT:-54329}" PGUSER=postgres
TEMPLATE_DB="${TEMPLATE_DB:-tp_mirror2}"
TEST_DB="${TEST_DB:-tp_cmp_indate}"
case "$TEST_DB" in tp_*) ;; *) echo "TEST_DB must start with tp_"; exit 2;; esac

q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$TEST_DB" "$@"; }
assertions() { psql -X -q -At -d "$TEST_DB" -f "$HERE/staging_complaints_in_date.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p'; }
fn_md5() { q -c "select md5(pg_get_functiondef('public.process_stg_complaints()'::regprocedure))"; }
apply() { if q -f "$PENDING/$1" >/dev/null 2>&1; then echo "applied: $1"; else echo "FAILED: $1"; q -f "$PENDING/$1" 2>&1 | grep -m3 -E 'ERROR|FATAL'; exit 1; fi; }

psql -X -q -d postgres -c "drop database if exists $TEST_DB" >/dev/null
psql -X -q -d postgres -c "create database $TEST_DB template $TEMPLATE_DB" >/dev/null
echo "copy: $TEST_DB from $TEMPLATE_DB"

apply 20261117110000_by_number_org_joins.sql
by_number_md5="$(fn_md5)"

echo "--- before the fix"
before="$(assertions)"; echo "$before"
echo "$before" | grep -q '^FAIL batch aborted' || { echo "expected the batch to abort before the fix"; exit 1; }

apply 20261117112000_complaints_missing_in_date_reject.sql
echo "--- after the fix"
after="$(assertions)"; echo "$after"
if echo "$after" | grep -q '^FAIL'; then echo "assertions failed"; exit 1; fi
[ "$(echo "$after" | grep -c '^PASS')" -eq 8 ] || { echo "expected 8 PASS lines"; exit 1; }

patched_md5="$(fn_md5)"
apply 20261117112000_complaints_missing_in_date_reject.sql
[ "$(fn_md5)" = "$patched_md5" ] && echo "re-run is a no-op: yes" || { echo "re-run changed the function"; exit 1; }

apply 20261117112000_complaints_missing_in_date_reject_ROLLBACK.sql
[ "$(fn_md5)" = "$by_number_md5" ] && echo "rollback restores the by-number text: yes" || { echo "rollback mismatch"; exit 1; }

apply 20261117112000_complaints_missing_in_date_reject.sql
[ "$(fn_md5)" = "$patched_md5" ] && echo "re-apply after rollback: identical" || { echo "re-apply mismatch"; exit 1; }
echo "ALL OK"
