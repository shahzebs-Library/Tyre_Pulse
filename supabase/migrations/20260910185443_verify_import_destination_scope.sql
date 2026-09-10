BEGIN;
CREATE OR REPLACE FUNCTION public.import_verify_landing(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  b public.import_batches%ROWTYPE; target text; org uuid:=public.app_current_org();
  expected integer:=0; landed integer:=0;
BEGIN
  IF auth.uid() IS NULL OR org IS NULL OR NOT coalesce(public.app_is_active(),false) THEN
    RAISE EXCEPTION 'Active organisation membership required.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO b FROM public.import_batches WHERE id=p_batch_id;
  IF NOT FOUND OR b.organisation_id IS DISTINCT FROM org OR NOT coalesce(public.import_user_can_commit_country(b.country),false) THEN
    RAISE EXCEPTION 'Import batch not found in your scope.' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.import_rows WHERE batch_id=p_batch_id AND organisation_id IS DISTINCT FROM org) THEN
    RAISE EXCEPTION 'Staging ownership does not match the import batch. Reconciliation is required.' USING ERRCODE='42501';
  END IF;
  target:=public.import_target_table(b.module);
  IF target IS NULL THEN RAISE EXCEPTION 'Unknown import destination.' USING ERRCODE='22023'; END IF;
  SELECT count(DISTINCT target_record_id) INTO expected FROM public.import_rows
    WHERE batch_id=p_batch_id AND target_record_id IS NOT NULL;
  EXECUTE format('SELECT count(DISTINCT r.target_record_id) FROM public.import_rows r JOIN public.%I t ON t.id::text=r.target_record_id AND t.organisation_id=$2 AND t.country IS NOT DISTINCT FROM $3 WHERE r.batch_id=$1 AND r.organisation_id=$2 AND r.target_record_id IS NOT NULL',target)
    INTO landed USING p_batch_id,org,b.country;
  -- This verifies destination existence and scope, not field equality or
  -- module-specific business correctness. A missing/foreign row remains dangling.
  RETURN jsonb_build_object('batch_id',p_batch_id,'module',b.module,'target_table',target,
    'status',b.import_status,'expected_distinct',expected,'landed_distinct',landed,
    'dangling',greatest(expected-landed,0),'scope_verified',true,'verified_at',now());
END $$;
REVOKE ALL ON FUNCTION public.import_verify_landing(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_verify_landing(uuid) TO authenticated;
COMMIT;
