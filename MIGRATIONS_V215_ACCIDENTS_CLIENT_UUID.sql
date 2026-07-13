-- ============================================================================
-- MIGRATIONS_V215 — Offline idempotency key on accidents
-- ============================================================================
-- The mobile accident report is a FIELD flow (crashes happen where signal is
-- weak), yet it was the only capture that inserted directly instead of through
-- the offline-safe record queue. To route it through the queue like every other
-- write, accidents needs the same client_uuid the queue upserts on
-- (onConflict=client_uuid, ignoreDuplicates), so a replayed insert after a
-- dropped connection is a no-op rather than a duplicate incident.
--
-- Purely additive; a partial unique index treats NULLs as distinct so rows
-- created any other way (web, ERP) are unaffected. Idempotent.
-- ============================================================================

ALTER TABLE public.accidents ADD COLUMN IF NOT EXISTS client_uuid text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_accidents_client_uuid
  ON public.accidents (client_uuid) WHERE client_uuid IS NOT NULL;

-- Reversible:
--   DROP INDEX IF EXISTS public.ux_accidents_client_uuid;
--   ALTER TABLE public.accidents DROP COLUMN IF EXISTS client_uuid;
