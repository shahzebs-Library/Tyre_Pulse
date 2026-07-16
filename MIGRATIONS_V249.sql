-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V249 — Tyre procurement quotes ("the deals") for the Value Advisor
-- ─────────────────────────────────────────────────────────────────────────────
-- Holds supplier quotes per approved fitment (vehicle type + position + brand +
-- size) so the Value Advisor can rank options by lifecycle cost-per-km (CPK),
-- not sticker price. Lifecycle CPK folds in retread yield, retread cost and the
-- residual casing value. Org-isolated + country-isolated; team-readable; elevated
-- roles (procurement decision makers) manage the library.
-- Depends on: app_current_org(), app_can_see_country(), get_my_role(),
-- app_is_active(), set_updated_at().
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tyre_procurement_options (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid DEFAULT public.app_current_org(),
  vehicle_type      text NOT NULL,
  position          text NOT NULL DEFAULT 'All Positions',
  brand             text NOT NULL,
  size              text,
  ply_rating        text,
  supplier          text,
  unit_price        numeric,                 -- quoted price per tyre
  currency          text DEFAULT 'SAR',
  expected_life_km  numeric,                 -- engineer/supplier expected new-life km
  retreadable       boolean DEFAULT false,
  retread_count     integer DEFAULT 0,       -- planned retread cycles on the casing
  retread_cost_pct  numeric DEFAULT 0.4,     -- retread cost as fraction of new price
  warranty_km       numeric,
  casing_value      numeric DEFAULT 0,       -- residual casing value recovered at scrap
  notes             text,
  country           text,
  created_by        uuid DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tyre_proc_options_org   ON public.tyre_procurement_options (organisation_id);
CREATE INDEX IF NOT EXISTS idx_tyre_proc_options_vt    ON public.tyre_procurement_options (vehicle_type, position);
CREATE INDEX IF NOT EXISTS idx_tyre_proc_options_brand ON public.tyre_procurement_options (brand);

DROP TRIGGER IF EXISTS set_updated_at_tyre_procurement_options ON public.tyre_procurement_options;
CREATE TRIGGER set_updated_at_tyre_procurement_options BEFORE UPDATE ON public.tyre_procurement_options
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tyre_procurement_options ENABLE ROW LEVEL SECURITY;

-- Hard org boundary (RESTRICTIVE).
DROP POLICY IF EXISTS tyre_procurement_options_org_isolation ON public.tyre_procurement_options;
CREATE POLICY tyre_procurement_options_org_isolation ON public.tyre_procurement_options
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM (select public.app_current_org()))
  WITH CHECK (organisation_id IS NOT DISTINCT FROM (select public.app_current_org()));

-- Country boundary (RESTRICTIVE; null country visible to all in org).
DROP POLICY IF EXISTS tyre_procurement_options_country_isolation ON public.tyre_procurement_options;
CREATE POLICY tyre_procurement_options_country_isolation ON public.tyre_procurement_options
  AS RESTRICTIVE FOR ALL
  USING (public.app_can_see_country(country))
  WITH CHECK (public.app_can_see_country(country));

-- Any active org member can read the quote library.
DROP POLICY IF EXISTS tyre_procurement_options_read ON public.tyre_procurement_options;
CREATE POLICY tyre_procurement_options_read ON public.tyre_procurement_options FOR SELECT
  USING ((select public.app_is_active()));

-- Elevated roles (procurement decision makers) create/edit/delete.
DROP POLICY IF EXISTS tyre_procurement_options_insert ON public.tyre_procurement_options;
CREATE POLICY tyre_procurement_options_insert ON public.tyre_procurement_options FOR INSERT
  WITH CHECK ((select public.get_my_role()) IN ('Admin','Manager','Director')
    AND (created_by IS NULL OR created_by = auth.uid()));

DROP POLICY IF EXISTS tyre_procurement_options_update ON public.tyre_procurement_options;
CREATE POLICY tyre_procurement_options_update ON public.tyre_procurement_options FOR UPDATE
  USING ((select public.get_my_role()) IN ('Admin','Manager','Director'))
  WITH CHECK ((select public.get_my_role()) IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS tyre_procurement_options_delete ON public.tyre_procurement_options;
CREATE POLICY tyre_procurement_options_delete ON public.tyre_procurement_options FOR DELETE
  USING ((select public.get_my_role()) IN ('Admin','Manager','Director'));

-- ── Rollback ────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS public.tyre_procurement_options CASCADE;
