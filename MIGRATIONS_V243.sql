-- V243 — Accidents: capture vehicle plate number + type at incident time
--
-- When an accident is filed against an asset, the operator wants the vehicle's
-- PLATE NUMBER (vehicle_fleet.registration_no) and TYPE (vehicle_fleet.vehicle_type)
-- captured on the record — the same way site/country already auto-fill from the
-- fleet master. The accidents table had no home for either value, so they could
-- not be shown or persisted. These are free-text snapshots taken at save time
-- (the asset's registration/type as it stood when the incident was filed), so no
-- FK/CHECK is imposed. Existing RLS (org + country isolation) already governs the
-- whole row, so the new columns need no separate policy.

ALTER TABLE public.accidents
  ADD COLUMN IF NOT EXISTS plate_number text,
  ADD COLUMN IF NOT EXISTS vehicle_type text;

COMMENT ON COLUMN public.accidents.plate_number IS
  'Vehicle plate/registration number, snapshotted from vehicle_fleet.registration_no when the incident was filed.';
COMMENT ON COLUMN public.accidents.vehicle_type IS
  'Vehicle type, snapshotted from vehicle_fleet.vehicle_type when the incident was filed.';
