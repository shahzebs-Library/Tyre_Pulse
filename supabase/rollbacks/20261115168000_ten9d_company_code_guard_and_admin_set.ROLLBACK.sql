-- ROLLBACK for 20261115168000_ten9d_company_code_guard_and_admin_set.sql
-- Restores the two trigger functions exactly as production stands before TEN-9d
-- (md5 of pg_get_functiondef, read 2026-11-18 from production):
--   _guard_org_sign_in_code               e1fa91eccacf1e5338194373e7d752cf
--   guard_organisation_platform_columns   d122d33d908f25ca51f85dbd030fad13
-- and removes the three functions TEN-9d adds. No data is touched (0 organisations
-- carry a sign-in code today).
begin;
CREATE OR REPLACE FUNCTION public._guard_org_sign_in_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'UPDATE' and new.sign_in_code is not distinct from old.sign_in_code then return new; end if;
  if new.sign_in_code is null then return new; end if;
  if current_user in ('authenticated', 'anon') and not coalesce(public.is_super_admin(), false) then
    raise exception 'The company code is managed by the platform.' using errcode = '42501';
  end if;
  if exists (select 1 from public.organisations o where o.id <> new.id and lower(o.slug) = lower(new.sign_in_code)) then
    raise exception 'That company code is already in use.' using errcode = '23505';
  end if;
  return new;
end $function$

;
CREATE OR REPLACE FUNCTION public.guard_organisation_platform_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$

;
drop function if exists public.org_set_my_sign_in_code(text);
drop function if exists public.get_my_org_sign_in_code();
drop function if exists public._multi_company_on();
commit;
