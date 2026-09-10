BEGIN;
-- Same predicate as deployed site isolation/write policies, including their
-- intentional allowance for blank sites. No privileges are elevated here.
CREATE OR REPLACE FUNCTION public.import_site_scope_ok(p_site text)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT nullif(btrim(p_site),'') IS NULL OR coalesce(public.app_sees_all_sites(),false)
   OR coalesce(upper(btrim(p_site))=ANY(coalesce(public.app_site_scope(),'{}'::text[])),false)
$$;
REVOKE ALL ON FUNCTION public.import_site_scope_ok(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_site_scope_ok(text) TO authenticated;
CREATE OR REPLACE FUNCTION public.import_enrich_batch(p_batch_id uuid,p_max_rows integer DEFAULT NULL,p_after_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='120s' AS $$
DECLARE
  b public.import_batches%ROWTYPE; r public.import_rows%ROWTYPE;
  v_uid uuid:=auth.uid(); v_org uuid:=public.app_current_org();
  v_target text; v_key text; v_live_id text; v_live jsonb; v_data jsonb; v_patch jsonb;
  v_set text; v_enriched int:=0; v_skipped int:=0; v_nomatch int:=0;
  v_ecols text[]; k text; v_limit int:=CASE WHEN p_max_rows IS NULL OR p_max_rows<=0 THEN NULL ELSE least(p_max_rows,5000) END;
  v_scanned int:=0; v_last_id uuid:=p_after_id; v_done boolean;
BEGIN
  IF v_uid IS NULL OR v_org IS NULL OR NOT coalesce(public.app_is_active(),false)
     OR NOT coalesce(public.is_elevated_user(),false) THEN
    RAISE EXCEPTION 'Only an active elevated reviewer can refresh imported records.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO b FROM public.import_batches WHERE id=p_batch_id FOR UPDATE;
  IF NOT FOUND OR b.organisation_id IS DISTINCT FROM v_org OR NOT coalesce(public.import_user_can_commit_country(b.country),false) THEN
    RAISE EXCEPTION 'Import batch is outside your scope.' USING ERRCODE='42501';
  END IF;
  IF b.approval_status IS DISTINCT FROM 'approved' OR b.import_status='reversed' THEN
    RAISE EXCEPTION 'Only an approved batch can refresh live records.' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.import_rows WHERE batch_id=p_batch_id AND organisation_id IS DISTINCT FROM v_org) THEN
    RAISE EXCEPTION 'Staging ownership does not match the batch.' USING ERRCODE='42501';
  END IF;
  v_target:=public.import_target_table(b.module);
  IF v_target IS NULL THEN RAISE EXCEPTION 'Enrich not supported for module %',b.module; END IF;
  SELECT array_agg(c.column_name::text) INTO v_ecols FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name=v_target AND c.is_generated='NEVER' AND c.identity_generation IS NULL
    AND c.column_name NOT IN ('id','organisation_id','country','created_by','created_at','uploaded_by','updated_by','upload_batch_id');
  FOR r IN SELECT * FROM public.import_rows WHERE batch_id=p_batch_id AND action='update'
    AND validation_status IN ('ready','warning') AND processed_at IS NULL
    AND (p_after_id IS NULL OR id>p_after_id) ORDER BY id LIMIT v_limit LOOP
    v_scanned:=v_scanned+1;v_last_id:=r.id;
    v_data:=coalesce(nullif(r.transformed_data,'{}'::jsonb),r.mapped_data)||jsonb_build_object('country',b.country);
    IF NOT public.import_site_scope_ok(v_data->>'site') THEN
      RAISE EXCEPTION 'An imported site is outside your scope.' USING ERRCODE='42501';
    END IF;
    v_key:=public.import_natural_key(b.module,v_data);
    IF v_key IS NULL THEN v_skipped:=v_skipped+1;CONTINUE;END IF;
    EXECUTE format('SELECT id::text,to_jsonb(t) FROM public.%I t WHERE public.import_natural_key($1,to_jsonb(t))=$2 AND t.organisation_id=$3 AND t.country IS NOT DISTINCT FROM $4 AND public.import_site_scope_ok(to_jsonb(t)->>''site'') ORDER BY t.id LIMIT 1 FOR UPDATE',v_target)
      INTO v_live_id,v_live USING b.module,v_key,v_org,b.country;
    IF v_live_id IS NULL THEN v_nomatch:=v_nomatch+1;CONTINUE;END IF;
    v_patch:='{}'::jsonb;
    FOREACH k IN ARRAY coalesce(v_ecols,'{}'::text[]) LOOP
      IF NOT(v_data?k) OR public.import_jsonb_blank(v_data->k) THEN CONTINUE;END IF;
      IF public.import_exact_supplied_match(v_live,jsonb_build_object(k,v_data->k),v_ecols) THEN CONTINUE;END IF;
      v_patch:=v_patch||jsonb_build_object(k,v_data->k);
    END LOOP;
    IF v_patch='{}'::jsonb THEN
      UPDATE public.import_rows SET target_record_id=v_live_id,target_module=b.module,processed_at=now(),dup_status='duplicate' WHERE id=r.id;
      v_skipped:=v_skipped+1;CONTINUE;
    END IF;
    SELECT string_agg(format('%I=(jsonb_populate_record(t,$1)).%I',kk,kk),', ') INTO v_set FROM jsonb_object_keys(v_patch) kk;
    EXECUTE format('UPDATE public.%I t SET %s WHERE id::text=$2 AND organisation_id=$3 AND country IS NOT DISTINCT FROM $4 AND public.import_site_scope_ok(to_jsonb(t)->>''site'')',v_target,v_set)
      USING v_patch,v_live_id,v_org,b.country;
    UPDATE public.import_rows SET target_record_id=v_live_id,target_module=b.module,processed_at=now(),dup_status='enriched' WHERE id=r.id;
    v_enriched:=v_enriched+1;
  END LOOP;
  v_done:=(v_limit IS NULL) OR v_scanned<v_limit;
  INSERT INTO public.import_audit_events(organisation_id,batch_id,actor,action,detail) VALUES(v_org,p_batch_id,v_uid,'enrich',
    jsonb_build_object('enriched',v_enriched,'skipped',v_skipped,'no_match',v_nomatch,'scanned',v_scanned,'done',v_done,'target',v_target));
  RETURN jsonb_build_object('enriched',v_enriched,'skipped',v_skipped,'no_match',v_nomatch,'scanned',v_scanned,'done',v_done,'last_id',CASE WHEN v_scanned>0 THEN v_last_id::text ELSE NULL END);
END $$;

CREATE OR REPLACE FUNCTION public.import_reprocess_row(p_row_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b public.import_batches%ROWTYPE;r public.import_rows%ROWTYPE;batch uuid;org uuid:=public.app_current_org();
BEGIN
  IF auth.uid() IS NULL OR org IS NULL OR NOT coalesce(public.app_is_active(),false) THEN
    RAISE EXCEPTION 'Active organisation membership required.' USING ERRCODE='42501';
  END IF;
  SELECT batch_id INTO batch FROM public.import_rows WHERE id=p_row_id AND organisation_id=org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staged row not found in your scope.' USING ERRCODE='42501';END IF;
  SELECT * INTO b FROM public.import_batches WHERE id=batch FOR UPDATE;
  IF NOT FOUND OR b.organisation_id IS DISTINCT FROM org OR NOT coalesce(public.import_user_can_commit_country(b.country),false)
     OR NOT coalesce(b.approval_status IN ('draft','pending_approval'),false) OR b.import_status IN ('committing','committed') THEN
    RAISE EXCEPTION 'Only an unapproved batch in your scope can be reprocessed.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO r FROM public.import_rows WHERE id=p_row_id AND batch_id=batch AND organisation_id=org FOR UPDATE;
  IF NOT FOUND OR r.target_record_id IS NOT NULL OR r.processed_at IS NOT NULL THEN
    RAISE EXCEPTION 'A linked or processed row cannot be reset.' USING ERRCODE='42501';
  END IF;
  IF NOT public.import_site_scope_ok(coalesce(nullif(r.transformed_data,'{}'::jsonb),r.mapped_data)->>'site') THEN
    RAISE EXCEPTION 'Staged row site is outside your scope.' USING ERRCODE='42501';
  END IF;
  UPDATE public.import_rows SET validation_status='pending',processed_at=NULL WHERE id=p_row_id;
END $$;
REVOKE ALL ON FUNCTION public.import_enrich_batch(uuid,integer,uuid),public.import_reprocess_row(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_enrich_batch(uuid,integer,uuid),public.import_reprocess_row(uuid) TO authenticated;

-- Retain the deployed commit's module-specific merging. Add preflight before
-- any destination write, plus scope checks on its duplicate preview lookup.
DO $commit_scope$
DECLARE original text;revised text;
BEGIN
  original:=pg_get_functiondef('public.import_commit_batch(uuid,integer)'::regprocedure);
  revised:=replace(original,'v_target := public.import_target_table(b.module);',$replacement$
  IF b.import_status='reversed' THEN RAISE EXCEPTION 'A reversed batch cannot be resumed.' USING ERRCODE='42501';END IF;
  IF EXISTS(SELECT 1 FROM public.import_rows WHERE batch_id=p_batch_id AND organisation_id IS DISTINCT FROM v_org) THEN
    RAISE EXCEPTION 'Staging ownership does not match the batch.' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.import_rows WHERE batch_id=p_batch_id AND action='insert'
    AND validation_status IN ('ready','warning') AND processed_at IS NULL
    AND NOT public.import_site_scope_ok(coalesce(nullif(transformed_data,'{}'::jsonb),mapped_data)->>'site')) THEN
    RAISE EXCEPTION 'An imported site is outside your scope.' USING ERRCODE='42501';
  END IF;
  v_target := public.import_target_table(b.module);$replacement$);
  IF revised=original THEN RAISE EXCEPTION 'Unexpected commit target selection; review deployed definition.';END IF;
  original:=revised;
  revised:=replace(original,'WHERE t.id::text = $1 AND t.organisation_id = $2 LIMIT 1',
    'WHERE t.id::text = $1 AND t.organisation_id = $2 AND t.country IS NOT DISTINCT FROM $3 AND public.import_site_scope_ok(to_jsonb(t)->>''''site'''') LIMIT 1');
  IF revised=original THEN RAISE EXCEPTION 'Unexpected commit duplicate lookup; review deployed definition.';END IF;
  revised:=replace(revised,'USING r.target_record_id, v_org INTO v_existing;', 'USING r.target_record_id, v_org, b.country INTO v_existing;');
  EXECUTE revised;
END $commit_scope$;

DO $reverse_scope$
DECLARE original text;revised text;
BEGIN
  original:=pg_get_functiondef('public.import_reverse_batch(uuid)'::regprocedure);
  revised:=replace(original,'if not public.app_can_admin_delete() then',
    'if auth.uid() is null or v_org is null or not coalesce(public.app_is_active(),false) or not coalesce(public.app_can_admin_delete(),false) then');
  IF revised=original THEN RAISE EXCEPTION 'Unexpected reversal authorization; review deployed definition.';END IF;
  original:=revised;
  revised:=replace(original,'select * into b from public.import_batches where id = p_batch_id;',
    'select * into b from public.import_batches where id = p_batch_id FOR UPDATE;');
  IF revised=original THEN RAISE EXCEPTION 'Unexpected reversal batch selection; review deployed definition.';END IF;
  revised:=replace(revised,'if b.organisation_id is not null and b.organisation_id is distinct from v_org then',
    'if b.organisation_id is distinct from v_org then');
  revised:=replace(revised,'if not public.app_write_country_ok(b.country) then',
    'if not coalesce(public.app_write_country_ok(b.country),false) then');
  original:=revised;
  revised:=replace(original,'v_target := public.import_target_table(b.module);',$replacement$
  IF EXISTS(SELECT 1 FROM public.import_rows WHERE batch_id=p_batch_id AND organisation_id IS DISTINCT FROM v_org) THEN
    RAISE EXCEPTION 'Staging ownership does not match the batch.' USING ERRCODE='42501';
  END IF;
  v_target := public.import_target_table(b.module);$replacement$);
  IF revised=original THEN RAISE EXCEPTION 'Unexpected reversal target selection; review deployed definition.';END IF;
  original:=revised;
  revised:=replace(original,'for r in select * from public.import_rows where batch_id = p_batch_id and target_record_id is not null loop',$replacement$
  for r in select * from public.import_rows where batch_id = p_batch_id and target_record_id is not null loop
    -- Exact duplicates and enriched rows existed before this import. Never
    -- delete them as if this batch created them.
    IF r.action IS DISTINCT FROM 'insert' OR r.dup_status IN ('duplicate','enriched') THEN
      v_skipped:=v_skipped+1;CONTINUE;
    END IF;$replacement$);
  IF revised=original THEN RAISE EXCEPTION 'Unexpected reversal row loop; review deployed definition.';END IF;
  original:=revised;
  revised:=replace(original,'delete from public.%I where id::text = $1 and organisation_id = $2 and (country is null or public.app_write_country_ok(country))',
    'delete from public.%I t where id::text = $1 and organisation_id = $2 and country IS NOT DISTINCT FROM $3 and public.import_site_scope_ok(to_jsonb(t)->>''''site'''')');
  IF revised=original THEN RAISE EXCEPTION 'Unexpected reversal delete statement; review deployed definition.';END IF;
  revised:=replace(revised,') using r.target_record_id, v_org;',') using r.target_record_id, v_org, b.country;');
  EXECUTE revised;
END $reverse_scope$;
REVOKE ALL ON FUNCTION public.import_reverse_batch(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_reverse_batch(uuid) TO authenticated;
COMMIT;
