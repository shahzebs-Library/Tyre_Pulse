-- =============================================================================
-- TEN-9d  company code: close the direct-write bypass + let a company Admin choose
--         its code ONCE, only after multi-company mode is switched on.
-- STATUS: AUTHORED, NOT APPLIED. Proven on a private copy of local staging only
--         (supabase/tests/multi_company_auth/run_staging.sh, checks 5j, 5k, 6a-6j).
--
-- DEFECT (found on staging, PR #546 test matrix, checks 5j / 5k)
--   1. _guard_org_sign_in_code() is SECURITY DEFINER, so inside it current_user is the
--      function OWNER, never 'authenticated'. Its "only the platform sets a company code"
--      test can therefore never fire: a company Admin (organisations_write lets them
--      UPDATE their own row) sets organisations.sign_in_code directly, bypassing
--      admin_set_org_sign_in_code (super admin only) and its console audit row.
--      Reproduced as Beta's Admin: UPDATE organisations SET sign_in_code = 'ALPHA' -> 1 row.
--      Uniqueness still held (unique index + slug check), so a company cannot take another
--      company's EXISTING code, but it can claim any free code (for example a rival's
--      brand) before the platform assigns it.
--   2. organisations.slug is the fallback sign-in code (_org_by_code reads code, then slug)
--      and nothing guards it: a company Admin renames the slug and every
--      "<old slug>/<name>" sign-in of that company stops working.
--
-- FIX
--   1b. A direct client UPDATE that CLEARS the code is refused too (found in review:
--       clear-then-set bypassed "once only" and released the code to other companies).
--   1. _guard_org_sign_in_code becomes SECURITY INVOKER (same convention as
--      guard_organisation_platform_columns, which works). Definer RPCs still pass because
--      inside them current_user is the owner. The uniqueness EXISTS then runs under the
--      caller's RLS only for a super admin, who reads every organisation.
--   2. slug joins the platform-managed columns of guard_organisation_platform_columns.
--   3. org_set_my_sign_in_code(p_code): the ONLY way a company Admin sets the code.
--      Refused while system_config.single_tenant_mode is true (nothing changes today).
--      Allowed once (only while the company has no code); a later change is the
--      platform's (admin_set_org_sign_in_code). Same shape + uniqueness rules as the
--      super-admin writer. Recorded in org_admin_events (TEN-12) as company.code_set.
--   4. get_my_org_sign_in_code(): what the Admin screen shows (code, slug, whether the
--      Admin may set it now, and why not).
--
-- EXISTING DATA: none touched. 0 organisations have a code in production today.
-- ROLLBACK
--   re-create _guard_org_sign_in_code from its previous body (SECURITY DEFINER, NULL
--   code returned before the client check);
--   re-create guard_organisation_platform_columns without the slug line;
--   drop function public.org_set_my_sign_in_code(text); drop function public.get_my_org_sign_in_code();
-- =============================================================================

-- SECURITY INVOKER (fix 1). Also (fix 1b, review 2026-11-16): a company Admin could
-- CLEAR its own code with a direct UPDATE (the guard returned early on a NULL code),
-- which (a) defeated "once only" (clear, then org_set_my_sign_in_code again) and
-- (b) released the code so another company could claim it, after which the first
-- company's "<code>/<name>" sign-ins would resolve inside the other company.
-- Clearing is now a platform change like any other code change.
create or replace function public._guard_org_sign_in_code()
returns trigger language plpgsql security invoker set search_path = public as $fn$
begin
  if tg_op = 'UPDATE' and new.sign_in_code is not distinct from old.sign_in_code then return new; end if;
  if tg_op = 'INSERT' and new.sign_in_code is null then return new; end if;
  if current_user in ('authenticated', 'anon') and not coalesce(public.is_super_admin(), false) then
    raise exception 'The company code is managed by the platform.' using errcode = '42501';
  end if;
  if new.sign_in_code is null then return new; end if;
  if exists (select 1 from public.organisations o where o.id <> new.id and lower(o.slug) = lower(new.sign_in_code)) then
    raise exception 'That company code is already in use.' using errcode = '23505';
  end if;
  return new;
end $fn$;

create or replace function public.guard_organisation_platform_columns()
returns trigger language plpgsql set search_path = public as $fn$
begin
  -- TEN-5b + TEN-9d. Direct client writes only: service_role and SECURITY DEFINER paths
  -- run as another role. slug is the fallback company sign-in code (_org_by_code).
  if current_user in ('authenticated', 'anon') and not coalesce(public.is_super_admin(), false) and (
    old.plan is distinct from new.plan or
    old.active is distinct from new.active or
    old.locked is distinct from new.locked or
    old.max_users is distinct from new.max_users or
    old.parent_organisation_id is distinct from new.parent_organisation_id or
    old.slug is distinct from new.slug
  ) then
    raise exception 'Plan, status, limits and the company address are managed by the platform.' using errcode = '42501';
  end if;
  return new;
end
$fn$;

create or replace function public._multi_company_on()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select btrim(lower(value), ' "') from public.system_config where key = 'single_tenant_mode'), 'false') <> 'true'
$fn$;
revoke execute on function public._multi_company_on() from public, anon, authenticated;

create or replace function public.get_my_org_sign_in_code()
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_org uuid := public.app_current_org(); o public.organisations%rowtype; v_reason text;
begin
  if v_org is null or public.app_is_active() is not true then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  select * into o from public.organisations where id = v_org;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  v_reason := case
    when public.get_my_role() is distinct from 'Admin' then 'not_admin'
    when not public._multi_company_on() then 'single_company_mode'
    when o.sign_in_code is not null then 'already_set'
    else null end;
  return jsonb_build_object('ok', true, 'sign_in_code', o.sign_in_code, 'slug', o.slug,
                            'effective_code', coalesce(o.sign_in_code, o.slug),
                            'can_set', v_reason is null, 'reason', v_reason);
end $fn$;
revoke execute on function public.get_my_org_sign_in_code() from public, anon;
grant execute on function public.get_my_org_sign_in_code() to authenticated;

create or replace function public.org_set_my_sign_in_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_org uuid := public.app_current_org(); v_code text := nullif(btrim(coalesce(p_code, '')), ''); v_n int;
begin
  if v_org is null or public.app_is_active() is not true or public.get_my_role() is distinct from 'Admin' then
    raise exception 'Only an Admin of the company can choose its sign-in code.' using errcode = '42501';
  end if;
  if not public._multi_company_on() then
    raise exception 'Company sign-in codes are not available yet.' using errcode = '42501';
  end if;
  if v_code is null or v_code !~ '^[A-Za-z0-9][A-Za-z0-9-]{1,23}$' then
    raise exception 'A company code is 2 to 24 letters, digits or hyphens.' using errcode = '22023';
  end if;
  if exists (select 1 from public.organisations o
              where o.id <> v_org and (lower(o.sign_in_code) = lower(v_code) or lower(o.slug) = lower(v_code))) then
    raise exception 'That company code is already in use.' using errcode = '23505';
  end if;
  -- Once only: a code already in use by this company's people is changed by the platform.
  update public.organisations set sign_in_code = v_code where id = v_org and sign_in_code is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'This company already has a sign-in code. Ask the platform team to change it.' using errcode = '42501';
  end if;
  perform public._org_admin_event(v_org, 'company.code_set', 'organisation', v_org::text, jsonb_build_object('code', v_code));
  return jsonb_build_object('ok', true, 'sign_in_code', v_code);
exception when unique_violation then
  raise exception 'That company code is already in use.' using errcode = '23505';
end $fn$;
revoke execute on function public.org_set_my_sign_in_code(text) from public, anon;
grant execute on function public.org_set_my_sign_in_code(text) to authenticated;
