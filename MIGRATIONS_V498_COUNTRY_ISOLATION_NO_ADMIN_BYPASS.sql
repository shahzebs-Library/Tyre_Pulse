-- MIGRATIONS_V498_COUNTRY_ISOLATION_NO_ADMIN_BYPASS.sql
-- STATUS: APPLIED LIVE 2026-08-10, verified by impersonation.
--
-- WHY
-- 50 *_country_isolation policies across 50 tables bypassed the country wall via
-- app_is_org_admin(), which is `is_super_admin() OR app_role() = 'admin'`. So ANY
-- plain Admin - not just the platform owner - read every country's data on those
-- tables. Defensible while one company runs the system with two owner accounts;
-- indefensible the moment a customer appoints a regional administrator, which is
-- the exact scenario the country wall exists for.
--
-- Country scoping is a DATA-VISIBILITY boundary, so its only legitimate bypass is
-- the platform owner: is_super_admin(). Ordinary administration (managing users,
-- editing records) legitimately keeps app_is_org_admin() - the 4 policies outside
-- the country-isolation set were deliberately NOT touched.
--
-- BLAST RADIUS MEASURED FIRST: 36 profiles, 2 super admins, **0 plain Admins**.
-- Both Admin accounts are super admins, so no user's visibility changes today.
-- This closes the hole BEFORE a regional admin exists, which is the only time
-- it can be done without taking access away from someone.
--
-- THE `WITH CHECK` HALF IS LOAD-BEARING (the V396 lesson): 4 of the 50 are FOR
-- ALL and carry the same expression in WITH CHECK. Both clauses are regenerated
-- together. A rewrite that fixed only USING would leave the write side open -
-- half a boundary is worse than none - so the migration ABORTS if any policy is
-- left still referencing the bypass.
--
-- VERIFIED AFTER APPLYING:
--   country-isolation policies still carrying app_is_org_admin : 0
--   policies backed up to _rls_policy_backup_v498              : 50
--   FOR ALL policies whose WITH CHECK survived                 : 4 of 4
--   super admin      -> inspections 238, all countries (unchanged)
--   KSA-only Manager -> inspections 238, KSA only    (unchanged)
--
-- ROLLBACK: _rls_policy_backup_v498 holds every original definition
--   (tablename, policyname, cmd, permissive, roles, qual, with_check). Recreate
--   each policy from that table to restore the previous behaviour.

create table if not exists public._rls_policy_backup_v498 (
  tablename text, policyname text, cmd text, permissive text,
  roles text, qual text, with_check text, saved_at timestamptz default now()
);

do $mig$
declare r record; v_using text; v_check text; v_cmd text; v_left int;
begin
  insert into public._rls_policy_backup_v498 (tablename, policyname, cmd, permissive, roles, qual, with_check)
  select tablename, policyname, cmd, permissive, array_to_string(roles, ','), qual, with_check
    from pg_policies
   where schemaname = 'public'
     and policyname like '%country_isolation%'
     and (coalesce(qual,'') || coalesce(with_check,'')) like '%app_is_org_admin%';

  for r in
    select tablename, policyname, cmd, permissive, roles, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and policyname like '%country_isolation%'
       and (coalesce(qual,'') || coalesce(with_check,'')) like '%app_is_org_admin%'
  loop
    -- textual swap covers both the call and its output alias:
    --   ( SELECT app_is_org_admin() AS app_is_org_admin)
    --   -> ( SELECT is_super_admin() AS is_super_admin)
    v_using := replace(coalesce(r.qual, ''), 'app_is_org_admin', 'is_super_admin');
    v_check := replace(coalesce(r.with_check, ''), 'app_is_org_admin', 'is_super_admin');
    v_cmd   := case upper(r.cmd) when 'ALL' then 'ALL' else upper(r.cmd) end;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);

    execute format(
      'create policy %I on public.%I as %s for %s to %s %s %s',
      r.policyname, r.tablename,
      case when r.permissive = 'RESTRICTIVE' then 'RESTRICTIVE' else 'PERMISSIVE' end,
      v_cmd,
      array_to_string(r.roles, ','),
      case when coalesce(r.qual,'') <> '' then 'using (' || v_using || ')' else '' end,
      case when coalesce(r.with_check,'') <> '' then 'with check (' || v_check || ')' else '' end
    );
  end loop;

  select count(*) into v_left
    from pg_policies
   where schemaname = 'public'
     and policyname like '%country_isolation%'
     and (coalesce(qual,'') || coalesce(with_check,'')) like '%app_is_org_admin%';

  if v_left > 0 then
    raise exception 'V498 aborted: % country-isolation policies still carry the admin bypass', v_left;
  end if;
end $mig$;

-- STILL OPEN after this migration:
--  * 140 of 219 country-bearing tables have no country policy AT ALL. V494 fixed
--    the two holding money; the rest need the same sweep, and each needs its own
--    blast-radius measurement first.
--  * app_can_see_site / the site policies were not reviewed here.
