-- =============================================================================
-- Staff directory privacy, part 1 of 2 (audit RLS-9). ADDITIVE. APPLIED LIVE 2026-11-12.
-- (Applied through the MCP as the statements below, without this header and
--  without the trailing ROLLBACK comment block.)
--
-- FINDINGS (measured live, rolled-back impersonation of a real Driver)
--   * profiles_select admits every authenticated member, so a Driver reads 768
--     profile rows: 767 other people's email (763 synthetic, 4 real), 115 push
--     tokens, 41 admin notes.
--   * get_user_email_by_id returned the 4 real email addresses to that Driver.
--
-- WHY THE POLICY IS NOT NARROWED HERE (the held draft 20261110147000)
--   Narrowing profiles_select to self + elevated breaks more than name labels:
--     - 143 of 155 active phones run the retired Expo build and 12 the Flutter
--       build. Both read OTHER people's rows from profiles as ordinary roles:
--       assignee pickers (Flutter inspection actions, Expo workshop status),
--       submitter / owner / assigned-owner names. A picker that returns only the
--       caller is a lost function, not a blank label.
--     - server side, v_inspection_signoff (security_invoker), the invoker
--       functions get_schedule_adherence and wash_entry_people, and the invoker
--       trigger workforce_assignment_classify all join profiles as the caller.
--   So this migration lays the groundwork that makes the narrow possible later
--   (a PII-free directory every client can move to) and part 2
--   (pending_migrations/20261112171000, column privileges; applied after the web
--   deploy) protects the secret columns without
--   touching row visibility.
--
-- WHAT THIS DOES
--   1. list_profile_directory(...)  SECURITY DEFINER set-returning function:
--      id, full_name, username, employee_id, role, country, sites, site,
--      approved, locked, org_id, organisation_id, avatar_url. No email, phone,
--      push token, notes, recovery fields, login metadata or super-admin flag.
--      A function, not a view: all 21 views are security_invoker (audited
--      invariant) and an invoker view returns only what the caller's RLS shows,
--      which after a future narrow is one row. The function takes NO org
--      argument; the organisation comes from app_current_org() in the body.
--   2. list_profile_private(p_ids) and count_profiles_with_push_token():
--      elevated-only readers for the columns part 2 withdraws from the table
--      grant (admin notes; "has a push token" as a boolean, never the token).
--   3. get_user_email_by_id: self, or an elevated caller in the same
--      organisation, or a super admin. Was: any member of the organisation.
--
-- PRE-FLIGHT (database-migration-safety)
--   Data loss      : none. Functions only. No table, row or policy is changed.
--   Rename/removal : none. get_user_email_by_id keeps its signature; it has no
--                    caller in src/, mobile/, tyre_pulse_flutter/lib or
--                    supabase/functions (grep), so tightening it breaks nothing.
--   Type change    : none.      CHECK : none.      FK / index : none.
--   Locks          : catalog only.
--   Triggers       : none fired.
--   RLS            : unchanged. The definer functions re-check, in the body:
--                    caller active (approved, not locked), same organisation
--                    (super admin: all), and for the private readers elevated.
--   SECURITY DEFINER: search_path pinned to public; execute withdrawn from
--                    PUBLIC then anon, granted to authenticated explicitly; no
--                    function accepts an organisation id; no dynamic SQL; the
--                    search term is LIKE-escaped.
--   PostgREST      : no 40001. Set-returning; capped at 1000 rows per call and
--                    paged by p_offset over a total order (full_name, id).
--   Duration       : instant.
--
-- VERIFY (rolled back, one user per transaction) - results recorded 2026-11-12
--   Driver            directory 768 rows, 768 named, other-org 0
--                     private rows 0, push count NULL, real e-mail via RPC 0 (was 4), own e-mail 1
--   Tyre Man          directory 768, private 0
--   Fleet Supervisor  directory 768, private 0
--   KSA Manager       directory 768, private 768, push count 115, e-mail via RPC allowed (same organisation)
--   demo-org Manager  directory 1 (own organisation only), private 1
--   super admin aal2  directory 769, private 769
--   locked account    directory 0, private 0
-- =============================================================================

create or replace function public.list_profile_directory(
  p_ids         uuid[]  default null,
  p_search      text    default null,
  p_limit       integer default 500,
  p_offset      integer default 0,
  p_roles       text[]  default null,
  p_active_only boolean default false
)
returns table (
  id uuid, full_name text, username text, employee_id text, role text,
  country text[], sites text[], site text, approved boolean, locked boolean,
  org_id uuid, organisation_id uuid, avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select public.app_current_org()                  as org,
           public.is_super_admin()                   as is_super,
           coalesce(public.app_is_active(), false)   as active
  ),
  term as (
    select nullif(
      replace(replace(replace(btrim(coalesce(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_'),
      '') as t
  )
  select p.id, p.full_name, p.username, p.employee_id, p.role,
         p.country, p.sites, p.site, p.approved, p.locked,
         p.org_id, p.organisation_id, p.avatar_url
  from public.profiles p
  cross join me
  cross join term
  where me.active
    and (me.is_super or (me.org is not null and p.organisation_id = me.org))
    and (p_ids is null or p.id = any (p_ids))
    and (p_roles is null or p.role = any (p_roles))
    and (not coalesce(p_active_only, false)
         or (coalesce(p.approved, false) and not coalesce(p.locked, false)))
    and (term.t is null
         or p.full_name   ilike '%' || term.t || '%'
         or p.username    ilike '%' || term.t || '%'
         or p.employee_id ilike '%' || term.t || '%')
  order by p.full_name nulls last, p.id
  limit least(greatest(coalesce(p_limit, 500), 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

comment on function public.list_profile_directory(uuid[], text, integer, integer, text[], boolean) is
  'PII-free staff directory for every active member of the same organisation (super admin: all). '
  'Names, employee id, role and scope only. The reader to use instead of selecting other people''s rows from profiles.';

revoke all on function public.list_profile_directory(uuid[], text, integer, integer, text[], boolean) from public;
revoke all on function public.list_profile_directory(uuid[], text, integer, integer, text[], boolean) from anon;
grant execute on function public.list_profile_directory(uuid[], text, integer, integer, text[], boolean) to authenticated, service_role;

-- Elevated-only reader for the columns part 2 withdraws from the table grant.
-- The push token itself is never returned: no screen needs it, only whether one exists.
create or replace function public.list_profile_private(p_ids uuid[] default null)
returns table (id uuid, notes text, has_push_token boolean, push_token_updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select public.app_current_org()                 as org,
           public.is_super_admin()                  as is_super,
           coalesce(public.app_is_active(), false)  as active,
           coalesce(public.app_is_elevated(), false) as elevated
  )
  select p.id, p.notes,
         (p.push_token is not null and p.push_token <> '') as has_push_token,
         p.push_token_updated_at
  from public.profiles p
  cross join me
  where me.active
    and (me.is_super or (me.elevated and me.org is not null and p.organisation_id = me.org))
    and (p_ids is null or p.id = any (p_ids))
  order by p.id
  limit 1000
$$;

comment on function public.list_profile_private(uuid[]) is
  'Admin notes and push-token presence per profile. Elevated callers of the same organisation, or a super admin. Never returns the token.';

revoke all on function public.list_profile_private(uuid[]) from public;
revoke all on function public.list_profile_private(uuid[]) from anon;
grant execute on function public.list_profile_private(uuid[]) to authenticated, service_role;

create or replace function public.count_profiles_with_push_token()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not coalesce(public.app_is_active(), false) then null
    when public.is_super_admin() then
      (select count(*)::integer from public.profiles p
        where p.push_token is not null and p.push_token <> '')
    when coalesce(public.app_is_elevated(), false) then
      (select count(*)::integer from public.profiles p
        where p.push_token is not null and p.push_token <> ''
          and p.organisation_id = public.app_current_org())
    else null
  end
$$;

comment on function public.count_profiles_with_push_token() is
  'How many profiles carry a legacy push token. Elevated (own organisation) or super admin; NULL for anyone else.';

revoke all on function public.count_profiles_with_push_token() from public;
revoke all on function public.count_profiles_with_push_token() from anon;
grant execute on function public.count_profiles_with_push_token() to authenticated, service_role;

-- get_user_email_by_id: was "any member of the organisation", which handed real
-- e-mail addresses to a Driver. Now self, elevated same-organisation, or super admin.
create or replace function public.get_user_email_by_id(user_id uuid)
returns text
language sql
stable
security definer
set search_path = auth, public
as $$
  select u.email
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id = user_id
    and (
      user_id = auth.uid()
      or (
        coalesce(public.app_is_active(), false)
        and (
          public.is_super_admin()
          or (coalesce(public.app_is_elevated(), false)
              and p.organisation_id = public.app_current_org())
        )
      )
    )
  limit 1
$$;

revoke all on function public.get_user_email_by_id(uuid) from public;
revoke all on function public.get_user_email_by_id(uuid) from anon;
grant execute on function public.get_user_email_by_id(uuid) to authenticated, service_role;

-- =============================================================================
-- ROLLBACK (not applied; paste by hand if ever needed)
--   drop function if exists public.list_profile_directory(uuid[], text, integer, integer, text[], boolean);
--   drop function if exists public.list_profile_private(uuid[]);
--   drop function if exists public.count_profiles_with_push_token();
--   create or replace function public.get_user_email_by_id(user_id uuid) returns text
--     language sql stable security definer set search_path to 'auth', 'public' as $f$
--     SELECT u.email FROM auth.users u JOIN public.profiles p ON p.id = u.id
--     WHERE u.id = user_id AND p.organisation_id = public.app_current_org() LIMIT 1; $f$;
-- =============================================================================
