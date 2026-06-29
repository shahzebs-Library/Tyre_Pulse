-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V42 — Organisation-scope FOUNDATION (additive, backward-compatible)
--
-- Lays the multi-tenant foundation WITHOUT changing any existing RLS policy, so
-- current app behaviour is unchanged (zero lockout risk). A later migration
-- (V43) flips RLS to enforce org isolation once this is validated.
--
-- Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- Sentinel id for the single default organisation all existing data belongs to.
-- (Real multi-org onboarding assigns new orgs their own gen_random_uuid().)
DO $$
DECLARE
  default_org constant uuid := '00000000-0000-0000-0000-000000000001';
  t text;
  business_tables text[] := ARRAY[
    'tyre_records','inspections','accidents','work_orders','corrective_actions',
    'vehicle_fleet','stock_records','stock_movements','gate_passes','rca_records',
    'budgets','purchase_orders','sites','alerts','warranty_claims','recalls',
    'tyre_specifications','tyre_rotations','inspection_schedules',
    'supplier_ratings','supplier_contracts','accident_parts','accident_remarks'
  ];
BEGIN
  -- 1. Default organisation
  INSERT INTO public.organisations (id, name, slug, active, plan)
  VALUES (default_org, 'Default Organisation', 'default', true, 'standard')
  ON CONFLICT (id) DO NOTHING;

  -- 2. profiles.org_id (+ backfill + default + index)
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organisations(id);
  UPDATE public.profiles SET org_id = default_org WHERE org_id IS NULL;
  -- DDL default expressions can't reference a PL/pgSQL variable — inject as a literal.
  EXECUTE format('ALTER TABLE public.profiles ALTER COLUMN org_id SET DEFAULT %L', default_org);
  CREATE INDEX IF NOT EXISTS idx_profiles_org_id ON public.profiles (org_id);

  -- 3. organisation_id on every business table (additive, default + backfill + FK + index)
  FOREACH t IN ARRAY business_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organisation_id uuid', t);
      EXECUTE format('UPDATE public.%I SET organisation_id = %L WHERE organisation_id IS NULL', t, default_org);
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN organisation_id SET DEFAULT %L', t, default_org);
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_org_fk') THEN
        EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (organisation_id) REFERENCES public.organisations(id)', t, t || '_org_fk');
      END IF;
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (organisation_id)', 'idx_' || t || '_org', t);
    END IF;
  END LOOP;
END $$;

-- 4. organisation_memberships (user ↔ org), enrol existing profiles into default org
CREATE TABLE IF NOT EXISTS public.organisation_memberships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  role            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organisation_memberships_uniq UNIQUE (user_id, organisation_id)
);
CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON public.organisation_memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_org  ON public.organisation_memberships (organisation_id);

INSERT INTO public.organisation_memberships (user_id, organisation_id, role)
SELECT id, '00000000-0000-0000-0000-000000000001', role FROM public.profiles
ON CONFLICT (user_id, organisation_id) DO NOTHING;

ALTER TABLE public.organisation_memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_memberships_read  ON public.organisation_memberships;
DROP POLICY IF EXISTS org_memberships_write ON public.organisation_memberships;
CREATE POLICY org_memberships_read ON public.organisation_memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.app_is_elevated());
CREATE POLICY org_memberships_write ON public.organisation_memberships
  FOR ALL TO authenticated
  USING (public.app_is_elevated()) WITH CHECK (public.app_is_elevated());

-- 5. Scope helper functions (used by the V43 enforcement migration and the API)
CREATE OR REPLACE FUNCTION public.app_current_org()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.app_in_org(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- NULL (uncategorised legacy rows) is permitted; otherwise must match caller's org.
  SELECT p_org IS NULL OR p_org = (SELECT org_id FROM public.profiles WHERE id = auth.uid());
$$;

GRANT EXECUTE ON FUNCTION public.app_current_org() TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_in_org(uuid) TO authenticated;

COMMENT ON FUNCTION public.app_current_org() IS 'Returns the calling user''s organisation_id from profiles. Basis for org-scoped RLS (V43+).';
COMMENT ON FUNCTION public.app_in_org(uuid) IS 'True when the given organisation_id matches the caller''s org (or is NULL/uncategorised). Used by org-scoped RLS policies.';
