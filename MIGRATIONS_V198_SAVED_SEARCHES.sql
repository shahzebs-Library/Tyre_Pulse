-- ============================================================================
-- MIGRATIONS_V198 — Saved Searches (Advanced / Global Search)
-- ============================================================================
-- Backs the Advanced Search module (/advanced-search). Persists named,
-- cross-entity searches so operators can save a query once and re-run it on
-- demand against the fleet's core tables (assets, tyres, work orders,
-- inspections, or all). Each row is one saved search definition for one org.
--
-- The Advanced Search page also runs *live* global searches directly against
-- the operational tables (vehicle_fleet, tyre_records, work_orders,
-- inspections); this table only stores the saved query definitions and their
-- last-run metadata so a search becomes a reusable, shareable asset.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.saved_searches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  name             text NOT NULL,
  entity           text NOT NULL DEFAULT 'all'
                     CHECK (entity IN ('assets','tyres','work_orders','inspections','all')),
  query_text       text,
  filters          jsonb,
  result_count     integer,
  pinned           boolean NOT NULL DEFAULT false,
  last_run_at      timestamptz,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_org
  ON public.saved_searches (organisation_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_entity
  ON public.saved_searches (entity);
CREATE INDEX IF NOT EXISTS idx_saved_searches_created
  ON public.saved_searches (created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_saved_searches ON public.saved_searches;
CREATE TRIGGER set_updated_at_saved_searches BEFORE UPDATE ON public.saved_searches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read saved searches; authenticated members may create, update and
-- delete saved searches for their own org.
ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS saved_searches_org_isolation ON public.saved_searches;
CREATE POLICY saved_searches_org_isolation ON public.saved_searches
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS saved_searches_read ON public.saved_searches;
CREATE POLICY saved_searches_read ON public.saved_searches FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS saved_searches_insert ON public.saved_searches;
CREATE POLICY saved_searches_insert ON public.saved_searches FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS saved_searches_update ON public.saved_searches;
CREATE POLICY saved_searches_update ON public.saved_searches FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS saved_searches_delete ON public.saved_searches;
CREATE POLICY saved_searches_delete ON public.saved_searches FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.saved_searches FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_searches TO authenticated;

-- Reversible:
--   DROP TABLE public.saved_searches;
