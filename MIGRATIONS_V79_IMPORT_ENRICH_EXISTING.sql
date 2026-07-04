-- V79: cross-file enrichment — complete an existing live record from a later
-- file instead of skipping it as a duplicate.
--
-- Fill-ONLY-empty: never overwrites a non-blank value; key-matched per module;
-- org + country scoped; every enrichment audited to import_audit_events.
-- Verified in a rolled-back sandbox (fleet): a second file with model=FH16,
-- make=<junk>, site='' filled the empty model, kept the existing make/site.
--
-- import_natural_key(module, jsonb): the natural key for EVERY module, computed
-- from a jsonb, mirroring import_existing_keys's live key columns. NULL when the
-- identifying component is blank (so blank rows never match).
-- import_enrich_batch(batch_id): for the batch's action='update' rows, find the
-- matching live record (same natural key) and fill its empty columns from the
-- row's data via jsonb_populate_record (type-safe), then audit.
--
-- The Data Intake Center sets action='update' on live-duplicate rows only when
-- the elevated operator turns on "Enrich existing records", and calls
-- import_enrich_batch after import_commit_batch.

CREATE OR REPLACE FUNCTION public.import_natural_key(p_module text, p_d jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(btrim(coalesce(p_d->>'country',''))) || chr(1) || CASE p_module
    WHEN 'fleet'      THEN nullif(lower(btrim(coalesce(p_d->>'asset_no',''))),'')
    WHEN 'tyre'       THEN nullif(lower(btrim(coalesce(p_d->>'serial_no',''))),'')
    WHEN 'stock'      THEN nullif(lower(btrim(coalesce(p_d->>'site','')))||chr(1)||lower(btrim(coalesce(p_d->>'description',''))), chr(1))
    WHEN 'accident'   THEN nullif(lower(btrim(coalesce(nullif(btrim(coalesce(p_d->>'insurance_claim_no','')),''), p_d->>'police_report_no',''))),'')
    WHEN 'inspection' THEN nullif(lower(btrim(coalesce(p_d->>'asset_no',''))),'')||chr(1)||lower(btrim(coalesce(p_d->>'inspection_type','')))||chr(1)||lower(btrim(coalesce(p_d->>'inspection_date','')))||chr(1)||lower(btrim(coalesce(p_d->>'inspector','')))
    WHEN 'workorder'  THEN nullif(lower(btrim(coalesce(p_d->>'work_order_no',''))),'')
    WHEN 'warranty'   THEN nullif(lower(btrim(coalesce(p_d->>'serial_number','')))||chr(1)||lower(btrim(coalesce(p_d->>'claim_no',''))), chr(1))
    WHEN 'gatepass'   THEN nullif(lower(btrim(coalesce(p_d->>'asset_no',''))),'')||chr(1)||lower(btrim(coalesce(p_d->>'pass_date','')))
    WHEN 'supplier'   THEN nullif(lower(btrim(coalesce(nullif(btrim(coalesce(p_d->>'supplier_code','')),''), p_d->>'supplier_name',''))),'')
    WHEN 'driver'     THEN nullif(lower(btrim(coalesce(p_d->>'driver_id',''))),'')
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION public.import_enrich_batch(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  b public.import_batches%ROWTYPE; r public.import_rows%ROWTYPE;
  v_uid uuid := auth.uid(); v_org uuid := public.app_current_org();
  v_target text; v_key text; v_live_id text; v_live jsonb; v_data jsonb; v_patch jsonb;
  v_col record; v_set text; v_enriched int := 0; v_skipped int := 0; v_nomatch int := 0;
BEGIN
  IF NOT public.is_approved_and_unlocked() THEN RAISE EXCEPTION 'Not authorised.' USING errcode='42501'; END IF;
  SELECT * INTO b FROM public.import_batches WHERE id=p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import batch not found.'; END IF;
  IF b.organisation_id IS NOT NULL AND b.organisation_id IS DISTINCT FROM v_org THEN RAISE EXCEPTION 'Cross-organisation enrich denied.' USING errcode='42501'; END IF;
  IF NOT public.import_user_can_commit_country(b.country) THEN RAISE EXCEPTION 'Cross-country enrich denied.' USING errcode='42501'; END IF;
  v_target := public.import_target_table(b.module);
  IF v_target IS NULL THEN RAISE EXCEPTION 'Enrich not supported for module %', b.module; END IF;
  FOR r IN SELECT * FROM public.import_rows WHERE batch_id=p_batch_id AND action='update'
             AND validation_status IN ('ready','warning') AND processed_at IS NULL LOOP
    v_data := COALESCE(NULLIF(r.transformed_data,'{}'::jsonb), r.mapped_data);
    v_key := public.import_natural_key(b.module, v_data);
    IF v_key IS NULL THEN v_skipped := v_skipped+1; CONTINUE; END IF;
    EXECUTE format('SELECT id::text, to_jsonb(t) FROM public.%I t WHERE public.import_natural_key(%L, to_jsonb(t)) = %L AND (t.organisation_id = %L OR t.organisation_id IS NULL) LIMIT 1',
                   v_target, b.module, v_key, v_org) INTO v_live_id, v_live;
    IF v_live_id IS NULL THEN v_nomatch := v_nomatch+1; CONTINUE; END IF;
    v_patch := '{}'::jsonb;
    FOR v_col IN SELECT c.column_name FROM information_schema.columns c
                 WHERE c.table_schema='public' AND c.table_name=v_target
                   AND c.is_generated='NEVER' AND c.identity_generation IS NULL AND v_data ? c.column_name LOOP
      IF v_col.column_name IN ('id','organisation_id','country','created_by','created_at') THEN CONTINUE; END IF;
      IF public.import_jsonb_blank(v_data -> v_col.column_name) THEN CONTINUE; END IF;
      IF NOT public.import_jsonb_blank(v_live -> v_col.column_name) THEN CONTINUE; END IF;
      v_patch := v_patch || jsonb_build_object(v_col.column_name, v_data -> v_col.column_name);
    END LOOP;
    IF v_patch = '{}'::jsonb THEN v_skipped := v_skipped+1; CONTINUE; END IF;
    v_set := (SELECT string_agg(format('%I = (jsonb_populate_record(t, %L::jsonb)).%I', k, v_patch, k), ', ') FROM jsonb_object_keys(v_patch) k);
    EXECUTE format('UPDATE public.%I t SET %s WHERE id = %L', v_target, v_set, v_live_id);
    UPDATE public.import_rows SET target_record_id=v_live_id, target_module=b.module, processed_at=now(), dup_status='enriched' WHERE id=r.id;
    v_enriched := v_enriched+1;
  END LOOP;
  INSERT INTO public.import_audit_events (organisation_id, batch_id, actor, action, detail)
    VALUES (v_org, p_batch_id, v_uid, 'enrich', jsonb_build_object('enriched',v_enriched,'skipped',v_skipped,'no_match',v_nomatch,'target',v_target));
  RETURN jsonb_build_object('enriched',v_enriched,'skipped',v_skipped,'no_match',v_nomatch);
END $fn$;

REVOKE ALL ON FUNCTION public.import_natural_key(text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_natural_key(text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.import_enrich_batch(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.import_enrich_batch(uuid) TO authenticated, service_role;
