-- Administration authorization. Existing tenant/country RLS remains in force.
-- Import approvers retain the existing Admin/Manager/Director self-approval
-- contract. This is authorization hardening, not a new maker/checker policy.
BEGIN;

DO $policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ocr_scans','onboarding_tasks'] LOOP
    EXECUTE format('CREATE POLICY administration_active_admin_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL AND coalesce(public.app_is_active(), false) AND public.app_current_org() IS NOT NULL AND (public.get_my_role() = ''Admin'' OR public.is_super_admin()))',t);
    EXECUTE format('CREATE POLICY administration_active_admin_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL AND coalesce(public.app_is_active(), false) AND public.app_current_org() IS NOT NULL AND (public.get_my_role() = ''Admin'' OR public.is_super_admin())) WITH CHECK (auth.uid() IS NOT NULL AND coalesce(public.app_is_active(), false) AND public.app_current_org() IS NOT NULL AND (public.get_my_role() = ''Admin'' OR public.is_super_admin()))',t);
  END LOOP;
END $policies$;

CREATE OR REPLACE FUNCTION public.guard_administration_record_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.app_is_active(),false)
     OR public.app_current_org() IS NULL THEN
    RAISE EXCEPTION 'Active organisation membership required.' USING ERRCODE='42501';
  END IF;
  IF TG_OP='INSERT' THEN
    NEW.created_by := auth.uid(); NEW.created_at := now();
  ELSIF NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id THEN
    RAISE EXCEPTION 'Record ownership and creation identity are immutable.' USING ERRCODE='42501';
  END IF;
  IF TG_TABLE_NAME='ocr_scans' THEN
    IF TG_OP='INSERT' OR NEW.review_status IS DISTINCT FROM OLD.review_status
       OR NEW.corrected_value IS DISTINCT FROM OLD.corrected_value THEN
      NEW.reviewed_by := CASE WHEN NEW.review_status IN ('confirmed','rejected') THEN auth.uid()::text ELSE NULL END;
    ELSE NEW.reviewed_by := OLD.reviewed_by;
    END IF;
  ELSIF TG_TABLE_NAME='onboarding_tasks' THEN
    IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.completed_at := CASE WHEN NEW.status='completed' THEN now() ELSE NULL END;
    ELSE NEW.completed_at := OLD.completed_at;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_administration_record_identity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER administration_record_identity BEFORE INSERT OR UPDATE ON public.ocr_scans
FOR EACH ROW EXECUTE FUNCTION public.guard_administration_record_identity();
CREATE TRIGGER administration_record_identity BEFORE INSERT OR UPDATE ON public.onboarding_tasks
FOR EACH ROW EXECUTE FUNCTION public.guard_administration_record_identity();

CREATE OR REPLACE FUNCTION public.guard_support_ticket_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE triage boolean := coalesce(public.get_my_role() IN ('Admin','Manager','Director') OR public.is_super_admin(),false);
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.app_is_active(),false)
     OR public.app_current_org() IS NULL THEN
    RAISE EXCEPTION 'Active organisation membership required.' USING ERRCODE='42501';
  END IF;
  IF TG_OP='INSERT' THEN
    NEW.created_by := auth.uid(); NEW.created_at := now();
    NEW.status := 'open'; NEW.admin_response := NULL;
    NEW.responded_by := NULL; NEW.responded_at := NULL; NEW.resolved_at := NULL;
  ELSE
    IF NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
       OR NEW.country IS DISTINCT FROM OLD.country
       OR NEW.created_by_name IS DISTINCT FROM OLD.created_by_name
       OR NEW.created_by_email IS DISTINCT FROM OLD.created_by_email THEN
      RAISE EXCEPTION 'Ticket ownership and reporter identity are immutable.' USING ERRCODE='42501';
    END IF;
    IF NOT triage AND (NEW.status IS DISTINCT FROM OLD.status
       OR NEW.admin_response IS DISTINCT FROM OLD.admin_response
       OR NEW.responded_by IS DISTINCT FROM OLD.responded_by
       OR NEW.responded_at IS DISTINCT FROM OLD.responded_at
       OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at) THEN
      RAISE EXCEPTION 'Only a support administrator may respond or change ticket status.' USING ERRCODE='42501';
    END IF;
    IF NEW.admin_response IS DISTINCT FROM OLD.admin_response THEN
      NEW.responded_by := auth.uid(); NEW.responded_at := now();
    ELSE
      NEW.responded_by := OLD.responded_by; NEW.responded_at := OLD.responded_at;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.resolved_at := CASE WHEN NEW.status IN ('resolved','closed') THEN now() ELSE NULL END;
    ELSE NEW.resolved_at := OLD.resolved_at;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_support_ticket_fields() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER administration_support_fields BEFORE INSERT OR UPDATE ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.guard_support_ticket_fields();

CREATE OR REPLACE FUNCTION public.guard_import_batch_approval()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE elevated boolean := coalesce(public.get_my_role() IN ('Admin','Manager','Director') OR public.is_super_admin(),false);
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.app_is_active(),false) THEN
    RAISE EXCEPTION 'Active membership required.' USING ERRCODE='42501';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.approval_status IS NULL OR NEW.approval_status NOT IN ('draft','pending_approval') OR NEW.approver IS NOT NULL OR NEW.approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'New batches must be submitted before approval.' USING ERRCODE='42501';
    END IF;
  ELSE
    IF NEW.uploader IS DISTINCT FROM OLD.uploader OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id THEN
      RAISE EXCEPTION 'Batch ownership is immutable.' USING ERRCODE='42501';
    END IF;
    IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
      IF OLD.import_status IN ('committing','committed') THEN
        RAISE EXCEPTION 'An importing batch cannot change approval.' USING ERRCODE='23514';
      END IF;
      IF NEW.approval_status IN ('approved','rejected') THEN
        IF NOT elevated THEN RAISE EXCEPTION 'Only elevated reviewers may decide imports.' USING ERRCODE='42501'; END IF;
        IF NOT coalesce(OLD.approval_status IN ('draft','pending_approval'),false) THEN
          RAISE EXCEPTION 'This batch already has an approval decision.' USING ERRCODE='23514';
        END IF;
        NEW.approver := auth.uid(); NEW.approved_at := now();
      ELSIF NEW.approval_status='pending_approval' AND OLD.approval_status='draft' THEN
        NEW.approver := NULL; NEW.approved_at := NULL;
      ELSE RAISE EXCEPTION 'Invalid approval transition.' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.approver IS DISTINCT FROM OLD.approver OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'Approval identity can only change with a decision.' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_import_batch_approval() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER administration_import_approval BEFORE INSERT OR UPDATE ON public.import_batches
FOR EACH ROW EXECUTE FUNCTION public.guard_import_batch_approval();

-- Keep the deployed module-specific merge/insert implementation intact. Fail
-- closed on schema drift instead of overwriting a newer implementation.
DO $commit_guard$
DECLARE definition text; patched text;
BEGIN
  SELECT pg_get_functiondef('public.import_commit_batch(uuid,integer)'::regprocedure) INTO definition;
  patched := replace(definition,
    'SELECT * INTO b FROM public.import_batches WHERE id = p_batch_id;',
    'SELECT * INTO b FROM public.import_batches WHERE id = p_batch_id FOR UPDATE;');
  IF patched=definition THEN RAISE EXCEPTION 'Unexpected import_commit_batch selection; review migration against deployed function.'; END IF;
  definition := patched;
  patched := replace(definition,
    'IF b.organisation_id IS NOT NULL AND b.organisation_id IS DISTINCT FROM v_org THEN',
    'IF v_uid IS NULL OR v_org IS NULL OR NOT coalesce(public.app_is_active(),false) OR b.organisation_id IS DISTINCT FROM v_org THEN');
  IF patched=definition THEN RAISE EXCEPTION 'Unexpected import_commit_batch tenant guard; review migration against deployed function.'; END IF;
  patched := replace(patched, 'IF b.approval_status <> ''approved'' THEN', 'IF b.approval_status IS DISTINCT FROM ''approved'' THEN');
  EXECUTE patched;
END $commit_guard$;

CREATE OR REPLACE FUNCTION public.approve_pending_upload(p_upload_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  batch public.pending_uploads%ROWTYPE;
  target text; allowed text[]; payload jsonb; row_data jsonb; cols text;
  imported integer := 0; row_country text; actor uuid := auth.uid(); org uuid := public.app_current_org();
BEGIN
  IF actor IS NULL OR org IS NULL OR NOT coalesce(public.app_is_active(),false)
     OR NOT coalesce(public.is_elevated_user(),false) THEN
    RAISE EXCEPTION 'Only active Admin, Manager or Director may approve uploads.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO batch FROM public.pending_uploads WHERE id=p_upload_id FOR UPDATE;
  IF NOT FOUND OR batch.organisation_id IS DISTINCT FROM org THEN
    RAISE EXCEPTION 'Upload not found or outside your organisation.' USING ERRCODE='42501';
  END IF;
  IF NOT coalesce(public.app_write_country_ok(batch.country),false) THEN
    RAISE EXCEPTION 'Upload country is outside your scope.' USING ERRCODE='42501';
  END IF;
  target := CASE lower(batch.upload_type) WHEN 'tyres' THEN 'tyre_records' WHEN 'stock' THEN 'stock_records' END;
  IF target IS NULL THEN RAISE EXCEPTION 'Unsupported upload type.' USING ERRCODE='22023'; END IF;
  IF batch.status='approved' AND batch.import_status='imported' THEN
    RETURN jsonb_build_object('ok',true,'imported',batch.imported_count,'target',target,'already_imported',true);
  END IF;
  IF batch.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'This upload already has a review decision.' USING ERRCODE='23514'; END IF;
  IF jsonb_typeof(batch.rows) IS DISTINCT FROM 'array' OR jsonb_array_length(batch.rows)=0 THEN
    RAISE EXCEPTION 'The upload must contain at least one data row.' USING ERRCODE='22023';
  END IF;
  allowed := CASE target WHEN 'tyre_records' THEN ARRAY[
    'sr','issue_date','description','brand','serial_no','qty','job_card','mis_number','asset_no','site',
    'remarks','remarks_cleaned','category','risk_level','source_sheet','source_file','region','cost_per_tyre',
    'km_at_fitment','km_at_removal','extra_fields','position','serial_number','pressure_reading','tread_depth',
    'size','driver_name','reason_for_removal','removal_date','tyre_serial','supplier','asset_number','findings',
    'removal_reason','driver_id','tyre_position','vehicle_type','hrs_at_fitment','hrs_at_removal','total_km','total_hrs','photos','status']
  ELSE ARRAY['site','description','stock_qty','min_level','critical_level','stock_status','reorder_qty','management_action','region','custom_data'] END;
  FOR row_data IN SELECT value FROM jsonb_array_elements(batch.rows) LOOP
    IF jsonb_typeof(row_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Each uploaded row must be an object.' USING ERRCODE='22023'; END IF;
    row_country := coalesce(nullif(btrim(row_data->>'country'),''),nullif(btrim(batch.country),''));
    IF row_country IS NULL OR NOT coalesce(public.app_write_country_ok(row_country),false) THEN
      RAISE EXCEPTION 'Each row requires a country within your scope.' USING ERRCODE='42501';
    END IF;
    IF nullif(btrim(row_data->>'site'),'') IS NOT NULL
       AND NOT coalesce(public.app_sees_all_sites(),false)
       AND NOT coalesce(upper(btrim(row_data->>'site'))=ANY(coalesce(public.app_site_scope(),'{}'::text[])),false) THEN
      RAISE EXCEPTION 'An uploaded site is outside your scope.' USING ERRCODE='42501';
    END IF;
    SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) INTO payload
      FROM jsonb_each(row_data) WHERE key=ANY(allowed);
    payload := payload || jsonb_build_object('organisation_id',org,'country',row_country);
    IF target='tyre_records' THEN
      payload := payload || jsonb_build_object('uploaded_by',batch.uploaded_by,'upload_batch_id',batch.batch_id,'data_source','upload');
    ELSE payload := payload || jsonb_build_object('updated_by',actor);
    END IF;
    -- Only supplied writable fields appear in INSERT. Defaults and generated
    -- columns belong to PostgreSQL, never to uploaded JSON.
    SELECT string_agg(quote_ident(c.column_name),', ' ORDER BY c.ordinal_position) INTO cols
    FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name=target AND c.is_generated='NEVER'
      AND c.identity_generation IS NULL AND payload ? c.column_name;
    EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(null::public.%I,$1)',target,cols,cols,target) USING payload;
    imported := imported+1;
  END LOOP;
  UPDATE public.pending_uploads SET status='approved',reviewed_by=actor,reviewed_at=now(),
    import_status='imported',imported_count=imported,imported_at=now(),import_error=NULL WHERE id=batch.id;
  RETURN jsonb_build_object('ok',true,'imported',imported,'target',target);
END $$;
REVOKE ALL ON FUNCTION public.approve_pending_upload(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_pending_upload(uuid) TO authenticated;

COMMIT;
