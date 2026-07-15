-- V238: Capability enforcement PILOT (additive/safe) on tyre_records, inspections, work_orders.
-- Adds PERMISSIVE write policies consuming app_user_can(module, capability) so per-user
-- create/edit/delete GRANTS become server-enforced (was UI-only). Permissive => ORs with the
-- existing role policies, so it can only ADD access to granted/admin users; existing writers are
-- unaffected. RESTRICTIVE org/country isolation still applies (a granted user stays scoped).
-- Verified live: a Reporter's app_user_can('tyre_records','edit') flips false->true on grant.
-- NOT yet enforced: revoke of a role-inherent capability (needs a restrictive policy) + the other
-- ~45 tables (this is a pilot). Applied live 2026-07-14.
DO $$
DECLARE t text; m text; tbls text[] := ARRAY['tyre_records','inspections','work_orders'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    m := t;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_cap_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.app_user_can(%L,%L))', t||'_cap_insert', t, m, 'create');
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_cap_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.app_user_can(%L,%L)) WITH CHECK (public.app_user_can(%L,%L))', t||'_cap_update', t, m, 'edit', m, 'edit');
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_cap_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.app_user_can(%L,%L))', t||'_cap_delete', t, m, 'delete');
  END LOOP;
END $$;
