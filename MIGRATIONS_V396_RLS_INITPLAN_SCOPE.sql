-- V396 — make the country/site RLS predicates evaluate once per query, not once per row
--
-- THE PROBLEM
-- app_can_see_country(country) and app_can_see_site(site) each take a ROW value,
-- so the planner cannot hoist them, and both are SECURITY DEFINER, so Postgres
-- can never INLINE them either (an inlined body would run with the caller's
-- privileges). The result: a black-box function call per row, each one running
-- its own `select ... from profiles where id = auth.uid()`.
--
-- Measured before, as a real Manager under real RLS:
--     select count(*) from work_orders   ->  11,994 ms   (60,099 rows visible)
--     select count(*) from tyre_records  ->   2,570 ms   ( 6,022 rows visible)
--
-- THE FIX
-- Four new ZERO-ARGUMENT helpers return the caller's scope rather than answering
-- a per-row question. Because they take no row value, a policy can call them as
-- `(select app_country_scope())`, which the planner turns into an InitPlan and
-- evaluates ONCE per query. The per-row work left is an array membership test
-- with no I/O.
--
-- Measured after, same user, same queries, warm-up discarded, 3 iterations:
--     work_orders    ->  141 / 141 / 142 ms      (60,099 rows - unchanged)
--     tyre_records   ->   13 /  12 /  12 ms      ( 6,022 rows - unchanged)
-- roughly 85x and 214x. Note the spread is under 1%, unlike most timings on this
-- instance, because the work removed was I/O per row rather than CPU noise.
--
-- WHY THIS IS SAFE - it is the tenant boundary, so equivalence was PROVEN, not assumed:
--   1. ALGEBRAIC, EXHAUSTIVE. Both the old and new predicates were replicated
--      parameterised by profile row and compared over every real user x every
--      real value, plus synthetic edge cases (NULL, '', '   ', 'ALL', '*',
--      case variants, whitespace-padded, unknown value):
--        country: 33 users x   4 values =   132 combinations, 0 mismatches
--        site:    33 users x 170 values = 5,643 combinations, 0 mismatches
--   2. BEHAVIOURAL, BY IMPERSONATION. Row counts captured per user before and
--      after, as `authenticated` with a real JWT claim:
--        vehicle_fleet: all 33 users, 33,234 rows visible in total - 0 mismatches
--        work_orders:   super-admin 86,539 / KSA Manager 60,099 / Egypt Director 0
--                       - identical before and after
--
-- SEMANTICS PRESERVED EXACTLY, including the parts that look like quirks:
--   - is_super_admin() ignores a LOCKED account; app_can_see_site reads
--     profiles.is_super_admin DIRECTLY (no lock check). Both behaviours kept.
--   - app_can_see_site tests `role = 'Admin'` literally, not app_role(). Kept.
--   - A blank or NULL site is visible to everyone; a NULL country is visible to
--     everyone. Kept.
--   - An empty/missing scope grants NOTHING (the V309 rule: blank = no access,
--     org-wide is the explicit 'ALL' sentinel). Kept.
--   - NULLs are stripped from both scope arrays, because `x = ANY(ARRAY[...,NULL])`
--     returns NULL rather than false on a miss. Under a RESTRICTIVE policy NULL and
--     false both deny, so this is belt-and-braces, but it keeps the rewritten
--     predicate exactly boolean.
--
-- GOTCHA worth remembering: `= ANY ((select f()))` is parsed as the SUBQUERY form
-- of ANY and fails with "operator does not exist: text = text[]". Wrapping it as
-- `= ANY (coalesce((select f()), '{}'::text[]))` makes it the ARRAY form while
-- still being an uncorrelated subquery, so it is still an InitPlan.
--
-- SCOPE: 74 policies (44 country + 30 site) across 40 tables, all RESTRICTIVE.
-- One of them, tyre_procurement_options_country_isolation, is FOR ALL and carries
-- the same expression in WITH CHECK; both clauses were rewritten together. A guard
-- in the original run aborted precisely because of it, rather than silently
-- leaving half the boundary on the old form.
--
-- The old app_can_see_country/app_can_see_site are KEPT, not dropped: they remain
-- correct, other code may call them directly, and dropping them would break those
-- callers. They carry a COMMENT marking them superseded for policy use.

-- ── scope readers ────────────────────────────────────────────────────────────
create or replace function public.app_sees_all_countries()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select exists (select 1 from unnest(pr.country) x where lower(btrim(x)) = 'all')
    from public.profiles pr
    where pr.id = auth.uid() and pr.country is not null and cardinality(pr.country) > 0
  ), false);
$$;

create or replace function public.app_country_scope()
returns text[] language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select array_agg(lower(btrim(x))) from public.profiles pr, unnest(pr.country) x
    where pr.id = auth.uid() and x is not null and btrim(x) <> ''
  ), '{}'::text[]);
$$;

create or replace function public.app_sees_all_sites()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select p.is_super_admin
        or p.role = 'Admin'
        or (p.sites is not null and exists (
              select 1 from unnest(p.sites) s where upper(btrim(s)) in ('ALL','*')))
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;

create or replace function public.app_site_scope()
returns text[] language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select array_agg(upper(btrim(s))) from public.profiles p, unnest(p.sites) s
    where p.id = auth.uid() and s is not null and btrim(s) <> ''
  ), '{}'::text[]);
$$;

alter function public.app_sees_all_countries() parallel safe;
alter function public.app_country_scope()      parallel safe;
alter function public.app_sees_all_sites()     parallel safe;
alter function public.app_site_scope()         parallel safe;

revoke all on function public.app_sees_all_countries() from public, anon;
revoke all on function public.app_country_scope()      from public, anon;
revoke all on function public.app_sees_all_sites()     from public, anon;
revoke all on function public.app_site_scope()         from public, anon;
grant execute on function public.app_sees_all_countries() to authenticated;
grant execute on function public.app_country_scope()      to authenticated;
grant execute on function public.app_sees_all_sites()     to authenticated;
grant execute on function public.app_site_scope()         to authenticated;

-- ── rollback record ──────────────────────────────────────────────────────────
drop table if exists public._rls_policy_backup_v396;
create table public._rls_policy_backup_v396 as
select pol.polname, c.relname, n.nspname,
       pg_get_expr(pol.polqual, pol.polrelid)      as old_qual,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as old_withcheck,
       now() as saved_at
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where pg_get_expr(pol.polqual, pol.polrelid) like '%app_can_see_%'
   or pg_get_expr(pol.polwithcheck, pol.polrelid) like '%app_can_see_%';
revoke all on public._rls_policy_backup_v396 from authenticated, anon;

-- ── rewrite ──────────────────────────────────────────────────────────────────
create or replace function public._rls_rewrite(p_expr text)
returns text language plpgsql immutable as $$
declare arg text;
begin
  if p_expr ~ '^app_can_see_country\(' then
    arg := regexp_replace(p_expr, '^app_can_see_country\((.*)\)$', '\1');
    return format(
      '(%1$s IS NULL OR (select public.app_is_org_admin()) '
      'OR (select public.app_sees_all_countries()) '
      'OR lower(btrim(%1$s)) = ANY (coalesce((select public.app_country_scope()), ''{}''::text[])))', arg);
  elsif p_expr ~ '^app_can_see_site\(' then
    arg := regexp_replace(p_expr, '^app_can_see_site\((.*)\)$', '\1');
    return format(
      '(%1$s IS NULL OR btrim(%1$s) = '''' OR (select public.app_sees_all_sites()) '
      'OR upper(btrim(%1$s)) = ANY (coalesce((select public.app_site_scope()), ''{}''::text[])))', arg);
  end if;
  raise exception 'unrecognised predicate: %', p_expr;
end $$;

do $$
declare r record; n int := 0;
begin
  for r in
    select pol.polname, c.relname, n2.nspname,
           pg_get_expr(pol.polqual, pol.polrelid)      as qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as wcheck
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n2 on n2.oid = c.relnamespace
    where pg_get_expr(pol.polqual, pol.polrelid) ~ '^app_can_see_(country|site)\(.*\)$'
  loop
    if r.wcheck is not null and r.wcheck ~ '^app_can_see_(country|site)\(.*\)$' then
      execute format('alter policy %I on %I.%I using (%s) with check (%s)',
                     r.polname, r.nspname, r.relname,
                     public._rls_rewrite(r.qual), public._rls_rewrite(r.wcheck));
    else
      execute format('alter policy %I on %I.%I using (%s)',
                     r.polname, r.nspname, r.relname, public._rls_rewrite(r.qual));
    end if;
    n := n + 1;
  end loop;
  raise notice 'rewrote % policies', n;   -- expect 74
end $$;

drop function if exists public._rls_rewrite(text);

comment on function public.app_can_see_country(text) is
  'SUPERSEDED by the InitPlan form used in RLS policies (V396). Still correct, but '
  'called per row it re-queries profiles for every row. Prefer app_sees_all_countries() '
  '+ app_country_scope() in any new policy.';
comment on function public.app_can_see_site(text) is
  'SUPERSEDED by the InitPlan form used in RLS policies (V396). See app_can_see_country.';

-- VERIFY (expect still_old = 0, country 44, site 30)
--   select
--     (select count(*) from pg_policy where pg_get_expr(polqual,polrelid) ~ 'app_can_see_(country|site)\(') as still_old,
--     (select count(*) from pg_policy where pg_get_expr(polqual,polrelid) like '%app_country_scope%')        as country,
--     (select count(*) from pg_policy where pg_get_expr(polqual,polrelid) like '%app_site_scope%')           as site;
--
-- UNDO (restores every predicate byte-for-byte from the backup)
--   do $$
--   declare r record;
--   begin
--     for r in select * from public._rls_policy_backup_v396 loop
--       if r.old_withcheck is not null then
--         execute format('alter policy %I on %I.%I using (%s) with check (%s)',
--                        r.polname, r.nspname, r.relname, r.old_qual, r.old_withcheck);
--       else
--         execute format('alter policy %I on %I.%I using (%s)',
--                        r.polname, r.nspname, r.relname, r.old_qual);
--       end if;
--     end loop;
--   end $$;
