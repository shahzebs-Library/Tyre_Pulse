-- ============================================================================
-- MIGRATIONS_V178 — Emissions Tests / Smog Compliance
-- ============================================================================
-- Backs the Emissions module (/emissions). Stores vehicle emissions / smog
-- test certificates so the fleet can track regulatory compliance and act before
-- certificates expire. Each row is one emissions test for one asset on one date,
-- with the measured gas readings, the pass/fail result, and the expiry date that
-- drives compliance alerting.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.emissions_tests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  certificate_no   text,
  asset_no         text NOT NULL,
  test_date        date,
  expiry_date      date,
  test_center      text,
  standard         text,
  co_pct           numeric,
  hc_ppm           numeric,
  nox_ppm          numeric,
  opacity_pct      numeric,
  co2_pct          numeric,
  result           text
                     CHECK (result IN ('pass','fail','conditional')),
  cost             numeric,
  currency         text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emissions_tests_org       ON public.emissions_tests (organisation_id);
CREATE INDEX IF NOT EXISTS idx_emissions_tests_asset     ON public.emissions_tests (asset_no);
CREATE INDEX IF NOT EXISTS idx_emissions_tests_test_date ON public.emissions_tests (test_date DESC);
CREATE INDEX IF NOT EXISTS idx_emissions_tests_expiry    ON public.emissions_tests (expiry_date);

DROP TRIGGER IF EXISTS set_updated_at_emissions_tests ON public.emissions_tests;
CREATE TRIGGER set_updated_at_emissions_tests BEFORE UPDATE ON public.emissions_tests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read tests; authenticated members may record (insert), correct
-- (update), and remove (delete) tests for their own org.
ALTER TABLE public.emissions_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS emissions_tests_org_isolation ON public.emissions_tests;
CREATE POLICY emissions_tests_org_isolation ON public.emissions_tests
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS emissions_tests_read ON public.emissions_tests;
CREATE POLICY emissions_tests_read ON public.emissions_tests FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS emissions_tests_insert ON public.emissions_tests;
CREATE POLICY emissions_tests_insert ON public.emissions_tests FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS emissions_tests_update ON public.emissions_tests;
CREATE POLICY emissions_tests_update ON public.emissions_tests FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS emissions_tests_delete ON public.emissions_tests;
CREATE POLICY emissions_tests_delete ON public.emissions_tests FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.emissions_tests FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.emissions_tests TO authenticated;

-- Reversible:
--   DROP TABLE public.emissions_tests;
