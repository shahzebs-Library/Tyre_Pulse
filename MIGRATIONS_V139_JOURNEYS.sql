-- ============================================================================
-- MIGRATIONS_V139 — Journey Log: Vehicle Journeys / Trips
-- ============================================================================
-- Backs the Journey Log module (/journeys). Fleet operators record vehicle
-- journeys — asset, driver, origin/destination, scheduled/actual times, distance
-- and purpose — with a lightweight status lifecycle (planned → in_progress →
-- completed / cancelled). Org-isolated, country-scoped. Any authenticated member
-- may read and maintain the org's journeys.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.journeys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  asset_no         text,
  driver_name      text,
  origin           text,
  destination      text,
  purpose          text,
  start_time       timestamptz,
  end_time         timestamptz,
  distance_km      numeric,
  site             text,
  status           text NOT NULL DEFAULT 'planned'
                     CHECK (status IN ('planned','in_progress','completed','cancelled')),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journeys_org        ON public.journeys (organisation_id);
CREATE INDEX IF NOT EXISTS idx_journeys_status     ON public.journeys (status);
CREATE INDEX IF NOT EXISTS idx_journeys_asset      ON public.journeys (asset_no);
CREATE INDEX IF NOT EXISTS idx_journeys_start_time ON public.journeys (start_time DESC);

DROP TRIGGER IF EXISTS set_updated_at_journeys ON public.journeys;
CREATE TRIGGER set_updated_at_journeys BEFORE UPDATE ON public.journeys
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and maintain (create/update/delete)
-- the org's journeys.
ALTER TABLE public.journeys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journeys_org_isolation ON public.journeys;
CREATE POLICY journeys_org_isolation ON public.journeys
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS journeys_read ON public.journeys;
CREATE POLICY journeys_read ON public.journeys FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS journeys_insert ON public.journeys;
CREATE POLICY journeys_insert ON public.journeys FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS journeys_update ON public.journeys;
CREATE POLICY journeys_update ON public.journeys FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS journeys_delete ON public.journeys;
CREATE POLICY journeys_delete ON public.journeys FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.journeys FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journeys TO authenticated;

-- Reversible:
--   DROP TABLE public.journeys;
