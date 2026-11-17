-- Rollback for 20261118100000_oem_catalog_advanced.sql. NOT APPLIED.
-- Restores the previous write policies (Admin, Manager, Director) and removes the additions.
-- WARNING: dropping the new tables discards figures, review items, corrections and category rules
-- created after the migration. Export them first (see docs/oem-catalog/RECONCILIATION.md).
-- Columns added to oem_parts_entries / oem_parts_manuals are left in place on purpose (nullable or
-- defaulted, harmless); drop them only after confirming nothing reads them.

DROP TRIGGER IF EXISTS oem_protect_corrected_trg ON public.oem_parts_entries;
DROP FUNCTION IF EXISTS public.oem_protect_corrected();
DROP FUNCTION IF EXISTS public.oem_apply_correction(uuid, text, text, text);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['oem_parts_manuals','oem_parts_entries'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.get_my_role() IN (''Admin'',''Manager'',''Director''))', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (public.get_my_role() IN (''Admin'',''Manager'',''Director'')) WITH CHECK (public.get_my_role() IN (''Admin'',''Manager'',''Director''))', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (public.get_my_role() IN (''Admin'',''Manager'',''Director''))', t || '_delete', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS oem_parts_pdf_insert ON storage.objects;
CREATE POLICY oem_parts_pdf_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'oem-parts-catalogs' AND EXISTS (
    SELECT 1 FROM public.oem_parts_manuals m
    WHERE m.id::text = split_part(name, '/', 1) AND m.organisation_id IS NOT DISTINCT FROM public.app_current_org()
      AND public.get_my_role() IN ('Admin','Manager','Director')));
DROP POLICY IF EXISTS oem_parts_pdf_delete ON storage.objects;
CREATE POLICY oem_parts_pdf_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'oem-parts-catalogs' AND EXISTS (
    SELECT 1 FROM public.oem_parts_manuals m
    WHERE m.id::text = split_part(name, '/', 1) AND m.organisation_id IS NOT DISTINCT FROM public.app_current_org()
      AND public.get_my_role() IN ('Admin','Manager','Director')));
DROP POLICY IF EXISTS oem_parts_pdf_update ON storage.objects;
CREATE POLICY oem_parts_pdf_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'oem-parts-catalogs' AND EXISTS (
    SELECT 1 FROM public.oem_parts_manuals m
    WHERE m.id::text = split_part(name, '/', 1) AND m.organisation_id IS NOT DISTINCT FROM public.app_current_org()
      AND public.get_my_role() IN ('Admin','Manager','Director')))
  WITH CHECK (bucket_id = 'oem-parts-catalogs' AND EXISTS (
    SELECT 1 FROM public.oem_parts_manuals m
    WHERE m.id::text = split_part(name, '/', 1) AND m.organisation_id IS NOT DISTINCT FROM public.app_current_org()
      AND public.get_my_role() IN ('Admin','Manager','Director')));

DROP TABLE IF EXISTS public.oem_category_rules;
DROP TABLE IF EXISTS public.oem_corrections;
DROP TABLE IF EXISTS public.oem_review_items;
DROP TABLE IF EXISTS public.oem_figures;
DROP FUNCTION IF EXISTS public.oem_catalog_admin();
