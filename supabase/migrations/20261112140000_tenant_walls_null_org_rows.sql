-- Tenant walls: org-less landing table, null-organisation rows, cross-tenant writes.
--
-- FINDINGS: RLS-3 (P0), RLS-4 (P0/P2), RLS-5 (P1)  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12 (everything below the
--   PRE-FLIGHT block; nothing held back). Verified by rolled-back impersonation
--   (VERIFY block at the foot).
--
-- WHAT WAS WRONG (each reproduced live before the change, demo-org Manager):
--   ksa_asset_master_upload 1236 rows readable (no org column, role-only gate)
--   report_send_log 192 / system_logs 273 / workflow_definitions 25 null-org rows
--     readable; domain_events 51 null-org rows readable
--   update workflow_definitions -> 25 rows, kpi_targets -> 7, column_mappings -> 16,
--     insert system_logs with organisation_id null -> 1 row
--
-- WHAT THIS DOES
--   RLS-3  ksa_asset_master_upload gets organisation_id (default app_current_org()),
--          all 1236 rows stamped Company A (every asset_no matches a Company A
--          vehicle_fleet row, 0 match the demo org), RESTRICTIVE org isolation.
--   RLS-4  report_send_log: 164 null-org rows stamped from report_schedules.org_id
--          (the parent row; the existing insert trigger already does this for new
--          rows). The 28 rows whose schedule no longer exists stay null and are
--          now super-admin only.
--          system_logs: null-org rows are platform rows (cron_seal_audit, retention,
--          nightly-backup, sentry, security_audit; user_id null on all) -> super
--          admin only. No backfill.
--          domain_events: null-org rows -> super admin only. NOT backfilled: the
--          table's own trigger makes organisation_id immutable and 37 of the 51
--          rows have no actor.
--          workflow_definitions: 25 null-org rows stamped Company A. Basis: all
--          created 2026-07-10..12, before the second tenant existed (2026-09-28);
--          50 of 52 instances launched from them carry a Company A org or a
--          Company A starter, none belongs to another tenant; steps contain no
--          user id or address. Read/write are now own-org (or super admin).
--   RLS-5  kpi_targets and column_mappings get organisation_id + RESTRICTIVE org
--          isolation (all rows predate the first extra organisation, 2026-06-29, so
--          they are Company A). system_logs insert must carry the caller's own org.
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- Data loss: none. No row removed. Three additive nullable columns. Snapshots of
--   the rows whose organisation was stamped: _bak.report_send_log_org_20261112
--   (164 ids), _bak.workflow_definitions_org_20261112 (25 ids). kpi_targets (7),
--   column_mappings (16), ksa_asset_master_upload (1236): every row was null-less
--   before (column did not exist), so rollback = clear the column.
-- Rename / removal: none. No client selects break (additive columns).
-- Type change / CHECK: none.
-- Locks: ADD COLUMN without default on 3 small tables (7 / 16 / 1236 rows), then
--   SET DEFAULT (catalog only). report_send_log trigger toggle = brief SHARE ROW
--   EXCLUSIVE on a 258-row table.
-- Triggers: report_send_log.prevent_audit_mutation_trigger refuses every UPDATE,
--   so it is switched off for the one backfill statement and back on in the same
--   transaction (verified tgenabled = 'O'). workflow_definitions.trg_audit_row
--   writes 25 audit rows (intended). No trigger on kpi_targets / column_mappings.
-- RLS impact: Company A users read exactly what they read before EXCEPT
--   (a) 28 orphan report_send_log rows, (b) 273 platform system_logs rows,
--   (c) 51 null-org domain_events - these are now super-admin only.
--   Other tenants lose the cross-tenant rows (the fix).
-- Writers checked: send-scheduled-reports (service role, bypasses RLS; the insert
--   trigger stamps the org). system_logs: 22 SECURITY DEFINER writers + cron run
--   as owner (unaffected); the web client relies on the column default
--   (src/lib/api/systemLogs.js does not send organisation_id). workflow engine
--   (consume_event_workflows / _workflow_launch) is SECURITY DEFINER and matches
--   definitions by org: Company A events still launch; events with no org still
--   launch; another tenant's events no longer launch Company A's definitions.
-- Known side effects (stated, not hidden):
--   kpi_targets unique key (metric,year,month,site) and column_mappings unique
--   fingerprint are still GLOBAL. A second tenant saving the same key now gets a
--   clean RLS refusal instead of overwriting Company A's row.
--   The demo organisation has no workflow definitions of its own any more.
-- Duration: < 1 s. Rollback: at the foot.

-- ------------------------------------------------------------------- RLS-3
alter table public.ksa_asset_master_upload add column if not exists organisation_id uuid;
update public.ksa_asset_master_upload
   set organisation_id = '00000000-0000-0000-0000-000000000001'
 where organisation_id is null;
alter table public.ksa_asset_master_upload alter column organisation_id set default public.app_current_org();

create policy ksa_asset_master_upload_org_isolation on public.ksa_asset_master_upload
  as restrictive for all to public
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));

-- ------------------------------------------------------------------- RLS-4
create table if not exists _bak.report_send_log_org_20261112 as
  select l.id from public.report_send_log l
    join public.report_schedules s on s.id = l.schedule_id
   where l.organisation_id is null and s.org_id is not null;
alter table _bak.report_send_log_org_20261112 enable row level security;

alter table public.report_send_log disable trigger prevent_audit_mutation_trigger;
update public.report_send_log l
   set organisation_id = s.org_id
  from public.report_schedules s
 where s.id = l.schedule_id and l.organisation_id is null and s.org_id is not null;
alter table public.report_send_log enable trigger prevent_audit_mutation_trigger;

alter policy report_send_log_read on public.report_send_log
  using (
    (select public.is_super_admin())
    or ((organisation_id = (select public.app_current_org()))
        and ((select public.get_my_role()) = any (array['Admin'::text, 'Manager'::text, 'Director'::text])))
  );

alter policy system_logs_read on public.system_logs
  using (
    (select public.is_super_admin())
    or ((organisation_id = (select public.app_current_org()))
        and ((select public.get_my_role()) = any (array['Admin'::text, 'Manager'::text, 'Director'::text])))
  );

alter policy system_logs_update on public.system_logs
  using ((select public.is_super_admin())
         or ((organisation_id = (select public.app_current_org())) and (select public.get_my_role()) = 'Admin'::text))
  with check ((select public.is_super_admin())
         or ((organisation_id = (select public.app_current_org())) and (select public.get_my_role()) = 'Admin'::text));

alter policy domain_events_select_elevated on public.domain_events
  using (
    (select public.is_super_admin())
    or ((select public.is_elevated_user()) and (organisation_id = (select public.app_current_org())))
  );

create table if not exists _bak.workflow_definitions_org_20261112 as
  select id from public.workflow_definitions where organisation_id is null;
alter table _bak.workflow_definitions_org_20261112 enable row level security;

update public.workflow_definitions
   set organisation_id = '00000000-0000-0000-0000-000000000001'
 where organisation_id is null;

alter policy workflow_definitions_select on public.workflow_definitions
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));

-- ------------------------------------------------------------------- RLS-5
alter policy workflow_definitions_write on public.workflow_definitions
  using ((select public.is_super_admin())
         or ((select public.is_elevated_user()) and (organisation_id = (select public.app_current_org()))))
  with check ((select public.is_super_admin())
         or ((select public.is_elevated_user()) and (organisation_id = (select public.app_current_org()))));

alter policy system_logs_insert on public.system_logs
  with check (
    (select auth.uid()) is not null
    and ((organisation_id is not distinct from (select public.app_current_org()))
         or (select public.is_super_admin()))
  );

alter table public.kpi_targets add column if not exists organisation_id uuid;
update public.kpi_targets set organisation_id = '00000000-0000-0000-0000-000000000001' where organisation_id is null;
alter table public.kpi_targets alter column organisation_id set default public.app_current_org();
create index if not exists idx_kpi_targets_organisation_id on public.kpi_targets (organisation_id);

create policy kpi_targets_org_isolation on public.kpi_targets
  as restrictive for all to public
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));

alter table public.column_mappings add column if not exists organisation_id uuid;
update public.column_mappings c
   set organisation_id = coalesce(
         (select p.org_id from public.profiles p where p.id = c.confirmed_by),
         '00000000-0000-0000-0000-000000000001')
 where c.organisation_id is null;
alter table public.column_mappings alter column organisation_id set default public.app_current_org();
create index if not exists idx_column_mappings_organisation_id on public.column_mappings (organisation_id);

create policy column_mappings_org_isolation on public.column_mappings
  as restrictive for all to public
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));

-- ============================================================================
-- VERIFY (rolled-back impersonation, one identity per transaction)
--   demo-org Manager  c2f9a806-...  BEFORE -> AFTER
--     ksa_asset_master_upload 1236 -> 0 | report_send_log 192 -> 0
--     system_logs 273 -> 0 | domain_events 81 -> 30 (own) | workflow_definitions 25 -> 0
--     kpi_targets 7 -> 0 | column_mappings 16 -> 0
--     update workflow_definitions 25 -> 0 rows | kpi_targets 7 -> 0 | column_mappings 16 -> 0
--     insert system_logs organisation_id null -> 42501 ; with own org (default) -> 1 row
--   Company A Manager 34793423-...  (control)
--     ksa_asset_master_upload 1236 | report_send_log 66 -> 230 | workflow_definitions 25
--     kpi_targets 7 (update 7) | column_mappings 16 | system_logs = own-org rows only
--   select tgenabled from pg_trigger where tgname='prevent_audit_mutation_trigger'
--     and tgrelid='public.report_send_log'::regclass;   -- 'O'
--
-- ROLLBACK (owner, SQL editor - contains statements the MCP gate will not run):
--   alter table public.report_send_log disable trigger prevent_audit_mutation_trigger;
--   update public.report_send_log set organisation_id = null
--     where id in (select id from _bak.report_send_log_org_20261112);
--   alter table public.report_send_log enable trigger prevent_audit_mutation_trigger;
--   update public.workflow_definitions set organisation_id = null
--     where id in (select id from _bak.workflow_definitions_org_20261112);
--   then restore the previous policy expressions (ALTER POLICY) and remove the
--   three *_org_isolation policies and the three organisation_id columns:
--     ksa_asset_master_upload_org_isolation, kpi_targets_org_isolation,
--     column_mappings_org_isolation;
--     ksa_asset_master_upload.organisation_id, kpi_targets.organisation_id,
--     column_mappings.organisation_id.
--   Previous expressions:
--     report_send_log_read: ((organisation_id IS NULL OR organisation_id = app_current_org()
--        OR is_super_admin()) AND get_my_role() IN ('Admin','Manager','Director'))
--     system_logs_read: (is_super_admin() OR get_my_role() IN ('Admin','Manager','Director'))
--     system_logs_update: (is_super_admin() OR get_my_role() = 'Admin')  [using + check]
--     system_logs_insert: check (auth.uid() IS NOT NULL)
--     domain_events_select_elevated: (is_elevated_user() AND (organisation_id IS NULL
--        OR organisation_id = app_current_org()))
--     workflow_definitions_select: (organisation_id IS NULL OR organisation_id = app_current_org())
--     workflow_definitions_write: (is_elevated_user() AND (organisation_id IS NULL
--        OR organisation_id = app_current_org()))  [using + check]
