-- =============================================================================
-- TEN-9g  a "company code/name" sign-in cannot be taken over by a username that
--         contains the separator.
-- STATUS: AUTHORED, NOT APPLIED. Proven on a private copy of local staging only
--         (supabase/tests/multi_company_auth/run_staging.sh, tests_gaps.sql 12a-12h).
--
-- DEFECT (PR #546 gap tests, 2026-11-16)
--   _resolve_sign_in_profile tries an EXACT username / employee id match first and
--   only then splits "<code>/<name>". Nothing stops a username from containing "/"
--   or "\": the invite page checks it in the browser, but a sign-up sent straight to
--   GoTrue (or the Expo/old web sign-up) stores any text. Reproduced on staging:
--     sign up with username "beta-haulage/beta.admin" (pending, no company needed)
--     resolve_sign_in_user('beta-haulage/beta.admin') -> the NEW account, not Beta's Admin
--   Effects once companies use codes: the real person can no longer sign in with the
--   code form (their password is checked against the impostor's address and fails),
--   their failed attempts lock the impostor's counter, and a person who sets the
--   impostor's password would land in the impostor's account.
--
-- FIX
--   1. _resolve_sign_in_profile: when the identifier carries "/" or "\", the code form
--      is tried FIRST. If "<code>/<name>" names an account inside that company, that
--      account wins. Only when it names nobody is the exact match tried, so a legacy
--      account whose username really contains a slash keeps signing in (it can no
--      longer shadow a real company account). Identifiers without a separator follow
--      exactly the old path (step 1 only).
--   2. guard_profile_sign_in_names (BEFORE INSERT / UPDATE OF username, employee_id
--      on profiles): a NEW or CHANGED username / employee id may not contain "/" or
--      "\" (errcode 22023). Existing rows are not touched and keep working; an UPDATE
--      that leaves the value unchanged is not checked. The refusal inside
--      handle_new_user aborts the auth.users insert, so no account is created.
--
-- PREFLIGHT (read only, run before applying):
--   select count(*) from public.profiles where username ~ '[/\\]' or employee_id ~ '[/\\]';
--   Expected 0. Any row found keeps signing in (fix 1), but list it for the owner.
--
-- EXISTING DATA: none touched.
-- ROLLBACK:
--   20261115168800_ten9g_code_form_cannot_be_squatted.ROLLBACK.sql (exact pre-TEN-9g body,
--   md5 1ee66847b3d067fd171305fa7de11233, plus drop of the trigger and guard function).
-- =============================================================================

create or replace function public._resolve_sign_in_profile(p_identifier text)
returns uuid
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_id text := lower(btrim(coalesce(p_identifier, '')));
  v_legacy uuid := public._legacy_config_org();
  v_ids uuid[]; v_pick uuid; v_code text; v_name text; v_org uuid;
begin
  if v_id = '' then return null; end if;

  -- Step 0 (TEN-9g): an identifier carrying the separator is a code form first, so a
  -- username such as "beta-haulage/beta.admin" can never shadow Beta's account.
  if v_id ~ '[/\\]' then
    select s.company_code, lower(s.name) into v_code, v_name from public._split_sign_in_identifier(p_identifier) s;
    if v_code is not null and v_name is not null then
      v_org := public._org_by_code(v_code);
      if v_org is not null then
        select p.id into v_pick from public.profiles p where p.org_id = v_org and lower(p.username) = v_name limit 1;
        if v_pick is null then
          select p.id into v_pick from public.profiles p where p.org_id = v_org and lower(p.employee_id) = v_name limit 1;
        end if;
        if v_pick is not null then return v_pick; end if;
      end if;
    end if;
  end if;

  -- Step 1: exactly as typed, every company. Username first, then employee id.
  select array_agg(p.id) into v_ids from public.profiles p where lower(p.username) = v_id;
  if v_ids is null then
    select array_agg(p.id) into v_ids from public.profiles p where lower(p.employee_id) = v_id;
  end if;
  if cardinality(v_ids) = 1 then return v_ids[1]; end if;
  if cardinality(v_ids) > 1 then
    select p.id into v_pick from public.profiles p where p.id = any (v_ids) and p.org_id = v_legacy;
    if found and (select count(*) from public.profiles p where p.id = any (v_ids) and p.org_id = v_legacy) = 1 then
      return v_pick;
    end if;
    return null;                     -- ambiguous outside the legacy company: the code is required
  end if;

  -- The code form (old step 2) already ran as step 0; nothing else names an account.
  return null;
end $function$;

create or replace function public.guard_profile_sign_in_names()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.username is not null and new.username ~ '[/\\]'
     and (tg_op = 'INSERT' or new.username is distinct from old.username) then
    raise exception 'A username cannot contain "/" or "\".' using errcode = '22023';
  end if;
  if new.employee_id is not null and new.employee_id ~ '[/\\]'
     and (tg_op = 'INSERT' or new.employee_id is distinct from old.employee_id) then
    raise exception 'An employee id cannot contain "/" or "\".' using errcode = '22023';
  end if;
  return new;
end $function$;

revoke all on function public.guard_profile_sign_in_names() from public, anon, authenticated;

drop trigger if exists trg_guard_profile_sign_in_names on public.profiles;
create trigger trg_guard_profile_sign_in_names
  before insert or update of username, employee_id on public.profiles
  for each row execute function public.guard_profile_sign_in_names();
