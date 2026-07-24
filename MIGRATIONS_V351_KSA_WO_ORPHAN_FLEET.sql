-- V351 — KSA work-order/tyre orphan-asset fleet backfill
-- Mirrors V348 (UAE/Egypt derived fleet). Green Concrete Company, org Company A.
--
-- PROBLEM: KSA work_orders reference 415 distinct asset numbers that have NO row
-- in vehicle_fleet, so ~9023 KSA work-order rows link 0% to a fleet record
-- (KSA WO link was 50423/59446 = 84.82%). Plus 1 KSA tyre_records asset also
-- missing from the fleet register.
--
-- FIX: DERIVE a fleet register row for each DISTINCT KSA asset number that
-- appears in work_orders (or tyre_records) but is missing from vehicle_fleet:
--   vehicle_type = mode() of tyre_records.vehicle_type for that (KSA, asset_no)
--   site         = mode() of site across tyre_records + work_orders for that asset
--   status       = 'Active'
--   organisation_id = Company A
-- These are WO/tyre-DERIVED rows (no dedicated flag column — none added). The
-- customer can later enrich them via the importer (merge inserts only new).
--
-- SAFETY: INSERT only (non-destructive, idempotent). NOT EXISTS guard on
-- (asset_no, country='KSA') + the V348 unique index
-- vehicle_fleet_org_country_asset_uidx serialize against duplicates. Existing
-- 604 KSA fleet rows and all UAE/Egypt rows are UNTOUCHED. The V337 normalize
-- trigger uppercases asset_no on insert; the org-stamp + plan-limit triggers are
-- inert for Company A.
--
-- REVERSIBILITY: no blanket KSA delete is provided — KSA already had 604 real
-- fleet rows before this migration, so a country-wide delete would be unsafe.
-- The rows added here are exactly the DISTINCT KSA asset numbers that were
-- present in work_orders/tyre_records but absent from vehicle_fleet at apply
-- time; they carry status='Active' and are identifiable as the WO/tyre-derived
-- register (see the derivation CTE below).

BEGIN;

WITH src AS (
  -- DISTINCT KSA asset numbers referenced by work_orders or tyre_records
  SELECT DISTINCT upper(btrim(asset_no)) AS asset_no
  FROM (
    SELECT asset_no FROM public.work_orders
    WHERE country = 'KSA' AND coalesce(btrim(asset_no), '') <> ''
    UNION
    SELECT asset_no FROM public.tyre_records
    WHERE country = 'KSA' AND coalesce(btrim(asset_no), '') <> ''
  ) u
),
missing AS (
  -- ...that are NOT already in vehicle_fleet for KSA
  SELECT s.asset_no
  FROM src s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.vehicle_fleet f
    WHERE f.country = 'KSA' AND f.asset_no = s.asset_no
  )
),
vt AS (
  -- mode() vehicle_type from KSA tyre_records
  SELECT upper(btrim(asset_no)) AS asset_no,
         mode() WITHIN GROUP (ORDER BY vehicle_type) AS vehicle_type
  FROM public.tyre_records
  WHERE country = 'KSA' AND coalesce(btrim(asset_no), '') <> ''
    AND coalesce(btrim(vehicle_type), '') <> ''
  GROUP BY 1
),
st AS (
  -- mode() site across KSA tyre_records + work_orders
  SELECT upper(btrim(asset_no)) AS asset_no,
         mode() WITHIN GROUP (ORDER BY site) AS site
  FROM (
    SELECT asset_no, site FROM public.tyre_records
    WHERE country = 'KSA' AND coalesce(btrim(asset_no), '') <> ''
      AND coalesce(btrim(site), '') <> ''
    UNION ALL
    SELECT asset_no, site FROM public.work_orders
    WHERE country = 'KSA' AND coalesce(btrim(asset_no), '') <> ''
      AND coalesce(btrim(site), '') <> ''
  ) s
  GROUP BY 1
)
INSERT INTO public.vehicle_fleet (asset_no, country, vehicle_type, site, status, organisation_id)
SELECT m.asset_no,
       'KSA',
       vt.vehicle_type,
       st.site,
       'Active',
       '00000000-0000-0000-0000-000000000001'::uuid
FROM missing m
LEFT JOIN vt ON vt.asset_no = m.asset_no
LEFT JOIN st ON st.asset_no = m.asset_no
ON CONFLICT (organisation_id, country, asset_no) DO NOTHING;

COMMIT;
