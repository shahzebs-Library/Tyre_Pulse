-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V43 — Organisation-scope ENFORCEMENT
--
-- Builds on V42 (foundation). Adds a single RESTRICTIVE RLS policy per business
-- table that requires the row's organisation_id to match the caller's org.
--
-- WHY RESTRICTIVE: PostgreSQL ANDs restrictive policies on top of ALL existing
-- permissive policies WITHOUT modifying them. So every current role/active/
-- creator rule is preserved untouched, and we simply add "...AND same org".
-- Because all existing data is in the single default org (V42), this changes
-- NOTHING for current users, but it now blocks cross-org access the moment a
-- second organisation exists.
--
-- service_role (Edge Functions) bypasses RLS and is unaffected. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
  business_tables text[] := ARRAY[
    'tyre_records','inspections','accidents','work_orders','corrective_actions',
    'vehicle_fleet','stock_records','stock_movements','gate_passes','rca_records',
    'budgets','purchase_orders','sites','alerts','warranty_claims','recalls',
    'tyre_specifications','tyre_rotations','inspection_schedules',
    'supplier_ratings','supplier_contracts','accident_parts','accident_remarks'
  ];
  pol text;
BEGIN
  FOREACH t IN ARRAY business_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name=t AND column_name='organisation_id') THEN
      -- RLS must be on for the restrictive policy to take effect.
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      pol := t || '_org_isolation';
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, t);
      -- Inline comparison (not the per-row function) so the planner can use the
      -- idx_<t>_org index; app_current_org() is STABLE → evaluated once.
      -- NULL org (legacy uncategorised) is permitted so no row is ever orphaned.
      EXECUTE format($p$
        CREATE POLICY %I ON public.%I
          AS RESTRICTIVE
          FOR ALL
          TO authenticated
          USING (organisation_id IS NULL OR organisation_id = public.app_current_org())
          WITH CHECK (organisation_id IS NULL OR organisation_id = public.app_current_org())
      $p$, pol, t);
    END IF;
  END LOOP;
END $$;
