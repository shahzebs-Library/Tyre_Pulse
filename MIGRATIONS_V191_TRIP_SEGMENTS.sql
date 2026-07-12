-- ============================================================================
-- MIGRATIONS_V191 — Trip Replay: Ordered GPS Breadcrumb Segments
-- ============================================================================
-- Backs the Trip Replay module (/trip-replay). Stores the ordered GPS
-- breadcrumb trail for a trip so a journey can be reconstructed and analysed:
-- great-circle distance travelled, number of stops/idles, harsh driving events
-- (brake / accel / corner / speeding), and a speed profile over the path.
--
-- Each row is one breadcrumb (one point on the trail) belonging to a trip
-- identified by `trip_ref`. Rows are ordered by `sequence` (fallback
-- `recorded_at`) to reconstruct the path deterministically. This complements
-- the live GPS Positions stream (V-GPS) and Odometer Logs (V162): those answer
-- "where is the fleet now / how far has each asset gone", while Trip Replay
-- answers "walk me through this specific trip, segment by segment".
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.trip_segments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  trip_ref         text NOT NULL,
  asset_no         text,
  driver_name      text,
  sequence         integer,
  latitude         numeric,
  longitude        numeric,
  speed_kmh        numeric,
  heading          numeric,
  event_type       text
                     CHECK (event_type IN ('move','stop','idle','harsh_brake',
                            'harsh_accel','harsh_corner','speeding','none')),
  recorded_at      timestamptz,
  address          text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_segments_org      ON public.trip_segments (organisation_id);
CREATE INDEX IF NOT EXISTS idx_trip_segments_trip     ON public.trip_segments (trip_ref);
CREATE INDEX IF NOT EXISTS idx_trip_segments_asset    ON public.trip_segments (asset_no);
CREATE INDEX IF NOT EXISTS idx_trip_segments_sequence ON public.trip_segments (sequence);
-- Composite covers the primary access path: reconstruct one trip in order.
CREATE INDEX IF NOT EXISTS idx_trip_segments_trip_seq ON public.trip_segments (trip_ref, sequence);

DROP TRIGGER IF EXISTS set_updated_at_trip_segments ON public.trip_segments;
CREATE TRIGGER set_updated_at_trip_segments BEFORE UPDATE ON public.trip_segments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read segments; authenticated members may ingest (insert), correct
-- (update), and remove (delete) segments for their own org.
ALTER TABLE public.trip_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trip_segments_org_isolation ON public.trip_segments;
CREATE POLICY trip_segments_org_isolation ON public.trip_segments
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS trip_segments_read ON public.trip_segments;
CREATE POLICY trip_segments_read ON public.trip_segments FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS trip_segments_insert ON public.trip_segments;
CREATE POLICY trip_segments_insert ON public.trip_segments FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS trip_segments_update ON public.trip_segments;
CREATE POLICY trip_segments_update ON public.trip_segments FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS trip_segments_delete ON public.trip_segments;
CREATE POLICY trip_segments_delete ON public.trip_segments FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.trip_segments FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_segments TO authenticated;

-- Reversible:
--   DROP TABLE public.trip_segments;
