#!/usr/bin/env bash
# Round 2 browser tests: prepare the e2e database COPY (never staging, never production).
#   1. closure fixture (synthetic sheets, actions, people)   supabase/tests/closure/fixture.sql
#   2. the eight drafts each feature needs, in their documented order (work orders, then closure)
#   3. round2_harness.sql (extra synthetic people with a per-run password, marked work orders)
#   4. an accounts file for the specs, OUTSIDE the repository
# Run once, right after the database copy is created (start.sh creates it), then start.sh --skip-build.
# Rollout rehearsal options (environment):
#   R2_DRAFTS=all (default) | wo (only the six #519 work order drafts) | none (no draft at all: the database as main ships it)
#   R2_PW=<password>          reuse an existing per-run password instead of generating one
#   R2_ACCOUNTS_OUT=<file>    accounts file to write (default $E2E_RUN/accounts_r2.txt)
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
PENDING="$REPO_ROOT/supabase/pending_migrations"
[ "$(psqle -At -d "$E2E_DB" -c "select count(*) from public.profiles where username like 'r2.%'")" = 0 ] || { echo "round 2 setup already applied to $E2E_DB"; exit 0; }
R2_DRAFTS="${R2_DRAFTS:-all}"
if [ "$R2_DRAFTS" = all ] && [ "$(psqle -At -d "$E2E_DB" -c "select count(*) from public.profiles where username like 'clo.%'")" = 0 ]; then
  psqle -At -d "$E2E_DB" -f "$REPO_ROOT/supabase/tests/closure/fixture.sql"
fi
for f in 20261113130000_cur_work_orders_manager_director_default 20261115140000_wo_permission_resolver \
         20261115140500_wo_policies_and_guards 20261115141000_wo_supervisor_module_visibility \
         20261115141500_wo_cost_approval_not_collector 20261115142000_wo_cost_entries_ledger \
         20261116100000_clo_corrective_action_review 20261116101000_clo_checklist_acknowledge_exception \
         20261116102000_clo_supervisor_actions_visibility; do
  case "$R2_DRAFTS:$f" in none:*|wo:*_clo_*) echo "skipped $f (R2_DRAFTS=$R2_DRAFTS)"; continue;; esac
  psqle -d "$E2E_DB" -1 -f "$PENDING/$f.sql" >/dev/null && echo "applied $f"
done
PW="${R2_PW:-$(head -c 18 /dev/urandom | base64 | tr -d '\n/+=')Aa1}"
psqle -At -d "$E2E_DB" -v pw="$PW" -f "$E2E_DIR/round2_harness.sql"
OUT="${R2_ACCOUNTS_OUT:-$E2E_RUN/accounts_r2.txt}"
( umask 077
  cat "$E2E_ACCOUNTS_FILE" > "$OUT"
  psqle -At -F ' | ' -d "$E2E_DB" -c "select 'Alpha Readymix Co', p.role, p.username, u.email, '$PW' from public.profiles p join auth.users u on u.id = p.id where p.username like 'r2.%' or p.username like 'clo.%' order by p.username" >> "$OUT" )
# The drafts were applied after PostgREST started: reload its schema cache or new functions read as missing.
psqle -d "$E2E_DB" -c "notify pgrst, 'reload schema'" >/dev/null
echo "accounts file: $OUT (export E2E_ACCOUNTS_FILE to it before running the round 2 specs)"
