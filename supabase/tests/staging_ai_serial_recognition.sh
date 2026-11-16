#!/usr/bin/env bash
# DRAFT AI serial recognition (pending migration 20261117130000). Runs on a PRIVATE COPY of the
# LOCAL staging mirror only (127.0.0.1). Nothing here touches production.
#
#   supabase/tests/staging_ai_serial_recognition.sh
#   TEMPLATE_DB=tp_mirror2 TEST_DB=tp_ai_serial ...   # optional names
#
# Order: apply -> SQL/JS mirror over the shared fixture -> behaviour assertions (rolled back)
# -> re-apply is a no-op -> ROLLBACK removes every object -> re-apply.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$HERE/../.."
PENDING="$HERE/../pending_migrations"
MIG=20261117130000_ai_tyre_serial_recognition.sql
export PGHOST=127.0.0.1 PGPORT="${STAGING_PORT:-54329}" PGUSER=postgres
TEMPLATE_DB="${TEMPLATE_DB:-tp_mirror2}"
TEST_DB="${TEST_DB:-tp_ai_serial}"
case "$TEST_DB" in tp_*) ;; *) echo "TEST_DB must start with tp_"; exit 2;; esac

q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$TEST_DB" "$@"; }
apply() { if q -f "$PENDING/$1" >/dev/null 2>&1; then echo "applied: $1"; else echo "FAILED: $1"; q -f "$PENDING/$1" 2>&1 | grep -m3 -E 'ERROR|FATAL'; exit 1; fi; }
objects() { q -c "select count(*) from pg_proc where proname like 'ai_tyre_serial%'" -c "select count(*) from pg_class where relname like 'ai_tyre_serial%' and relkind='r'" | paste -sd/; }
defs_md5() { q -c "select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) from pg_proc p where proname like 'ai_tyre_serial%'"; }

psql -X -q -d postgres -c "drop database if exists $TEST_DB" >/dev/null
psql -X -q -d postgres -c "create database $TEST_DB template $TEMPLATE_DB" >/dev/null
echo "copy: $TEST_DB from $TEMPLATE_DB"

apply "$MIG"
echo "objects (functions/tables): $(objects)"

echo "--- SQL mirror of compareSerial over src/test/fixtures/aiSerialOutcomeCases.json"
mirror_sql="$(node -e '
const c = require(process.argv[1]).cases;
const lit = (v) => v === null ? "null" : "$q$" + v + "$q$";
const arr = (a) => "array[" + a.map(lit).join(",") + "]::text[]";
console.log(c.map((x) => "select " + lit(x.name) + " as name, " + lit(x.outcome) + " as want_o, " + lit(x.reason) +
  " as want_r, public.ai_tyre_serial_outcome(" + [lit(x.status), lit(x.confidence), lit(x.normalized), lit(x.position), arr(x.registered)].join(",") + ") as got").join(" union all "));
' "$ROOT/src/test/fixtures/aiSerialOutcomeCases.json")"
mirror="$(q -c "select case when got->>'outcome' = want_o and got->>'reason' = want_r then 'PASS ' else 'FAIL ' end || name || ' -> ' || (got->>'outcome') from ($mirror_sql) t")"
echo "$mirror"
echo "$mirror" | grep -q '^FAIL' && { echo "mirror mismatch"; exit 1; }

echo "--- behaviour (rolled back)"
out="$(psql -X -q -At -d "$TEST_DB" -f "$HERE/staging_ai_serial_recognition.sql" 2>&1 | sed -n 's/^.*NOTICE:  //p')"
echo "$out"
echo "$out" | grep -q '^FAIL' && { echo "assertions failed"; exit 1; }
[ "$(echo "$out" | grep -c '^PASS')" -ge 25 ] || { echo "expected at least 25 PASS lines"; exit 1; }

before="$(defs_md5)"
apply "$MIG"
[ "$(defs_md5)" = "$before" ] && echo "re-apply is a no-op: yes" || { echo "re-apply changed functions"; exit 1; }

apply 20261117130000_ai_tyre_serial_recognition_ROLLBACK.sql
[ "$(objects)" = "0/0" ] && echo "rollback removes every object: yes" || { echo "rollback left: $(objects)"; exit 1; }

apply "$MIG"
[ "$(defs_md5)" = "$before" ] && echo "re-apply after rollback: identical" || { echo "re-apply mismatch"; exit 1; }
psql -X -q -d postgres -c "drop database if exists $TEST_DB" >/dev/null
echo "ALL OK"
