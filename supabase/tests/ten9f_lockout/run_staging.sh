#!/usr/bin/env bash
# TEN-9f standalone lockout tests. LOCAL staging cluster only (refuses any other host).
#   1. fresh copy of the staging mirror (production schema; the six lockout functions
#      are byte-identical to production, checked by md5 below)
#   2. before.sql: reproduces the bypass on the production shape
#   3. apply the migration, after.sql: every check must read ok
#   4. concurrency: 20 parallel failures on one fresh account are all counted
#   5. ROLLBACK file restores the exact production function bodies
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
HOST="${STAGING_HOST:-127.0.0.1}"; PORT="${STAGING_PORT:-54329}"
BASE="${STAGING_DB:-tp_mirror2}"; DB="${TEN9F_DB:-tp_ten9f}"
case "$HOST" in 127.0.0.1|localhost) ;; *) echo "Refusing: local staging only" >&2; exit 1;; esac
P=(psql -X -q -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -U postgres)
MIG="$ROOT/supabase/pending_migrations/20261116100000_ten9f_login_lockout_per_account.sql"
RB="$ROOT/supabase/pending_migrations/20261116100000_ten9f_login_lockout_per_account.ROLLBACK.sql"
PROD_MD5="login_attempt_status=bda4f978f7404a86aa650f9aab6f3f14 record_login_failure=c8a5b4a419e567262e6620c3fb16bbed reset_login_attempts=32867f65d8493dd864f2d00c9e29dc71"
timing() { "${P[@]}" -d "$DB" -f "$HERE/timing.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p' | grep '^timing'; }
md5s() { "${P[@]}" -d "$DB" -At -c "select string_agg(p.proname||'='||md5(pg_get_functiondef(p.oid)),' ' order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('login_attempt_status','record_login_failure','reset_login_attempts')"; }
checks() { "${P[@]}" -d "$DB" -f "$1" 2>&1 | sed -n 's/^.*NOTICE:  //p' | grep -E '^(ok|not ok)'; }

"${P[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB template $BASE" >/dev/null
"${P[@]}" -d "$DB" -f "$HERE/helpers.sql" >/dev/null
OUT=""
[ "$(md5s)" = "$PROD_MD5" ] && OUT+="ok - 0 staging functions byte-identical to production"$'\n' || OUT+="not ok - 0 staging functions differ from production: $(md5s)"$'\n'

echo -n "$OUT"; echo "## before TEN-9f (production shape)"; B="$(checks "$HERE/before.sql")"; echo "$B"
echo "## timing before"; timing
"${P[@]}" -d "$DB" -f "$MIG" >/dev/null || { echo "not ok - migration failed to apply"; exit 1; }
echo "## after TEN-9f"; A="$(checks "$HERE/after.sql")"; echo "$A"
echo "## timing after"; timing
echo "## flood and retention"; F="$(checks "$HERE/retention.sql")"; echo "$F"; A="$A"$'\n'"$F"

echo "## concurrency"
"${P[@]}" -d "$DB" -c "select public.t9f_reset(); update public.system_config set value='50' where key='max_login_attempts'" >/dev/null
for i in $(seq 1 20); do "${P[@]}" -d "$DB" -At -c "select public.record_login_failure('alpha.inspector')" >/dev/null & done; wait
N="$("${P[@]}" -d "$DB" -At -c "select attempt_count from public.login_attempts where identifier='u:7d8d8143-523b-5a02-bc76-6640df4db3d4'")"
"${P[@]}" -d "$DB" -c "select public.t9f_reset(); update public.system_config set value='5' where key='max_login_attempts'" >/dev/null
for i in $(seq 1 12); do "${P[@]}" -d "$DB" -At -c "select public.record_login_failure('alpha.inspector')" >/dev/null & done; wait
L="$("${P[@]}" -d "$DB" -At -c "select (locked_until > now())::text||'/'||attempt_count from public.login_attempts where identifier='u:7d8d8143-523b-5a02-bc76-6640df4db3d4'")"
C=""; [ "$N" = "20" ] && C+="ok - 9a 20 simultaneous failures all counted ($N)"$'\n' || C+="not ok - 9a simultaneous failures counted $N of 20"$'\n'
[ "$L" = "true/5" ] && C+="ok - 9b 12 simultaneous failures lock at exactly 5 ($L)" || C+="not ok - 9b burst lock state $L"
echo "$C"

echo "## rollback"
"${P[@]}" -d "$DB" -f "$RB" >/dev/null || echo "not ok - rollback failed"
R=""; [ "$(md5s)" = "$PROD_MD5" ] && R="ok - 10 rollback restores production function bodies byte for byte" || R="not ok - 10 rollback md5 $(md5s)"
G="$("${P[@]}" -d "$DB" -At -c "select count(*) from pg_proc where proname in ('_login_attempt_key','admin_clear_login_lock','admin_login_lock_status','_login_lock_admin_ok')")"
[ "$G" = "0" ] && R+=$'\n'"ok - 11 rollback removes the new functions" || R+=$'\n'"not ok - 11 $G new functions left"
echo "$R"

"${P[@]}" -d postgres -c "drop database if exists $DB" >/dev/null
ALL="$OUT$A"$'\n'"$C"$'\n'"$R"
PASS=$(echo "$ALL" | grep -c '^ok' || true); FAIL=$(echo "$ALL" | grep -c '^not ok' || true)
BYP=$(echo "$B" | grep -c '^ok' || true)
echo "TEN-9f staging: bypass reproduced on production shape ($BYP/8 checks); after fix $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
