#!/usr/bin/env bash
# PR #519 then PR #520 drafts on ONE fresh copy of the LOCAL staging database (tp_combined), then both
# staging suites (work order matrix, closure tests) on that same copy. Local 127.0.0.1 only, synthetic data.
# Hashes of work_orders, corrective_actions (review columns excluded), checklist_submissions (ack columns
# excluded) and parts_consumption before the first draft, after the last draft, and after both suites.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"; OUT="${OUT_DIR:-$(mktemp -d)}"
PEND=$ROOT/supabase/pending_migrations; T=$ROOT/supabase/tests
DB=tp_combined
P=(psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54329 -U postgres)
"${P[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB template tyrepulse_staging"
echo "fixture (closure synthetic rows):"; "${P[@]}" -d $DB -At -f $T/closure/fixture.sql >/dev/null && echo ok
HASH="select 'work_orders '||count(*)||' '||md5(coalesce(string_agg(md5(w::text),'' order by w.id),'')) from public.work_orders w
union all select 'corrective_actions '||count(*)||' '||md5(coalesce(string_agg((to_jsonb(c) - array['review_status','submitted_by','submitted_at','completion_note','completion_photos','reviewed_by','reviewed_at','review_comment','exception_requested_by','exception_requested_at','exception_reason'])::text,'' order by id),'')) from public.corrective_actions c
union all select 'checklist_submissions '||count(*)||' '||md5(coalesce(string_agg((to_jsonb(s) - array['acknowledged_by','acknowledged_at','acknowledged_name','acknowledged_signature','acknowledgement_note'])::text,'' order by id),'')) from public.checklist_submissions s
union all select 'parts_consumption '||count(*)||' '||md5(coalesce(string_agg(md5(p::text),'' order by p.id),'')) from public.parts_consumption p"
"${P[@]}" -d $DB -At -c "$HASH" > $OUT/hash_before.txt
for f in 20261113130000_cur_work_orders_manager_director_default 20261115140000_wo_permission_resolver 20261115140500_wo_policies_and_guards 20261115141000_wo_supervisor_module_visibility 20261115141500_wo_cost_approval_not_collector 20261115142000_wo_cost_entries_ledger 20261116100000_clo_corrective_action_review 20261116101000_clo_checklist_acknowledge_exception 20261116102000_clo_supervisor_actions_visibility; do
  if out=$("${P[@]}" -d $DB -1 -f $PEND/$f.sql 2>&1 >/dev/null); then echo "applied $f"; else echo "FAILED $f"; echo "$out" | grep -m3 -E 'ERROR|FATAL'; fi
done
"${P[@]}" -d $DB -At -c "$HASH" > $OUT/hash_after_drafts.txt
echo "--- WO matrix"; "${P[@]}" -d $DB -At -f $T/staging_work_order_permissions.sql 2>&1 | grep -E '^(FAIL|cases=)|ERROR' 
echo "--- closure"; CLO=$("${P[@]}" -d $DB -At -f $T/closure/tests.sql 2>&1); echo "$CLO" | grep -E '^not ok|ERROR'; echo "closure ok=$(echo "$CLO"|grep -c '^ok') notok=$(echo "$CLO"|grep -c '^not ok')"
"${P[@]}" -d $DB -At -c "$HASH" > $OUT/hash_after_suites.txt
cd "$OUT"; paste hash_before.txt hash_after_drafts.txt hash_after_suites.txt
psql -X -q -h 127.0.0.1 -p 54329 -U postgres -d postgres -c "drop database if exists tp_combined"
