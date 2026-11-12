-- TEN-7b: the shared accident mailbox keys in system_config are readable only by the
--         organisation they belong to (the legacy config organisation) and by a super admin.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12. Not applied to production.
--         Tested on PGlite (supabase/tests/tenant_isolation_ten7b.test.mjs) and on the local
--         PostgreSQL 16 staging copy (supabase/staging, TEN-7 reproduction).
--
-- WHAT IT FIXES
--   system_config is one global table. The keys accident_email_to, accident_email_cc and
--   accident_email_subject_prefix hold the CURRENT company's accident mailbox. Their read level
--   is 'elevated', and "elevated" is judged on the caller's role alone, so an Admin, Manager or
--   Director of ANY organisation reads them straight from the table (measured on staging after
--   TEN-1..TEN-9: a second company's Manager sees both mailbox keys). TEN-7 added org_config(),
--   which already answers per organisation, but left the table read open and said so.
--
--   This file adds one RESTRICTIVE select policy. A row whose key is one of the three mailbox
--   keys is visible only when the caller is a super admin, or the caller's organisation is the
--   one named in system_config.legacy_config_org (TEN-7). Every other key is untouched. The
--   existing read-level policies still apply on top, so inside the legacy organisation the
--   mailbox stays elevated-only exactly as today.
--
-- CURRENT READERS (checked 2026-11-12, read-only) AND WHY THEY KEEP WORKING
--   src/lib/api/accidentWorkflow.js getAccidentMailbox()  direct table read by Admin / Manager /
--       Director of the current company: their organisation IS the legacy config organisation,
--       so the three rows are still returned. Writes there are super admin only already.
--   src/lib/consolePlatform.js (console settings)         super admin: passes.
--   consume_event_accident_notify and accident_mail_config  SECURITY DEFINER: row security is
--       not applied to them, unchanged.
--   Service role (edge functions, cron): bypasses row security, unchanged.
--   A second tenant's Accident Workflow settings page shows an empty mailbox instead of the
--   first company's addresses. Its own mailbox is the org_config / set_org_config path (TEN-7).
--
-- WHAT IT DOES NOT FIX
--   company_logo, report_palette and the other keys in _tenant_config_keys() stay readable by
--   every signed-in user: the web shell reads them directly on every page load, and scoping
--   them needs the readers repointed to org_config() first (client work, roadmap).
--   The global role matrix (module_permissions rows with org_id NULL) stays shared for the
--   built-in roles by design (TEN-7 decision D1).
--
-- RISK TO THE CURRENT COMPANY: LOW, ONE CONDITION.
--   The three rows remain visible to an elevated user only while that user's profiles.org_id
--   equals system_config.legacy_config_org. Checked on the 2026-11-12 read: every approved
--   profile that serves the current company is in that organisation. An elevated user parked in
--   another organisation would see an empty mailbox on the settings page (no error, no effect on
--   sending). If legacy_config_org is ever cleared, only super admins read the mailbox keys;
--   outgoing accident mail is unaffected because the sender is SECURITY DEFINER.
--   Cost: system_config has about 60 rows; the policy helper takes no row argument and is called
--   as a scalar subquery, so it is evaluated once per statement.
--
-- APPLY ORDER: after 20261113111000 (TEN-7), which creates _legacy_config_org(). Aborts otherwise.
--
-- VERIFY (rolled back, after applying):
--   begin;
--   select policyname, permissive, cmd from pg_policies
--    where schemaname = 'public' and tablename = 'system_config'
--      and policyname = 'system_config_mailbox_keys_legacy_org';        -- 1 row, RESTRICTIVE, SELECT
--   select has_function_privilege('authenticated', 'public.system_config_caller_in_legacy_org()', 'EXECUTE'),
--          has_function_privilege('anon', 'public.system_config_caller_in_legacy_org()', 'EXECUTE');   -- t, f
--   -- impersonate a Company A Manager:
--   --   select count(*) from public.system_config where key like 'accident_email%';   same count as before applying
--   --   select count(*) from public.system_config;                                    same count as before applying
--   -- impersonate the demo organisation Manager: the first count is 0, every other key unchanged.
--   -- impersonate a Company A Tyre Man: 0 before and after (read level elevated is kept).
--   rollback;
--
-- ROLLBACK (keeps the objects, switches the rule off):
--   alter policy system_config_mailbox_keys_legacy_org on public.system_config using (true);
-- ---------------------------------------------------------------------------------------------

do $guard$
begin
  if to_regclass('public.system_config') is null then
    raise exception 'TEN-7b aborted: public.system_config does not exist';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.system_config'::regclass) then
    raise exception 'TEN-7b aborted: row level security is off on system_config. A restrictive policy would do nothing; re-author.';
  end if;
  if to_regprocedure('public._legacy_config_org()') is null then
    raise exception 'TEN-7b aborted: public._legacy_config_org() is missing. Apply TEN-7 (20261113111000) first.';
  end if;
  if public._legacy_config_org() is null
     or not exists (select 1 from public.organisations o where o.id = public._legacy_config_org()) then
    raise exception 'TEN-7b aborted: system_config.legacy_config_org does not name an existing organisation. The current company would lose its mailbox read.';
  end if;
  if public.system_config_read_level('accident_email_to') is distinct from 'elevated' then
    raise exception 'TEN-7b aborted: accident_email_to is no longer read level elevated (found %). Re-author this migration.',
      public.system_config_read_level('accident_email_to');
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'system_config' and cmd = 'SELECT'
                    and permissive = 'PERMISSIVE' and qual like '%system_config_read_level%') then
    raise exception 'TEN-7b aborted: the read-level select policy on system_config was not found. Re-author this migration.';
  end if;
end
$guard$;

-- True when the caller may read configuration that belongs to the legacy config organisation.
-- Takes no argument and reveals only a yes or no about the caller itself.
create or replace function public.system_config_caller_in_legacy_org()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select coalesce(public.is_super_admin(), false)
      or coalesce(public.app_current_org() = public._legacy_config_org(), false)
$fn$;

revoke all on function public.system_config_caller_in_legacy_org() from public;
revoke all on function public.system_config_caller_in_legacy_org() from anon;
grant execute on function public.system_config_caller_in_legacy_org() to authenticated, service_role;

do $mig$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'system_config'
                    and policyname = 'system_config_mailbox_keys_legacy_org') then
    create policy system_config_mailbox_keys_legacy_org on public.system_config
      as restrictive for select to public
      using (
        key not in ('accident_email_to', 'accident_email_cc', 'accident_email_subject_prefix')
        or (select public.system_config_caller_in_legacy_org())
      );
  end if;
  if has_function_privilege('anon', 'public.system_config_caller_in_legacy_org()', 'EXECUTE') then
    raise exception 'TEN-7b aborted: anon can execute system_config_caller_in_legacy_org';
  end if;
end
$mig$;
