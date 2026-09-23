-- Country-scoped staged expense imports. No existing data is changed by this migration.
-- Private immutable receipts retain replaced rows for operator-led recovery.
CREATE SCHEMA IF NOT EXISTS administration_imports;
REVOKE ALL ON SCHEMA administration_imports FROM PUBLIC, anon, authenticated;
CREATE TABLE administration_imports.expense_batches (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL, actor uuid NOT NULL,
 country text NOT NULL, replace_existing boolean NOT NULL, expected_rows integer NOT NULL CHECK(expected_rows BETWEEN 1 AND 300000),
 baseline text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), result jsonb
);
CREATE TABLE administration_imports.expense_chunks (
 batch_id uuid NOT NULL REFERENCES administration_imports.expense_batches(id),
 chunk_index integer NOT NULL CHECK(chunk_index >= 0), rows jsonb NOT NULL,
 PRIMARY KEY(batch_id,chunk_index)
);
CREATE TABLE administration_imports.expense_archive (
 batch_id uuid NOT NULL REFERENCES administration_imports.expense_batches(id),
 row_id uuid NOT NULL, row_data jsonb NOT NULL, PRIMARY KEY(batch_id,row_id)
);
ALTER TABLE administration_imports.expense_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_imports.expense_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_imports.expense_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA administration_imports FROM PUBLIC, anon, authenticated;

CREATE FUNCTION administration_imports.check_expense_actor(p_country text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_org uuid := public.app_current_org();
BEGIN
 IF auth.uid() IS NULL OR v_org IS NULL OR NOT coalesce(public.app_is_active(),false)
    OR NOT coalesce(public.app_is_elevated(),false)
    OR nullif(btrim(p_country),'') IS NULL OR lower(btrim(p_country))='all'
    OR NOT coalesce(public.app_write_country_ok(p_country),false) THEN
  RAISE EXCEPTION 'Expense import is not permitted in this country' USING ERRCODE='42501';
 END IF;
 RETURN v_org;
END $$;

CREATE FUNCTION administration_imports.expense_baseline(p_org uuid,p_country text) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT md5(coalesce(string_agg(md5(to_jsonb(p)::text),'' ORDER BY p.id),''))
 FROM public.parts_consumption p WHERE p.organisation_id=p_org AND p.country=p_country;
$$;

CREATE FUNCTION public.expense_import_count(p_country text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_org uuid; v_count bigint;
BEGIN
 v_org:=administration_imports.check_expense_actor(p_country);
 SELECT count(*) INTO v_count FROM public.parts_consumption WHERE organisation_id=v_org AND country=p_country;
 RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.expense_import_count(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.expense_import_count(text) TO authenticated;

CREATE FUNCTION public.begin_expense_import(p_request_id uuid,p_country text,p_replace boolean,p_rows integer,p_expected_count bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_org uuid; v_batch administration_imports.expense_batches; v_count bigint;
BEGIN
 v_org := administration_imports.check_expense_actor(p_country);
 IF p_request_id IS NULL OR p_replace IS NULL OR p_rows IS NULL OR p_rows NOT BETWEEN 1 AND 300000 THEN
  RAISE EXCEPTION 'Invalid expense import request' USING ERRCODE='22023';
 END IF;
 IF p_replace AND NOT coalesce(public.app_can_admin_delete(),false) THEN
  RAISE EXCEPTION 'Only administrators may replace expense data' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 SELECT * INTO v_batch FROM administration_imports.expense_batches WHERE id=p_request_id;
 IF FOUND THEN
  IF v_batch.organisation_id<>v_org OR v_batch.actor<>auth.uid() OR v_batch.country<>p_country
    OR v_batch.replace_existing<>p_replace OR v_batch.expected_rows<>p_rows THEN
   RAISE EXCEPTION 'Import request identity conflicts; start a new import' USING ERRCODE='22023';
  END IF;
  RETURN jsonb_build_object('ok',true,'result',v_batch.result);
 END IF;
 LOCK TABLE public.parts_consumption IN SHARE MODE;
 SELECT count(*) INTO v_count FROM public.parts_consumption WHERE organisation_id=v_org AND country=p_country;
 IF p_replace AND (p_expected_count IS NULL OR v_count<>p_expected_count) THEN
  RAISE EXCEPTION 'Stored expense data changed; refresh the count before replacing' USING ERRCODE='40001';
 END IF;
 INSERT INTO administration_imports.expense_batches(id,organisation_id,actor,country,replace_existing,expected_rows,baseline)
 VALUES(p_request_id,v_org,auth.uid(),p_country,p_replace,p_rows,administration_imports.expense_baseline(v_org,p_country));
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION public.stage_expense_import(p_request_id uuid,p_chunk integer,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_batch administration_imports.expense_batches; v_previous jsonb;
BEGIN
 SELECT * INTO v_batch FROM administration_imports.expense_batches WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Expense import not found' USING ERRCODE='42501'; END IF;
 IF administration_imports.check_expense_actor(v_batch.country)<>v_batch.organisation_id OR v_batch.actor<>auth.uid() THEN
  RAISE EXCEPTION 'Expense import access denied' USING ERRCODE='42501';
 END IF;
 IF p_chunk IS NULL OR p_chunk<0 OR p_chunk>=(v_batch.expected_rows+199)/200
    OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_rows)<>least(200,v_batch.expected_rows-p_chunk*200)
    OR pg_column_size(p_rows)>1048576 THEN
  RAISE EXCEPTION 'Invalid expense import chunk' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE jsonb_typeof(r)<>'object'
    OR (r ? 'country' AND r->>'country' IS DISTINCT FROM v_batch.country)
    OR nullif(btrim(r->>'item_description'),'') IS NULL) THEN
  RAISE EXCEPTION 'Every expense row needs a description and the selected country' USING ERRCODE='22023';
 END IF;
 SELECT rows INTO v_previous FROM administration_imports.expense_chunks WHERE batch_id=p_request_id AND chunk_index=p_chunk;
 IF FOUND THEN
  IF v_previous<>p_rows THEN RAISE EXCEPTION 'Expense chunk retry differs from original' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('ok',true);
 END IF;
 IF v_batch.result IS NOT NULL THEN RAISE EXCEPTION 'Import already completed' USING ERRCODE='40001'; END IF;
 INSERT INTO administration_imports.expense_chunks VALUES(p_request_id,p_chunk,p_rows);
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION public.commit_expense_import(p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_batch administration_imports.expense_batches; v_inserted bigint; v_total bigint; v_replaced bigint:=0; v_result jsonb;
BEGIN
 -- Also serializes legacy/direct writers while the replacement is checked and committed.
 -- Failures or statement timeout roll back deletion, inserts, archive, and receipt together.
 LOCK TABLE public.parts_consumption IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO v_batch FROM administration_imports.expense_batches WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Expense import not found' USING ERRCODE='42501'; END IF;
 IF administration_imports.check_expense_actor(v_batch.country)<>v_batch.organisation_id OR v_batch.actor<>auth.uid() THEN
  RAISE EXCEPTION 'Expense import access denied' USING ERRCODE='42501';
 END IF;
 IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
 IF v_batch.replace_existing AND NOT coalesce(public.app_can_admin_delete(),false) THEN
  RAISE EXCEPTION 'Only administrators may replace expense data' USING ERRCODE='42501';
 END IF;
 SELECT coalesce(sum(jsonb_array_length(rows)),0) INTO v_total FROM administration_imports.expense_chunks WHERE batch_id=p_request_id;
 IF v_total<>v_batch.expected_rows THEN RAISE EXCEPTION 'Expense staging is incomplete' USING ERRCODE='22023'; END IF;
 IF v_batch.replace_existing THEN
  IF administration_imports.expense_baseline(v_batch.organisation_id,v_batch.country)<>v_batch.baseline THEN
   RAISE EXCEPTION 'Stored expense data changed during upload; start a new import' USING ERRCODE='40001';
  END IF;
  INSERT INTO administration_imports.expense_archive
   SELECT p_request_id,p.id,to_jsonb(p) FROM public.parts_consumption p
   WHERE p.organisation_id=v_batch.organisation_id AND p.country=v_batch.country;
  DELETE FROM public.parts_consumption WHERE organisation_id=v_batch.organisation_id AND country=v_batch.country;
  GET DIAGNOSTICS v_replaced=ROW_COUNT;
 END IF;
 INSERT INTO public.parts_consumption(organisation_id,country,issue_number,work_order_no,txn_date,asset_code,asset_description,asset_type,store_code,cost_center,item_code,qty,item_description,value_amount,spare_parts_amount,tyre_amount,oil_amount,total_amount,source_row)
 SELECT v_batch.organisation_id,v_batch.country,r.issue_number,r.work_order_no,r.txn_date,r.asset_code,r.asset_description,r.asset_type,r.store_code,r.cost_center,r.item_code,r.qty,r.item_description,r.value_amount,r.spare_parts_amount,r.tyre_amount,r.oil_amount,r.total_amount,r.source_row
 FROM administration_imports.expense_chunks c
 CROSS JOIN LATERAL jsonb_to_recordset(c.rows) AS r(issue_number text,work_order_no text,txn_date text,asset_code text,asset_description text,asset_type text,store_code text,cost_center text,item_code text,qty text,item_description text,value_amount text,spare_parts_amount text,tyre_amount text,oil_amount text,total_amount text,source_row text)
 WHERE c.batch_id=p_request_id ORDER BY c.chunk_index;
 GET DIAGNOSTICS v_inserted=ROW_COUNT;
 -- Existing fingerprint trigger may intentionally skip exact duplicates; never call them inserted.
 v_result:=jsonb_build_object('ok',true,'inserted',v_inserted,'skipped',v_total-v_inserted,'failed',0,'replaced',v_replaced,'request_id',p_request_id);
 UPDATE administration_imports.expense_batches SET result=v_result WHERE id=p_request_id;
 RETURN v_result;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA administration_imports FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_expense_import(uuid,text,boolean,integer,bigint), public.stage_expense_import(uuid,integer,jsonb), public.commit_expense_import(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.begin_expense_import(uuid,text,boolean,integer,bigint), public.stage_expense_import(uuid,integer,jsonb), public.commit_expense_import(uuid) TO authenticated;
