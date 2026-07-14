-- V234: wrap zero-arg STABLE RLS helper functions in (select ...) so the planner
-- evaluates them ONCE per query (InitPlan) instead of per row (auth_rls_initplan fix).
-- Semantically identical; scoped to hot operational tables. app_can_see_country(country)
-- is row-dependent and intentionally left alone. Applied live 2026-07-14; access verified
-- unchanged via impersonation. Transaction-safe (any malformed rewrite aborts the migration).
DO $$
DECLARE
  r record; nq text; nw text; changed boolean; stmt text; base text;
  bases text[] := ARRAY['is_super_admin','app_current_org','get_my_role','app_role','app_is_active','app_is_org_admin','app_is_elevated'];
  hot text[] := ARRAY['tyre_records','vehicle_fleet','accidents','inspections','work_orders','stock_records',
                      'alerts','warranty_claims','corrective_actions','budgets','purchase_orders','rca_records',
                      'tyre_rotations','gate_passes','recalls','insurance_claims','drivers','incident_reports',
                      'tyre_specifications','tyre_status_marks'];
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, pol.polname AS pname,
           pg_get_expr(pol.polqual, pol.polrelid) AS qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS wchk
    FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname = ANY(hot)
  LOOP
    nq := r.qual; nw := r.wchk; changed := false;
    FOREACH base IN ARRAY bases LOOP
      IF nq IS NOT NULL THEN nq := replace(nq,'public.'||base||'()','@@'||base||'@@'); nq := replace(nq,base||'()','@@'||base||'@@'); END IF;
      IF nw IS NOT NULL THEN nw := replace(nw,'public.'||base||'()','@@'||base||'@@'); nw := replace(nw,base||'()','@@'||base||'@@'); END IF;
    END LOOP;
    FOREACH base IN ARRAY bases LOOP
      IF nq IS NOT NULL AND position('@@'||base||'@@' in nq) > 0 THEN nq := replace(nq,'@@'||base||'@@','(select public.'||base||'())'); changed := true; END IF;
      IF nw IS NOT NULL AND position('@@'||base||'@@' in nw) > 0 THEN nw := replace(nw,'@@'||base||'@@','(select public.'||base||'())'); changed := true; END IF;
    END LOOP;
    IF changed THEN
      IF nq IS NOT NULL AND nw IS NOT NULL THEN stmt := format('ALTER POLICY %I ON public.%I USING (%s) WITH CHECK (%s)', r.pname, r.tbl, nq, nw);
      ELSIF nq IS NOT NULL THEN stmt := format('ALTER POLICY %I ON public.%I USING (%s)', r.pname, r.tbl, nq);
      ELSE stmt := format('ALTER POLICY %I ON public.%I WITH CHECK (%s)', r.pname, r.tbl, nw); END IF;
      EXECUTE stmt;
    END IF;
  END LOOP;
END $$;
