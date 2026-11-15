-- =============================================================================
-- TEN-9b: sign-in that can tell two companies apart, with no change for today's users.
-- STATUS: AUTHORED, NOT APPLIED. Draft for review. Run only on the local staging copy.
--
-- THE PROBLEM
--   get_email_by_identifier(identifier) resolves a username or employee id with
--   `limit 1` and no company. Usernames are unique across ALL companies (five global
--   unique indexes on profiles), so today that is exact. Per-company usernames need a
--   resolver that knows the company BEFORE the global indexes can go (TEN-9c).
--   Second, hidden constraint (measured in the source, not in the earlier drafts): the
--   sign-up forms create the account address as <username>@users.tyrepulse.app, and
--   auth.users.email is unique. Two companies can therefore not both have "ahmed" even
--   after the profile indexes are removed, unless the second company's address differs.
--
-- THE RULE (one resolver, _resolve_sign_in_profile, used by every path)
--   1. The identifier exactly as typed, across all companies (today's behaviour):
--        one match            -> that account.
--        several matches      -> the account in the legacy (current) company if there is
--                                one, so a current user who types only a username keeps
--                                signing in; otherwise NO match (the person must add the
--                                company code). Never an arbitrary pick.
--   2. Only when step 1 found nothing and the text contains "/" : "<company code>/<name>".
--      The code is organisations.sign_in_code or the slug. The name is looked up inside
--      that company only.
--   Username is tried before employee id in both steps, as today.
--   Production, counted 2026-11-15: 0 usernames and 0 employee ids contain "/" or "\",
--   0 usernames are repeated, 765 of 781 accounts use a made-up address. Step 1 therefore
--   returns for every current account exactly what the live function returns.
--
-- WHY "code/name" IN THE EXISTING FIELD
--   It needs no new input on any screen: the web form, the Flutter app and the frozen
--   Expo build all pass the typed text to get_email_by_identifier unchanged. A separate
--   "Company code" field is a later, optional improvement.
--
-- ADDRESS CONVENTION FOR A NEW COMPANY (client work, not in this file)
--   legacy company : <username>@users.tyrepulse.app            (unchanged)
--   other company  : <username>+<company code>@users.tyrepulse.app
--   The disclosure rule below still ends in @users.tyrepulse.app, so it holds for both.
--
-- WHAT IT CHANGES
--   new  _split_sign_in_identifier(text), _resolve_sign_in_profile(text),
--        resolve_sign_in_user(text) (service_role only, for the sign-in edge function)
--   same signature, new body: get_email_by_identifier(text), _login_identifier_exists(text)
--
-- NOT DONE HERE (stated)
--   * supabase/functions/sign-in/index.ts still resolves with its own two ilike queries.
--     It must call resolve_sign_in_user(identifier) instead (one line) before a second
--     company has real-e-mail accounts. Not edited, not deployed.
--   * The lockout counter is keyed on the typed text, so "code/name" and "name" count
--     separately for the same person. Acceptable; noted.
--   * The sign-up forms do not yet build the "+<company code>" address.
--
-- RISK TO THE CURRENT COMPANY: none measured. For every synthetic account the staging
--   run compares the old and new result of get_email_by_identifier for the username and
--   the employee id: identical.
--
-- APPLY ORDER: after 20261115162000 (TEN-8b, _org_by_code). Before TEN-9c.
--
-- VERIFY (begin; ... rollback;)
--   select public.get_email_by_identifier('<an existing username>');   -- as before
--   select public.get_email_by_identifier('nobody-here');              -- null
--
-- ROLLBACK
--   Re-create get_email_by_identifier and _login_identifier_exists from
--   public._fn_backup_ten9b (execute each def). The helpers are then unused.
-- =============================================================================

do $$ begin
  if to_regprocedure('public._org_by_code(text)') is null or to_regprocedure('public._legacy_config_org()') is null then
    raise exception 'TEN-9b needs TEN-7 and TEN-8b applied first. Nothing applied.';
  end if;
end $$;

create table if not exists public._fn_backup_ten9b (fn text primary key, def text not null, saved_at timestamptz not null default now());
alter table public._fn_backup_ten9b enable row level security;      -- no policy: nobody reads it through the API
revoke all on public._fn_backup_ten9b from anon, authenticated;
insert into public._fn_backup_ten9b (fn, def)
select p.oid::regprocedure::text, pg_get_functiondef(p.oid) from pg_proc p
 where p.oid in ('public.get_email_by_identifier(text)'::regprocedure, 'public._login_identifier_exists(text)'::regprocedure)
on conflict (fn) do nothing;

create or replace function public._split_sign_in_identifier(p_identifier text, out company_code text, out name text)
language sql immutable set search_path = public as $fn$
  select case when position('/' in v) > 1 then nullif(btrim(split_part(v, '/', 1)), '') end,
         case when position('/' in v) > 1 then nullif(btrim(substr(v, position('/' in v) + 1)), '') else nullif(v, '') end
    from (select btrim(replace(coalesce(p_identifier, ''), E'\\', '/')) as v) s
$fn$;

create or replace function public._resolve_sign_in_profile(p_identifier text)
returns uuid language plpgsql stable security definer set search_path = public as $fn$
declare
  v_id text := lower(btrim(coalesce(p_identifier, '')));
  v_legacy uuid := public._legacy_config_org();
  v_ids uuid[]; v_pick uuid; v_code text; v_name text; v_org uuid;
begin
  if v_id = '' then return null; end if;

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

  -- Step 2: "<company code>/<name>", inside that company only.
  select s.company_code, lower(s.name) into v_code, v_name from public._split_sign_in_identifier(p_identifier) s;
  if v_code is null or v_name is null then return null; end if;
  v_org := public._org_by_code(v_code);
  if v_org is null then return null; end if;
  select p.id into v_pick from public.profiles p where p.org_id = v_org and lower(p.username) = v_name limit 1;
  if v_pick is null then
    select p.id into v_pick from public.profiles p where p.org_id = v_org and lower(p.employee_id) = v_name limit 1;
  end if;
  return v_pick;
end $fn$;
revoke execute on function public._resolve_sign_in_profile(text) from public;
revoke execute on function public._resolve_sign_in_profile(text) from anon, authenticated;
revoke execute on function public._split_sign_in_identifier(text) from public;
revoke execute on function public._split_sign_in_identifier(text) from anon, authenticated;

-- For the sign-in edge function (service role): the user id, never an address.
create or replace function public.resolve_sign_in_user(p_identifier text)
returns uuid language sql stable security definer set search_path = public as $fn$
  select public._resolve_sign_in_profile(p_identifier)
$fn$;
revoke execute on function public.resolve_sign_in_user(text) from public;
revoke execute on function public.resolve_sign_in_user(text) from anon, authenticated;
grant execute on function public.resolve_sign_in_user(text) to service_role;

create or replace function public.get_email_by_identifier(identifier text)
returns text language plpgsql security definer set search_path = public, extensions as $fn$
declare v_uid uuid; v_email text;
begin
  if identifier is null or btrim(identifier) = '' then return null; end if;
  v_uid := public._resolve_sign_in_profile(identifier);
  if v_uid is null then return null; end if;
  select au.email into v_email from auth.users au where au.id = v_uid;
  -- Only a made-up sign-in address is ever handed out. A real email is never
  -- disclosed to an anonymous caller.
  if v_email is null or lower(v_email) not like '%@users.tyrepulse.app' then
    return null;
  end if;
  return v_email;
end $fn$;

create or replace function public._login_identifier_exists(p_id text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select public._resolve_sign_in_profile(p_id) is not null
      or exists (select 1 from public.profiles p where lower(p.email) = lower(btrim(p_id)))
$fn$;

select anum_integration.apply_reader_policies();
