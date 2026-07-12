-- ============================================================================
-- MIGRATIONS_V151 — Tyre Service Events
-- ============================================================================
-- Logs discrete tyre service actions (rotation, repair, inflation, inspection,
-- replacement) against a tyre serial and/or asset. Backs the Tyre Service Events
-- module: an operational log of every hands-on tyre intervention, with tread /
-- pressure readings, cost, technician and site for downstream CPK, compliance
-- and workshop-productivity analytics.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tyre_service_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  tyre_serial      text,
  asset_no         text,
  position         text,
  event_type       text NOT NULL DEFAULT 'inspection'
                     CHECK (event_type IN ('rotation','repair','inflation','inspection','replacement','other')),
  event_date       date,
  tread_depth      numeric,
  pressure         numeric,
  cost             numeric,
  technician       text,
  site             text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tyre_service_events_org    ON public.tyre_service_events (organisation_id);
CREATE INDEX IF NOT EXISTS idx_tyre_service_events_serial ON public.tyre_service_events (tyre_serial);
CREATE INDEX IF NOT EXISTS idx_tyre_service_events_asset  ON public.tyre_service_events (asset_no);
CREATE INDEX IF NOT EXISTS idx_tyre_service_events_date   ON public.tyre_service_events (event_date DESC);

DROP TRIGGER IF EXISTS set_updated_at_tyre_service_events ON public.tyre_service_events;
CREATE TRIGGER set_updated_at_tyre_service_events BEFORE UPDATE ON public.tyre_service_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and log/edit/remove service events.
ALTER TABLE public.tyre_service_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tyre_service_events_org_isolation ON public.tyre_service_events;
CREATE POLICY tyre_service_events_org_isolation ON public.tyre_service_events
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS tyre_service_events_read ON public.tyre_service_events;
CREATE POLICY tyre_service_events_read ON public.tyre_service_events FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS tyre_service_events_insert ON public.tyre_service_events;
CREATE POLICY tyre_service_events_insert ON public.tyre_service_events FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS tyre_service_events_update ON public.tyre_service_events;
CREATE POLICY tyre_service_events_update ON public.tyre_service_events FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS tyre_service_events_delete ON public.tyre_service_events;
CREATE POLICY tyre_service_events_delete ON public.tyre_service_events FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.tyre_service_events FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tyre_service_events TO authenticated;

-- Reversible:
--   DROP TABLE public.tyre_service_events;
