BEGIN;
-- No ownership is inferred for legacy global mappings. They remain stored with
-- NULL scope and are inaccessible to application clients until reviewed.
ALTER TABLE public.field_synonyms ADD COLUMN organisation_id uuid;
ALTER TABLE public.field_synonyms ALTER COLUMN organisation_id SET DEFAULT public.app_current_org();
ALTER TABLE public.field_synonyms DROP CONSTRAINT field_synonyms_unique_name;
ALTER TABLE public.field_synonyms ADD CONSTRAINT field_synonyms_tenant_unique_name UNIQUE(organisation_id,custom_name,table_target);

DROP POLICY fs_read_all ON public.field_synonyms;
DROP POLICY fs_write_admin ON public.field_synonyms;
CREATE POLICY fs_read_tenant ON public.field_synonyms FOR SELECT TO authenticated
USING (coalesce(public.app_is_active(),false));
CREATE POLICY fs_write_admin ON public.field_synonyms FOR ALL TO authenticated
USING (coalesce(public.app_is_active(),false) AND (public.get_my_role() IN ('Admin','Manager') OR public.is_super_admin()))
WITH CHECK (coalesce(public.app_is_active(),false) AND (public.get_my_role() IN ('Admin','Manager') OR public.is_super_admin()));
CREATE POLICY fs_tenant_isolation ON public.field_synonyms AS RESTRICTIVE FOR ALL TO authenticated
USING (organisation_id IS NOT NULL AND organisation_id=public.app_current_org())
WITH CHECK (organisation_id IS NOT NULL AND organisation_id=public.app_current_org());

CREATE OR REPLACE FUNCTION public.guard_field_synonym_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.app_is_active(),false) OR public.app_current_org() IS NULL THEN
    RAISE EXCEPTION 'Active tenant membership required.' USING ERRCODE='42501';
  END IF;
  IF TG_OP='INSERT' THEN
    NEW.created_by := auth.uid(); NEW.created_at := now();
  ELSIF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Mapping ownership and creation identity are immutable.' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_field_synonym_identity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER fs_identity BEFORE INSERT OR UPDATE ON public.field_synonyms
FOR EACH ROW EXECUTE FUNCTION public.guard_field_synonym_identity();
COMMIT;
