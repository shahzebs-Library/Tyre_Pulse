-- =============================================================================
-- MIGRATIONS_V271_WASH_MOBILE.sql
-- Vehicle Washing - mobile driver support.
--
-- What this does:
--   1. ADD wash_records.photos jsonb (categorized/multi wash photos captured by
--      the mobile driver screen; mirrors the photos column on other field
--      tables). NOT NULL DEFAULT '[]' so existing rows are valid immediately.
--   2. ADD wash_records.client_uuid uuid + a UNIQUE index so the mobile record
--      queue can upsert idempotently (a lost response / offline retry can never
--      create a duplicate wash). Mirrors odometer_logs (V213) / accidents (V215).
--   3. WIDEN the INSERT policy so DRIVERS can log a wash from the mobile app
--      (previously Admin/Manager/Director only). UPDATE and DELETE stay
--      elevated-only, so a driver can create a wash record but not edit or
--      remove one - matching how mobile field writes work elsewhere.
--
-- Blast radius: two additive columns + a single INSERT policy widened by one
-- role. Depends only on the existing wash_records table (V270) and get_my_role().
-- Idempotent: ADD COLUMN / CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS.
-- Reversible: see the footer.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Photos + idempotency columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.wash_records
  ADD COLUMN IF NOT EXISTS photos      jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS client_uuid text;

-- One wash per client-generated id: lets the offline queue's ON CONFLICT
-- (client_uuid) upsert swallow a replayed insert instead of creating a second
-- row. A plain (non-partial) unique index so ON CONFLICT (client_uuid) matches
-- it; NULLs are distinct in a unique index, so historical rows (client_uuid
-- NULL) coexist freely. Mirrors odometer_logs (V213) / accidents (V215).
CREATE UNIQUE INDEX IF NOT EXISTS wash_records_client_uuid_uidx
  ON public.wash_records (client_uuid);

-- ---------------------------------------------------------------------------
-- 2. Widen INSERT to include drivers (write-only; no UPDATE/DELETE grant)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS wash_records_insert ON public.wash_records;
CREATE POLICY wash_records_insert ON public.wash_records
  FOR INSERT WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director','driver'));

-- UPDATE / DELETE intentionally unchanged (elevated roles only):
--   wash_records_update  -> Admin / Manager / Director
--   wash_records_delete  -> Admin / Manager / Director
-- The RESTRICTIVE org / country / site isolation policies from V270 still apply
-- on top of this, so a driver only ever writes within their own scope.

-- =============================================================================
-- Reversal (manual):
--   DROP POLICY IF EXISTS wash_records_insert ON public.wash_records;
--   CREATE POLICY wash_records_insert ON public.wash_records
--     FOR INSERT WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));
--   DROP INDEX IF EXISTS public.wash_records_client_uuid_uidx;
--   ALTER TABLE public.wash_records DROP COLUMN IF EXISTS client_uuid;
--   ALTER TABLE public.wash_records DROP COLUMN IF EXISTS photos;
-- =============================================================================
