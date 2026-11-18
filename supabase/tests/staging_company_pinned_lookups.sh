#!/usr/bin/env bash
# 20261117113000_company_pinned_lookups: per-asset / per-serial readers stay in
# the caller's company. Runs on a PRIVATE COPY of the LOCAL staging mirror only
# (127.0.0.1). Nothing here touches production.
#
#   supabase/tests/staging_company_pinned_lookups.sh
#   TEMPLATE_DB=tp_mirror2 TEST_DB=tp_cmp_pinned ...   # optional names
#
# Order: parity fingerprints (Alpha ordinary admin, Alpha super admin) ->
# assertions (expected FAIL before) -> migration -> assertions (expected PASS)
# -> ordinary admin byte-identical, super admin now equals ordinary admin ->
# re-run is a no-op -> rollback restores every function byte-identical ->
# re-apply.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PENDING="$HERE/../pending_migrations"
export PGHOST=127.0.0.1 PGPORT="${STAGING_PORT:-54329}" PGUSER=postgres
TEMPLATE_DB="${TEMPLATE_DB:-tp_mirror2}"
TEST_DB="${TEST_DB:-tp_cmp_pinned}"
case "$TEST_DB" in tp_*) ;; *) echo "TEST_DB must start with tp_"; exit 2;; esac
ALPHA_ADMIN=af52a86f-2c24-5ce2-a00d-7ac6ca5d715f   # Alpha Admin, not super admin
ALPHA_SUPER=5eacf3d3-29af-5995-bc52-bcef51b82c38   # Alpha super admin
MIG=20261117113000_company_pinned_lookups

q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$TEST_DB" "$@"; }
assertions() { psql -X -q -At -d "$TEST_DB" -f "$HERE/staging_company_pinned_lookups.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p'; }
parity() { q -v uid="$1" -f "$HERE/staging_company_pinned_lookups_parity.sql" | grep '|'; }
fn_md5() { q -c "select string_agg(md5(pg_get_functiondef(p.oid)), ',' order by p.proname) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('report_asset_overview','report_asset_metrics','check_duplicate_serials','get_unplanned_assets','asset_site_at')"; }
apply() { if q -f "$PENDING/$1" >/dev/null 2>&1; then echo "applied: $1"; else echo "FAILED: $1"; q -f "$PENDING/$1" 2>&1 | grep -m3 -E 'ERROR|FATAL'; exit 1; fi; }

psql -X -q -d postgres -c "drop database if exists $TEST_DB" >/dev/null
psql -X -q -d postgres -c "create database $TEST_DB template $TEMPLATE_DB" >/dev/null
echo "copy: $TEST_DB from $TEMPLATE_DB"

orig_md5="$(fn_md5)"
admin_before="$(parity $ALPHA_ADMIN)"
super_before="$(parity $ALPHA_SUPER)"

echo "--- before the fix"
before="$(assertions)"; echo "$before"
[ "$(echo "$before" | grep -c '^FAIL')" -ge 4 ] || { echo "expected the leaks to show before the fix"; exit 1; }

apply $MIG.sql
echo "--- after the fix"
after="$(assertions)"; echo "$after"
if echo "$after" | grep -q '^FAIL'; then echo "assertions failed"; exit 1; fi
[ "$(echo "$after" | grep -c '^PASS')" -eq 6 ] || { echo "expected 6 PASS lines"; exit 1; }

admin_after="$(parity $ALPHA_ADMIN)"
super_after="$(parity $ALPHA_SUPER)"
[ "$admin_before" = "$admin_after" ] && echo "Alpha ordinary admin output unchanged: yes" || { echo "ordinary admin output changed"; diff <(echo "$admin_before") <(echo "$admin_after"); exit 1; }
# The three definer readers now answer the super admin exactly as an Alpha
# admin. The two invoker helpers still list every company's machines for a
# super admin (RLS); only their joins are fixed, checked by the assertions.
definer() { grep -E '^(report_asset_overview|report_asset_overview_ksa|report_asset_metrics|check_duplicate_serials)\|'; }
[ "$(echo "$super_after" | definer)" = "$(echo "$admin_after" | definer)" ] && echo "Alpha super admin definer readers equal Alpha admin's: yes" || { echo "super admin differs from ordinary admin"; diff <(echo "$admin_after" | definer) <(echo "$super_after" | definer); exit 1; }
echo "super admin outputs that changed (were cross-company):"
diff <(echo "$super_before") <(echo "$super_after") | sed -n 's/^> /  /p' | cut -d'|' -f1 || true

patched_md5="$(fn_md5)"
apply $MIG.sql
[ "$(fn_md5)" = "$patched_md5" ] && echo "re-run is a no-op: yes" || { echo "re-run changed a function"; exit 1; }

apply ${MIG}_ROLLBACK.sql
[ "$(fn_md5)" = "$orig_md5" ] && echo "rollback restores the original text: yes" || { echo "rollback mismatch"; exit 1; }
[ "$(parity $ALPHA_SUPER)" = "$super_before" ] && echo "rollback restores super admin output: yes" || { echo "rollback output mismatch"; exit 1; }

apply $MIG.sql
[ "$(fn_md5)" = "$patched_md5" ] && echo "re-apply after rollback: identical" || { echo "re-apply mismatch"; exit 1; }
psql -X -q -d postgres -c "drop database if exists $TEST_DB" >/dev/null
echo "ALL OK"
