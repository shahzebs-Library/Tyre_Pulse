#!/usr/bin/env bash
# Work order permission drafts (WO-1 to WO-4) on a private copy of the LOCAL staging database.
# Synthetic companies only. Refuses anything that is not 127.0.0.1. Nothing here touches production.
#
#   supabase/tests/staging_work_order_permissions.sh            # copy, apply, run the matrix
#   TEMPLATE_DB=tyrepulse_staging TEST_DB=tp_workorder_test ...  # optional names
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PENDING="$HERE/../pending_migrations"
export PGHOST=127.0.0.1 PGPORT="${STAGING_PORT:-54329}" PGUSER=postgres
TEMPLATE_DB="${TEMPLATE_DB:-tyrepulse_staging}"
TEST_DB="${TEST_DB:-tp_wo3}"
case "$TEST_DB" in tp_*) ;; *) echo "TEST_DB must start with tp_"; exit 2;; esac

q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$TEST_DB" "$@"; }
hash_rows() { q -c "select md5(coalesce(string_agg(md5(w::text), '' order by w.id), '')) || ' rows=' || count(*) from public.work_orders w"; }

psql -X -q -d postgres -c "drop database if exists $TEST_DB" >/dev/null
psql -X -q -d postgres -c "create database $TEST_DB template $TEMPLATE_DB" >/dev/null
echo "copy: $TEST_DB from $TEMPLATE_DB"
before="$(hash_rows)"

for f in 20261113130000_cur_work_orders_manager_director_default.sql \
         20261115140000_wo_permission_resolver.sql \
         20261115140500_wo_policies_and_guards.sql \
         20261115141000_wo_supervisor_module_visibility.sql \
         20261115141500_wo_cost_approval_not_collector.sql; do
  if out="$(q -f "$PENDING/$f" 2>&1 >/dev/null)"; then echo "applied: $f"
  else echo "FAILED: $f"; echo "$out" | grep -m3 -E 'ERROR|FATAL'; exit 1; fi
done
after_apply="$(hash_rows)"

echo "--- matrix"
q -f "$HERE/staging_work_order_permissions.sql" | grep -E '^(FAIL|cases=)' || true
after_tests="$(hash_rows)"

echo "--- stored work orders (md5 over every row)"
echo "before drafts : $before"
echo "after drafts  : $after_apply"
echo "after matrix  : $after_tests"
[ "$before" = "$after_apply" ] && [ "$before" = "$after_tests" ] && echo "work orders unchanged: yes" || { echo "work orders unchanged: NO"; exit 1; }
