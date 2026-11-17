-- OEM illustrated parts manuals and extracted part-number index.
-- This is reference data, separate from parts_catalog inventory balances.

CREATE TABLE IF NOT EXISTS public.oem_parts_manuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
  country text,
  manufacturer text NOT NULL,
  model text NOT NULL,
  model_code text,
  equipment_no text,
  chassis_from text,
  chassis_to text,
  source_file_name text NOT NULL,
  source_sha256 text NOT NULL,
  storage_path text,
  page_count integer NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  extraction_status text NOT NULL DEFAULT 'processing'
    CHECK (extraction_status IN ('processing','ready','needs_review','failed')),
  import_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oem_parts_manuals_org_sha_key UNIQUE (organisation_id, source_sha256)
);

CREATE TABLE IF NOT EXISTS public.oem_parts_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
  country text,
  manual_id uuid NOT NULL REFERENCES public.oem_parts_manuals(id) ON DELETE CASCADE,
  source_pdf_page integer NOT NULL CHECK (source_pdf_page > 0),
  row_order integer NOT NULL CHECK (row_order > 0),
  assembly_heading text,
  printed_page text,
  index_no text,
  parent_index text,
  part_no text NOT NULL,
  part_no_normalized text GENERATED ALWAYS AS (regexp_replace(upper(part_no), '[^A-Z0-9]', '', 'g')) STORED,
  description text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(part_no, '') || ' ' || coalesce(description, '') || ' ' || coalesce(assembly_heading, ''))
  ) STORED,
  remark text,
  quantity numeric,
  see_page text,
  illustration_pdf_page integer CHECK (illustration_pdf_page IS NULL OR illustration_pdf_page > 0),
  row_type text NOT NULL DEFAULT 'catalog_item'
    CHECK (row_type IN ('catalog_item','variant','alternate_part')),
  source_line text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oem_parts_entries_manual_line_key UNIQUE (manual_id, source_pdf_page, row_order)
);

CREATE INDEX IF NOT EXISTS oem_parts_manuals_org_model_idx
  ON public.oem_parts_manuals (organisation_id, lower(manufacturer), lower(model));
CREATE INDEX IF NOT EXISTS oem_parts_manuals_equipment_idx
  ON public.oem_parts_manuals (organisation_id, equipment_no);
CREATE INDEX IF NOT EXISTS oem_parts_entries_org_part_idx
  ON public.oem_parts_entries (organisation_id, part_no_normalized);
CREATE INDEX IF NOT EXISTS oem_parts_entries_manual_page_idx
  ON public.oem_parts_entries (manual_id, source_pdf_page, row_order);
CREATE INDEX IF NOT EXISTS oem_parts_entries_description_fts_idx
  ON public.oem_parts_entries USING gin (search_vector);

DROP TRIGGER IF EXISTS set_updated_at_oem_parts_manuals ON public.oem_parts_manuals;
CREATE TRIGGER set_updated_at_oem_parts_manuals
  BEFORE UPDATE ON public.oem_parts_manuals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.oem_parts_manuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oem_parts_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS oem_parts_manuals_org_isolation ON public.oem_parts_manuals;
CREATE POLICY oem_parts_manuals_org_isolation ON public.oem_parts_manuals
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());
DROP POLICY IF EXISTS oem_parts_manuals_read ON public.oem_parts_manuals;
CREATE POLICY oem_parts_manuals_read ON public.oem_parts_manuals FOR SELECT
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS oem_parts_manuals_insert ON public.oem_parts_manuals;
CREATE POLICY oem_parts_manuals_insert ON public.oem_parts_manuals FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));
DROP POLICY IF EXISTS oem_parts_manuals_update ON public.oem_parts_manuals;
CREATE POLICY oem_parts_manuals_update ON public.oem_parts_manuals FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));
DROP POLICY IF EXISTS oem_parts_manuals_delete ON public.oem_parts_manuals;
CREATE POLICY oem_parts_manuals_delete ON public.oem_parts_manuals FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS oem_parts_entries_org_isolation ON public.oem_parts_entries;
CREATE POLICY oem_parts_entries_org_isolation ON public.oem_parts_entries
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());
DROP POLICY IF EXISTS oem_parts_entries_read ON public.oem_parts_entries;
CREATE POLICY oem_parts_entries_read ON public.oem_parts_entries FOR SELECT
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS oem_parts_entries_insert ON public.oem_parts_entries;
CREATE POLICY oem_parts_entries_insert ON public.oem_parts_entries FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));
DROP POLICY IF EXISTS oem_parts_entries_update ON public.oem_parts_entries;
CREATE POLICY oem_parts_entries_update ON public.oem_parts_entries FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));
DROP POLICY IF EXISTS oem_parts_entries_delete ON public.oem_parts_entries;
CREATE POLICY oem_parts_entries_delete ON public.oem_parts_entries FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.oem_parts_manuals, public.oem_parts_entries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.oem_parts_manuals, public.oem_parts_entries TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('oem-parts-catalogs', 'oem-parts-catalogs', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 52428800,
  allowed_mime_types = ARRAY['application/pdf'];

DROP POLICY IF EXISTS oem_parts_pdf_read ON storage.objects;
CREATE POLICY oem_parts_pdf_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'oem-parts-catalogs' AND EXISTS (
    SELECT 1 FROM public.oem_parts_manuals m
    WHERE m.id::text = split_part(name, '/', 1)
      AND m.organisation_id IS NOT DISTINCT FROM public.app_current_org()
  ));
DROP POLICY IF EXISTS oem_parts_pdf_insert ON storage.objects;
CREATE POLICY oem_parts_pdf_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'oem-parts-catalogs' AND EXISTS (
    SELECT 1 FROM public.oem_parts_manuals m
    WHERE m.id::text = split_part(name, '/', 1)
      AND m.organisation_id IS NOT DISTINCT FROM public.app_current_org()
      AND public.get_my_role() IN ('Admin','Manager','Director')
  ));
DROP POLICY IF EXISTS oem_parts_pdf_delete ON storage.objects;
CREATE POLICY oem_parts_pdf_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'oem-parts-catalogs' AND EXISTS (
    SELECT 1 FROM public.oem_parts_manuals m
    WHERE m.id::text = split_part(name, '/', 1)
      AND m.organisation_id IS NOT DISTINCT FROM public.app_current_org()
      AND public.get_my_role() IN ('Admin','Manager','Director')
  ));
DROP POLICY IF EXISTS oem_parts_pdf_update ON storage.objects;
CREATE POLICY oem_parts_pdf_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'oem-parts-catalogs' AND EXISTS (
    SELECT 1 FROM public.oem_parts_manuals m
    WHERE m.id::text = split_part(name, '/', 1)
      AND m.organisation_id IS NOT DISTINCT FROM public.app_current_org()
      AND public.get_my_role() IN ('Admin','Manager','Director')
  ))
  WITH CHECK (bucket_id = 'oem-parts-catalogs' AND EXISTS (
    SELECT 1 FROM public.oem_parts_manuals m
    WHERE m.id::text = split_part(name, '/', 1)
      AND m.organisation_id IS NOT DISTINCT FROM public.app_current_org()
      AND public.get_my_role() IN ('Admin','Manager','Director')
  ));
