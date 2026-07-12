-- ============================================================================
-- MIGRATIONS_V128 — tyre-photos storage read policy
-- ============================================================================
-- The private `tyre-photos` bucket (shared by tyre inspections and checklist
-- submissions) had INSERT and UPDATE policies on storage.objects but NO SELECT
-- policy. As a result authenticated users could not read objects, so
-- createSignedUrl() was denied by RLS and checklist photos rendered as
-- "image unavailable" in the app and PDF report.
--
-- Add a read policy mirroring the other private photo buckets
-- (inspection-photos / accident-photos / vehicle-photos), enabling signed-URL
-- access for any authenticated member.
--
-- Idempotent and safe to re-run.
-- ============================================================================

DROP POLICY IF EXISTS tyre_photos_read ON storage.objects;
CREATE POLICY tyre_photos_read ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'tyre-photos');

-- Reversible:
--   DROP POLICY IF EXISTS tyre_photos_read ON storage.objects;
