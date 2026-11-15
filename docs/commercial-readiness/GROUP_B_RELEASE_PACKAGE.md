# Group B release package: #519, #520, #527

Status: rehearsed on local copies only. Nothing in this file has been merged, deployed or applied to production.
Every merge, deploy and apply below needs the owner's explicit go at that step. Production was not read or
written for this package (no Supabase connection used); the production facts quoted come from the 2026-11-15
read-only checks recorded in `RELEASE_RUNBOOK_519_520.md`.

Status labels: Verified Fixed / Verified Failed / Not Tested / Blocked.

## 1. What was tested (exact SHAs)

| Item | SHA |
|---|---|
| main | `b036c033` (contains #529, #526, #524) |
| #519 `claude/work-order-permissions-7rxp2t` | `e46fe004` |
| #520 `claude/closure-workflow-7rxp2t` | `59313c92` |
| #527 `claude/pdf-cache-service-7rxp2t` | `ed1bd9be` (database drafts only; its web code is NOT in the integration build) |
| Integration tree (local only, not pushed) | `63ae3806` = round 4 integration + merge of `b036c033` + `e46fe004` + `59313c92` |
| Not included | #531 |

Merge notes: `origin/main` into the round 4 integration had one conflict (`vercel.json`, the preview-disabled branch
list; both sides kept). #519 and #520 merged without conflict on top (the `checklistAccess.js` and
`correctiveActions.js` resolutions from round 4 were already in the tree).

## 2. Results

### Code (integration tree `63ae3806`)

| Check | Result | Status |
|---|---|---|
| eslint, 92 changed source files | 0 errors, 3 warnings | Verified Fixed |
| vite build | built, exit 0 | Verified Fixed |
| vitest, the 40 test files changed since main | 40 files, 514 tests passed | Verified Fixed |

### Database: fresh copy `tp_final` (PostgreSQL 16, from `tyrepulse_staging`, synthetic Alpha / Beta / Gamma)

Start state made to match production today: `apply_reader_policies()` once (clears the copy's own drift),
`20261115120000_observation_erp_reconciliation` applied, then `20261115120856_observation_erp_confirm_interim_lock`
(its guard passed on this copy). ERP function ACL at the start:
`{postgres=X/postgres,service_role=X/postgres}` for all three. Closure fixture loaded (synthetic actions and sheets).
Baseline schema fingerprint (`runbook_519_520/schema_fingerprint.sql`): md5 `420d0cd85300`, 18,731 lines.

Each step ran in its own transaction: preflight file, apply file, verify file (placeholders filled with synthetic
ids), invariants, schema fingerprint and the data hashes below.

| Step | File | Preflight | Apply | Verify | Data hashes equal to baseline |
|---|---|---|---|---|---|
| 0 | `runbook_519_520/step0_reader_policy_normalise.sql` | as expected (drift exactly the two ERP tables) | OK | all t | yes |
| 1 | `20261113130000_cur_work_orders_manager_director_default` | all t | OK | all t | yes |
| 2 | `20261115140000_wo_permission_resolver` | all t | OK | all t | yes |
| 3 | `20261115140500_wo_policies_and_guards` | all t | OK | all t | yes |
| 4 | `20261115141000_wo_supervisor_module_visibility` | all t (the 5 f lines are the recorded current built-in rows, as expected) | OK | all t | yes |
| 5 | `20261115141500_wo_cost_approval_not_collector` | all t | OK | all t | yes |
| 6 | `20261115142000_wo_cost_entries_ledger` | all t | OK | all t; the one "expect ERROR" probe refused ("You are not allowed to add a cost to this work order.") | yes |
| 7 | `20261116100000_clo_corrective_action_review` | all t | OK | all t; expected refusal probe raised | yes |
| 8 | `20261116101000_clo_checklist_acknowledge_exception` | all t | OK | all t; expected refusal probe raised | yes |
| 9 | `20261116102000_clo_supervisor_actions_visibility` | all t | OK | all t; Tyre Man insert into module_permissions refused by RLS | yes |

Staging suites on the database with all ten steps:

| Suite | Result | Status |
|---|---|---|
| `staging_work_order_permissions.sql` | `cases=305 passed=305 failed=0` | Verified Fixed |
| `closure/tests.sql` | 87 ok, 0 not ok | Verified Fixed |
| closure "existing rows byte-identical after the drafts" (the 88th check of `closure/run_staging.sh`) | covered by the hash table below (whole-row hashes over the baseline columns, equal) | Verified Fixed |

Data hashes (md5 over every row, restricted to the columns that existed at the baseline so added columns do not
count; `work_orders` cost columns = labour, parts, lubricant, outside repair, tyre, total):

| Hash | Baseline | After steps 0-9 | After both suites | After #527 drafts | After full rollback |
|---|---|---|---|---|---|
| work_orders cost columns | 1298 `95130c6f774e7cb9f921adfc9d80100c` | same | same | same | same |
| work_orders whole rows | 1298 `29b3dd327b94781d227878911e44e800` | same | same | same | same |
| parts_consumption | 1406 `ca36fde4b44690e3f33dfc9557bc4d3b` | same | same | same | same |
| approval_execution_requests | 0 rows | same | same | same | same |
| corrective_actions | 18 `b04df70de2b7597006165747476f6f82` | same | same | same | same |
| checklist_submissions | 8 `4b20f7bdc4a2fd7ccdf0cef23dbb5cdf` | same | same | same | same |

`invariants.sql` (work order count and md5 over id:parts_cost, 240 cards with parts cost and no parts lines,
parts_consumption count, corrective_actions and checklist_submissions status md5, ERP lock ACL and hashes): equal to
the baseline after every step, after the suites and after the full rollback.

#527 drafts on top (same database, after the suites):

| Draft | Apply | Verify | Status |
|---|---|---|---|
| `20261117090000_report_pdf_cache` | OK | 16 policies on `report_pdf_files` + `report_pdf_events` (8 + reader policies); anon cannot execute `pdf_cache_lookup`; `pdf_sha256_hex('abc')` correct; reader-policy drift 0 | Verified Fixed |
| `20261117091000_report_pdf_autoqueue` | OK | data hashes unchanged | Verified Fixed |

Rollback chain (reverse order: #527 091000, #527 090000, steps 9 to 1, step 0):

| Check | Result | Status |
|---|---|---|
| #527 header rollback of `20261117090000` as written | FAILS: `cannot drop function pdf_cache_source_visible(text,uuid) because other objects depend on it` (functions are dropped before the tables whose policies use them). It also never removes `pdf_canonical_json(jsonb)`, `pdf_sha256_hex(text)` or the `report-pdfs` storage bucket row | Verified Failed (defect B-1, see section 6) |
| Corrected rollback `runbook_519_520/rollback_527_report_pdf_cache_FIXED.sql` | OK | Verified Fixed |
| Fingerprint after the #527 rollback equals the fingerprint before #527 | yes; bucket row count 0, 1, 0 (before, applied, rolled back) | Verified Fixed |
| Rollback files 9 to 1, then step 0 | all OK | Verified Fixed |
| Fingerprint at the end equals the baseline | yes, `420d0cd85300` both | Verified Fixed |
| Invariants and data hashes at the end equal the baseline | yes | Verified Fixed |
| ERP lock ACL start vs end | unchanged | Verified Fixed |
| `system_config.single_tenant_mode` | `true` throughout | Verified Fixed |

### Browser on the combined build

Stack rebuilt from the integration tree `63ae3806` (`start.sh --rebuild-db`, PostgREST 54350, gateway 54351, web
5220, database `tp_browser4` = fresh copy + closure fixture + all nine #519/#520 drafts + synthetic people). Each spec
was compared case by case with its round 4 output (same specs, older heads); differences are listed.

| Spec | Recorded cases | Same as round 4 | Differences | Status |
|---|---|---|---|---|
| round3_ledger (cost ledger, S3) | 17 | 16 | 1: amounts and DB rows identical; the ledger shows "601.00" without "SAR" (see observation O-1) | 17 Verified Fixed |
| round2_closure actions | 53 | 49 | 4, all explained below | 52 Verified Fixed, 1 Not Tested in the browser (covered in the database) |
| round2_closure checklists | 28 | 27 | 1: the viewer no longer tells an acknowledged sheet to be sent back (the intended #520 `59313c92` change) | 28 Verified Fixed |
| final_tpe_exception (new, TPE) | 10 | n/a | n/a | 9 Verified Fixed, 1 Not Tested |
| rollout_states S1 / S2 / S3 (Manager, Workshop Supervisor, Tyre Man) | 30 / 39 / 39 steps | all, except the timing variant of O-1 and the state label in written test values | none in behaviour | 108 Verified Fixed; Data Monitor Officer and Admin Not Tested in this round (round 4 covered them on S1 and S2) |

round2_closure actions, the four differences:
- `exception_requester_close_by_status` and `self_exception_close_by_status`: the requester now reads "You asked for an
  exception on this action, so another authorised person has to close it." (the #520 `4f74b224` rule) instead of
  "Approve or refuse the exception first." Database: still not closed. Verified Fixed.
- `manager_failed`: the refused close now returns 403 instead of 409 (same refusal, new rule). Verified Fixed.
- `collector_on_unassigned`: the spec opens the first card titled "Checklist fault: Brakes"; this copy lists the
  supervisor's Brakes action first, so the collector correctly gets no panel (not their action). The case round 4
  measured (the collector's OWN Brakes action) was re-checked in the database: `can_submit` true,
  `can_request_exception` true. Browser for that exact card: Not Tested (spec picks by a non-unique title).

Rollout states on the combined build (same web build, three database copies made fresh from the template;
S1 = no draft, as production today; S2 = the six #519 drafts; S3 = all nine drafts = `tp_browser4`). Money and
history hashes (work_orders cost columns, work_orders whole rows, parts_consumption, approval_execution_requests,
cost ledger tables) were taken before the first role and after the last role in each state: equal in S1, S2 and S3.
No raw database text, blank screen or error screen in any step. S1: Manager sees Work Orders and Live Control, no
cost ledger panel, the missing ledger is a silent 404 probe; Workshop Supervisor and Tyre Man are routed away exactly
as on main. S2 and S3: Manager and Workshop Supervisor edit scope and notes (stored costs unchanged) and add a cost as
a pending line; Tyre Man unchanged.

final_tpe_exception (TPE = `r2.tpe`, Alpha, KSA, all sites; action "Checklist fault: Seat belts"):

| Case | Expected | Observed | Status |
|---|---|---|---|
| TPE opens an open action in scope | exception request offered, no decide, no approve | offered; decide and approve absent | Verified Fixed |
| TPE requests the exception in the browser | recorded as requested by the TPE, action stays open | "Exception requested. The action stays open until a different authorised person decides."; DB `exception_requested`, requester `r2.tpe`, event `exception_requested` | Verified Fixed |
| TPE reopens it | told it is their request, no decide or approve | "requested by me" note shown; decide and approve absent | Verified Fixed |
| TPE decides own exception (DB) | refused | "Your role is not authorised to decide an exception." | Verified Fixed |
| TPE closes directly (DB update) | refused | 0 rows written | Verified Fixed |
| TPE request with evidence in scope (DB, rolled back) | stored | evidence 1, requester TPE, `exception_requested_by_me` true, `can_decide_exception` false | Verified Fixed |
| TPE request on another company's action (DB) | refused | "That action does not exist or is outside your company, country or sites." | Verified Fixed |
| Manager opens the TPE request | can decide (independent approval) | decide offered | Verified Fixed |
| Row restored after the run | as before | Open, no exception | Verified Fixed |
| Evidence photo upload in the browser | stored in private storage | the local stack has no storage service | Not Tested |

The rule "whoever asked for an exception can never approve completion" is covered by the closure database tests
(T01 to T11 inside the 87) and was not driven in the browser for the TPE.

Observation O-1 (not a regression from these merges): whether the job card dialog shows the currency label "SAR"
and the extra "Labour / Parts / Total" breakdown lines depends on when the dialog text is captured (both variants
appear in round 4 and in this round, for the same database state; see the rollout comparison below). The amounts and
the database rows are identical in every variant.


## 3. Production sequence

### (a) Pre-release checks (read only, before anything)

Owner only (dashboard, not visible to Claude):
- Supabase dashboard, Database, Backups: confirm the latest daily backup finished today and, if the plan has it,
  that Point in Time Recovery is on and its window covers today. Write down the backup time.
- Vercel project `tyre-pulse`: note the deployment id of the current production deployment (the instant rollback
  target).

Read-only SQL on production (SQL editor or `execute_sql`; no drop/delete text, so no confirm prompt), save every
output in the release log:

```sql
-- 1. latest in-database snapshot (row recovery, not disaster recovery)
select id, created_at, status from backups.snapshots order by created_at desc limit 3;
-- 2. migration head (expect 20261115120856, 1,091 rows on 2026-11-15)
select max(version), count(*) from supabase_migrations.schema_migrations;
-- 3. single tenant mode (expect true)
select key, value from public.system_config where key = 'single_tenant_mode';
```

Then run and save `runbook_519_520/invariants.sql` and `runbook_519_520/schema_fingerprint.sql` (production
2026-11-15: work_orders 97,242, 7,099 with parts cost and no lines, ERP lock ACL
`{postgres=X/postgres,service_role=X/postgres}`), plus the four money hashes:

```sql
select 'wo_cost', count(*), md5(coalesce(string_agg(id::text||'|'||coalesce(parts_cost::text,'')||'|'||coalesce(labour_cost::text,'')||'|'||coalesce(total_cost::text,''), ',' order by id), '')) from public.work_orders;
select 'wo_rows', count(*), md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.work_orders t;
select 'parts_consumption', count(*), md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.parts_consumption t;
select 'approval_execution_requests', count(*), md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.approval_execution_requests t;
```

Note: these whole-row hashes run over 97k work orders and every expense line; run them once before and once at the
end, not after every step. After steps 7 and 8 add columns to corrective_actions and checklist_submissions, compare
those two tables with the invariants (status md5), not with whole rows.

Go / no-go: backup confirmed, migration head as expected, `single_tenant_mode` true, drift preflight
(`preflight_reader_policy_drift.sql`) returns exactly `observation_erp_link_events, observation_erp_links`.

### (b) Web: merge order and what each merge deploys

Every merge to main starts a Vercel production build of `tyre-pulse` that goes live on its own (no separate deploy
step). One merge = one build; do not merge anything else in between.

| Order | Merge | Database at that moment | Proven state | What users see |
|---|---|---|---|---|
| 1 | #519 | no draft | S1 (round 4 and this round) | every screen opens; no cost ledger panel; Managers and supervisors see Edit disabled with a reason where today's database already refuses the write; nothing stored changes |
| (db) | steps 0 to 6 | #519 drafts | S2 | Managers can create and edit job cards; supervisors get their rights; the cost ledger appears on the next page load |
| 2 | #520 | #519 drafts | S2 with the #520 build | closure screens degrade safely (no review buttons until the drafts) |
| (db) | steps 7 to 9 | all drafts | S3 | corrective action review, checklist acknowledge and exception, supervisors see Corrective Actions |
| 3 | #527 | all drafts | Not Tested in this round (#527 web code was not in the integration build) | see #527's own test notes |
| (db) | #527 drafts | all | applied and rolled back on `tp_final` | stored report PDFs |

Fallback for any web step: Vercel instant rollback, i.e. promote the previous production deployment (owner, Vercel
dashboard, Deployments, previous production, Promote). The older build ignores the new tables and functions, so a
web rollback is safe at any point, also after the database steps.

### (c) Database steps

Apply each file as ONE migration (Supabase `apply_migration` or the SQL editor). The #520 files `20261116100000` and
`20261116101000` have no `begin; ... commit;`: `apply_migration` wraps them; in the SQL editor wrap them yourself.
After each apply: `notify pgrst, 'reload schema';` (PostgREST otherwise serves the old function list until its next
reload; seen in round 4).

| Step | Preflight | Apply file | Verify | Go / no-go | Rollback |
|---|---|---|---|---|---|
| 0 | `runbook_519_520/preflight_step0.sql` | `runbook_519_520/step0_reader_policy_normalise.sql` | `runbook_519_520/verify_step0.sql` | drift 0, every ok t, invariants equal | `runbook_519_520/step0_reader_policy_normalise_ROLLBACK.sql` (only after 9 to 1 are rolled back) |
| 1 | `preflight_step1.sql` | `supabase/pending_migrations/20261113130000_cur_work_orders_manager_director_default.sql` | `verify_step1.sql` | every ok t; a Manager can save a job card, a Tyre Man cannot | `..._ROLLBACK.sql` (restores organisations.settings from `_bak.cur1_org_settings_20261113`; any Access Control change made after the apply is lost) |
| 2 | `preflight_step2.sql` | `20261115140000_wo_permission_resolver.sql` | `verify_step2.sql` | 31 built-in rules, 7 functions, anon no execute | `..._ROLLBACK.sql` |
| 3 | `preflight_step3.sql` | `20261115140500_wo_policies_and_guards.sql` | `verify_step3.sql` | probes allow/refuse as listed | `..._ROLLBACK.sql` |
| 4 | `preflight_step4.sql` | `20261115141000_wo_supervisor_module_visibility.sql` | `verify_step4.sql` | every ok t | `..._ROLLBACK.sql` |
| 5 | `preflight_step5.sql` | `20261115141500_wo_cost_approval_not_collector.sql` | `verify_step5.sql` | every ok t | `..._ROLLBACK.sql` |
| 6 | `preflight_step6.sql` | `20261115142000_wo_cost_entries_ledger.sql` | `verify_step6.sql` | every ok t; Tyre Man add cost refused | `..._ROLLBACK.sql` |
| 7 | `preflight_step7.sql` | `20261116100000_clo_corrective_action_review.sql` | `verify_step7.sql` | every ok t | `..._ROLLBACK.sql` |
| 8 | `preflight_step8.sql` | `20261116101000_clo_checklist_acknowledge_exception.sql` | `verify_step8.sql` | every ok t | `..._ROLLBACK.sql` |
| 9 | `preflight_step9.sql` | `20261116102000_clo_supervisor_actions_visibility.sql` | `verify_step9.sql` | every ok t | `..._ROLLBACK.sql` |
| 10 | #527 file header VERIFY | `20261117090000_report_pdf_cache.sql` (on the #527 branch) | 16 policies, anon no execute on `pdf_cache_lookup`, `pdf_sha256_hex('abc')`, drift 0 | as listed | `runbook_519_520/rollback_527_report_pdf_cache_FIXED.sql` (NOT the header text, see defect B-1); stored files must be removed through the Storage API first |
| 11 | #527 file header VERIFY | `20261117091000_report_pdf_autoqueue.sql` | trigger present, inspections unchanged | as listed | header rollback (5 drop lines, OK) |

The preflight and verify files are in `docs/commercial-readiness/runbook_519_520/`. Before step 1 pick the probe ids
(`<MANAGER_ID>`, `<TYRE_MAN_ID>`, `<ADMIN_ID>`, `<OPEN_WO_ID>`) with read-only queries, as described in
`RELEASE_RUNBOOK_519_520.md`. After every apply run `invariants.sql` and `schema_fingerprint.sql`; after every
rollback the fingerprint must equal the one saved before that step.

### (d) Which steps show the MCP confirm prompt

Any file text containing `drop` or `delete` (comments and names included) makes the MCP tool wait for a human; in a
cloud session it times out after 60 s. The owner must be present (or use the SQL editor) for:

- Apply: step 0, step 1, step 2, step 3, step 6, step 7, step 8, #527 `20261117090000`, #527 `20261117091000`
  (its header carries the drop lines).
- Apply without the prompt: steps 4, 5, 9.
- Every rollback file except the one of step 5, plus both #527 rollbacks.
- The pre-release and post-release read-only checks: no prompt.

### (e) Post-checks (after the last step)

- `invariants.sql`: equal to the pre-release output (ERP lock line included: ACL
  `{postgres=X/postgres,service_role=X/postgres}`, three hashes unchanged).
- The four money hashes: equal to the pre-release values.
- `select key, value from public.system_config where key = 'single_tenant_mode';` still `true`.
- `preflight_reader_policy_drift.sql`: drift 0.
- Browser smoke as the owner: Work Orders opens, a job card saves as a Manager, Corrective Actions shows the review
  buttons, an inspection PDF downloads.

### What users see between steps

| After | Users see |
|---|---|
| #519 web | same work as today; new controls disabled with a reason where the database still refuses |
| step 0 | nothing (only the read-only reporting bot loses the two ERP decision tables) |
| step 1 | Managers and Directors can create and edit job cards |
| steps 2 to 5 | buttons follow the rule table; supervisors see Work Orders; collectors cannot approve cost |
| step 6 | cost ledger panel and "Add a cost" for allowed roles (after a page reload) |
| #520 web | closure screens unchanged until steps 7 to 9 |
| steps 7, 8 | submit / review / exception on corrective actions; acknowledge with a fault on checklists |
| step 9 | Workshop and Maintenance Supervisors see Corrective Actions |
| #527 web + drafts | stored inspection PDFs, reused instead of redrawn |

## 4. First production migration to request approval for: Step 0

Why first: it is the smallest change (8 restrictive policies on two tables), it is the precondition for steps 2, 6, 7
and 8 to roll back cleanly, and it changes nothing for any person except the read-only reporting bot. Owner present
(the text contains "delete"). Run the preflight first (read only) and confirm the drift is exactly the two tables.

```sql
begin;
do $guard$
declare v_drift text[]; v_existing int; v_listed int; v_rls int;
begin
  select count(*) into v_rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('observation_erp_links','observation_erp_link_events')
     and c.relkind = 'r' and c.relrowsecurity;
  if v_rls <> 2 then
    raise exception 'step 0 refused: both tables must exist with RLS enabled (found %)', v_rls;
  end if;
  select count(*) into v_existing from pg_policies
   where schemaname = 'public' and tablename in ('observation_erp_links','observation_erp_link_events')
     and policyname like 'anum\_reader\_%';
  if v_existing <> 0 then
    raise exception 'step 0 refused: % anum_reader_* policies already exist on the two tables', v_existing;
  end if;
  select count(*) into v_listed from anum_integration.reader_tables
   where table_name in ('observation_erp_links','observation_erp_link_events');
  if v_listed <> 0 then
    raise exception 'step 0 refused: a table is listed in anum_integration.reader_tables (expected not listed)';
  end if;
  with t as (
    select c.relname,
           exists (select 1 from anum_integration.reader_tables a where a.table_name = c.relname) as allowed,
           exists (select 1 from pg_attribute at where at.attrelid = c.oid and at.attname = 'organisation_id'
                     and not at.attisdropped and at.atttypid = 'uuid'::regtype) as has_org
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity)
  select coalesce(array_agg(t.relname::text order by t.relname), '{}') into v_drift
    from t left join pg_policies p
      on p.schemaname = 'public' and p.tablename = t.relname and p.policyname = 'anum_reader_select_scope'
   where p.qual is distinct from case when t.allowed and t.has_org
           then '((NOT ( SELECT anum_integration.is_reader() AS is_reader)) OR (organisation_id = ( SELECT anum_integration.reader_org() AS reader_org)))'
           else '(NOT ( SELECT anum_integration.is_reader() AS is_reader))' end;
  if v_drift is distinct from array['observation_erp_link_events','observation_erp_links'] then
    raise exception 'step 0 refused: reader-policy drift is % (expected exactly observation_erp_link_events, observation_erp_links)', v_drift;
  end if;
end
$guard$;
create policy anum_reader_select_scope on public.observation_erp_links as restrictive for select to authenticated
  using (not (select anum_integration.is_reader()));
create policy anum_reader_no_insert on public.observation_erp_links as restrictive for insert to authenticated
  with check (not (select anum_integration.is_reader()));
create policy anum_reader_no_update on public.observation_erp_links as restrictive for update to authenticated
  using (not (select anum_integration.is_reader())) with check (not (select anum_integration.is_reader()));
create policy anum_reader_no_delete on public.observation_erp_links as restrictive for delete to authenticated
  using (not (select anum_integration.is_reader()));
create policy anum_reader_select_scope on public.observation_erp_link_events as restrictive for select to authenticated
  using (not (select anum_integration.is_reader()));
create policy anum_reader_no_insert on public.observation_erp_link_events as restrictive for insert to authenticated
  with check (not (select anum_integration.is_reader()));
create policy anum_reader_no_update on public.observation_erp_link_events as restrictive for update to authenticated
  using (not (select anum_integration.is_reader())) with check (not (select anum_integration.is_reader()));
create policy anum_reader_no_delete on public.observation_erp_link_events as restrictive for delete to authenticated
  using (not (select anum_integration.is_reader()));
commit;
```

This is byte-identical in effect to `runbook_519_520/step0_reader_policy_normalise.sql` at `e46fe004` (the file adds
only comments). Verify with `verify_step0.sql`; rollback with `step0_reader_policy_normalise_ROLLBACK.sql`.

## 5. Not Tested

- The PostgREST HTTP path for the step 0 to 9 probes on production-sized data (SQL probes as `authenticated` only).
- PostgreSQL 17.6 (production) itself: the rehearsal ran on 16.
- #527 web code and its browser behaviour (not in the integration build of this round).
- The #527 storage policies with real stored files (no storage service in the local stack).
- The owner-only dashboard checks in 3(a).

## 6. Defects

- **B-1 (#527, rollback, blocks a clean rollback of step 10):** the ROLLBACK block in the header of
  `20261117090000_report_pdf_cache.sql` drops the functions before the tables, so it fails on
  `pdf_cache_source_visible(text,uuid)` (used by the table policies); it also misses `pdf_canonical_json(jsonb)`,
  `pdf_sha256_hex(text)` and the `report-pdfs` bucket row. Corrected file:
  `runbook_519_520/rollback_527_report_pdf_cache_FIXED.sql` (storage policies, then tables, then functions, then the
  two missing functions, then the bucket row), rehearsed: fingerprint and bucket count back to the pre-#527 state.
  The #527 branch itself was not changed here; carry the fix over to its header before that PR merges.
