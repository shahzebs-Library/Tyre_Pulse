#!/usr/bin/env bash
# Closure workflow staging test. LOCAL staging cluster only (synthetic companies).
#   1. fresh copy of the staging baseline in its own database (tp_closure)
#   2. synthetic fixture
#   3. fingerprint of every existing row
#   4. apply the two drafts
#   5. fingerprint again: existing rows must be identical
#   6. behaviour tests, inside one transaction that is rolled back
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
HOST="${STAGING_HOST:-127.0.0.1}"; PORT="${STAGING_PORT:-54329}"
BASE="${STAGING_DB:-tyrepulse_staging}"; DB="${CLOSURE_DB:-tp_closure}"
case "$HOST" in 127.0.0.1|localhost) ;; *) echo "Refusing: local staging only" >&2; exit 1;; esac
P=(psql -X -q -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -U postgres)
"${P[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB template $BASE" 2>/dev/null
"${P[@]}" -d "$DB" -At -f "$HERE/fixture.sql"
FP="select 'ca ' || count(*) || ' ' || md5(coalesce(string_agg((to_jsonb(c) - array['review_status','submitted_by','submitted_at','completion_note','completion_photos','reviewed_by','reviewed_at','review_comment','exception_requested_by','exception_requested_at','exception_reason','exception_evidence'])::text, '' order by id), '')) from public.corrective_actions c
union all select 'cs ' || count(*) || ' ' || md5(coalesce(string_agg((to_jsonb(s) - array['acknowledged_by','acknowledged_at','acknowledged_name','acknowledged_signature','acknowledgement_note'])::text, '' order by id), '')) from public.checklist_submissions s
union all select 'ai ' || count(*) || ' ' || md5(coalesce(string_agg(to_jsonb(i)::text, '' order by id), '')) from public.action_items i
union all select 'wo ' || count(*) || ' ' || md5(coalesce(string_agg(to_jsonb(w)::text, '' order by id), '')) from public.work_orders w
union all select 'in ' || count(*) || ' ' || md5(coalesce(string_agg(to_jsonb(n)::text, '' order by id), '')) from public.inspections n"
BEFORE="$("${P[@]}" -d "$DB" -At -c "$FP")"
for f in "$ROOT"/supabase/pending_migrations/20261116100000_clo_corrective_action_review.sql \
         "$ROOT"/supabase/pending_migrations/20261116101000_clo_checklist_acknowledge_exception.sql; do
  "${P[@]}" -d "$DB" -1 -f "$f" >/dev/null
done
AFTER="$("${P[@]}" -d "$DB" -At -c "$FP")"
if [ "$BEFORE" = "$AFTER" ]; then echo "ok - existing rows byte-identical after the drafts ($(echo "$BEFORE" | tr '\n' ';'))"
else echo "not ok - existing rows changed"; echo "$BEFORE"; echo "$AFTER"; exit 1; fi
OUT="$("${P[@]}" -d "$DB" -At -f "$HERE/tests.sql" 2>&1)" || { echo "$OUT"; exit 1; }
echo "$OUT" | grep -E "^(ok|not ok)" || true
PASS=$(echo "$OUT" | grep -c "^ok" || true); FAIL=$(echo "$OUT" | grep -c "^not ok" || true)
echo "closure staging: $((PASS + 1)) passed, $FAIL failed"
[ "$FAIL" = "0" ]
