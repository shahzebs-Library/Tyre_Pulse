-- V309 (Phase-1 SaaS security: B1) — applied live 2026-07-20
-- Old behaviour: a blank scope (empty/NULL sites or country) meant "see EVERY
-- site / country". A newly-approved user with no scope therefore saw all data.
-- New behaviour: blank scope = NO access to scoped rows. Org-wide access must be
-- EXPLICIT via an 'ALL' (or '*') sentinel in the array. Admins/super still see all.
-- Backfill: every existing user with a blank `sites` is stamped ARRAY['ALL'] so
-- nobody loses access today; going forward an admin narrows a user by replacing
-- 'ALL' with real site codes. (country needs no backfill: the only blank-country
-- users are admins, who already see all countries via the admin branch.)

-- Site visibility: unscoped rows (null/'' site) always visible; else the caller
-- must be admin/super, hold the 'ALL'/'*' org-wide sentinel, or list the site.
create or replace function public.app_can_see_site(p_site text)
  returns boolean
  language sql
  stable security definer
  set search_path to 'public'
as $function$
  select case
    when p_site is null or btrim(p_site) = '' then true
    else coalesce((
      select p.is_super_admin
             or p.role = 'Admin'
             or (p.sites is not null and exists (
                   select 1 from unnest(p.sites) s where upper(btrim(s)) in ('ALL', '*')))
             or (p.sites is not null and cardinality(p.sites) > 0
                 and upper(btrim(p_site)) in (select upper(btrim(s)) from unnest(p.sites) s))
      from public.profiles p where p.id = auth.uid()
    ), false)
  end;
$function$;

-- Country visibility: unscoped rows (null country) always visible; else caller
-- must be admin/super, hold the 'all' org-wide sentinel, or list the country.
create or replace function public.app_can_see_country(p_country text)
  returns boolean
  language sql
  stable security definer
  set search_path to 'public'
as $function$
  select
    p_country is null
    or public.app_is_org_admin()
    or exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid()
        and pr.country is not null
        and cardinality(pr.country) > 0
        and exists (
          select 1 from unnest(pr.country) x
          where lower(btrim(x)) = 'all'
             or lower(btrim(x)) = lower(btrim(p_country))
        )
    );
$function$;

-- Backfill: keep every current user org-wide so nobody is blacked out.
update public.profiles
   set sites = array['ALL']
 where sites is null or cardinality(sites) = 0;
