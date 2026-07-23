-- V348 — Multi-country vehicle_fleet: per-country asset uniqueness + backfill the
-- UAE/Egypt fleet register from the asset numbers already present in their data.
--
-- vehicle_fleet.asset_no was GLOBALLY unique, which blocks a multi-country tenant
-- (the same asset number cannot exist in KSA and UAE). Per the established model
-- (per-country dedup for tyre_records/work_orders/vehicle_fleet), uniqueness must be
-- per (organisation_id, country, asset_no). Then the UAE/Egypt asset masters were
-- never loaded, so their tyres/work-orders could not link to a fleet record. This
-- derives a minimal fleet register for UAE + Egypt from the DISTINCT asset numbers
-- their tyres and work orders already reference (vehicle_type from tyre_records,
-- site from tyres + work orders), so cross-module relations resolve. Non-destructive
-- (INSERT only assets not already present for that country); the customer can later
-- enrich these rows via the importer (merge inserts only new).
--
-- Result (live): fleet KSA 604 / UAE 371 / Egypt 133; UAE+Egypt tyres and work orders
-- now link 100% to a fleet record (were 0). App lookups getAssetByNo/findVehicleByAsset
-- made country-aware + limit(1) so a super-admin who can see every country never hits
-- a multi-row error.

-- 1. Per-country asset uniqueness.
ALTER TABLE public.vehicle_fleet DROP CONSTRAINT IF EXISTS vehicle_fleet_asset_no_key;
DROP INDEX IF EXISTS public.vehicle_fleet_asset_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_fleet_org_country_asset_uidx
  ON public.vehicle_fleet (organisation_id, country, asset_no);

-- 2. Backfill UAE + Egypt from their tyres + work orders.
WITH assets AS (
  SELECT country, asset_no FROM public.tyre_records
    WHERE country IN ('UAE','Egypt') AND asset_no IS NOT NULL AND btrim(asset_no) <> ''
  UNION
  SELECT country, asset_no FROM public.work_orders
    WHERE country IN ('UAE','Egypt') AND asset_no IS NOT NULL AND btrim(asset_no) <> ''
),
vtype AS (
  SELECT country, asset_no, mode() WITHIN GROUP (ORDER BY vehicle_type) AS vehicle_type
  FROM public.tyre_records
  WHERE country IN ('UAE','Egypt') AND asset_no IS NOT NULL
    AND nullif(btrim(vehicle_type),'') IS NOT NULL
  GROUP BY country, asset_no
),
st AS (
  SELECT country, asset_no, mode() WITHIN GROUP (ORDER BY site) AS site FROM (
    SELECT country, asset_no, site FROM public.tyre_records
      WHERE country IN ('UAE','Egypt') AND nullif(btrim(site),'') IS NOT NULL
    UNION ALL
    SELECT country, asset_no, site FROM public.work_orders
      WHERE country IN ('UAE','Egypt') AND nullif(btrim(site),'') IS NOT NULL
  ) s GROUP BY country, asset_no
)
INSERT INTO public.vehicle_fleet (asset_no, country, vehicle_type, site, status, organisation_id)
SELECT a.asset_no, a.country, v.vehicle_type, st.site, 'Active',
       '00000000-0000-0000-0000-000000000001'::uuid
FROM assets a
LEFT JOIN vtype v USING (country, asset_no)
LEFT JOIN st    USING (country, asset_no)
WHERE NOT EXISTS (
  SELECT 1 FROM public.vehicle_fleet f
  WHERE f.asset_no = a.asset_no AND coalesce(f.country,'') = coalesce(a.country,'')
);

-- Reversible:
--   DELETE FROM public.vehicle_fleet WHERE country IN ('UAE','Egypt') AND status='Active';
--   DROP INDEX IF EXISTS public.vehicle_fleet_org_country_asset_uidx;
--   ALTER TABLE public.vehicle_fleet ADD CONSTRAINT vehicle_fleet_asset_no_key UNIQUE (asset_no);
