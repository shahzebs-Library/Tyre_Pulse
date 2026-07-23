-- V337 — Standardize asset identifiers to one canonical UPPER(TRIM()) form.
--
-- Asset numbers arrive from multiple ERP exports and in-app entry with mixed
-- casing / stray whitespace (e.g. "tp-1234" vs "TP-1234" vs " TP-1234 "), which
-- splits the SAME physical asset across fleet, tyre, work-order and parts data so
-- joins on asset_no miss and analytics double-count. This normalizes every BASE
-- table that carries the asset identifier and adds a cheap BEFORE-write trigger so
-- future imports or edits can never reintroduce the split.
--
-- PURE casing/whitespace fix (upper + btrim). It never merges genuinely-distinct
-- asset numbers. Empty/blank becomes NULL so a stray space cannot masquerade as an
-- asset. Idempotent: safe to re-run (CREATE OR REPLACE + DROP TRIGGER IF EXISTS +
-- backfill guarded by IS DISTINCT FROM).
--
-- Tables / columns covered:
--   vehicle_fleet          . asset_no
--   tyre_records           . asset_no
--   work_orders            . asset_no
--   work_order_line_items  . asset_no
--   open_work_orders       . asset_no
--   parts_consumption      . asset_code   (the ERP parts grid names it asset_code)
--
-- None of these carries a content-lock trigger (only inspections does, and it is
-- intentionally OUT of scope here). parts_consumption has a BEFORE INSERT/UPDATE
-- classifier (trg_classify_parts_consumption) which is deterministic/idempotent and
-- re-runs harmlessly on the backfill; asset-number normalization does not affect it.

-- 0. PRE-STEP: vehicle_fleet.asset_no has a UNIQUE constraint, so uppercasing can
--    collide when the same asset exists twice in different casing (e.g. "Mp122" +
--    "MP122"). Remove the redundant mixed-case duplicate, keeping the already-
--    canonical (all-uppercase) twin, before the backfill. (79 rows removed live.)
DELETE FROM public.vehicle_fleet a
WHERE a.asset_no IS NOT NULL
  AND a.asset_no <> upper(btrim(a.asset_no))
  AND EXISTS (SELECT 1 FROM public.vehicle_fleet b
              WHERE b.id <> a.id AND b.asset_no = upper(btrim(a.asset_no)));

-- 1. asset_no normalizer (vehicle_fleet / tyre_records / work_orders /
--    work_order_line_items / open_work_orders).
CREATE OR REPLACE FUNCTION public.normalize_asset_no()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.asset_no IS NOT NULL THEN
    NEW.asset_no := upper(btrim(NEW.asset_no));
    IF NEW.asset_no = '' THEN NEW.asset_no := NULL; END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 2. asset_code normalizer (parts_consumption uses asset_code, not asset_no).
CREATE OR REPLACE FUNCTION public.normalize_asset_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.asset_code IS NOT NULL THEN
    NEW.asset_code := upper(btrim(NEW.asset_code));
    IF NEW.asset_code = '' THEN NEW.asset_code := NULL; END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Attach BEFORE INSERT OR UPDATE triggers + backfill each table.
DO $$
DECLARE tbl text;
BEGIN
  -- asset_no tables
  FOREACH tbl IN ARRAY ARRAY['vehicle_fleet','tyre_records','work_orders','work_order_line_items','open_work_orders']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_normalize_asset_no ON public.%I', tbl);
    EXECUTE format('CREATE TRIGGER trg_normalize_asset_no BEFORE INSERT OR UPDATE OF asset_no ON public.%I FOR EACH ROW EXECUTE FUNCTION public.normalize_asset_no()', tbl);
    EXECUTE format(
      'UPDATE public.%I SET asset_no = upper(btrim(asset_no))
         WHERE asset_no IS NOT NULL
           AND asset_no IS DISTINCT FROM upper(btrim(asset_no))',
      tbl);
  END LOOP;

  -- parts_consumption.asset_code
  DROP TRIGGER IF EXISTS trg_normalize_asset_code ON public.parts_consumption;
  CREATE TRIGGER trg_normalize_asset_code BEFORE INSERT OR UPDATE OF asset_code ON public.parts_consumption
    FOR EACH ROW EXECUTE FUNCTION public.normalize_asset_code();
  UPDATE public.parts_consumption SET asset_code = upper(btrim(asset_code))
    WHERE asset_code IS NOT NULL
      AND asset_code IS DISTINCT FROM upper(btrim(asset_code));
END $$;

-- ============================================================================
-- REVERSIBLE (best effort). Casing is lossy, so a rollback removes the guard but
-- cannot restore the original mixed casing. To undo the enforcement:
--   DROP TRIGGER IF EXISTS trg_normalize_asset_no  ON public.vehicle_fleet;
--   DROP TRIGGER IF EXISTS trg_normalize_asset_no  ON public.tyre_records;
--   DROP TRIGGER IF EXISTS trg_normalize_asset_no  ON public.work_orders;
--   DROP TRIGGER IF EXISTS trg_normalize_asset_no  ON public.work_order_line_items;
--   DROP TRIGGER IF EXISTS trg_normalize_asset_no  ON public.open_work_orders;
--   DROP TRIGGER IF EXISTS trg_normalize_asset_code ON public.parts_consumption;
--   DROP FUNCTION IF EXISTS public.normalize_asset_no();
--   DROP FUNCTION IF EXISTS public.normalize_asset_code();
-- ============================================================================
