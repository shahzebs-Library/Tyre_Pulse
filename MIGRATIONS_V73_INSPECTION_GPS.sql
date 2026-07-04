-- V73: GPS location tagging for inspections.
-- The mobile inspector app captures a foreground GPS fix on the submit path and
-- folds it into the inspection payload. These additive, nullable columns store
-- that geotag so fleet managers can see WHERE each tyre check was performed and
-- power future map/geo-analytics without a schema change.
--
-- Fully additive, idempotent, and non-destructive: existing rows keep NULL geo
-- fields, and inspections submitted with GPS denied/unavailable also store NULL
-- (the app never blocks an inspection on location). The existing row-level RLS
-- INSERT/SELECT policies on public.inspections already cover these new columns,
-- so no policy changes are required.

ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS gps_lat double precision;
ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS gps_lng double precision;
ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS gps_accuracy double precision;
ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS gps_captured_at timestamptz;

COMMENT ON COLUMN public.inspections.gps_lat IS
  'WGS84 latitude where the inspection was recorded (device GPS). NULL when location was denied/unavailable.';
COMMENT ON COLUMN public.inspections.gps_lng IS
  'WGS84 longitude where the inspection was recorded (device GPS). NULL when location was denied/unavailable.';
COMMENT ON COLUMN public.inspections.gps_accuracy IS
  'Horizontal accuracy of the GPS fix in metres, as reported by the device OS.';
COMMENT ON COLUMN public.inspections.gps_captured_at IS
  'Timestamp (UTC) at which the GPS fix was captured on the device.';

-- Partial index: only geotagged inspections are indexed, keeping it small and
-- cheap while accelerating "inspections with a known location" map/geo queries.
CREATE INDEX IF NOT EXISTS idx_inspections_gps
  ON public.inspections (gps_lat, gps_lng)
  WHERE gps_lat IS NOT NULL AND gps_lng IS NOT NULL;
