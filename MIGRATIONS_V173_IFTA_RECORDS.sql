-- ============================================================================
-- MIGRATIONS_V173 — IFTA Fuel Tax Reporting Records
-- ============================================================================
-- Backs the IFTA Fuel Tax Reporting module (/ifta-reporting). Stores the
-- jurisdiction-by-jurisdiction distance and fuel data required to file
-- interstate/inter-provincial fuel-tax returns under the International Fuel Tax
-- Agreement (IFTA). Each row captures the miles/kilometres travelled and the
-- fuel purchased/consumed by one asset in one jurisdiction, for one reporting
-- quarter, on a given travel date.
--
-- This is the operational basis for quarterly IFTA settlements: net taxable
-- distance per jurisdiction, fuel economy reconciliation, and per-jurisdiction
-- tax due. Distance/fuel history feeds fleet CPK and utilisation analytics.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ifta_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  asset_no         text NOT NULL,
  driver_name      text,
  jurisdiction     text,
  quarter          text,
  travel_date      date,
  distance_km      numeric,
  fuel_litres      numeric,
  fuel_cost        numeric,
  currency         text,
  tax_rate         numeric,
  taxable_km       numeric,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ifta_records_org         ON public.ifta_records (organisation_id);
CREATE INDEX IF NOT EXISTS idx_ifta_records_asset       ON public.ifta_records (asset_no);
CREATE INDEX IF NOT EXISTS idx_ifta_records_travel_date ON public.ifta_records (travel_date DESC);

DROP TRIGGER IF EXISTS set_updated_at_ifta_records ON public.ifta_records;
CREATE TRIGGER set_updated_at_ifta_records BEFORE UPDATE ON public.ifta_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read records; authenticated members may capture (insert),
-- correct (update) and remove (delete) records for their own org.
ALTER TABLE public.ifta_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ifta_records_org_isolation ON public.ifta_records;
CREATE POLICY ifta_records_org_isolation ON public.ifta_records
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS ifta_records_read ON public.ifta_records;
CREATE POLICY ifta_records_read ON public.ifta_records FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ifta_records_insert ON public.ifta_records;
CREATE POLICY ifta_records_insert ON public.ifta_records FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ifta_records_update ON public.ifta_records;
CREATE POLICY ifta_records_update ON public.ifta_records FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS ifta_records_delete ON public.ifta_records;
CREATE POLICY ifta_records_delete ON public.ifta_records FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.ifta_records FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ifta_records TO authenticated;

-- Reversible:
--   DROP TABLE public.ifta_records;
