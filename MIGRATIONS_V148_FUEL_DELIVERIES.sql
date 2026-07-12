-- ============================================================================
-- MIGRATIONS_V148 — Fuel Delivery: Bulk Fuel Deliveries
-- ============================================================================
-- Logs bulk fuel deliveries into sites / storage tanks (supplier, litres, unit
-- price, total cost, delivery date). Backs the /fuel-delivery module. Any
-- authenticated member of the org may record and manage deliveries. Org-isolated
-- and country-scoped, with a lightweight status lifecycle.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fuel_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  delivery_no      text,
  supplier         text,
  site             text,
  tank             text,
  litres           numeric,
  unit_price       numeric,
  total_cost       numeric,
  delivered_at     date,
  status           text NOT NULL DEFAULT 'delivered'
                     CHECK (status IN ('ordered','delivered','cancelled')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fuel_deliveries_org       ON public.fuel_deliveries (organisation_id);
CREATE INDEX IF NOT EXISTS idx_fuel_deliveries_site      ON public.fuel_deliveries (site);
CREATE INDEX IF NOT EXISTS idx_fuel_deliveries_delivered ON public.fuel_deliveries (delivered_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_fuel_deliveries ON public.fuel_deliveries;
CREATE TRIGGER set_updated_at_fuel_deliveries BEFORE UPDATE ON public.fuel_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and manage (create/update/delete)
-- fuel delivery records.
ALTER TABLE public.fuel_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fuel_deliveries_org_isolation ON public.fuel_deliveries;
CREATE POLICY fuel_deliveries_org_isolation ON public.fuel_deliveries
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS fuel_deliveries_read ON public.fuel_deliveries;
CREATE POLICY fuel_deliveries_read ON public.fuel_deliveries FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS fuel_deliveries_insert ON public.fuel_deliveries;
CREATE POLICY fuel_deliveries_insert ON public.fuel_deliveries FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS fuel_deliveries_update ON public.fuel_deliveries;
CREATE POLICY fuel_deliveries_update ON public.fuel_deliveries FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS fuel_deliveries_delete ON public.fuel_deliveries;
CREATE POLICY fuel_deliveries_delete ON public.fuel_deliveries FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.fuel_deliveries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fuel_deliveries TO authenticated;

-- Reversible:
--   DROP TABLE public.fuel_deliveries;
