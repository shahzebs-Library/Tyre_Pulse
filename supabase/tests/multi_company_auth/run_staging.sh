#!/usr/bin/env bash
# Multi-company sign-in + invitation tests (PR #546). LOCAL staging cluster only.
#   1. fresh private copy of the staging mirror (production schema + rollout migrations)
#   2. fixture (assertion helpers + one synthetic field account)
#   3. tests.sql as production stands today (5j/5k = the TEN-9d defect, expected to fail)
#   4. apply the TEN-9d, 9e, 9f drafts, re-run tests.sql strictly (all pass)
#      + tests_ten9d.sql + tests_ten9e.sql + tests_ten9f.sql
#   5. second private copy with TEN-9d/9e/9f AND the HOLD file ten9c -> tests_ten9c.sql
# Never point this at a hosted project: the host is checked.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
HOST="${STAGING_HOST:-127.0.0.1}"; PORT="${STAGING_PORT:-54329}"
BASE="${STAGING_DB:-tp_mirror2}"; DB="${AUTH_TEST_DB:-tp_auth_test}"; DB9C="${DB}_ten9c"
case "$HOST" in 127.0.0.1|localhost) ;; *) echo "Refusing: local staging only" >&2; exit 1;; esac
P=(psql -X -q -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -U postgres)
PEND="$ROOT/supabase/pending_migrations"
TEN9D="$PEND/20261115168000_ten9d_company_code_guard_and_admin_set.sql"
TEN9E="$PEND/20261115168500_ten9e_invitation_signup_refuses_cleanly.sql"
TEN9F="$PEND/20261115168700_ten9f_login_lockout_per_account.sql"
TEN9C="$PEND/20261115169000_ten9c_HOLD_per_company_usernames.sql"

fresh() {
  "${P[@]}" -d postgres -c "drop database if exists $1" -c "create database $1 template $BASE" >/dev/null
  "${P[@]}" -d "$1" -f "$HERE/fixture.sql" >/dev/null
}
run() { "${P[@]}" -d "$1" "${@:3}" -f "$2" 2>&1 | grep -E "^(ok|not ok)|ERROR"; }

echo "## production shape (before TEN-9d)"
fresh "$DB"
run "$DB" "$HERE/tests.sql"

"${P[@]}" -d "$DB" -1 -f "$TEN9D" >/dev/null
"${P[@]}" -d "$DB" -1 -f "$TEN9E" >/dev/null
"${P[@]}" -d "$DB" -1 -f "$TEN9F" >/dev/null
echo "## after TEN-9d + TEN-9e + TEN-9f"
OUT1="$(run "$DB" "$HERE/tests.sql" -v strict=1; run "$DB" "$HERE/tests_ten9d.sql"; run "$DB" "$HERE/tests_ten9e.sql"; run "$DB" "$HERE/tests_ten9f.sql")"
echo "$OUT1"

echo "## TEN-9d/9e/9f + HOLD ten9c (private copy only)"
fresh "$DB9C"
"${P[@]}" -d "$DB9C" -1 -f "$TEN9D" >/dev/null
"${P[@]}" -d "$DB9C" -1 -f "$TEN9E" >/dev/null
"${P[@]}" -d "$DB9C" -1 -f "$TEN9F" >/dev/null
"${P[@]}" -d "$DB9C" -1 -f "$TEN9C" >/dev/null
OUT2="$(run "$DB9C" "$HERE/tests_ten9c.sql")"
echo "$OUT2"

ALL="$OUT1"$'\n'"$OUT2"
PASS=$(echo "$ALL" | grep -c "^ok" || true)
FAIL=$(echo "$ALL" | grep -cE "^not ok|ERROR" || true)
echo "multi-company auth staging (after TEN-9d/9e/9f): $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
