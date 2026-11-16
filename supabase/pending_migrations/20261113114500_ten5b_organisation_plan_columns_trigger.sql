-- TEN-5b: the plan, status and limit columns of public.organisations are guarded on EVERY update,
--         not only on updates that name the settings column.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12. Not applied to production.
--         Tested on PGlite (supabase/tests/tenant_isolation_ten5.test.mjs) and on the local
--         PostgreSQL 16 staging copy (supabase/staging, TEN-5 reproduction).
--
-- WHY THIS FILE EXISTS (a gap in TEN-5, found on real PostgreSQL)
--   TEN-5 (20261113104000) added its plan-column check inside guard_organisation_configuration().
--   The live trigger that runs that function is declared
--       BEFORE UPDATE OF settings ON public.organisations
--   so it fires only when the statement's SET list names `settings`. An update such as
--       update organisations set plan = 'enterprise', max_users = 9999, locked = false where id = <own>
--   never runs the function, and the company's own Admin passes the organisations_write policy.
--   Measured on the staging copy with TEN-5 applied: plan after = enterprise, max_users = 9999.
--   The first PGlite fixture declared the trigger without the column list, which is why the
--   TEN-5 test passed; the fixture now matches the live trigger definition.
--
-- WHAT IT FIXES
--   A separate function and a separate row trigger with NO column list:
--       trg_guard_organisation_platform_columns BEFORE UPDATE ON public.organisations
--   For a direct client write (current_user authenticated or anon) by someone who is not a super
--   admin, a change to plan, active, locked, max_users or parent_organisation_id raises 42501
--   "Plan, status and limits are managed by the platform." Every other column (name, branding,
--   country, timezone, contact, notes, holding_link_optin, settings) is untouched by this file.
--   Not affected, by construction: service_role, SECURITY DEFINER RPCs (inside them current_user
--   is the function owner) and a super admin in the console.
--
-- WHAT IT DOES NOT FIX
--   holding_link_optin stays editable by the company Admin (it is that company's own consent
--   flag). org_subscriptions is covered by TEN-5 itself. Entitlements are enforced by TEN-6.
--
-- RISK TO THE CURRENT COMPANY (2 super admins, 0 plain Admins): NONE EXPECTED.
--   ConsoleOrganisations.jsx writes plan and locked as a super admin and still may. No plain
--   Admin exists today; a future plain Company A Admin could rename the company but not change
--   its plan or limits, which is the intent. Cost: one extra row trigger on a table that is
--   written a handful of times a year.
--
-- VERIFY (rolled back, after applying):
--   begin;
--   select tgname, tgenabled, pg_get_triggerdef(oid) from pg_trigger
--    where tgrelid = 'public.organisations'::regclass and tgname = 'trg_guard_organisation_platform_columns';
--        -- 1 row, O, "BEFORE UPDATE ON public.organisations" with no column list
--   select has_function_privilege('authenticated', 'public.guard_organisation_platform_columns()', 'EXECUTE'),
--          has_function_privilege('anon', 'public.guard_organisation_platform_columns()', 'EXECUTE');   -- f, f
--   -- impersonate a Company A super admin:
--   --   update public.organisations set max_users = max_users where id = '<Company A id>' returning max_users;  (allowed)
--   -- the refusal needs a plain Admin, an account type production does not have: confirm on a
--   --   branch database (42501 on plan, locked, max_users; a name change still writes 1 row).
--   rollback;
--
-- ROLLBACK:
--   alter table public.organisations disable trigger trg_guard_organisation_platform_columns;
-- ---------------------------------------------------------------------------------------------

do $guard$
declare
  v_missing text;
begin
  if to_regclass('public.organisations') is null then
    raise exception 'TEN-5b aborted: public.organisations does not exist';
  end if;
  select string_agg(c, ', ') into v_missing
    from unnest(array['plan', 'active', 'locked', 'max_users', 'parent_organisation_id']) c
   where not exists (select 1 from information_schema.columns a
                      where a.table_schema = 'public' and a.table_name = 'organisations'
                        and a.column_name = c);
  if v_missing is not null then
    raise exception 'TEN-5b aborted: organisations no longer has column(s) %. Re-author this migration.', v_missing;
  end if;
  if to_regprocedure('public.is_super_admin()') is null then
    raise exception 'TEN-5b aborted: public.is_super_admin() does not exist';
  end if;
end
$guard$;

create or replace function public.guard_organisation_platform_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $fn$
begin
  -- TEN-5b. Direct client writes only: service_role and SECURITY DEFINER paths run as another role.
  if current_user in ('authenticated', 'anon') and not coalesce(public.is_super_admin(), false) and (
    old.plan is distinct from new.plan or
    old.active is distinct from new.active or
    old.locked is distinct from new.locked or
    old.max_users is distinct from new.max_users or
    old.parent_organisation_id is distinct from new.parent_organisation_id
  ) then
    raise exception 'Plan, status and limits are managed by the platform.' using errcode = '42501';
  end if;
  return new;
end
$fn$;

-- A trigger function needs no EXECUTE grant; nobody should be able to call it directly.
revoke all on function public.guard_organisation_platform_columns() from public;
revoke all on function public.guard_organisation_platform_columns() from anon;
revoke all on function public.guard_organisation_platform_columns() from authenticated;
grant execute on function public.guard_organisation_platform_columns() to service_role;

do $mig$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.organisations'::regclass
                    and tgname = 'trg_guard_organisation_platform_columns') then
    create trigger trg_guard_organisation_platform_columns
      before update on public.organisations
      for each row execute function public.guard_organisation_platform_columns();
  end if;
  -- Assert the trigger really is unconditional on columns (tgattr empty) and enabled.
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.organisations'::regclass
                    and tgname = 'trg_guard_organisation_platform_columns'
                    and tgenabled = 'O' and tgattr::text = '') then
    raise exception 'TEN-5b aborted: trg_guard_organisation_platform_columns is missing, disabled or column limited';
  end if;
end
$mig$;
