-- ============================================================================
-- MIGRATIONS_V59_STORAGE_HARDENING.sql
-- Storage security sweep (live-verified against storage.buckets/pg_policies).
--
--  1. LEAK: policy `public_read_accident_photos` granted SELECT on
--     accident-photos objects to the PUBLIC role — anyone with the anon key
--     could download accident photos (injuries, plates) through the storage
--     API despite the bucket being "private". Drop it; authenticated read
--     remains via `accident_photos_auth_read`.
--  2. Loose INSERTs: two redundant accident-photos INSERT policies
--     (`accident_photos_auth_insert`, `auth_insert_accident_photos`) had no
--     app_is_active() gate, so a LOCKED account could still upload. Drop both;
--     the canonical `Authenticated photo uploads` policy already covers
--     accident-photos AND requires app_is_active().
--  3. Bucket limits: tyre-photos had NO size limit and NO mime restriction →
--     cap at 20 MB, images only (matches the clients' MAX_PHOTO_BYTES and the
--     only content types they ever send). accident-photos raised 10→20 MB so
--     the bucket matches the mobile client's 20 MB allowance (a 12 MB photo
--     passed the client check then failed the bucket).
--
-- Rollback:
--   CREATE POLICY public_read_accident_photos ON storage.objects FOR SELECT TO public USING (bucket_id = 'accident-photos');
--   CREATE POLICY accident_photos_auth_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'accident-photos');
--   CREATE POLICY auth_insert_accident_photos ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'accident-photos');
--   UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL WHERE id = 'tyre-photos';
--   UPDATE storage.buckets SET file_size_limit = 10485760 WHERE id = 'accident-photos';
-- ============================================================================

DROP POLICY IF EXISTS public_read_accident_photos ON storage.objects;
DROP POLICY IF EXISTS accident_photos_auth_insert ON storage.objects;
DROP POLICY IF EXISTS auth_insert_accident_photos ON storage.objects;

UPDATE storage.buckets
SET file_size_limit = 20971520,
    allowed_mime_types = ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/heic']
WHERE id = 'tyre-photos';

UPDATE storage.buckets
SET file_size_limit = 20971520
WHERE id = 'accident-photos';
