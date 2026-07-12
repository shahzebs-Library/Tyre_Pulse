-- ============================================================================
-- MIGRATIONS_V125 — client_uuid on checklist_submissions (mobile idempotency)
-- ============================================================================
-- The mobile record queue (V81 pattern) inserts every row with a stable
-- client_uuid and upserts on it (onConflict=client_uuid, ignoreDuplicates), so a
-- lost response / crash / offline replay can never create a duplicate. Mobile
-- checklist submissions need the same column + unique index to participate.
-- Additive and idempotent.
-- ============================================================================
ALTER TABLE public.checklist_submissions ADD COLUMN IF NOT EXISTS client_uuid text;
CREATE UNIQUE INDEX IF NOT EXISTS ux_checklist_submissions_client_uuid
  ON public.checklist_submissions (client_uuid) WHERE client_uuid IS NOT NULL;

-- Reversible:
--   DROP INDEX IF EXISTS public.ux_checklist_submissions_client_uuid;
--   ALTER TABLE public.checklist_submissions DROP COLUMN IF EXISTS client_uuid;
