-- Atomic Administration corrections. Existing mobile/table APIs are unchanged.
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.admin_clean_tyre_records(
  p_changes jsonb, p_country text DEFAULT NULL, p_site text DEFAULT NULL,
  p_action text DEFAULT 'classify'
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  change jsonb; patch jsonb; expected jsonb; old_row jsonb; new_row jsonb;
  row_id uuid; ids jsonb := '[]'::jsonb; allowed text[];
  v public.tyre_records%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.app_is_active(),false) OR
    NOT (coalesce(public.get_my_role()='Admin',false) OR coalesce(public.is_super_admin(),false)) THEN
    RAISE EXCEPTION 'Not permitted' USING ERRCODE='42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('classify','undo','serial','odometer','review')
    OR jsonb_typeof(p_changes) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid correction' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_changes) NOT BETWEEN 1 AND 200
    OR (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(p_changes) e) <> jsonb_array_length(p_changes) THEN
    RAISE EXCEPTION 'Invalid correction batch' USING ERRCODE='22023';
  END IF;
  allowed := CASE p_action WHEN 'serial' THEN ARRAY['tyre_serial']
    WHEN 'odometer' THEN ARRAY['km_at_fitment','km_at_removal']
    WHEN 'review' THEN ARRAY['remarks'] ELSE ARRAY['category','risk_level','remarks_cleaned','cleaned'] END;

  -- A stable lock order prevents two overlapping batches acquiring inverse locks.
  FOR change IN SELECT e FROM jsonb_array_elements(p_changes) e ORDER BY e->>'id' LOOP
    row_id := (change->>'id')::uuid;
    patch := change->'patch'; expected := change->'expected';
    IF row_id IS NULL OR jsonb_typeof(patch) IS DISTINCT FROM 'object'
      OR jsonb_typeof(expected) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Invalid correction payload' USING ERRCODE='22023';
    END IF;
    IF patch = '{}'::jsonb OR EXISTS(SELECT 1 FROM jsonb_object_keys(patch) k WHERE NOT k=ANY(allowed) OR NOT expected ? k)
      OR EXISTS(SELECT 1 FROM jsonb_object_keys(expected) k WHERE NOT k=ANY(allowed || ARRAY['description','remarks'])) THEN
      RAISE EXCEPTION 'Invalid correction fields' USING ERRCODE='22023';
    END IF;
    IF p_action IN ('classify','undo') AND (NOT patch ?& allowed OR NOT expected ?& ARRAY['description','remarks']) THEN
      RAISE EXCEPTION 'Classification snapshot required' USING ERRCODE='22023';
    END IF;
    SELECT to_jsonb(r) INTO old_row FROM public.tyre_records r
      WHERE id=row_id AND organisation_id=public.app_current_org()
        AND (p_country IS NULL OR country=p_country) AND (p_site IS NULL OR site=p_site) FOR UPDATE;
    IF old_row IS NULL THEN RAISE EXCEPTION 'Record unavailable in selected scope' USING ERRCODE='42501'; END IF;

    -- Retrying an already-applied value succeeds without adding duplicate history.
    -- Non-patched source fields must still match the reviewed snapshot.
    IF old_row @> patch AND NOT EXISTS(SELECT 1 FROM jsonb_each(expected) e WHERE NOT patch ? e.key AND old_row->e.key IS DISTINCT FROM e.value) THEN
      ids := ids || jsonb_build_array(row_id); CONTINUE;
    END IF;
    IF NOT old_row @> expected THEN
      RAISE EXCEPTION 'Record changed; refresh before correcting' USING ERRCODE='40001';
    END IF;
    SELECT * INTO v FROM jsonb_populate_record(NULL::public.tyre_records,old_row || patch);
    IF p_action='classify' AND (v.cleaned IS DISTINCT FROM true OR nullif(btrim(v.category),'') IS NULL
      OR v.risk_level IS NULL OR v.risk_level NOT IN ('Critical','High','Medium','Low') OR length(v.category)>200 OR length(v.remarks_cleaned)>5000) THEN
      RAISE EXCEPTION 'Invalid classification' USING ERRCODE='22023';
    END IF;
    IF p_action='undo' AND patch IS DISTINCT FROM '{"category":null,"risk_level":null,"remarks_cleaned":null,"cleaned":false}'::jsonb THEN
      RAISE EXCEPTION 'Invalid reversal' USING ERRCODE='22023';
    END IF;
    IF p_action='serial' AND (nullif(btrim(v.tyre_serial),'') IS NULL OR length(v.tyre_serial)>100) THEN
      RAISE EXCEPTION 'Invalid serial' USING ERRCODE='22023';
    END IF;
    IF p_action='odometer' AND (v.km_at_fitment < 0 OR v.km_at_removal < 0 OR v.km_at_removal < v.km_at_fitment
      OR v.km_at_fitment::text IN ('NaN','Infinity','-Infinity') OR v.km_at_removal::text IN ('NaN','Infinity','-Infinity')
      OR EXISTS(SELECT 1 FROM jsonb_each(patch) e WHERE jsonb_typeof(e.value)<>'number')) THEN
      RAISE EXCEPTION 'Invalid odometer values' USING ERRCODE='22023';
    END IF;
    IF p_action='review' AND (nullif(btrim(v.remarks),'') IS NULL OR length(v.remarks)>5000) THEN
      RAISE EXCEPTION 'Invalid review note' USING ERRCODE='22023';
    END IF;
    UPDATE public.tyre_records r SET category=v.category,risk_level=v.risk_level,remarks_cleaned=v.remarks_cleaned,
      cleaned=v.cleaned,tyre_serial=v.tyre_serial,km_at_fitment=v.km_at_fitment,km_at_removal=v.km_at_removal,remarks=v.remarks
      WHERE id=row_id RETURNING to_jsonb(r) INTO new_row;
    IF new_row IS NULL OR NOT new_row @> patch THEN
      RAISE EXCEPTION 'Correction was not persisted' USING ERRCODE='42501';
    END IF;
    INSERT INTO public.audit_log(table_name,record_id,action,old_data,new_data,changed_by,organisation_id,details)
      VALUES('tyre_records',row_id,'UPDATE',old_row,new_row,auth.uid(),v.organisation_id,
        jsonb_build_object('channel','Data Cleaning','operation',p_action,'country',v.country,'site',v.site));
    IF p_action='classify' THEN
      INSERT INTO public.cleaning_log(original_text,cleaned_text,category,tyre_record_id,cleaned_by_model)
        VALUES(concat_ws(' | ',v.description,v.remarks),v.remarks_cleaned,v.category,row_id,'rule-based-v1');
    END IF;
    -- Undo appends the reversal to audit_log; previous cleaning history remains.
    ids := ids || jsonb_build_array(row_id);
  END LOOP;
  RETURN jsonb_build_object('ids',ids);
END $$;
REVOKE ALL ON FUNCTION public.admin_clean_tyre_records(jsonb,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_clean_tyre_records(jsonb,text,text,text) TO authenticated;
