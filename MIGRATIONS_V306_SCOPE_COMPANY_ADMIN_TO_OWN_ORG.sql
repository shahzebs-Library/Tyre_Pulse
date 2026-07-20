-- V306 (Phase-1 SaaS security: A1 + B2) — applied live 2026-07-20
-- A1: Company Admins were bypassing org isolation via app_is_org_admin()
--     (= is_super_admin() OR role='admin'). Any plain Admin could read/write
--     EVERY organisation's data. Scope them to their own org: only a true
--     super-admin crosses the org boundary.
-- B2: Drop the "organisation_id IS NULL" cross-org branch on these isolation
--     policies (0 null-org business rows; authenticated inserts get org stamped
--     by the app_current_org() column default, so writes are unaffected).
-- Scope: the 45 RESTRICTIVE *_org_isolation policies carrying app_is_org_admin().
-- system_logs_org_isolation is deliberately EXCLUDED (its null-org branch is
-- intentional for early-boot error logging and it never used the admin bypass).
do $$
declare
  r record;
  v_pred constant text :=
    '((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))';
begin
  for r in
    select tablename, policyname, cmd, roles
    from pg_policies
    where schemaname = 'public'
      and policyname like '%\_org\_isolation' escape '\'
      and qual like '%app_is_org_admin()%'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    if r.cmd in ('SELECT', 'DELETE') then
      execute format(
        'create policy %I on public.%I as restrictive for %s to %s using %s',
        r.policyname, r.tablename, r.cmd, array_to_string(r.roles, ','), v_pred);
    elsif r.cmd = 'INSERT' then
      execute format(
        'create policy %I on public.%I as restrictive for insert to %s with check %s',
        r.policyname, r.tablename, array_to_string(r.roles, ','), v_pred);
    else -- ALL or UPDATE: both USING and WITH CHECK
      execute format(
        'create policy %I on public.%I as restrictive for %s to %s using %s with check %s',
        r.policyname, r.tablename,
        case when r.cmd = 'ALL' then 'all' else 'update' end,
        array_to_string(r.roles, ','), v_pred, v_pred);
    end if;
  end loop;
end $$;
