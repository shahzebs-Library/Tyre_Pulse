-- ============================================================================
-- MIGRATIONS_V168 — Video Telematics / Dashcam Events
-- ============================================================================
-- Backs the Video Telematics module (/video-telematics): safety-critical driving
-- events captured by AI dashcams and video telematics devices — collisions,
-- harsh braking, tailgating, distraction, drowsiness, phone use, and seatbelt
-- violations. Each row is one detected event for one asset/driver at a point in
-- time, with a severity, an optional geolocation, speed, and a link to the
-- source video clip for review. This is the evidentiary backbone for driver
-- coaching, risk scoring, accident investigation, and insurance workflows, so
-- every event is org-isolated, country-scoped, and auditable.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dashcam_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  asset_no         text,
  driver_name      text,
  event_type       text
                     CHECK (event_type IN ('collision','harsh_brake','tailgating',
                       'distraction','drowsiness','phone_use','no_seatbelt','other')),
  severity         text
                     CHECK (severity IN ('low','medium','high','critical')),
  event_at         timestamptz,
  location         text,
  speed_kmh        numeric,
  video_url        text,
  reviewed         boolean DEFAULT false,
  review_notes     text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashcam_events_org      ON public.dashcam_events (organisation_id);
CREATE INDEX IF NOT EXISTS idx_dashcam_events_asset    ON public.dashcam_events (asset_no);
CREATE INDEX IF NOT EXISTS idx_dashcam_events_event_at ON public.dashcam_events (event_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_dashcam_events ON public.dashcam_events;
CREATE TRIGGER set_updated_at_dashcam_events BEFORE UPDATE ON public.dashcam_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read events and log/triage them —
-- reviewing dashcam events is a routine safety/ops activity, not a privileged
-- one.
ALTER TABLE public.dashcam_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dashcam_events_org_isolation ON public.dashcam_events;
CREATE POLICY dashcam_events_org_isolation ON public.dashcam_events
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS dashcam_events_read ON public.dashcam_events;
CREATE POLICY dashcam_events_read ON public.dashcam_events FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS dashcam_events_insert ON public.dashcam_events;
CREATE POLICY dashcam_events_insert ON public.dashcam_events FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS dashcam_events_update ON public.dashcam_events;
CREATE POLICY dashcam_events_update ON public.dashcam_events FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS dashcam_events_delete ON public.dashcam_events;
CREATE POLICY dashcam_events_delete ON public.dashcam_events FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.dashcam_events FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashcam_events TO authenticated;

-- Reversible:
--   DROP TABLE public.dashcam_events;
