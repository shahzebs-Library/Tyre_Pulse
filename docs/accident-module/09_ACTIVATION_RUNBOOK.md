# 09 - ACCIDENT MODULE ACTIVATION RUNBOOK

Turnkey sequence for a DB-authorized operator to bring the accident case module
live. Follow the steps in order. Each step is independently verifiable and
independently reversible.

## Status and safety guarantees

- The three ready SQL files in this folder are additive, idempotent and
  reviewed-GO, and were validated against the live schema:
  - `02_DATA_MODEL.sql` = migration **V417** (case tables + columns + honest
    backfill + closure guard).
  - `08_ENGINE_SQL_MIRROR.sql` = migration **V418** (51 pure / DEFINER functions
    mirroring `src/lib/accidentCase.js`; no data change).
  - `07_SEED_CONFIG.sql` = config seed for Company A (no migration number; data
    rows only).
- The application code (pure engine `src/lib/accidentCase.js`, the completeness
  view `src/lib/caseCompletionView.js`, and the UI `CaseCompletionPanel.jsx` wired
  into `AccidentDetailModal.jsx`) is already merged and is INERT until Step 1 is
  applied: it reads the new `accidents` columns and the new case tables, which do
  not exist until V417 lands, and every read degrades to an empty / not-started
  state before then.
- Next-free migration number is confirmed **V417** (latest applied is V416). V418
  takes the next slot after V417.
- **Migration numbering for files 10-17.** Only `02_DATA_MODEL.sql` = **V417** and
  `08_ENGINE_SQL_MIRROR.sql` = **V418** are fixed. Files `10_WORKSTREAM_RPCS.sql`,
  `11_NOTIFICATIONS.sql`, `12_SLA_ENGINE.sql`, `13_EVIDENCE.sql`, `14_INSURANCE.sql`,
  `15_REPAIR_FINANCE.sql`, `16_EXTERNAL_PORTAL.sql` and `17_REPORTING_RPCS.sql` do
  NOT have fixed numbers - each takes the next free slot AT APPLY TIME. **Reconcile
  against the standing V419-V422 staging batch (PROJECT_MEMORY part 13), which may
  land first**: if that batch applies before this one, these files take numbers from
  V423 up (or whatever is free); if the accident batch lands first, they take V419
  up. Nothing in files 10-17 depends on its own number. Re-run
  `select version from supabase_migrations.schema_migrations order by version desc
  limit 5;` immediately before applying to claim the real next-free number.
- Run every step inside a transaction where shown. Do a dry run in a branch /
  staging copy first if one is available.

Legend: PRE-REQ = the guard to check before running; APPLY = what to run;
VERIFY = the exact checks that prove success; ROLLBACK = how to reverse.

---

## Step 1 - Apply V417 (data model + honest backfill)

File: `docs/accident-module/02_DATA_MODEL.sql`

PRE-REQ:
- Latest applied migration is V416.
```sql
select version from supabase_migrations.schema_migrations order by version desc limit 3;
-- expect the top row to be V416 (no V417 yet)
```

APPLY:
- Run the whole of `02_DATA_MODEL.sql` as migration V417 (one transaction). It is
  additive (new tables, `add column if not exists`, `if not exists` guards) and its
  Part-A backfill is `IS NULL`-guarded, so it can be re-run without harm.

VERIFY:
```sql
-- (a) accident_* table count moves from 8 to ~38 (8 pre-existing + 30 new)
select count(*) as accident_tables
from information_schema.tables
where table_schema = 'public' and table_name like 'accident_%';
-- expect ~38

-- (b) every one of the 38 live accident rows received a case_no
select count(*) as total_rows,
       count(case_no) as with_case_no,
       count(*) filter (where case_no is null) as missing_case_no
from public.accidents;
-- expect total_rows = with_case_no, missing_case_no = 0

-- (c) closure_level backfilled honestly (no NULLs; legacy closed rows flagged)
select closure_level, count(*)
from public.accidents
group by closure_level order by 1;
-- legacy closed rows read 'legacy_closed', never 'fully_closed'

-- (d) the closure guard is installed
select tgname from pg_trigger
where tgrelid = 'public.accidents'::regclass and tgname = 'trg_enforce_accident_closure';
-- expect one row
```

ROLLBACK:
- Run the ROLLBACK block at the bottom of `02_DATA_MODEL.sql` (drops the guard,
  the ~30 new tables `cascade`, the new `accidents` columns and the two CHECK
  constraints). Note: this discards the backfilled `case_no` / `closure_level`
  values; snapshot `accidents` first if you need to preserve them.

---

## Step 2 - Apply V418 (engine SQL mirror)

File: `docs/accident-module/08_ENGINE_SQL_MIRROR.sql`

PRE-REQ:
- Step 1 (V417) applied and verified. V418 functions read the case shape V417
  creates.
```sql
select 1 from information_schema.columns
where table_schema = 'public' and table_name = 'accidents' and column_name = 'case_no';
-- expect one row
```

APPLY:
- Run the whole of `08_ENGINE_SQL_MIRROR.sql` as migration V418. Every function is
  `create or replace`, so the file is idempotent and re-runnable. It creates no
  tables and changes no data. The enforcement trigger in the file's Section 9 is a
  commented-out sketch and is deliberately NOT installed by V418; the live closure
  guard remains the `enforce_accident_closure` trigger shipped in V417.

VERIFY:
```sql
-- 51 accident engine functions are present
select count(*) as engine_functions
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like 'accident_%' or p.proname like '_acc_%');
-- expect 51 for the V418 mirror (a higher number means pre-existing accident_*
-- functions are also counted; confirm the 51 mirror names from the file are all
-- present)

-- smoke test: a pure reader returns without error
select public.accident_workstream_keys();  -- expect the 10 canonical keys
```

ROLLBACK:
- `drop function if exists` each of the 51 functions (names listed as
  `create or replace function public.<name>` in the file). They are side-effect
  free, so leaving them in place is also harmless.

---

## Step 3 - Apply the config seed (Company A)

File: `docs/accident-module/07_SEED_CONFIG.sql`

PRE-REQ:
- V417 applied (it creates the six config tables). `accident_email_templates`
  already exists (V302).
- OPTIONAL BEFORE THE 7 EMAIL TEMPLATES CAN SEND: extend the
  `accident_apply_tokens` resolver to emit `{{case_no}}`, `{{liability}}`,
  `{{owner}}`, `{{missing_docs}}`, `{{latest_decision}}`. The templates seed
  active=true but no trigger references their keys yet, so seeding them is safe and
  they cannot send until wired.

APPLY:
- Run `07_SEED_CONFIG.sql` (scoped to Company A `00000000-0000-0000-0000-000000000001`).

VERIFY:
```sql
select 'country' as t, count(*) from public.accident_country_rule_profiles
  where organisation_id = '00000000-0000-0000-0000-000000000001'
union all select 'route',   count(*) from public.accident_route_profiles
  where organisation_id = '00000000-0000-0000-0000-000000000001'
union all select 'type',    count(*) from public.accident_type_profiles
  where organisation_id = '00000000-0000-0000-0000-000000000001'
union all select 'sla',     count(*) from public.accident_sla_definitions
  where organisation_id = '00000000-0000-0000-0000-000000000001'
union all select 'evidence',count(*) from public.accident_evidence_requirements
  where organisation_id = '00000000-0000-0000-0000-000000000001'
union all select 'email_new',count(*) from public.accident_email_templates
  where organisation_id = '00000000-0000-0000-0000-000000000001'
    and key in ('workstream_assigned','approval_required','claim_registered','vehicle_ready',
                'handover_rejected','settlement_overdue','ready_for_closure');
-- expect: country 3, route 10, type 31, sla 11, evidence 24, email_new 7
```

ROLLBACK:
- Run the ROLLBACK block at the bottom of `07_SEED_CONFIG.sql` (deletes exactly the
  seeded country / route / type / sla / evidence rows and the 7 new email templates
  for Company A; leaves the 15 pre-existing templates untouched).

---

## Step 4 - Apply the action / behaviour layers (files 10 to 17)

These eight scripts add the per-team action RPCs, the notification wiring, the SLA
engine, the evidence / insurance / repair-finance chains, the external portal and
the server-side analytics. They all depend on V417 (Step 1) and V418 (Step 2), and
the SLA engine (12) also depends on the Part-4 SLA seeds (Step 3). Apply them in the
dependency order below: **10 first** (it declares the shared internal context helper
`public._accident_rpc_context(uuid)` that 13, 14, 15 and 16 REUSE), then 11 and 12
(both after 10), then 13, 14, 15, 16, 17. Each takes the next free migration number
at apply time (see the Migration-numbering note above) - re-check the free number
before EACH file. Every file is idempotent (`create or replace` functions,
`add column if not exists`, guarded triggers) and carries its own ROLLBACK block.

Common PRE-REQ for all of Step 4:
- Steps 1 to 3 applied and verified.
- Re-confirm the next-free migration number immediately before each APPLY.

### Step 4a - `10_WORKSTREAM_RPCS.sql` (per-team workstream / task / closure RPCs)

APPLY: run the whole file in one transaction (it has its own `begin;` / `commit;`).
It creates `public._accident_rpc_context`, `_accident_ws_cap`, `accident_ws_set_status`,
`accident_ws_assign`, `accident_ws_mark_na`, `accident_task_create`,
`accident_task_complete`, `accident_request_closure` and `accident_decide_closure`.
VERIFY:
```sql
-- the 9 workstream RPCs + the shared context helper exist
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('_accident_rpc_context','_accident_ws_cap','accident_ws_set_status',
    'accident_ws_assign','accident_ws_mark_na','accident_task_create','accident_task_complete',
    'accident_request_closure','accident_decide_closure');
-- expect 9

-- closure gate is enforced with the SAFE NA-approval default: a fully_closed approval
-- passes accident_can_fully_close with a NULL profile (na_requires_approval -> TRUE),
-- so an unapproved Not-Applicable waiver cannot close a case through this RPC.
```
ROLLBACK: run the ROLLBACK block at the bottom of the file (`drop function` the 9
RPCs + the context helper). Files 13/14/15/16 reuse the context helper, so roll those
back first if they are already live.

### Step 4b - `11_NOTIFICATIONS.sql` (case notification wiring) - AFTER 10

APPLY: run the file. It adds `consume_event_accident_case_notify(domain_events)`,
registers it in `event_consumers`, and installs the five `trg_*` domain-event
triggers on the case tables. No new notification machinery - it feeds the existing
`domain_events -> process_domain_events -> workflow_notifications -> workflow-notify`
pipeline (V96 / V119). Emails only send when `system_config.accident_emails_enabled`
is true (default false = in-app only).
VERIFY:
```sql
select 1 from public.event_consumers where consumer = 'consume_event_accident_case_notify';
-- expect one row
select count(*) from pg_trigger where tgname in
  ('trg_ws_assigned_ins','trg_ws_assigned_upd','trg_appr_requested_ins',
   'trg_closure_requested_ins','trg_closure_decided_upd');
-- expect 5
```
ROLLBACK: `DELETE FROM event_consumers WHERE consumer='consume_event_accident_case_notify';`
`DROP FUNCTION public.consume_event_accident_case_notify(public.domain_events);` and drop
the five triggers (see the file's ROLLBACK block).

### Step 4c - `12_SLA_ENGINE.sql` (SLA timers, pause/resume, breach scan) - AFTER 10 and 3

APPLY: run the file. It adds `breached_notified` / `warned_notified` guards to
`accident_sla_instances` and creates `accident_sla_start`, `accident_sla_pause`,
`accident_sla_resume` and `accident_sla_scan`. The pg_cron schedule
(`accident-sla-scan-timers`, `30 6 * * *`) is COMMENTED - enable it deliberately at
apply time (cron scheduling cannot run inside a transaction block).
VERIFY:
```sql
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname in
  ('accident_sla_start','accident_sla_pause','accident_sla_resume','accident_sla_scan');
-- expect 4
-- after enabling the cron line:
select jobname from cron.job where jobname = 'accident-sla-scan-timers';  -- expect one row
```
ROLLBACK: `select cron.unschedule('accident-sla-scan-timers');` if enabled, then run
the file's ROLLBACK block (`drop function` the 4 RPCs; the `breached_notified` /
`warned_notified` columns can be dropped too).

### Step 4d - `13_EVIDENCE.sql` (evidence + document workflow) - AFTER 10

APPLY: run the file (own `begin;` / `commit;`). It REUSES `_accident_rpc_context`
from file 10 (does not redeclare it) and creates `accident_evidence_add`,
`accident_evidence_verify`, `accident_document_add`, `accident_document_mark_received`
and `accident_evidence_checklist`.
VERIFY:
```sql
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('accident_evidence_add','accident_evidence_verify',
  'accident_document_add','accident_document_mark_received','accident_evidence_checklist');
-- expect 5
```
ROLLBACK: the file's ROLLBACK block (`drop function` the 5 RPCs). Do NOT drop
`_accident_rpc_context` here - it is owned by file 10 and shared.

### Step 4e - `14_INSURANCE.sql` (claim register / decision / settlement) - AFTER 10

APPLY: run the file (own `begin;` / `commit;`). REUSES `_accident_rpc_context`.
Creates `accident_claim_register`, `accident_claim_decision`, `accident_claim_settlement`.
VERIFY:
```sql
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('accident_claim_register','accident_claim_decision','accident_claim_settlement');
-- expect 3
```
ROLLBACK: the file's ROLLBACK block (drop the 3 RPCs; leave `_accident_rpc_context`).

### Step 4f - `15_REPAIR_FINANCE.sql` (repair chain + finance ledger) - AFTER 10

APPLY: run the file (own `begin;` / `commit;`). REUSES `_accident_rpc_context`.
Creates `accident_repair_order_upsert`, `accident_repair_task_add`,
`accident_repair_task_complete`, `accident_repair_qc`, `accident_repair_complete`,
`accident_finance_txn_add`, `accident_recovery_record`, `accident_downtime_set`.
VERIFY:
```sql
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('accident_repair_order_upsert','accident_repair_task_add','accident_repair_task_complete',
   'accident_repair_qc','accident_repair_complete','accident_finance_txn_add',
   'accident_recovery_record','accident_downtime_set');
-- expect 8
```
ROLLBACK: the file's ROLLBACK block (drop the 8 RPCs; leave `_accident_rpc_context`).

### Step 4g - `16_EXTERNAL_PORTAL.sql` (read-only insurer / authority token portal) - AFTER 10

APPLY: run the file (own `begin;` / `commit;`). REUSES `_accident_rpc_context` on the
mint path. Creates the `accident_portal_shares` table and `accident_portal_create`,
`accident_portal_revoke`, `get_accident_portal_snapshot` (anon-token read, DEFINER,
no base table granted to anon).
VERIFY:
```sql
select 1 from information_schema.tables
where table_schema='public' and table_name='accident_portal_shares';  -- expect one row
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('accident_portal_create','accident_portal_revoke','get_accident_portal_snapshot');
-- expect 3
```
ROLLBACK: the file's ROLLBACK block (drop the 3 RPCs and the `accident_portal_shares`
table; leave `_accident_rpc_context`).

### Step 4h - `17_REPORTING_RPCS.sql` (server-side fleet-wide analytics) - AFTER 10

APPLY: run the file (own `begin;` / `commit;`). Creates the `get_accident_case_*`
aggregate RPCs mirroring `src/lib/accidentCaseAnalytics.js` over the full RLS-scoped
dataset.
VERIFY:
```sql
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like 'get_accident_case%'
   or p.proname in ('get_accident_workstream_bottleneck');
-- expect the reporting RPCs (get_accident_case_kpis / _status_breakdown /
-- get_accident_workstream_bottleneck) present
```
ROLLBACK: the file's ROLLBACK block (drop the reporting RPCs; they are side-effect
free, so leaving them is also harmless).

---

## Step 5 - Legacy case backfill

FILE STATUS: `MIGRATIONS_ACCIDENT_LEGACY_BACKFILL.sql` is the planned Phase-20
reversible, snapshot-protected legacy migration referenced in `00_MASTER_PLAN.md`.
It is NOT yet present in the repo (docs/accident-module/ or repo root) as of this
runbook. Two facts make this step low-risk:

1. The minimal legacy backfill (a `case_no` for all 38 rows and an honest
   `closure_level`, with `case_flags.closure_basis='backfilled'` on legacy closed
   rows) ALREADY runs inside V417 Part A, so it is done and verified after Step 1.
2. The data model deliberately does NOT fabricate `accident_case_workstreams` /
   closure-requirement rows for pre-existing accidents (02_DATA_MODEL.md route
   instantiation note): a legacy case keeps working on its scalar columns and shows
   a not-started case screen rather than an invented one.

PRE-REQ:
- Steps 1 to 3 applied and verified (Step 4 is independent and not a prerequisite
  for the legacy backfill).
- Confirm `MIGRATIONS_ACCIDENT_LEGACY_BACKFILL.sql` has been authored and marked
  reviewed-GO before running it. If it is not present, this step is a no-op beyond
  the V417 Part-A backfill already completed in Step 1, and you may proceed to
  Step 6.

APPLY (only when the file exists and is reviewed-GO):
- Take a snapshot of `accidents` (and any case table the migration writes) first.
```sql
create table if not exists public._bak_accidents_legacy_backfill as
  select * from public.accidents;
```
- Run `MIGRATIONS_ACCIDENT_LEGACY_BACKFILL.sql` in one transaction. It must be
  `IS NULL` / `not exists` guarded so a re-run is idempotent.

VERIFY:
```sql
-- no legacy row was left without a case_no or a closure_level (already true from Step 1)
select count(*) filter (where case_no is null) as missing_case_no,
       count(*) filter (where closure_level is null) as missing_closure_level
from public.accidents;
-- expect 0 and 0

-- no legacy closed row was falsely upgraded to a verified full closure
select count(*) as false_full_closures
from public.accidents
where closure_level = 'fully_closed'
  and case_flags ->> 'closure_basis' = 'backfilled';
-- expect 0
```

ROLLBACK:
```sql
-- restore from the pre-run snapshot, then drop it
-- (adapt columns to whatever the backfill migration changed)
update public.accidents a set
  closure_level = b.closure_level,
  case_flags    = b.case_flags
from public._bak_accidents_legacy_backfill b
where a.id = b.id;
drop table if exists public._bak_accidents_legacy_backfill;
```

---

## Step 6 - Go live (UI wiring)

The foundation code and the UI wiring are already merged and inert. No further code
change is required to activate; the panel begins reading real data automatically
once Steps 1 to 3 are live.

PRE-REQ:
- Steps 1 to 3 applied and verified. Step 4 (the action / behaviour layers) is
  required for the per-team actions, SLA, evidence, insurance, repair-finance,
  portal and server-side analytics to work; the Case Completion panel itself renders
  on Steps 1 to 3 alone. Step 5 (legacy backfill) is optional per its FILE STATUS.
- Confirmed live: `src/lib/accidentCase.js`, `src/lib/caseCompletionView.js`,
  `src/components/accidents/CaseCompletionPanel.jsx`, and its mount point in
  `src/components/AccidentDetailModal.jsx`.

APPLY:
- Ensure the merged build is deployed. `CaseCompletionPanel` renders inside the
  accident detail screen and now resolves against the live case tables and the
  seeded route / SLA / evidence config instead of the empty fallback.

VERIFY:
- Open an accident in the app. The Case Completion panel shows a resolved route,
  the ten workstreams with real statuses, the five completeness percentages and the
  closure gate (blockers list), all matching the SQL mirror.
```sql
-- server and client must agree on the route for a sample case; pick any accident id
select public.accident_build_case_route(to_jsonb(a), '[]'::jsonb)
from public.accidents a where a.id = '<accident-id>';
```
- Attempt an API-only close on a case with open blockers: the V417
  `enforce_accident_closure` guard rejects it with error 42501, proving closure
  cannot be bypassed.

ROLLBACK:
- No code rollback needed to disable the feature after data rollback: reversing
  Step 1 removes the case columns / tables, and the UI degrades back to its inert
  not-started state on the next load.
