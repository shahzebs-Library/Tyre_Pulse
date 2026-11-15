#!/usr/bin/env bash
# Round 2 browser tests: prepare the e2e database COPY (never staging, never production).
#   1. closure fixture (synthetic sheets, actions, people)   supabase/tests/closure/fixture.sql
#   2. the drafts each feature needs, in their documented order (work orders, then closure)
#   3. round2_harness.sql (extra synthetic people with a per-run password, marked work orders)
#   4. an accounts file for the specs, OUTSIDE the repository
# Run once, right after the database copy is created (start.sh creates it), then start.sh --skip-build.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
PENDING="$REPO_ROOT/supabase/pending_migrations"
[ "$(psqle -At -d "$E2E_DB" -c "select count(*) from public.profiles where username like 'r2.%'")" = 0 ] || { echo "round 2 setup already applied to $E2E_DB"; exit 0; }
if [ "$(psqle -At -d "$E2E_DB" -c "select count(*) from public.profiles where username like 'clo.%'")" = 0 ]; then
  psqle -At -d "$E2E_DB" -f "$REPO_ROOT/supabase/tests/closure/fixture.sql"
fi
for f in 20261113130000_cur_work_orders_manager_director_default 20261115160000_wo_permission_resolver \
         20261115160500_wo_policies_and_guards 20261115161000_wo_supervisor_module_visibility \
         20261116100000_clo_corrective_action_review 20261116101000_clo_checklist_acknowledge_exception; do
  if [ "$(psqle -At -d "$E2E_DB" -c "select to_regprocedure('public.acknowledge_checklist_faults(uuid,text,text)') is not null")" = t ]; then break; fi
  psqle -d "$E2E_DB" -1 -f "$PENDING/$f.sql" >/dev/null && echo "applied $f"
done
PW="$(head -c 18 /dev/urandom | base64 | tr -d '\n/+=')Aa1"
psqle -At -d "$E2E_DB" -v pw="$PW" -f "$E2E_DIR/round2_harness.sql"
OUT="$E2E_RUN/accounts_r2.txt"
( umask 077
  cat "$E2E_ACCOUNTS_FILE" > "$OUT"
  psqle -At -F ' | ' -d "$E2E_DB" -c "select 'Alpha Readymix Co', p.role, p.username, u.email, '$PW' from public.profiles p join auth.users u on u.id = p.id where p.username like 'r2.%' or p.username like 'clo.%' order by p.username" >> "$OUT" )
echo "accounts file: $OUT (export E2E_ACCOUNTS_FILE to it before running the round 2 specs)"
