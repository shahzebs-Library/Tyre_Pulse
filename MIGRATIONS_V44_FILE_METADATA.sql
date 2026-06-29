-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V44 — file_metadata (per-file authority record)
--
-- Every uploaded business file (inspection/accident photo, document) gets a DB
-- row recording owner, organisation, the entity it belongs to, bucket+path,
-- type and size. The DB row — not a URL — is the source of truth; files stay in
-- PRIVATE buckets and are served via short-lived signed URLs. Org-scoped via the
-- same V42/V43 pattern, so file metadata is tenant-isolated like every other
-- business table. Additive; depends on V42 (organisations + app_current_org()).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.file_metadata (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'
                    REFERENCES public.organisations(id),
  owner_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_type     text NOT NULL,          -- e.g. 'accident' | 'inspection' | 'tyre'
  entity_id       text,                   -- the owning record's id
  bucket          text NOT NULL,          -- e.g. 'accident-photos'
  path            text NOT NULL,          -- storage object key
  content_type    text,
  size_bytes      bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT file_metadata_bucket_path_uniq UNIQUE (bucket, path),
  CONSTRAINT file_metadata_size_chk CHECK (size_bytes IS NULL OR (size_bytes >= 0 AND size_bytes <= 104857600)),
  CONSTRAINT file_metadata_ct_chk CHECK (content_type IS NULL OR content_type IN
    ('image/jpeg','image/jpg','image/png','image/webp','image/heic','image/heif','application/pdf'))
);

CREATE INDEX IF NOT EXISTS idx_file_metadata_org    ON public.file_metadata (organisation_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_entity ON public.file_metadata (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_owner  ON public.file_metadata (owner_id);

ALTER TABLE public.file_metadata ENABLE ROW LEVEL SECURITY;

-- Restrictive org isolation (same pattern as V43) — ANDs on top of the permissive
-- policies below; NULL org permitted for legacy/uncategorised.
DROP POLICY IF EXISTS file_metadata_org_isolation ON public.file_metadata;
CREATE POLICY file_metadata_org_isolation ON public.file_metadata
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (organisation_id IS NULL OR organisation_id = public.app_current_org())
  WITH CHECK (organisation_id IS NULL OR organisation_id = public.app_current_org());

-- Permissive: authenticated read; insert only your own files; delete own or elevated.
DROP POLICY IF EXISTS file_metadata_read   ON public.file_metadata;
DROP POLICY IF EXISTS file_metadata_insert ON public.file_metadata;
DROP POLICY IF EXISTS file_metadata_delete ON public.file_metadata;
CREATE POLICY file_metadata_read   ON public.file_metadata FOR SELECT TO authenticated USING (true);
CREATE POLICY file_metadata_insert ON public.file_metadata FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND public.is_approved_and_unlocked());
CREATE POLICY file_metadata_delete ON public.file_metadata FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR public.app_is_elevated());

COMMENT ON TABLE public.file_metadata IS
  'Authority record per uploaded business file (private bucket + path). Org-scoped; files served via short-lived signed URLs, never public URLs.';
