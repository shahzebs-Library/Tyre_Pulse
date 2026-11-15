# Release runbook: PR #519 (work orders) and PR #520 (closure workflow)

Status: rehearsed on a local copy, NOT applied anywhere. Nothing in this file has been run on production. Every merge, deploy and apply below needs the owner's explicit go at that step.

Rehearsal: 2026-11-15, local PostgreSQL 16 at 127.0.0.1:54329, database `tp_runbook` created from the template `tyrepulse_staging` (synthetic companies Alpha, Beta, Gamma, 1,298 work orders), then `supabase/migrations/20261115120000_observation_erp_reconciliation.sql` and the applied ERP lock `20261115120856_observation_erp_confirm_interim_lock.sql` (the lock guard passed: same three function hashes as production), so the copy starts where production is today. Production itself is PostgreSQL 17.6; the rehearsal ran on 16 (no feature used by the drafts differs). `tp_runbook` was removed afterwards.

Production facts this runbook assumes (read only, verified by the lead on 2026-11-15): latest migration `20261115120856`, 1,091 migrations, ERP lock active, `single_tenant_mode` true, `work_orders` 97,242 rows, 7,099 of them with `parts_cost > 0` and no parts lines. Re-check each one in the preflight before starting.

## Result of the rehearsal

For every step: preflight, apply, verify, rollback, fingerprint compared with the one taken before the step, re-apply, verify again. Fingerprint = `runbook_519_520/schema_fingerprint.sql`: `pg_get_functiondef` md5 and ACL of every function in `public`, `approval_private`, `anum_integration`; every policy (command, roles, USING, WITH CHECK); every relation with RLS flag, ACL and options; every column; every trigger with its enabled flag; every index and constraint; and the data of `module_permissions` (including `updated_at`), `organisations.settings`, `anum_integration.reader_tables`, `approval_policies`. Invariants = `runbook_519_520/invariants.sql`: `work_orders` count and md5 over `id:parts_cost`, cards with parts cost and no parts lines, `parts_consumption` count, `corrective_actions` and `checklist_submissions` count and md5 over status, ERP lock ACL and hashes.

| Step | Draft | Apply | Verify and probes | Rollback restores fingerprint | Invariants | Fingerprint before (md5 prefix, lines) |
|---|---|---|---|---|---|---|
| 0 | `Reader-policy normalisation, narrow (2 tables, 8 policies)` | OK | OK | OK (all 4,620 policy lines identical, md5 `5030c84317ce`) | ERP lock unchanged | re-rehearsed on tp_step0, see Step 0 section (the global version was `81dbb3118eba`, 18733) |
| 1 | `20261113130000_cur_work_orders_manager_director_default` | OK | OK | OK | unchanged by apply and by rollback | `c979a0e044dd`, 18741 |
| 2 | `20261115140000_wo_permission_resolver` | OK | OK | OK | unchanged by apply and by rollback | `5f8097844cf7`, 18742 |
| 3 | `20261115140500_wo_policies_and_guards` | OK | OK | OK | unchanged by apply and by rollback | `c2c64832cf0b`, 18778 |
| 4 | `20261115141000_wo_supervisor_module_visibility` | OK | OK | OK | unchanged by apply and by rollback | `0f779a617a3b`, 18787 |
| 5 | `20261115141500_wo_cost_approval_not_collector` | OK | OK | OK | unchanged by apply and by rollback | `1b167a669e07`, 18787 |
| 6 | `20261115142000_wo_cost_entries_ledger` | OK | OK | OK | unchanged by apply and by rollback | `29cdc7f9a88f`, 18787 |
| 7 | `20261116100000_clo_corrective_action_review` | OK | OK | OK | unchanged by apply and by rollback | `f907c5d3cba1`, 18898 |
| 8 | `20261116101000_clo_checklist_acknowledge_exception` | OK | OK | OK | unchanged by apply and by rollback | `f12b8a1760ff`, 18978 |
| 9 | `20261116102000_clo_supervisor_actions_visibility` | OK | OK | OK | unchanged by apply and by rollback | `697541773a8e`, 19033 |

Full chain: after all nine steps (plus step 0) were applied, the ten rollback files were run in reverse order (9 to 1, then step 0). The fingerprint and the invariants were byte-identical to the baseline taken before step 0.

Not tested in this rehearsal: the PostgREST HTTP path (all probes ran in SQL as the `authenticated` role with `request.jwt.claims` set); the refusal probes of steps 7 and 8 against a real corrective action or checklist (the staging copy holds none, so the writers refuse with "does not exist or is outside your company"; the 76 closure cases on #520 cover real rows); browser behaviour (rounds 2 and 3 cover it on the PR branches); production-sized timing.

One rehearsal finding that changes the plan: `anum_integration.apply_reader_policies()`, which steps 2, 6 and 8 call at the end, rewrites the `anum_reader_*` policies of EVERY RLS table, not only the new ones. On the staging copy 30 tables drifted from `reader_tables` (including `observation_erp_links` and `observation_erp_link_events`, created by `20261115120000`, which does not call it), so step 2 initially did not roll back cleanly. Hence step 0: measure the drift on production first; if it is not 0, normalise it as its own reversible step before step 1. Production measured 2026-11-15: drift = 2 (`observation_erp_links`, `observation_erp_link_events`), so step 0 is now narrowed to those two tables only (see "Step 0 exact change"). After step 0 the drift stayed 0 through all nine steps.

## Order and timing

1. Merge #519 (carries #528 and #511) with the owner's go. A merge applies no migration (production records only MCP-applied timestamps; no workflow runs `supabase db push`).
2. Deploy the web from main (Vercel project `tyre-pulse`, production workflow). Without the drafts the client degrades safely: the cost ledger says "not available" and writes nothing, the form never changes `parts_cost`, and permission checks fall back to today's rules. Watch Work Orders, Workshop Live Control and the job card form for one hour before step 0.
3. Database steps 0 (if needed) and 1 to 6, one at a time, each with its preflight, verify and owner go/no-go. Leave at least the go/no-go check between steps; there is no need to wait days.
4. Merge #520 AFTER #519, resolving `src/lib/checklistAccess.js` exactly as on `claude/round3-integration-7rxp2t` (one list of module-gated paths). Deploy the web. The #520 build must be live BEFORE steps 7 to 9. If steps 7 to 9 were applied with only the #519 build live, users would see: the old status dropdown still closes corrective actions (accepted while `ca_allow_direct_close` is true, recorded as `direct_closed`), no submit/review/exception buttons, and no acknowledge option on faulty checklists; nothing breaks, but the workflow is invisible. Supervisors would get the Corrective Actions menu item (step 9) but the #519 build sends them back to Checklists (defect C1), so step 9 must wait for the #520 build.
5. Database steps 7, 8, 9 in order.

The ERP interim lock stays untouched. None of the nine drafts and none of the ten rollback files mentions `observation_erp_decide`, `confirm_observation_erp_link` or `reject_observation_erp_link` (`grep -cE "observation_erp_decide|confirm_observation_erp_link|reject_observation_erp_link"` returns 0 for all 18 files plus the two step 0 files). The invariants query re-reads the three ACLs and hashes after every step: unchanged in the rehearsal (`{postgres=X/postgres,service_role=X/postgres}`).

## Applying on production (both paths)

- Apply each file as ONE migration with the Supabase `apply_migration` tool or the SQL editor. The tool records the version as the timestamp of the apply (for example `20261116...`), NOT the draft stamp in the file name; note both in the release log. Files of #519 carry their own `begin; ... commit;`. The #520 files 100000 and 101000 do not; `apply_migration` wraps them in one transaction, and in the SQL editor wrap them in `begin; ... commit;`.
- MCP confirm-gate trap: any text containing `drop` or `delete` (even a comment or a function name such as `wo_delete_guard`) makes the MCP tool wait for a human; in a cloud session it times out after 60 s. The owner must be present (or use the SQL editor) for: step 0, step 1, step 2, step 3, step 6, step 7, step 8, and for EVERY rollback file except the one of step 5. Steps 4, 5 and 9 apply files contain neither word.
- After each apply: move the file from `supabase/pending_migrations/` to `supabase/migrations/` with the recorded timestamp and change its header to APPLIED, on a branch, in one commit per step.

Placeholders in the probes: `<MANAGER_ID>` an approved Manager of Company A with an open work order in their site; `<TYRE_MAN_ID>` an approved Tyre Man of the same company NOT assigned to `<OPEN_WO_ID>`; `<ADMIN_ID>` an approved Admin; `<OPEN_WO_ID>` an open work order of Company A (`00000000-0000-0000-0000-000000000001`) in KSA. Choose them with read-only queries before starting. Every probe runs inside `begin; ... rollback;` and changes nothing. Step 5 changes one profile role inside the rolled-back transaction with `session_replication_role = replica`; on production run that probe only in the SQL editor as the owner, or skip it and rely on the function-text check.

Before step 0, run and save `runbook_519_520/invariants.sql` and `runbook_519_520/schema_fingerprint.sql` on production (read only). Run both again after every apply and every rollback. After an apply only the objects of that step may differ; after a rollback the fingerprint must equal the saved one exactly.

## Step 0: Reader-policy normalisation (narrow, two tables only)

- PR: #519. Apply file: `runbook_519_520/step0_reader_policy_normalise.sql`. Rollback file: `runbook_519_520/step0_reader_policy_normalise_ROLLBACK.sql`.
- Contains drop/delete text (MCP confirm gate): yes. The apply contains "delete" (policy name `anum_reader_no_delete` and `for delete`); the rollback contains "drop" and "delete". The owner must be present for both.
- What users see / owner go-no-go: No user-visible change. Only the read-only reporting bot (a user listed in `anum_integration.readers`) stops seeing the two ERP decision tables.
- Replaces the earlier global step 0 (which called `apply_reader_policies()` on every table). Production drift measured 2026-11-15 = exactly `observation_erp_links` and `observation_erp_link_events`, so the global call is not needed.

### Step 0 exact change

Affected objects: `public.observation_erp_links` and `public.observation_erp_link_events`. Nothing else. No grant, no revoke, no function, no other table, no call to `apply_reader_policies()` (the apply file names it only in comments).

Affected roles: `authenticated` only. Every new policy is `RESTRICTIVE ... TO authenticated` with the expression `not (select anum_integration.is_reader())`. `is_reader()` is true only when `auth.uid()` is a row of `anum_integration.readers`, so the only identity whose access changes is the reporting reader. For every other signed-in user the expression is true and the result is unchanged. `anon` has no grant on either table (unchanged). `service_role` bypasses RLS (unchanged).

| Table | Policy | Kind | Command | Before | After |
|---|---|---|---|---|---|
| observation_erp_links | observation_erp_links_org | RESTRICTIVE | ALL | present | unchanged |
| observation_erp_links | observation_erp_links_country | RESTRICTIVE | SELECT | present | unchanged |
| observation_erp_links | observation_erp_links_read | PERMISSIVE | SELECT | present | unchanged |
| observation_erp_links | anum_reader_select_scope | RESTRICTIVE | SELECT | absent | using `not (select anum_integration.is_reader())` |
| observation_erp_links | anum_reader_no_insert | RESTRICTIVE | INSERT | absent | with check same expression |
| observation_erp_links | anum_reader_no_update | RESTRICTIVE | UPDATE | absent | using and with check same expression |
| observation_erp_links | anum_reader_no_delete | RESTRICTIVE | DELETE | absent | using same expression |
| observation_erp_link_events | observation_erp_events_org | RESTRICTIVE | SELECT | present | unchanged |
| observation_erp_link_events | observation_erp_events_country | RESTRICTIVE | SELECT | present | unchanged |
| observation_erp_link_events | observation_erp_events_read | PERMISSIVE | SELECT | present | unchanged |
| observation_erp_link_events | anum_reader_select_scope / _no_insert / _no_update / _no_delete | RESTRICTIVE | as above | absent | as above |

Why it cannot widen access: a RESTRICTIVE policy is ANDed with the existing policies, so it can only remove rows, never add them. No PERMISSIVE policy is added (the verify file checks the table still has exactly 2 permissive policies, both `*_read`). No grant changes (the verify file compares both ACLs to `{postgres=arwdDxt/postgres,service_role=arwdDxt/postgres,authenticated=r/postgres}`). Authenticated users still hold SELECT only, so INSERT, UPDATE and DELETE stay refused by privilege; the three write policies are defence in depth.

Tenant isolation: the org and country policies are not touched (policy list compared before and after; the rehearsal diff over all 4,620 policy lines of the copy shows exactly 8 added lines and 0 changed or removed).

ERP interim lock untouched: `grep -cE "observation_erp_decide|confirm_observation_erp_link|reject_observation_erp_link"` returns 0 for both step 0 files. Verify re-checks that `authenticated` and `anon` cannot execute any of the three functions; rehearsal ACL before and after: `{postgres=X/postgres,service_role=X/postgres}`.

Preflight guard (inside the apply, same transaction): aborts unless both tables exist with RLS on, neither has any `anum_reader_*` policy, neither is in `anum_integration.reader_tables`, and the drift set is exactly `{observation_erp_link_events, observation_erp_links}`. Running the apply twice is refused ("8 anum_reader_* policies already exist").

Policy text equals what `apply_reader_policies()` writes for a table not in `reader_tables`, so the later calls are a no-op for these 8 policies. Note: the call appears in steps 2, 6, 7 and 8 (step 7, `20261116100000`, also ends with `select anum_integration.apply_reader_policies();`).

Rollback: drops exactly the 8 policies by name (no `if exists`, so a missing policy fails loudly). Run only after steps 9 to 1 are rolled back.

### Step 0 rehearsal (local copy tp_step0, 2026-11-15)

Setup: copy of `tyrepulse_staging`; `apply_reader_policies()` run once to clear the copy's own drift; migration `20261115120000` applied; EXECUTE on the three ERP functions revoked from authenticated, public and anon (production interim lock). Result: drift = 2 with exactly the two production table names, the same 6 policies, the same ACLs, RLS on and FORCE off. Fixture rows (seeded with triggers off, test only): 4 links and 4 events (org A KSA x2, org A UAE x1, org B KSA x1); a reader identity = an approved org A KSA profile listed in `anum_integration.readers`. Probes ran as `authenticated` with `request.jwt.claims` set, and as `service_role`; every write was undone inside its own savepoint.

| Identity | Table | Read before | Read after | Insert / update / delete before and after |
|---|---|---|---|---|
| (a) org A Manager (KSA) | links | 2 | 2 | refused 42501 / 42501 / 42501 (both) |
| (a) org A Manager (KSA) | events | 2 | 2 | refused 42501 / 42501 / 42501 (both) |
| (b) org B Manager (KSA) | links | 1 | 1 | refused 42501 / 42501 / 42501 (both) |
| (b) org B Manager (KSA) | events | 1 | 1 | refused 42501 / 42501 / 42501 (both) |
| (c) reporting reader (org A, KSA) | links | 2 | **0** | refused 42501 / 42501 / 42501 (both) |
| (c) reporting reader (org A, KSA) | events | 2 | **0** | refused 42501 / 42501 / 42501 (both) |
| (d) service_role | links | 4 | 4 | insert 23503 (fixture FK, no real action) / update ok 4 / delete ok 4 (both) |
| (d) service_role | events | 4 | 4 | insert ok / update P0001 / delete P0001 (append-only trigger) (both) |

The only difference between the before and after probe outputs is the two reader read lines (diff = 2 lines).

| Check | Result |
|---|---|
| Preflight | drift 2 (the two tables), anum_reader_* on them 0, in reader_tables 0 |
| Apply | 8 CREATE POLICY, COMMIT |
| verify_step0.sql | drift 0; 8 policies exact; total 14; 2 permissive; grants unchanged; ERP lock untouched: all t |
| Re-apply | refused by the guard |
| All policies after apply vs before | +8 lines, 0 changed, 0 removed |
| `apply_reader_policies()` after step 0 (rolled back) | 0 changed lines over all policies (md5 c28bd6d25586 both) |
| Steps 1 to 9 applied after step 0 | the 8 policies byte-identical after every step; drift 0 after every step |
| ERP functions authenticated / anon EXECUTE | f / f before, after apply and after rollback |
| Rollback | 8 DROP POLICY, COMMIT; two-table policy list identical to the start; all 4,620 policy lines identical (md5 5030c84317ce); drift back to 2; probe output identical to before |

Not tested: the PostgREST HTTP path (SQL probes only); production-sized data; a reader identity on production (none exists in the copy, the fixture one was created for the test). `tp_step0` dropped after the run.

Preflight (record every output):

```sql
\i runbook_519_520/preflight_step0.sql
```

Verify after apply (every `ok` must be `t`, drift must be 0):

```sql
\i runbook_519_520/verify_step0.sql
```

Then run `invariants.sql`: every line must equal the saved baseline, except the 8 new policies if the fingerprint lists policies.

## Step 1: 20261113130000_cur_work_orders_manager_director_default

- PR: #519. Apply file: `supabase/pending_migrations/20261113130000_cur_work_orders_manager_director_default.sql`. Rollback file: `supabase/pending_migrations/20261113130000_cur_work_orders_manager_director_default_ROLLBACK.sql`.
- Contains drop/delete text (MCP confirm gate): yes ("delete" in header text).
- What users see / owner go-no-go: Managers (3 on production) can create and edit job cards. Watch: a Manager opens New Work Order and saves; Tyre Man still cannot.
- Note: Production expectation: `ver1 backup rows` = 4 (organisations whose matrix stored Manager work_orders false); the staging copy had 0. Rollback CAUTION: it restores `organisations.settings` from `_bak.cur1_org_settings_20261113`; any Access Control change made after the apply in those organisations is lost. Compare first (query in the rollback file header).
- Rehearsal: apply OK, verify OK, rollback restored the fingerprint (`c979a0e044dd`), invariants unchanged.

Preflight (all `ok` must be `t`; record the listed values):

```sql
select 'pre1 app_user_can live hash' k, md5(prosrc) = 'df5b4f662cb0822453a8be753da453db' ok from pg_proc where oid = 'public.app_user_can(text,text)'::regprocedure;
select 'pre1 default fn absent' k, to_regprocedure('public.app_role_capability_default(text,text,text)') is null ok;
select 'pre1 anchor once' k, (length(d) - length(replace(d, 'v_default := coalesce((v_ov -> v_role -> p_key ->> v_cap)::boolean, false);', ''))) / length('v_default := coalesce((v_ov -> v_role -> p_key ->> v_cap)::boolean, false);') = 1 ok from (select pg_get_functiondef('public.app_user_can(text,text)'::regprocedure) d) x;
select 'pre1 backup table absent' k, to_regclass('_bak.cur1_org_settings_20261113') is null ok;
```

Verify after apply (all `ok` must be `t`; the lines marked "expect ERROR" must raise 42501 or the refusal message):

```sql
select 'ver1 app_user_can reads default' k, position('app_role_capability_default' in prosrc) > 0 ok from pg_proc where oid = 'public.app_user_can(text,text)'::regprocedure;
select 'ver1 default table' k, public.app_role_capability_default('Manager','work_orders','create') and public.app_role_capability_default('Director','work_orders','edit') and not public.app_role_capability_default('Manager','work_orders','delete') and not public.app_role_capability_default('Manager','fleet_master','edit') and not public.app_role_capability_default('Tyre Man','work_orders','create') ok;
select 'ver1 grants (anon f, authenticated f)' k, not has_function_privilege('anon','public.app_role_capability_default(text,text,text)','EXECUTE') and not has_function_privilege('authenticated','public.app_role_capability_default(text,text,text)','EXECUTE') ok;
select 'ver1 app_user_can ACL unchanged' k, proacl::text from pg_proc where oid = 'public.app_user_can(text,text)'::regprocedure;
select 'ver1 backup rows' k, count(*) from _bak.cur1_org_settings_20261113;
begin; select set_config('request.jwt.claims', '{"sub":"<MANAGER_ID>","role":"authenticated"}', true) is not null as as_manager; set local role authenticated; select 'probe1 Manager create/edit allowed, delete refused' k, public.app_user_can('work_orders','create') and public.app_user_can('work_orders','edit') and not public.app_user_can('work_orders','delete') ok; rollback;
begin; select set_config('request.jwt.claims', '{"sub":"<TYRE_MAN_ID>","role":"authenticated"}', true) is not null as as_tyreman; set local role authenticated; select 'probe1 Tyre Man create refused' k, not public.app_user_can('work_orders','create') ok; rollback;
```

Then run `invariants.sql`: every line must equal the saved baseline.

## Step 2: 20261115140000_wo_permission_resolver

- PR: #519. Apply file: `supabase/pending_migrations/20261115140000_wo_permission_resolver.sql`. Rollback file: `supabase/pending_migrations/20261115140000_wo_permission_resolver_ROLLBACK.sql`.
- Contains drop/delete text (MCP confirm gate): yes (app_can_admin_delete, header).
- What users see / owner go-no-go: Nothing enforced yet (policies unchanged until step 3). The web build starts reading work_order_my_access(): buttons follow the rule table. Watch: Work Orders and Workshop Live Control render for Manager, Workshop Supervisor, technician.
- Rehearsal: apply OK, verify OK, rollback restored the fingerprint (`5f8097844cf7`), invariants unchanged.

Preflight (all `ok` must be `t`; record the listed values):

```sql
\i runbook_519_520/preflight_reader_policy_drift.sql
select 'pre2 step1 applied' k, to_regprocedure('public.app_role_capability_default(text,text,text)') is not null ok;
select 'pre2 rule table absent' k, to_regclass('public.work_order_role_rules') is null ok;
select 'pre2 resolver fns absent' k, count(*) = 0 ok from pg_proc where pronamespace='public'::regnamespace and proname in ('work_order_can','work_order_can_job','work_order_scope','work_order_my_access','work_order_is_assigned','work_order_is_tyre','work_order_is_closed');
select 'pre2 helpers it needs exist' k, to_regprocedure('public.app_can_admin_delete()') is not null and to_regprocedure('public.app_sees_all_sites()') is not null and to_regprocedure('public.app_can_see_site(text)') is not null and to_regprocedure('anum_integration.apply_reader_policies()') is not null ok;
```

Verify after apply (all `ok` must be `t`; the lines marked "expect ERROR" must raise 42501 or the refusal message):

```sql
select 'ver2 built-in rules 31' k, count(*) = 31 ok from public.work_order_role_rules where organisation_id is null;
select 'ver2 RLS on + 3 own policies' k, (select relrowsecurity from pg_class where oid='public.work_order_role_rules'::regclass) and (select count(*) from pg_policies where tablename='work_order_role_rules' and policyname like 'work_order_role_rules_%') = 3 ok;
select 'ver2 anon no EXECUTE on 7 fns' k, bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE')) and bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')) and count(*) = 7 ok from pg_proc p where pronamespace='public'::regnamespace and proname in ('work_order_can','work_order_can_job','work_order_scope','work_order_my_access','work_order_is_assigned','work_order_is_tyre','work_order_is_closed');
select 'ver2 anon no table grant' k, not has_table_privilege('anon','public.work_order_role_rules','SELECT') ok;
select 'ver2 is_tyre' k, public.work_order_is_tyre('Tyre Change', null, null) and not public.work_order_is_tyre('Repair', null, null) and public.work_order_is_tyre('Repair','S1',null) ok;
begin; select set_config('request.jwt.claims', '{"sub":"<MANAGER_ID>","role":"authenticated"}', true) is not null as as_manager; set local role authenticated; select 'probe2 Manager create scope all' k, public.work_order_my_access() ->> 'create' = 'all' ok; rollback;
begin; select set_config('request.jwt.claims', '{"sub":"<TYRE_MAN_ID>","role":"authenticated"}', true) is not null as as_tyreman; set local role authenticated; select 'probe2 Tyre Man create refused, progress assigned' k, (public.work_order_my_access() ->> 'create') is null and public.work_order_my_access() ->> 'progress' = 'assigned' ok; rollback;
```

Then run `invariants.sql`: every line must equal the saved baseline.

## Step 3: 20261115140500_wo_policies_and_guards

- PR: #519. Apply file: `supabase/pending_migrations/20261115140500_wo_policies_and_guards.sql`. Rollback file: `supabase/pending_migrations/20261115140500_wo_policies_and_guards_ROLLBACK.sql`.
- Contains drop/delete text (MCP confirm gate): yes (wo_delete_guard).
- What users see / owner go-no-go: Enforcement starts: closed jobs editable by Admin only, technicians write only assigned jobs, supervisors assign by job site. Watch: a technician can progress only their own job; a Manager edits an open job; editing a closed job shows the Admin-only message.
- Rehearsal: apply OK, verify OK, rollback restored the fingerprint (`c2c64832cf0b`), invariants unchanged.

Preflight (all `ok` must be `t`; record the listed values):

```sql
select 'pre3 step2 applied' k, to_regclass('public.work_order_role_rules') is not null ok;
select 'pre3 guard fns absent' k, count(*) = 0 ok from pg_proc where pronamespace='public'::regnamespace and proname in ('wo_write_guard','wo_delete_guard','wo_tasks_progress_guard','work_order_can_any_write','work_order_can_event');
select 'pre3 policy wo_tasks_assignee_progress absent' k, not exists (select 1 from pg_policies where tablename='wo_tasks' and policyname='wo_tasks_assignee_progress') ok;
select 'pre3 live policy expressions' k, policyname, coalesce(qual,'') q, coalesce(with_check,'') c from pg_policies where (tablename,policyname) in (('work_orders','work_orders_cap_insert'),('work_orders','work_orders_cap_update'),('wo_assignments','wo_assignments_elevated_write'),('wo_tasks','wo_tasks_elevated_write'),('tech_activity_events','tech_activity_events_elevated_write'),('tech_activity_events','tech_activity_events_self_insert'),('tech_activity_events','tech_activity_events_own_visibility')) order by policyname;
```

Verify after apply (all `ok` must be `t`; the lines marked "expect ERROR" must raise 42501 or the refusal message):

```sql
select 'ver3 two guard triggers enabled' k, count(*) = 2 ok from pg_trigger where tgrelid='public.work_orders'::regclass and tgname in ('wo_write_guard','wo_delete_guard') and tgenabled='O';
select 'ver3 tasks guard enabled' k, count(*) = 1 ok from pg_trigger where tgrelid='public.wo_tasks'::regclass and tgname='wo_tasks_progress_guard' and tgenabled='O';
select 'ver3 insert policy uses work_order_can' k, position('work_order_can' in with_check) > 0 ok from pg_policies where tablename='work_orders' and policyname='work_orders_cap_insert';
select 'ver3 anon no EXECUTE; trigger fns not callable by authenticated' k, not has_function_privilege('anon','public.work_order_can_any_write(uuid,text,text,boolean,uuid)','EXECUTE') and not has_function_privilege('anon','public.work_order_can_event(text,uuid,text,text,uuid)','EXECUTE') and not has_function_privilege('authenticated','public.wo_write_guard()','EXECUTE') ok;
begin; select set_config('request.jwt.claims', '{"sub":"<MANAGER_ID>","role":"authenticated"}', true) is not null as as_manager; set local role authenticated; with u as (update public.work_orders set notes = coalesce(notes,'') where id = '<OPEN_WO_ID>' returning 1) select 'probe3 Manager may update open job' k, count(*) = 1 ok from u; rollback;
begin; select set_config('request.jwt.claims', '{"sub":"<TYRE_MAN_ID>","role":"authenticated"}', true) is not null as as_tyreman; set local role authenticated; with u as (update public.work_orders set notes = coalesce(notes,'') where id = '<OPEN_WO_ID>' returning 1) select 'probe3 Tyre Man unassigned job refused (0 rows)' k, count(*) = 0 ok from u; rollback;
```

Then run `invariants.sql`: every line must equal the saved baseline.

## Step 4: 20261115141000_wo_supervisor_module_visibility

- PR: #519. Apply file: `supabase/pending_migrations/20261115141000_wo_supervisor_module_visibility.sql`. Rollback file: `supabase/pending_migrations/20261115141000_wo_supervisor_module_visibility_ROLLBACK.sql`.
- Contains drop/delete text (MCP confirm gate): no.
- What users see / owner go-no-go: Supervisors see Work Orders and Workshop Live Control in the menu; technicians see My Jobs. Watch: the menu for Workshop Supervisor and Tyre Man.
- Note: Rollback CAUTION: an Admin edit to one of the 27 built-in rows after the apply is undone. Production expectation for `pre4 current built-in rows`: record them; the rollback restores exactly these values and removes rows the apply created.
- Rehearsal: apply OK, verify OK, rollback restored the fingerprint (`0f779a617a3b`), invariants unchanged.

Preflight (all `ok` must be `t`; record the listed values):

```sql
select 'pre4 step3 applied' k, to_regprocedure('public.wo_write_guard()') is not null ok;
select 'pre4 backup absent' k, to_regclass('_bak.wo3_module_permissions_20261115') is null ok;
select 'pre4 no duplicate built-in rows' k, count(*) = 0 ok from (select role, module_key from public.module_permissions where org_id is null group by 1,2 having count(*) > 1) d;
select 'pre4 unique index for on conflict' k, count(*) >= 1 ok from pg_indexes where tablename='module_permissions' and indexdef ilike '%coalesce(org_id%';
select 'pre4 current built-in rows' k, role, module_key, enabled from public.module_permissions where org_id is null and module_key in ('work_orders','workshop_live') order by 2,3;
```

Verify after apply (all `ok` must be `t`; the lines marked "expect ERROR" must raise 42501 or the refusal message):

```sql
select 'ver4 5 supervisor rows true' k, count(*) = 5 ok from public.module_permissions where org_id is null and enabled and (role, module_key) in (('Workshop Supervisor','work_orders'),('Workshop Supervisor','workshop_live'),('Maintenance Supervisor','work_orders'),('Maintenance Supervisor','workshop_live'),('Workshop Area Manager','workshop_live'));
select 'ver4 technician rows true (22 incl Tyre Man)' k, count(*) = 22 ok from public.module_permissions where org_id is null and module_key='work_orders' and enabled and role in (select role from public.work_order_role_rules where organisation_id is null and scope='assigned');
select 'ver4 per-company rows untouched' k, count(*) from public.module_permissions where org_id is not null;
select 'ver4 backup not readable by authenticated' k, not has_table_privilege('authenticated','_bak.wo3_module_permissions_20261115','SELECT') ok;
begin; select set_config('request.jwt.claims', '{"sub":"<TYRE_MAN_ID>","role":"authenticated"}', true) is not null as as_tyreman; set local role authenticated; select 'probe4 Tyre Man sees work_orders module' k, coalesce((select bool_or(enabled) from public.module_permissions where module_key='work_orders' and role='Tyre Man' and org_id is null), false) ok; rollback;
begin; select set_config('request.jwt.claims', '{"sub":"<TYRE_MAN_ID>","role":"authenticated"}', true) is not null as as_tyreman; set local role authenticated; with u as (update public.module_permissions set enabled = enabled where module_key='work_orders' returning 1) select 'probe4 Tyre Man cannot write module_permissions (0 rows)' k, count(*) = 0 ok from u; rollback;
```

Then run `invariants.sql`: every line must equal the saved baseline.

## Step 5: 20261115141500_wo_cost_approval_not_collector

- PR: #519. Apply file: `supabase/pending_migrations/20261115141500_wo_cost_approval_not_collector.sql`. Rollback file: `supabase/pending_migrations/20261115141500_wo_cost_approval_not_collector_ROLLBACK.sql`.
- Contains drop/delete text (MCP confirm gate): no.
- What users see / owner go-no-go: None visible today (no published work order approval policy). A Tyre Data Collector can no longer be named as a work order approver.
- Rehearsal: apply OK, verify OK, rollback restored the fingerprint (`1b167a669e07`), invariants unchanged.

Preflight (all `ok` must be `t`; record the listed values):

```sql
select 'pre5 person_eligible present' k, count(*) = 1 ok from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='approval_private' and p.proname='person_eligible';
select 'pre5 role list found once, no work_order branch' k, (length(d)-length(replace(d, $s$ELSE ARRAY['Admin','Maintenance Supervisor','Workshop Supervisor','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager','Tyre Data Collector'] END$s$,''))) / length($s$ELSE ARRAY['Admin','Maintenance Supervisor','Workshop Supervisor','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager','Tyre Data Collector'] END$s$) = 1 and position($s$WHEN p_type='work_order'$s$ in d) = 0 ok from (select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='approval_private' and p.proname='person_eligible') x;
select 'pre5 hash (record it)' k, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='approval_private' and p.proname='person_eligible';
select 'pre5 no published work order approvals' k, count(*) from public.approval_execution_requests;
```

Verify after apply (all `ok` must be `t`; the lines marked "expect ERROR" must raise 42501 or the refusal message):

```sql
select 'ver5 work_order branch present' k, position($s$WHEN p_type='work_order' THEN ARRAY['Admin'$s$ in prosrc) > 0 ok from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='approval_private' and p.proname='person_eligible';
select 'ver5 ACL unchanged (anon none)' k, coalesce(proacl::text,'default') acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='approval_private' and p.proname='person_eligible';
begin; set local session_replication_role = replica; update public.profiles set role='Tyre Data Collector' where id='<TYRE_MAN_ID>'; insert into public.module_permissions (role, module_key, org_id, enabled) select 'Tyre Data Collector', k, null, true from unnest(approval_private.module_keys('work_order') || approval_private.module_keys('checklist')) k on conflict do nothing;
select 'probe5 collector refused for work_order, still eligible for checklist' k, approval_private.person_eligible('<TYRE_MAN_ID>','00000000-0000-0000-0000-000000000001','work_order',null,null) = false and approval_private.person_eligible('<TYRE_MAN_ID>','00000000-0000-0000-0000-000000000001','checklist',null,null) = true ok; rollback;
select 'probe5 Admin still eligible for work_order' k, approval_private.person_eligible('<ADMIN_ID>','00000000-0000-0000-0000-000000000001','work_order',null,null) ok;
```

Then run `invariants.sql`: every line must equal the saved baseline.

## Step 6: 20261115142000_wo_cost_entries_ledger

- PR: #519. Apply file: `supabase/pending_migrations/20261115142000_wo_cost_entries_ledger.sql`. Rollback file: `supabase/pending_migrations/20261115142000_wo_cost_entries_ledger_ROLLBACK.sql`.
- Contains drop/delete text (MCP confirm gate): yes (header, immutability guard).
- What users see / owner go-no-go: "Add cost" on a job card becomes available (draft, reconciliation, independent approval). Watch: imported parts_cost unchanged on a card with stored cost; an added part shows as a ledger entry, not in parts_cost.
- Note: Rollback STOP: if `work_order_cost_entries` holds any row, export it and prefer the switch-off (revoke EXECUTE on the six RPCs, in the rollback file header) over removal.
- Rehearsal: apply OK, verify OK, rollback restored the fingerprint (`29cdc7f9a88f`), invariants unchanged.

Preflight (all `ok` must be `t`; record the listed values):

```sql
\i runbook_519_520/preflight_reader_policy_drift.sql
select 'pre6 step2 resolver present' k, to_regprocedure('public.work_order_can_job(text,uuid)') is not null ok;
select 'pre6 ledger absent' k, to_regclass('public.work_order_cost_entries') is null and to_regclass('public.work_order_cost_entry_events') is null and to_regclass('public.v_work_order_cost_totals') is null ok;
select 'pre6 currency_for_country present' k, to_regprocedure('public.currency_for_country(text)') is not null ok;
```

Verify after apply (all `ok` must be `t`; the lines marked "expect ERROR" must raise 42501 or the refusal message):

```sql
select 'ver6 RLS on both tables' k, bool_and(relrowsecurity) ok from pg_class where oid in ('public.work_order_cost_entries'::regclass,'public.work_order_cost_entry_events'::regclass);
select 'ver6 own policies (4 + 2)' k, (select count(*) from pg_policies where tablename='work_order_cost_entries' and policyname like 'wo_cost_%') = 4 and (select count(*) from pg_policies where tablename='work_order_cost_entry_events' and policyname like 'wo_cost_%') = 2 ok;
select 'ver6 authenticated SELECT only' k, has_table_privilege('authenticated','public.work_order_cost_entries','SELECT') and not has_table_privilege('authenticated','public.work_order_cost_entries','INSERT') and not has_table_privilege('authenticated','public.work_order_cost_entries','UPDATE') and not has_table_privilege('anon','public.work_order_cost_entries','SELECT') ok;
select 'ver6 anon no EXECUTE on 6 RPCs, authenticated yes' k, bool_and(not has_function_privilege('anon',p.oid,'EXECUTE') and has_function_privilege('authenticated',p.oid,'EXECUTE')) and count(*) = 6 ok from pg_proc p where pronamespace='public'::regnamespace and proname in ('work_order_cost_reconcile','work_order_cost_add','work_order_cost_submit','work_order_cost_decide','work_order_cost_withdraw','work_order_cost_reverse');
select 'ver6 wo_cost_log not callable' k, not has_function_privilege('authenticated','public.wo_cost_log(uuid,uuid,text,text,text,text)','EXECUTE') ok;
select 'ver6 view security_invoker' k, 'security_invoker=on' = any(reloptions) ok from pg_class where oid='public.v_work_order_cost_totals'::regclass;
select 'ver6 ledger empty' k, count(*) = 0 ok from public.work_order_cost_entries;
begin; select set_config('request.jwt.claims', '{"sub":"<MANAGER_ID>","role":"authenticated"}', true) is not null as as_manager; set local role authenticated; select 'probe6 Manager adds a draft cost' k, (public.work_order_cost_add('<OPEN_WO_ID>','additional','parts','X1','Probe part',1,10,null,'manual',null,'runbook probe') ->> 'status') is not null ok; rollback;
begin; select set_config('request.jwt.claims', '{"sub":"<TYRE_MAN_ID>","role":"authenticated"}', true) is not null as as_tyreman; set local role authenticated; select 'probe6 Tyre Man refused (expect ERROR 42501 next line)' k; select public.work_order_cost_add('<OPEN_WO_ID>','additional','parts','X1','Probe part',1,10,null,'manual',null,'runbook probe'); rollback;
```

Then run `invariants.sql`: every line must equal the saved baseline.

## Step 7: 20261116100000_clo_corrective_action_review

- PR: #520. Apply file: `supabase/pending_migrations/20261116100000_clo_corrective_action_review.sql (branch claude/closure-workflow-7rxp2t)`. Rollback file: `supabase/pending_migrations/20261116100000_clo_corrective_action_review_ROLLBACK.sql (branch claude/closure-workflow-7rxp2t)`.
- Contains drop/delete text (MCP confirm gate): yes (header ROLLBACK section, "drop" in comments).
- What users see / owner go-no-go: Corrective actions: worker submits evidence, a reviewer approves or returns; exceptions are requested and decided by a different person. Open and Closed counts do not move.
- Note: Rollback STOP: count review_status and review events first (rollback file header); the Open / In Progress / Closed status is never touched.
- Rehearsal: apply OK, verify OK, rollback restored the fingerprint (`f907c5d3cba1`), invariants unchanged.

Preflight (all `ok` must be `t`; record the listed values):

```sql
\i runbook_519_520/preflight_reader_policy_drift.sql
select 'pre7 #519 ledger applied' k, to_regclass('public.work_order_cost_entries') is not null ok;
select 'pre7 objects absent' k, to_regclass('public.closure_review_config') is null and to_regclass('public.corrective_action_review_events') is null and not exists (select 1 from information_schema.columns where table_name='corrective_actions' and column_name='review_status') ok;
select 'pre7 trigger name free' k, not exists (select 1 from pg_trigger where tgname='trg_ca_review_guard') ok;
select 'pre7 corrective_actions statuses' k, status, count(*) from public.corrective_actions group by status order by 2;
```

Verify after apply (all `ok` must be `t`; the lines marked "expect ERROR" must raise 42501 or the refusal message):

```sql
select 'ver7 11 new columns, all null' k, (select count(*) from information_schema.columns where table_name='corrective_actions' and column_name in ('review_status','submitted_by','submitted_at','completion_note','completion_photos','reviewed_by','reviewed_at','review_comment','exception_requested_by','exception_requested_at','exception_reason')) = 11 and not exists (select 1 from public.corrective_actions where review_status is not null) ok;
select 'ver7 RLS on 2 tables' k, bool_and(relrowsecurity) ok from pg_class where oid in ('public.closure_review_config'::regclass,'public.corrective_action_review_events'::regclass);
select 'ver7 events table SELECT only' k, has_table_privilege('authenticated','public.corrective_action_review_events','SELECT') and not has_table_privilege('authenticated','public.corrective_action_review_events','INSERT') and not has_table_privilege('anon','public.corrective_action_review_events','SELECT') ok;
select 'ver7 anon no EXECUTE on writers, authenticated yes' k, bool_and(not has_function_privilege('anon',p.oid,'EXECUTE') and has_function_privilege('authenticated',p.oid,'EXECUTE')) and count(*) = 8 ok from pg_proc p where pronamespace='public'::regnamespace and proname in ('corrective_action_worker_update','corrective_action_submit_completion','corrective_action_review','corrective_action_request_exception','corrective_action_decide_exception','corrective_action_my_permissions','get_closure_review_config','save_closure_review_config');
select 'ver7 guard trigger enabled' k, tgenabled = 'O' ok from pg_trigger where tgname='trg_ca_review_guard';
begin; select set_config('request.jwt.claims', '{"sub":"<MANAGER_ID>","role":"authenticated"}', true) is not null as as_manager; set local role authenticated; select 'probe7 Manager reads closure config' k, public.get_closure_review_config() is not null ok; rollback;
begin; select set_config('request.jwt.claims', '{"sub":"<TYRE_MAN_ID>","role":"authenticated"}', true) is not null as as_tyreman; set local role authenticated; select 'probe7 Tyre Man review refused (expect ERROR next line)' k; select public.corrective_action_review(gen_random_uuid(),'approve','x'); rollback;
```

Then run `invariants.sql`: every line must equal the saved baseline.

## Step 8: 20261116101000_clo_checklist_acknowledge_exception

- PR: #520. Apply file: `supabase/pending_migrations/20261116101000_clo_checklist_acknowledge_exception.sql (branch claude/closure-workflow-7rxp2t)`. Rollback file: `supabase/pending_migrations/20261116101000_clo_checklist_acknowledge_exception_ROLLBACK.sql (branch claude/closure-workflow-7rxp2t)`.
- Contains drop/delete text (MCP confirm gate): yes ("drop constraint" executed: the status CHECK is swapped).
- What users see / owner go-no-go: Signers can acknowledge a sheet with a fault (it stays not compliant until every fault action is closed). Clean sheets approve as before.
- Note: Preflight must show the `checklist_is_area_manager()` md5 `d5993d23fe17f89fe8732256878bdfc3`; if production differs, replace the body in the rollback file with the production body before the apply. The rollback refuses to run when any sheet is `acknowledged`.
- Rehearsal: apply OK, verify OK, rollback restored the fingerprint (`f12b8a1760ff`), invariants unchanged.

Preflight (all `ok` must be `t`; record the listed values):

```sql
\i runbook_519_520/preflight_reader_policy_drift.sql
select 'pre8 step7 applied' k, to_regclass('public.closure_review_config') is not null ok;
select 'pre8 status check is the 5-value one' k, pg_get_constraintdef(oid) = $c$CHECK ((approval_status = ANY (ARRAY['not_required'::text, 'pending'::text, 'pending_area_manager'::text, 'approved'::text, 'rejected'::text])))$c$ ok from pg_constraint where conname='checklist_submissions_approval_status_chk';
select 'pre8 checklist_is_area_manager md5 (rollback body matches d5993d23...)' k, md5(pg_get_functiondef('public.checklist_is_area_manager()'::regprocedure)) = 'd5993d23fe17f89fe8732256878bdfc3' ok;
select 'pre8 objects absent' k, to_regclass('public.checklist_decision_events') is null and to_regprocedure('public.acknowledge_checklist_faults(uuid,text,text)') is null ok;
select 'pre8 checklist_submissions by approval_status' k, approval_status, count(*) from public.checklist_submissions group by 2 order by 2;
```

Verify after apply (all `ok` must be `t`; the lines marked "expect ERROR" must raise 42501 or the refusal message):

```sql
select 'ver8 status check includes acknowledged' k, position('acknowledged' in pg_get_constraintdef(oid)) > 0 ok from pg_constraint where conname='checklist_submissions_approval_status_chk';
select 'ver8 no sheet acknowledged by the apply' k, count(*) = 0 ok from public.checklist_submissions where approval_status='acknowledged';
select 'ver8 decision events RLS + SELECT only' k, (select relrowsecurity from pg_class where oid='public.checklist_decision_events'::regclass) and has_table_privilege('authenticated','public.checklist_decision_events','SELECT') and not has_table_privilege('authenticated','public.checklist_decision_events','INSERT') ok;
select 'ver8 anon no EXECUTE on acknowledge' k, not has_function_privilege('anon','public.acknowledge_checklist_faults(uuid,text,text)','EXECUTE') and has_function_privilege('authenticated','public.acknowledge_checklist_faults(uuid,text,text)','EXECUTE') ok;
select 'ver8 view security_invoker, no anon' k, 'security_invoker=on' = any(reloptions) and not has_table_privilege('anon','public.v_checklist_fault_compliance','SELECT') ok from pg_class where oid='public.v_checklist_fault_compliance'::regclass;
begin; select set_config('request.jwt.claims', '{"sub":"<MANAGER_ID>","role":"authenticated"}', true) is not null as as_manager; set local role authenticated; select 'probe8 Manager reads compliance view' k, count(*) >= 0 ok from public.v_checklist_fault_compliance; rollback;
begin; select set_config('request.jwt.claims', '{"sub":"<TYRE_MAN_ID>","role":"authenticated"}', true) is not null as as_tyreman; set local role authenticated; select 'probe8 Tyre Man acknowledge refused (expect ERROR next line)' k; select public.acknowledge_checklist_faults(gen_random_uuid(),'x','<svg/>'); rollback;
```

Then run `invariants.sql`: every line must equal the saved baseline.

## Step 9: 20261116102000_clo_supervisor_actions_visibility

- PR: #520. Apply file: `supabase/pending_migrations/20261116102000_clo_supervisor_actions_visibility.sql (branch claude/closure-workflow-7rxp2t)`. Rollback file: `supabase/pending_migrations/20261116102000_clo_supervisor_actions_visibility_ROLLBACK.sql (branch claude/closure-workflow-7rxp2t)`.
- Contains drop/delete text (MCP confirm gate): no.
- What users see / owner go-no-go: Workshop Supervisor and Maintenance Supervisor see Corrective Actions in the menu.
- Note: The rollback removes the two rows; run it only if preflight showed no rows for these roles.
- Rehearsal: apply OK, verify OK, rollback restored the fingerprint (`697541773a8e`), invariants unchanged.

Preflight (all `ok` must be `t`; record the listed values):

```sql
select 'pre9 step7 applied' k, to_regclass('public.closure_review_config') is not null ok;
select 'pre9 no existing rows for the two roles' k, count(*) = 0 ok from public.module_permissions where org_id is null and module_key='corrective_actions' and role in ('Workshop Supervisor','Maintenance Supervisor');
```

Verify after apply (all `ok` must be `t`; the lines marked "expect ERROR" must raise 42501 or the refusal message):

```sql
select 'ver9 2 rows true' k, count(*) = 2 ok from public.module_permissions where org_id is null and module_key='corrective_actions' and enabled and role in ('Workshop Supervisor','Maintenance Supervisor');
begin; select set_config('request.jwt.claims', '{"sub":"<TYRE_MAN_ID>","role":"authenticated"}', true) is not null as as_tyreman; set local role authenticated; with u as (insert into public.module_permissions (role,module_key,org_id,enabled) values ('Tyre Man','corrective_actions',null,true) returning 1) select 'probe9 Tyre Man cannot write module_permissions' k, count(*) from u; rollback;
```

Then run `invariants.sql`: every line must equal the saved baseline.

## Rolling back

Database rollback runs in reverse order only: 9, 8, 7, then 6, 5, 4, 3, 2, 1, then step 0. Each rollback file refuses or warns when a later step is still applied or when user data would be lost (6, 7, 8). Rehearsed as one chain: fingerprint and invariants identical to the baseline.

Web side (Vercel project `tyre-pulse`): promote the previous production deployment (Vercel dashboard, Deployments, previous production build, "Promote" / instant rollback).

- Rolling back only the web (database steps stay): safe for #519 and #520. The previous build ignores the new objects; database rules still apply (for example a technician still cannot edit an unassigned job).
- Rolling back the database: roll the web back FIRST when the database rollback removes something the current build calls on every screen load (steps 2, 6, 7, 8: `work_order_my_access`, the cost ledger RPCs, closure RPCs, `acknowledge_checklist_faults`). The #519 and #520 builds degrade when these are missing (rehearsed by `closureSafeDegrade.test.js` and the "not available" ledger state), so the order is a precaution, not a requirement. For steps 1, 3, 4, 5, 9 the order does not matter.
- Never roll the web back to a build older than main before #519 while steps 1 to 6 stay applied without checking with the owner: older Work Orders screens show buttons the database now refuses (the save fails with a clear message, nothing is written).

## Files

- `runbook_519_520/schema_fingerprint.sql`, `runbook_519_520/invariants.sql`, `runbook_519_520/preflight_reader_policy_drift.sql`
- `runbook_519_520/preflight_stepN.sql`, `runbook_519_520/verify_stepN.sql` for N = 0 to 9 (same text as above)
- `runbook_519_520/step0_reader_policy_normalise.sql` and its `_ROLLBACK.sql`
- Rollback files for steps 1 to 6: `supabase/pending_migrations/<stamp>_..._ROLLBACK.sql` on this branch. Steps 7 to 9: same naming on `claude/closure-workflow-7rxp2t` (#520).
