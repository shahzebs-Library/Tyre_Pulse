-- TEN-3: platform-wide configuration tables are written by a super admin only.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from LIVE pg_policies. Not applied to any
--         database. Tested on PGlite only (supabase/tests/tenant_isolation_ten3.test.mjs).
--
-- WHAT IT FIXES
--   These tables have no organisation column: one row set is shared by every company. Their
--   write policies admit any organisation's plain Admin.
--
--   REALLY OPEN TODAY (the role test matches the stored Title Case role):
--     modules               modules_write                    is_super_admin() OR get_my_role() = 'Admin'
--     subscription_plans    subscription_plans_admin_write   profiles.role = 'Admin'
--     due_alert_rules       due_alert_rules_write            is_super_admin() OR get_my_role() = 'Admin'
--     brand_aliases         "Admin write brand aliases"      get_my_role() = 'Admin'
--   A second tenant's Admin can switch modules off for everyone, edit plan prices and limits,
--   change due alert recipients everywhere, and add brand aliases that rewrite other tenants'
--   tyre brands.
--
--   CLOSED TODAY ONLY BY ACCIDENT (correction to the audit report): nine registry tables use
--     is_super_admin() OR app_role() = 'Admin'
--   and the live app_role() returns the role LOWER-CASED ('admin'), so the Admin arm can never be
--   true. A plain Admin already writes 0 rows there. The dead arm is removed anyway, because the
--   first person to "fix the casing" would open all nine: metric_registry, metric_versions,
--   quality_rules, data_assets, lineage_edges, dashboard_registry, widget_bindings, releases,
--   release_impacts.
--
--   Every write policy becomes  (select public.is_super_admin())  for USING and WITH CHECK.
--   Read policies are not touched. ALTER POLICY only: no policy is removed or created.
--
-- RISK TO THE CURRENT COMPANY (Company A; 2 super admins, 0 plain Admins): NONE EXPECTED.
--   Nobody holds a plain Admin role, so nobody loses a write. Know this before creating one:
--   * is_super_admin() is false for a super admin who has a verified MFA factor but an aal1
--     session. Today such a session still writes `modules`, `due_alert_rules` and `brand_aliases`
--     through the get_my_role() = 'Admin' arm; after this it must be MFA-complete. The web app and
--     the System Console already refuse a half-authenticated session, so this is not expected to
--     be reachable, but it was not exercised.
--   * Any future plain Admin inside Company A loses module switches, alert rule edits and brand
--     aliases. If a company needs its own alert recipients or module switches, that is a
--     per-organisation override table (audit report section 5), not a write on these rows.
--   * billing-checkout reads subscription_plans with the service role; unaffected.
--
-- VERIFY (rolled back, after applying):
--   begin;
--   select tablename, policyname, qual, with_check from pg_policies
--    where schemaname = 'public' and cmd = 'ALL' and permissive = 'PERMISSIVE'
--      and tablename in ('modules','subscription_plans','due_alert_rules','brand_aliases','metric_registry',
--        'metric_versions','quality_rules','data_assets','lineage_edges','dashboard_registry','widget_bindings',
--        'releases','release_impacts');          -- 13 rows, each qual and with_check is the is_super_admin() form
--   -- impersonate a Company A super admin:  with u as (update public.modules set note = note
--   --   where module_id = (select min(module_id) from public.modules) returning 1) select count(*) from u;  -- 1
--   -- impersonate the demo Manager: same statement returns 0 (it already does; no plain Admin
--   --   exists in production, so the before/after difference can only be seen on a branch database).
--   rollback;
--
-- ROLLBACK: one ALTER POLICY per table restoring the expression in the "before" column above, e.g.
--   alter policy modules_write on public.modules
--     using (is_super_admin() or get_my_role() = 'Admin') with check (is_super_admin() or get_my_role() = 'Admin');
--   alter policy subscription_plans_admin_write on public.subscription_plans
--     using (exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'Admin'))
--     with check (exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'Admin'));
--   alter policy due_alert_rules_write on public.due_alert_rules
--     using ((select is_super_admin()) or (select get_my_role()) = 'Admin')
--     with check ((select is_super_admin()) or (select get_my_role()) = 'Admin');
--   alter policy "Admin write brand aliases" on public.brand_aliases using ((select get_my_role()) = 'Admin');
--   -- registry tables: using (is_super_admin() or app_role() = 'Admin') with check (same)
-- ---------------------------------------------------------------------------------------------

do $mig$
declare
  r record;
  v_qual text;
  v_cmd  text;
  v_perm text;
  v_left integer;
begin
  for r in
    select * from (values
      ('modules',            'modules_write'),
      ('subscription_plans', 'subscription_plans_admin_write'),
      ('due_alert_rules',    'due_alert_rules_write'),
      ('brand_aliases',      'Admin write brand aliases'),
      ('metric_registry',    'metric_registry_write'),
      ('metric_versions',    'metric_versions_write'),
      ('quality_rules',      'quality_rules_write'),
      ('data_assets',        'data_assets_write'),
      ('lineage_edges',      'lineage_edges_write'),
      ('dashboard_registry', 'dashboard_registry_write'),
      ('widget_bindings',    'widget_bindings_write'),
      ('releases',           'releases_write'),
      ('release_impacts',    'release_impacts_write')
    ) as x(tbl, pol)
  loop
    select p.qual, p.cmd, p.permissive into v_qual, v_cmd, v_perm
      from pg_policies p
     where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol;

    if not found then
      raise exception 'TEN-3 aborted: policy "%" on public.% does not exist. The live policies have changed; re-author this migration.', r.pol, r.tbl;
    end if;
    if v_cmd <> 'ALL' or v_perm <> 'PERMISSIVE' then
      raise exception 'TEN-3 aborted: policy "%" on public.% is % %, expected PERMISSIVE ALL', r.pol, r.tbl, v_perm, v_cmd;
    end if;
    if v_qual not like '%''Admin''%' then
      if v_qual like '%is_super_admin()%' then
        raise notice 'TEN-3: policy "%" on public.% is already super admin only, skipped', r.pol, r.tbl;
        continue;
      end if;
      raise exception 'TEN-3 aborted: policy "%" on public.% has an unexpected expression: %', r.pol, r.tbl, v_qual;
    end if;

    execute format('alter policy %I on public.%I using ((select public.is_super_admin())) with check ((select public.is_super_admin()))',
                   r.pol, r.tbl);
  end loop;

  select count(*) into v_left
    from pg_policies p
   where p.schemaname = 'public' and p.cmd = 'ALL' and p.permissive = 'PERMISSIVE'
     and p.tablename in ('modules','subscription_plans','due_alert_rules','brand_aliases','metric_registry',
                         'metric_versions','quality_rules','data_assets','lineage_edges','dashboard_registry',
                         'widget_bindings','releases','release_impacts')
     and (coalesce(p.qual, '') like '%''Admin''%' or coalesce(p.with_check, '') like '%''Admin''%');
  if v_left <> 0 then
    raise exception 'TEN-3 aborted: % write policy(ies) on the platform tables still name the Admin role', v_left;
  end if;
end
$mig$;
