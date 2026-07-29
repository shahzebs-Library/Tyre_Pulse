-- =====================================================================================
-- MIGRATIONS_V422_FUTURE_REMOVAL_DATE_FIX.sql
-- =====================================================================================
-- STATUS: AUTHORED, NOT YET APPLIED.
--   Requires a Supabase-MCP-authorized session (project jhssdmeruxtrlqnwfksc) to run.
--   The DB is not reachable from this authoring session, so this is a ready-to-apply
--   ARTIFACT only. Re-confirm the next free migration number at apply time
--   (V417/V418 are RESERVED by the accident-module design; V419 is taken; this file
--   claims V422 -- verify nothing between has consumed it before applying).
--
-- PURPOSE (data hygiene, not a KPI fix)
--   A live audit found exactly 3 tyre_records rows carrying a FUTURE removal_date
--   (max 2026-11-10), all UAE, org Company A (00000000-0000-0000-0000-000000000001).
--   A tyre cannot have been removed on a date that has not happened yet: this is a
--   known data-entry typo cluster (the year keyed forward). It is NOT currently
--   corrupting KPIs -- fleet_km_by_asset already excludes future-dated rows, and the
--   tyre-life / CPK maths (src/lib/tyreBay.js tyreLifeKm) reads km_at_removal /
--   km_at_fitment / total_km, never removal_date -- but the impossible value should
--   not sit in the record.
--
-- FIX CHOSEN: Option A (null out the impossible value).
--   SET removal_date = NULL for the affected rows, leaving status, km_at_removal and
--   total_km AS-IS. Rationale:
--     * PROJECT_MEMORY philosophy: never fabricate a date. A future removal_date is
--       not a real removal date, and there is NO safe signal in the data to infer the
--       intended past date (no corroborating removal km/reason that pins a real day),
--       so guessing a specific corrected date would invent a fact. Option B is
--       therefore rejected here -- it is not defensible without strong evidence.
--     * Nulling ONLY removal_date is honest ("removal date unknown/erroneous") and is
--       the least-invasive correct action: it removes the impossible datum without
--       claiming a replacement truth.
--     * The tyre stays correctly classified as off-vehicle. src/lib/tyrePool.js
--       (isRemovedOrScrapped) marks a row removed when it carries removal_date OR
--       km_at_removal OR a removed/scrapped status -- km_at_removal and status are
--       preserved, so the tyre is NOT silently promoted back into the active pool.
--     * No re-derivation of life/CPK is affected (those never read removal_date).
--
-- SCOPING SAFETY
--   The UPDATE is bounded so it can never touch more than the impossible-future rows:
--     country = 'UAE'
--     AND removal_date > current_date          -- the impossible datum, definitionally
--     AND organisation_id = '00000000-0000-0000-0000-000000000001'   -- Company A
--   Expected affected rows: 3 (audit ground truth). The verification block below
--   RAISES if the pre-count is not exactly 3, so an unexpected data shape aborts the
--   run instead of silently changing more (or fewer) rows.
--
-- REVERSIBILITY / ROLLBACK
--   Every affected row is snapshotted IN FULL (id, removal_date, km_at_removal,
--   total_km, status) into _bak.tyre_future_removal_v422 BEFORE any change. To undo
--   after apply, restore removal_date from the snapshot:
--
--     UPDATE public.tyre_records t
--        SET removal_date = s.removal_date
--       FROM _bak.tyre_future_removal_v422 s
--      WHERE t.id = s.id;
--     -- (optional) DROP TABLE _bak.tyre_future_removal_v422;
--
--   Nothing else is mutated, so this restores the exact prior state.
--
-- No em/en dashes are used in emitted (verification/notice) text.
-- =====================================================================================

BEGIN;

-- ------------------------------------------------------------------------------------
-- 0. Snapshot schema (idempotent; _bak already exists from prior migrations).
-- ------------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS _bak;

-- ------------------------------------------------------------------------------------
-- 1. Snapshot the affected rows BEFORE changing anything (reversible).
--    Snapshot uses the SAME scoping predicate as the fix, so it captures exactly the
--    rows the UPDATE will touch and nothing else.
-- ------------------------------------------------------------------------------------
DROP TABLE IF EXISTS _bak.tyre_future_removal_v422;

CREATE TABLE _bak.tyre_future_removal_v422 AS
SELECT
  id,
  removal_date,
  km_at_removal,
  total_km,
  status
FROM public.tyre_records
WHERE country = 'UAE'
  AND removal_date > current_date
  AND organisation_id = '00000000-0000-0000-0000-000000000001'::uuid;

-- ------------------------------------------------------------------------------------
-- 2. Guard: abort unless the snapshot captured exactly the 3 audited rows.
--    (A future run that finds 0 rows already fixed, or a different count, should stop
--    and be re-audited rather than proceed.)
-- ------------------------------------------------------------------------------------
DO $guard$
DECLARE
  v_snap  integer;
BEGIN
  SELECT count(*) INTO v_snap FROM _bak.tyre_future_removal_v422;
  IF v_snap <> 3 THEN
    RAISE EXCEPTION
      'V422 aborted: expected exactly 3 UAE Company A rows with a future removal_date, found %. Re-audit before applying.',
      v_snap;
  END IF;
  RAISE NOTICE 'V422 snapshot captured % row(s) into _bak.tyre_future_removal_v422.', v_snap;
END
$guard$;

-- ------------------------------------------------------------------------------------
-- 3. Verification (BEFORE): count of future-removal rows in scope should be 3.
-- ------------------------------------------------------------------------------------
SELECT
  'before' AS phase,
  count(*) AS future_removal_rows
FROM public.tyre_records
WHERE country = 'UAE'
  AND removal_date > current_date
  AND organisation_id = '00000000-0000-0000-0000-000000000001'::uuid;

-- ------------------------------------------------------------------------------------
-- 4. Apply Option A: null out the impossible future removal_date only.
--    status / km_at_removal / total_km left untouched.
-- ------------------------------------------------------------------------------------
UPDATE public.tyre_records
   SET removal_date = NULL
 WHERE country = 'UAE'
   AND removal_date > current_date
   AND organisation_id = '00000000-0000-0000-0000-000000000001'::uuid;

-- ------------------------------------------------------------------------------------
-- 5. Verification (AFTER): count of future-removal rows in scope should now be 0,
--    and the number of rows we nulled should equal the snapshot count (3).
-- ------------------------------------------------------------------------------------
SELECT
  'after' AS phase,
  count(*) AS future_removal_rows
FROM public.tyre_records
WHERE country = 'UAE'
  AND removal_date > current_date
  AND organisation_id = '00000000-0000-0000-0000-000000000001'::uuid;

DO $verify$
DECLARE
  v_remaining integer;
  v_nulled    integer;
BEGIN
  SELECT count(*) INTO v_remaining
    FROM public.tyre_records
   WHERE country = 'UAE'
     AND removal_date > current_date
     AND organisation_id = '00000000-0000-0000-0000-000000000001'::uuid;

  -- rows now NULL that were snapshotted = the rows this migration corrected
  SELECT count(*) INTO v_nulled
    FROM public.tyre_records t
    JOIN _bak.tyre_future_removal_v422 s ON s.id = t.id
   WHERE t.removal_date IS NULL;

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'V422 post-check failed: % future-removal row(s) still in scope.', v_remaining;
  END IF;
  IF v_nulled <> 3 THEN
    RAISE EXCEPTION 'V422 post-check failed: expected 3 corrected rows, found %.', v_nulled;
  END IF;

  RAISE NOTICE 'V422 OK: future removal_date rows 3 -> 0; % row(s) corrected (removal_date set NULL, status/km preserved).', v_nulled;
END
$verify$;

COMMIT;

-- =====================================================================================
-- POST-APPLY (optional, run separately to confirm the corrected rows still read as
-- off-vehicle via km_at_removal / status -- proves Option A did not re-activate them):
--
--   SELECT t.id, t.status, t.km_at_removal, t.total_km, t.removal_date
--     FROM public.tyre_records t
--     JOIN _bak.tyre_future_removal_v422 s ON s.id = t.id;
-- =====================================================================================
