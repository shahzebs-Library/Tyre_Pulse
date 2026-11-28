-- Drivers can save their own issue reports and their own accident reports.
--
-- STATUS: APPLIED LIVE 2026-11-27 on owner OK (yes 1-4). Post-apply check as Driver 07540a9c: drivers 1, accidents 0, issues 0, own issue insert ok, old meter edit changed nothing.
-- 2026-11-27 (see VERIFY). The main session applies it.
--
-- OWNER RULE (2026-11-27): "Drivers can save their own issue reports and
-- accident reports, only for accidents they were involved in. They may read
-- their own accidents. They may NOT edit or close them afterwards."
--
-- WHAT WAS WRONG (measured live, impersonating the real Driver 07540a9c):
--   * corrective_actions INSERT: actions_insert admits Reporter/Manager/Admin
--     only and app_user_can('corrective_actions','create') is false for the
--     Driver role, so the phone REPORT_ISSUE command was refused (42501).
--   * accidents INSERT: role_insert_accidents admits admin/manager/director/
--     inspector/tyre_man only and app_user_can('accidents','create') is false,
--     so a driver could not file the accident they were in.
--   * accidents SELECT: the Driver read all 43 accidents in scope, not their own.
--   * accidents.reported_by and corrective_actions.created_by have no default,
--     so a payload that omits them stores NULL and the row is orphaned.
--
-- WHAT THIS ADDS (additive):
--   1. public.app_my_driver_ids(): the drivers rows linked to the caller's
--      login (driver_account_links). Shared with 20261127163000.
--   2. Stamp triggers: corrective_actions.created_by and (for the Driver role)
--      accidents.reported_by default to auth.uid() when the payload leaves them
--      NULL. Never overwrites a value that was sent.
--   3. corrective_actions_own_report_insert (PERMISSIVE INSERT): any approved,
--      active user may file an issue as themselves, as a fresh Open report with
--      no closure / review / verification fields. The RESTRICTIVE org, country
--      and site policies still apply on top.
--   4. accidents_driver_own_insert (PERMISSIVE INSERT): the Driver role may
--      file an accident as reported_by = themselves, status 'reported', with no
--      closure, release, approval or review fields set.
--   5. accidents_driver_own_read (RESTRICTIVE SELECT, Driver role only): a
--      driver reads an accident they reported, or one an admin linked to their
--      drivers row through driver_record_links (source_type 'accidents').
--      Every other role is unaffected (the predicate is true for them).
--   6. accidents_driver_no_update / accidents_driver_no_delete (RESTRICTIVE):
--      the Driver role can never update or delete an accident, even if a
--      capability grant is added later.
--
-- NOT DONE ON PURPOSE:
--   * accidents.driver_name is free text. Matching it to the linked driver's
--     name to widen "their own" was rejected: names are not unique.
--   * A Driver's issue reports are visible to them through
--     20261127163000 (created_by = auth.uid()).

begin;

create or replace function public.app_my_driver_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(l.driver_id), '{}'::uuid[])
    from public.driver_account_links l
   where l.user_id = auth.uid()
     and l.organisation_id = public.app_current_org();
$$;
comment on function public.app_my_driver_ids() is
  'drivers.id rows linked to the caller login via driver_account_links (own org only). Used by Driver-only RLS.';
revoke execute on function public.app_my_driver_ids() from public;
revoke execute on function public.app_my_driver_ids() from anon;
grant execute on function public.app_my_driver_ids() to authenticated, service_role;

-- 2. stamp the reporter when the payload leaves it blank
create or replace function public.stamp_own_report_author()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_table_name = 'corrective_actions' then
    new.created_by := coalesce(new.created_by, auth.uid());
  elsif tg_table_name = 'accidents' then
    if public.app_role() = 'driver' then
      new.reported_by := coalesce(new.reported_by, auth.uid());
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.stamp_own_report_author() from public;
revoke execute on function public.stamp_own_report_author() from anon;

drop trigger if exists trg_aa_stamp_own_report_author on public.corrective_actions;
create trigger trg_aa_stamp_own_report_author
  before insert on public.corrective_actions
  for each row execute function public.stamp_own_report_author();

drop trigger if exists trg_aa_stamp_own_report_author on public.accidents;
create trigger trg_aa_stamp_own_report_author
  before insert on public.accidents
  for each row execute function public.stamp_own_report_author();

-- 3. own issue report
create policy corrective_actions_own_report_insert
  on public.corrective_actions
  as permissive
  for insert
  to authenticated
  with check (
    (select public.app_is_active()) is true
    and created_by = (select auth.uid())
    and coalesce(status, 'Open') = 'Open'
    and closed_by is null and closed_at is null and resolved_at is null
    and verified_by is null and verified_at is null
    and review_status is null and reviewed_by is null and reviewed_at is null
  );

-- 4. driver files their own accident
create policy accidents_driver_own_insert
  on public.accidents
  as permissive
  for insert
  to authenticated
  with check (
    (select public.app_role()) = 'driver'
    and (select public.app_is_active()) is true
    and reported_by = (select auth.uid())
    and status = 'reported'
    and coalesce(closure_status, 'open') = 'open'
    and coalesce(workflow_stage, 'reported') = 'reported'
    and coalesce(case_status, 'submitted') in ('draft', 'submitted')
    and closure_approved_by is null and closure_approved_at is null
    and close_requested_by is null
    and reviewed_by is null and reviewed_at is null
    and estimate_approved_by is null
    and release_date is null
  );

-- 5. a driver reads only their own accidents
create policy accidents_driver_own_read
  on public.accidents
  as restrictive
  for select
  to authenticated
  using (
    (select public.app_role()) <> 'driver'
    or reported_by = (select auth.uid())
    or exists (
      select 1 from public.driver_record_links r
       where r.source_type = 'accidents'
         and r.source_id = accidents.id
         and r.driver_id = any (coalesce((select public.app_my_driver_ids()), '{}'::uuid[]))
    )
  );

-- 6. a driver never edits or deletes an accident
create policy accidents_driver_no_update
  on public.accidents
  as restrictive
  for update
  to authenticated
  using ((select public.app_role()) <> 'driver')
  with check ((select public.app_role()) <> 'driver');

create policy accidents_driver_no_delete
  on public.accidents
  as restrictive
  for delete
  to authenticated
  using ((select public.app_role()) <> 'driver');

commit;

-- VERIFY (run each block as its own transaction, then roll back):
--   begin;
--   select set_config('request.jwt.claims','{"sub":"07540a9c-9d4c-44a7-804d-8b2affd8bbe9","role":"authenticated"}',true);
--   set local role authenticated;
--   insert into corrective_actions(title,description,site,country) values ('test','x','NHC','KSA') returning created_by, status;  -- ok, created_by = driver
--   insert into corrective_actions(title,status,country) values ('t','Closed','KSA');                                         -- 42501
--   insert into accidents(asset_no,incident_date,country,site) values ('TM514',current_date,'KSA','NHC') returning reported_by; -- ok
--   insert into accidents(asset_no,incident_date,country,status) values ('TM514',current_date,'KSA','closed');
--     -> ACCEPTED but stored as status 'reported' / stage 'reported': the
--        existing closure gate trigger rewrites a closed status on insert
--        before the policy check runs, so a driver can never file a closed case.
--   update accidents set notes='x' where reported_by=auth.uid();                                                               -- 0 rows
--   select count(*) from accidents;                                                                                            -- own only
--   rollback;
--   Tested 2026-11-27 as Driver 07540a9c (rolled back):
--     BEFORE: corrective_actions insert 42501, accidents insert 42501, 43 accidents visible.
--     AFTER : own issue OK (created_by stamped, status Open); Closed issue 42501;
--             issue as another user 42501; issue in UAE 42501 (country policy);
--             own accident OK (reported_by stamped); accident as another user 42501;
--             update / close own accident -> 0 rows; accidents visible = own only (2 test rows).
--
-- ROLLBACK:
--   drop policy accidents_driver_no_delete on public.accidents;
--   drop policy accidents_driver_no_update on public.accidents;
--   drop policy accidents_driver_own_read on public.accidents;
--   drop policy accidents_driver_own_insert on public.accidents;
--   drop policy corrective_actions_own_report_insert on public.corrective_actions;
--   drop trigger trg_aa_stamp_own_report_author on public.accidents;
--   drop trigger trg_aa_stamp_own_report_author on public.corrective_actions;
--   drop function public.stamp_own_report_author();
--   -- keep app_my_driver_ids() if 20261127163000 is applied (it depends on it)
