-- ============================================================================
-- MIGRATIONS_V110 — organisation_id default = app_current_org() (multi-org fix)
-- ============================================================================
-- The org-isolation RLS on every business/intake table is RESTRICTIVE:
--
--   (organisation_id IS NULL OR organisation_id = app_current_org() OR app_is_org_admin())
--
-- i.e. an inserted row's organisation_id MUST equal the caller's org. But those
-- tables were created (V45 and earlier) with a hardcoded default of the Default
-- Organisation ('…0001'). Any user who belongs to a DIFFERENT org (e.g. a KSA
-- user) therefore fails the RESTRICTIVE WITH CHECK on every insert: the row
-- defaults to '…0001' ≠ their org. In the Data Intake Center this surfaced as a
-- batch that never persisted, so staging its rows failed with
-- `import_rows_batch_id_fkey` (the parent batch was rejected by RLS).
--
-- Fix: default organisation_id to app_current_org() — the caller's own org —
-- exactly like the V42 foundation intended and like V108/V109 already do. For
-- users in the Default Org this is identical to today ('…0001'); for everyone
-- else their rows now land in their own org and satisfy the policy. Defaults
-- only affect NEW inserts; existing rows are untouched.
--
-- Idempotent: re-running only re-points defaults that still reference '…0001'.
-- ============================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'organisation_id'
      AND column_default LIKE '%00000000-0000-0000-0000-000000000001%'
    ORDER BY table_name
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN organisation_id SET DEFAULT public.app_current_org()',
      t
    );
    RAISE NOTICE 'org default -> app_current_org() on public.%', t;
  END LOOP;
END $$;
