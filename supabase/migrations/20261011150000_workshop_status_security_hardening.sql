-- =============================================================================
-- Workshop Status loop 17 - security hardening (APPLIED 2026-10-11)
-- =============================================================================
-- STATUS: APPLIED live 2026-10-11 (apply_migration workshop_status_security_hardening).
--   Verified rolled back: Workshop Supervisor all-sites upload=t; narrowed to {NHC}
--   upload=f, view=t; anon execute=f, authenticated=t.
--
-- FINDING (latent scope bypass):
--   workshop_status_stage_upload / workshop_status_confirm_upload /
--   workshop_status_cancel_upload check the ORG and the COUNTRY of the upload,
--   but never the caller's SITE scope. A daily file is country-wide: confirming
--   it inserts, refreshes and RELEASES (current_active = false) every vehicle in
--   that country, at every site. So a user restricted to one site
--   (profiles.sites = '{NHC}') who holds 'upload' or 'confirm' could release or
--   rewrite vehicles at sites they cannot even read (the records_site RLS policy
--   hides them, the DEFINER writer does not).
--   Measured 2026-10-11: 0 approved profiles have a narrowed site scope, so the
--   path is unreachable TODAY. It opens the moment an admin narrows one
--   supervisor's sites.
--
-- FIX: the decision lives in ONE place, workshop_status_can(). 'upload' and
--   'confirm' (country-wide operations) now additionally require the caller to
--   see every site (app_sees_all_sites(): super admin, role Admin, or sites
--   containing ALL / *). Every writer already calls workshop_status_can() for
--   these actions, and workshop_status_my_permissions() reads the same function,
--   so the UI hides the buttons for a site-restricted user with no client change.
--   Behaviour for everyone else is byte-identical (0 users affected today).
--
-- Body = the live definition (pg_get_functiondef 2026-10-11) plus the one guard.
-- CREATE OR REPLACE keeps SECURITY DEFINER, search_path and grants; the grant
-- lines are restated so a partial apply can never leave anon executing it.
--
-- VERIFY after apply (expect: f, t, t):
--   select has_function_privilege('anon', 'public.workshop_status_can(text)', 'execute');
--   select has_function_privilege('authenticated', 'public.workshop_status_can(text)', 'execute');
--   select pg_get_functiondef('public.workshop_status_can(text)'::regprocedure) like '%app_sees_all_sites%';
--
-- ROLLBACK: re-run the workshop_status_can body from
--   supabase/migrations/20261007100000_workshop_status_permissions.sql (lines 50-79).
-- =============================================================================

create or replace function public.workshop_status_can(p_action text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_action text := lower(btrim(coalesce(p_action, '')));
begin
  -- An unapproved, locked or signed-out session can do nothing.
  if not coalesce(public.app_is_active(), false) then return false; end if;

  -- Unknown actions are refused for everyone, super admin included.
  if not (v_action = any (array[
      'view', 'view_removed', 'view_uploads', 'view_activity', 'view_reports', 'view_audit',
      'update', 'upload', 'confirm', 'assign', 'disposition', 'export',
      'archive', 'restore', 'soft_delete', 'configure', 'permanent_delete'])) then
    return false;
  end if;

  -- Super admin: every action, including the one nobody else can hold.
  if coalesce(public.is_super_admin(), false) then return true; end if;
  if v_action = 'permanent_delete' then return false; end if;

  if v_action = 'view' then return coalesce(public.workshop_status_can_view(), false); end if;

  -- Loop 17: a daily file is country-wide (it adds and releases vehicles at
  -- every site), so staging or confirming one needs the whole site scope.
  if v_action in ('upload', 'confirm')
     and not coalesce(public.app_sees_all_sites(), false) then
    return false;
  end if;

  return coalesce(public.workshop_status_can_view(), false)
     and coalesce(public.app_user_can('daily_ops:workshop:' || v_action, 'view'), false);
end $$;

grant execute on function public.workshop_status_can(text) to authenticated, service_role;
revoke all on function public.workshop_status_can(text) from public;
revoke all on function public.workshop_status_can(text) from anon;
