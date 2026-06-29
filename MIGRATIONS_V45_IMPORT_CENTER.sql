-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V45 — Multi-Country Data Intake Center: staging schema (DB foundation)
--
-- Additive, backward-compatible. Introduces the controlled import pipeline:
--   import_files → import_batches → import_batch_sheets → import_rows
--   (+ import_row_issues, mapping_profiles/rules, attachment_matches,
--    custom_field_catalog, import_audit_events)
--
-- Every original row/file is preserved; live tables are NOT touched here.
-- Org/country-scoped, RLS on every table, reusing V42/V43 helpers
-- (app_current_org(), is_approved_and_unlocked(), app_is_elevated()).
-- The existing pending_uploads table is left intact (legacy-readable).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Original uploaded files (bytes in a private bucket; DB holds metadata only)
CREATE TABLE IF NOT EXISTS public.import_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.organisations(id),
  country           text,
  company_id        uuid,
  storage_bucket    text NOT NULL DEFAULT 'import-files',
  storage_path      text NOT NULL,
  original_filename text NOT NULL,
  mime_type         text,
  size_bytes        bigint,
  sha256            text,
  source_system     text,
  retention_status  text NOT NULL DEFAULT 'retained',
  validation_status text NOT NULL DEFAULT 'pending',
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_files_path_uniq UNIQUE (storage_bucket, storage_path),
  CONSTRAINT import_files_sha_org_uniq UNIQUE (organisation_id, sha256)
);

-- 2. An import run for one sheet of one file, with full lifecycle counters
CREATE TABLE IF NOT EXISTS public.import_batches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.organisations(id),
  country             text NOT NULL,
  company_id          uuid,
  project             text,
  site                text,
  module              text NOT NULL,            -- fleet|tyre|stock|accident|inspection|workorder|warranty|supplier|driver|gatepass|integration|custom
  file_id             uuid REFERENCES public.import_files(id) ON DELETE CASCADE,
  sheet               text,
  source_system       text,
  header_row_detected int,
  header_row_confirmed int,
  mapping_profile_id  uuid,
  mapping_profile_version int,
  date_format         text,
  timezone            text,
  source_currency     text,
  unit_system         text,
  uploader            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewer            uuid,
  approver            uuid,
  approval_status     text NOT NULL DEFAULT 'draft',   -- draft|pending_approval|approved|rejected
  import_status       text NOT NULL DEFAULT 'staged',  -- staged|validating|ready|committing|committed|reversed|failed
  total_rows          int DEFAULT 0,
  ready_rows          int DEFAULT 0,
  warning_rows        int DEFAULT 0,
  error_rows          int DEFAULT 0,
  duplicate_rows      int DEFAULT 0,
  conflict_rows       int DEFAULT 0,
  imported_rows       int DEFAULT 0,
  skipped_rows        int DEFAULT 0,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  approved_at         timestamptz,
  completed_at        timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 3. Per-sheet identity within a multi-sheet workbook
CREATE TABLE IF NOT EXISTS public.import_batch_sheets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.organisations(id),
  batch_id        uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  sheet_name      text NOT NULL,
  sheet_order     int,
  header_row      int,
  total_rows      int DEFAULT 0,
  selected        boolean NOT NULL DEFAULT true,
  source_columns  jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 4. Every source row preserved individually (raw + mapped + transformed + custom)
CREATE TABLE IF NOT EXISTS public.import_rows (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.organisations(id),
  batch_id          uuid NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  sheet_name        text,
  source_row_no     int,
  raw_source_data   jsonb NOT NULL DEFAULT '{}'::jsonb,
  mapped_data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  transformed_data  jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_status text NOT NULL DEFAULT 'pending',  -- pending|ready|warning|error
  dup_status        text NOT NULL DEFAULT 'none',     -- none|duplicate|conflict
  action            text NOT NULL DEFAULT 'insert',   -- insert|update|skip|review|reject
  target_module     text,
  target_record_id  text,
  row_fingerprint   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz
);

-- 5. Row-level validation issues
CREATE TABLE IF NOT EXISTS public.import_row_issues (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.organisations(id),
  row_id           uuid NOT NULL REFERENCES public.import_rows(id) ON DELETE CASCADE,
  source_field     text,
  target_field     text,
  severity         text NOT NULL DEFAULT 'warning',   -- info|warning|error
  issue_code       text,
  message          text,
  original_value   text,
  transformed_value text,
  suggested_fix    text,
  resolved         boolean NOT NULL DEFAULT false,
  resolved_by      uuid,
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- 6. Reusable, versioned mapping profiles (identity = module+source+country+company+fingerprint+version)
CREATE TABLE IF NOT EXISTS public.import_mapping_profiles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.organisations(id),
  name              text NOT NULL,
  module            text NOT NULL,
  source_system     text,
  country           text,
  company_id        uuid,
  header_fingerprint text,
  date_format       text,
  timezone          text,
  source_currency   text,
  unit_settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  version           int NOT NULL DEFAULT 1,
  approved_by       uuid,
  active            boolean NOT NULL DEFAULT true,
  last_used_at      timestamptz,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- 7. Mapping rules per profile
CREATE TABLE IF NOT EXISTS public.import_mapping_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.organisations(id),
  profile_id      uuid NOT NULL REFERENCES public.import_mapping_profiles(id) ON DELETE CASCADE,
  source_header   text NOT NULL,
  target_field    text,                          -- null = preserve as custom / ignore-but-keep
  transform       jsonb NOT NULL DEFAULT '{}'::jsonb,
  alias_rule      jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence      numeric(5,2),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 8. Attachment (photo/document/ZIP) → record matching
CREATE TABLE IF NOT EXISTS public.import_attachment_matches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.organisations(id),
  batch_id           uuid REFERENCES public.import_batches(id) ON DELETE CASCADE,
  file_id            uuid REFERENCES public.import_files(id) ON DELETE CASCADE,
  match_key          text,
  match_kind         text,                        -- accident_no|claim_no|asset_no|source_doc|filename_pattern
  matched_entity_type text,
  matched_entity_id  text,
  status             text NOT NULL DEFAULT 'unmatched',
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- 9. Catalogue of unknown/custom fields seen across imports (promote-to-canonical insight)
CREATE TABLE IF NOT EXISTS public.custom_field_catalog (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.organisations(id),
  module           text NOT NULL,
  country          text,
  company_id       uuid,
  source_system    text,
  field_name       text NOT NULL,
  occurrence_count int NOT NULL DEFAULT 0,
  example_values   jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  mapping_status   text NOT NULL DEFAULT 'unmapped',  -- unmapped|mapped|promoted|archived
  recommendation   text
);
CREATE UNIQUE INDEX IF NOT EXISTS custom_field_catalog_uniq
  ON public.custom_field_catalog (organisation_id, module, (COALESCE(country,'')), field_name);

-- 10. Append-only audit of import actions
CREATE TABLE IF NOT EXISTS public.import_audit_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.organisations(id),
  batch_id        uuid REFERENCES public.import_batches(id) ON DELETE SET NULL,
  actor           uuid,
  action          text NOT NULL,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_import_files_org      ON public.import_files (organisation_id);
CREATE INDEX IF NOT EXISTS idx_import_files_sha      ON public.import_files (sha256);
CREATE INDEX IF NOT EXISTS idx_import_batches_org    ON public.import_batches (organisation_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_mod    ON public.import_batches (module, country);
CREATE INDEX IF NOT EXISTS idx_import_batches_status ON public.import_batches (import_status, approval_status);
CREATE INDEX IF NOT EXISTS idx_import_sheets_batch   ON public.import_batch_sheets (batch_id);
CREATE INDEX IF NOT EXISTS idx_import_rows_batch     ON public.import_rows (batch_id);
CREATE INDEX IF NOT EXISTS idx_import_rows_status    ON public.import_rows (validation_status, dup_status);
CREATE INDEX IF NOT EXISTS idx_import_rows_fp        ON public.import_rows (row_fingerprint);
CREATE INDEX IF NOT EXISTS idx_import_issues_row     ON public.import_row_issues (row_id);
CREATE INDEX IF NOT EXISTS idx_import_profiles_key   ON public.import_mapping_profiles (module, country, header_fingerprint, version);
CREATE INDEX IF NOT EXISTS idx_import_rules_profile  ON public.import_mapping_rules (profile_id);
CREATE INDEX IF NOT EXISTS idx_import_attach_batch   ON public.import_attachment_matches (batch_id);
CREATE INDEX IF NOT EXISTS idx_custom_fields_mod     ON public.custom_field_catalog (module, country);
CREATE INDEX IF NOT EXISTS idx_import_audit_batch    ON public.import_audit_events (batch_id);

-- updated_at trigger on batches
DROP TRIGGER IF EXISTS trg_import_batches_touch ON public.import_batches;
CREATE TRIGGER trg_import_batches_touch BEFORE UPDATE ON public.import_batches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── RLS: org isolation (restrictive) + sensible permissive policies on all 10 tables ──
DO $$
DECLARE
  t text;
  import_tables text[] := ARRAY[
    'import_files','import_batches','import_batch_sheets','import_rows','import_row_issues',
    'import_mapping_profiles','import_mapping_rules','import_attachment_matches',
    'custom_field_catalog','import_audit_events'
  ];
BEGIN
  FOREACH t IN ARRAY import_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- restrictive org isolation
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_org_isolation', t);
    EXECUTE format($p$
      CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
        USING (organisation_id IS NULL OR organisation_id = public.app_current_org())
        WITH CHECK (organisation_id IS NULL OR organisation_id = public.app_current_org())
    $p$, t||'_org_isolation', t);
    -- permissive read for any authenticated user (org-restrictive ANDs)
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t||'_read', t);
    -- permissive write (insert/update) for approved+unlocked users
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_write', t);
    EXECUTE format($p$
      CREATE POLICY %I ON public.%I FOR ALL TO authenticated
        USING (public.is_approved_and_unlocked())
        WITH CHECK (public.is_approved_and_unlocked())
    $p$, t||'_write', t);
  END LOOP;
END $$;

-- ── Private storage bucket for original import files ──
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('import-files','import-files', false, 104857600)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS import_files_auth_read   ON storage.objects;
DROP POLICY IF EXISTS import_files_auth_insert ON storage.objects;
DROP POLICY IF EXISTS import_files_auth_delete ON storage.objects;
CREATE POLICY import_files_auth_read   ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'import-files');
CREATE POLICY import_files_auth_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'import-files');
CREATE POLICY import_files_auth_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'import-files' AND public.app_is_elevated());
