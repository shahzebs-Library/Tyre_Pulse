-- A driver sees only their own data.
--
-- STATUS: APPLIED LIVE 2026-11-27 on owner OK (yes 1-4). Post-apply check as Driver 07540a9c: drivers 1, accidents 0, issues 0, own issue insert ok, old meter edit changed nothing.
-- 2026-11-27 (see VERIFY). The main session applies it.
-- Depends on public.app_my_driver_ids() (20261127160000; re-declared here,
-- identical body, so this file also applies on its own).
--
-- OWNER RULE (2026-11-27): a driver sees their own drivers row (not all 674),
-- their own fines, their own requests (repair requests, issues), their own
-- vehicle assignments and the handovers they took part in. Elevated roles and
-- the Fleet Supervisor keep full read in scope.
--
-- WHAT WAS WRONG (measured live, impersonating Driver 07540a9c):
--   drivers 674 rows (drivers_select is USING true), corrective_actions 214.
--   repair_requests and handover_reports hold 0 rows today but their read
--   policies admit any active user, so the first rows would be visible to every
--   driver. driver_fines / driver_charges / driver_team_assignments /
--   driver_charge_instalments / driver_fine_responses / driver_record_links /
--   driver_account_links are already scoped through
--   private.driver_workspace_access(), which returns 'driver' only for the
--   caller's own linked driver; a capability grant (driver_workspace view,
--   fleet_master edit) added to the Driver role later would widen them.
--
-- WHAT THIS ADDS: one RESTRICTIVE SELECT policy per table, named
-- <table>_driver_own_scope, whose predicate is TRUE for every role except
-- 'driver' (app_role()), so no other role changes. For the Driver:
--   drivers                    id is one of my linked drivers rows
--   corrective_actions         created_by = me (or submitted_by = me)
--   repair_requests            reported_by = me
--   handover_reports           created_by = me, or from/to driver is mine,
--                              or I signed it (from_signed_by / to_signed_by)
--   driver_team_assignments,
--   driver_fines, driver_charges, driver_charge_instalments,
--   driver_fine_responses, driver_record_links, driver_account_links
--                              driver_id is one of my linked drivers rows
-- The RESTRICTIVE org / country / site policies still apply on top.
-- SECURITY DEFINER functions (driver_workspace(), fleet_supervisor_* ...) are
-- not affected (they bypass RLS and do their own checks).
--
-- NOT DONE: odometer_logs / engine_hours_logs reads stay as they are (the phone
-- shows the last reading for the asset being logged); accidents are scoped in
-- 20261127160000.

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
revoke execute on function public.app_my_driver_ids() from public;
revoke execute on function public.app_my_driver_ids() from anon;
grant execute on function public.app_my_driver_ids() to authenticated, service_role;

create policy drivers_driver_own_scope on public.drivers
  as restrictive for select to authenticated
  using ((select public.app_role()) <> 'driver'
         or id = any (coalesce((select public.app_my_driver_ids()), '{}'::uuid[])));

create policy corrective_actions_driver_own_scope on public.corrective_actions
  as restrictive for select to authenticated
  using ((select public.app_role()) <> 'driver'
         or created_by = (select auth.uid())
         or submitted_by = (select auth.uid()));

create policy repair_requests_driver_own_scope on public.repair_requests
  as restrictive for select to authenticated
  using ((select public.app_role()) <> 'driver'
         or reported_by = (select auth.uid()));

create policy handover_reports_driver_own_scope on public.handover_reports
  as restrictive for select to authenticated
  using ((select public.app_role()) <> 'driver'
         or created_by = (select auth.uid())
         or from_signed_by = (select auth.uid())
         or to_signed_by = (select auth.uid())
         or from_driver_id = any (coalesce((select public.app_my_driver_ids()), '{}'::uuid[]))
         or to_driver_id = any (coalesce((select public.app_my_driver_ids()), '{}'::uuid[])));

do $$
declare t text;
begin
  foreach t in array array['driver_team_assignments', 'driver_fines', 'driver_charges',
                           'driver_charge_instalments', 'driver_fine_responses',
                           'driver_record_links', 'driver_account_links'] loop
    execute format(
      'create policy %I on public.%I as restrictive for select to authenticated
         using ((select public.app_role()) <> %L
                or driver_id = any (coalesce((select public.app_my_driver_ids()), %L::uuid[])))',
      t || '_driver_own_scope', t, 'driver', '{}');
  end loop;
end $$;

commit;

-- VERIFY (rolled back, one user per transaction; counts before -> after):
--   Tested 2026-11-27, plus 2 planted handovers (one to this driver) and 2 planted
--   repair requests (one by this driver), together with 20261127160000's
--   accident read policy:
--                       drivers  issues  repair_req  handovers  links  accidents
--   Driver 07540a9c     674->1   214->0  (2)->1      (2)->1     1->1   43->0
--   Fleet Sup f3a70480  674=674  214=214 (2)->2      (2)->2     0      43=43
--   Manager 34793423    674=674  214=214 (2)->2      (2)->2     0      43=43
--   driver_fines / driver_charges / driver_team_assignments hold 0 rows for
--   everyone today, so their policy (same predicate as driver_account_links)
--   was not exercised with data.
--
-- ROLLBACK:
--   drop policy drivers_driver_own_scope on public.drivers;
--   drop policy corrective_actions_driver_own_scope on public.corrective_actions;
--   drop policy repair_requests_driver_own_scope on public.repair_requests;
--   drop policy handover_reports_driver_own_scope on public.handover_reports;
--   drop policy driver_team_assignments_driver_own_scope on public.driver_team_assignments;
--   drop policy driver_fines_driver_own_scope on public.driver_fines;
--   drop policy driver_charges_driver_own_scope on public.driver_charges;
--   drop policy driver_charge_instalments_driver_own_scope on public.driver_charge_instalments;
--   drop policy driver_fine_responses_driver_own_scope on public.driver_fine_responses;
--   drop policy driver_record_links_driver_own_scope on public.driver_record_links;
--   drop policy driver_account_links_driver_own_scope on public.driver_account_links;
