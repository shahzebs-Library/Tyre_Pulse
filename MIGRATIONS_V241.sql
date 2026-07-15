-- V241: extend capability enforcement (V238 pilot) to the main operational tables so per-role/
-- per-user create/edit/delete RULES actually govern them. PERMISSIVE app_user_can policies =>
-- additive (only add access for granted/admin; existing writers unaffected; org/country isolation
-- still scopes). (table, module_key) pairs match moduleCatalog. Applied live 2026-07-14.
DO $$
DECLARE i int; t text; m text;
  tbls text[] := ARRAY['accidents','vehicle_fleet','stock_records','gate_passes','budgets','corrective_actions','alerts','rca_records'];
  mods text[] := ARRAY['accidents','fleet_master','stock','gate_pass','budgets','corrective_actions','alerts','rca'];
BEGIN
  FOR i IN 1..array_length(tbls,1) LOOP
    t := tbls[i]; m := mods[i];
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_cap_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.app_user_can(%L,%L))', t||'_cap_insert', t, m, 'create');
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_cap_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.app_user_can(%L,%L)) WITH CHECK (public.app_user_can(%L,%L))', t||'_cap_update', t, m, 'edit', m, 'edit');
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_cap_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.app_user_can(%L,%L))', t||'_cap_delete', t, m, 'delete');
  END LOOP;
END $$;
