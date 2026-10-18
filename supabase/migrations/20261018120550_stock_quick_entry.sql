-- Quick entry reuses the existing stock register/ledger. No historical rows or
-- expenses are rewritten. Source data provides identity, never on-hand quantity.
BEGIN;
-- The deployed legacy check omits stocktake even though set_stock_count uses it.
-- Extend the vocabulary without rewriting historical movements.
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK (movement_type IN (
 'In','Out','Adjustment','Initial','Reorder','Scrap','receipt','return','transfer_in','adjustment_up',
 'issue','transfer_out','scrap','adjustment_down','stocktake'));
CREATE OR REPLACE FUNCTION public.stock_item_kind(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE
 WHEN p_name ~* '\m(filter|lubricant|coolant|engine oil|hydraulic oil|labour|labor|service|fitting charge)\M' THEN NULL
 WHEN p_name ~* '\m(rim|wheel disc)\M' THEN 'rim'
 WHEN p_name ~* '\m(valve|tube|flap|patch|repair kit|nut|stud)\M' AND
  (p_name ~* '\m(tyre|tire|wheel)\M' OR p_name ~* '[0-9]{3}[[:space:]]*/[[:space:]]*[0-9]{2}[[:space:]]*r?[[:space:]]*[0-9]{2}|[0-9]{2}\.[0-9]{1,2}[[:space:]]*[-r][[:space:]]*[0-9]{2}|[0-9]{4}[[:space:]]*r[[:space:]]*[0-9]{2}') THEN 'accessory'
 WHEN p_name ~* '\m(tyre|tire)\M|[0-9]{3}[[:space:]]*/[[:space:]]*[0-9]{2}[[:space:]]*r?[[:space:]]*[0-9]{2}|[0-9]{2}\.[0-9]{1,2}[[:space:]]*[-r][[:space:]]*[0-9]{2}|[0-9]{4}[[:space:]]*r[[:space:]]*[0-9]{2}' THEN 'tyre'
 ELSE NULL END;
$$;
REVOKE ALL ON FUNCTION public.stock_item_kind(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stock_item_kind(text) TO authenticated;

-- Private-to-the-RPC resolver. Unlike broad expense access, this exposes only
-- physical tyre/rim item identity, with explicit org/country/site predicates.
CREATE OR REPLACE FUNCTION public.stock_entry_resolve(p_source text,p_id text,p_country text,p_site text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d jsonb;
BEGIN
 IF p_source='material' THEN
  SELECT jsonb_build_object('source','material','source_id',m.id,'code',m.item_code,'name',m.item_name,
   'kind',coalesce(stock_item_kind(m.item_name),CASE WHEN m.reviewed AND m.category='tyre' THEN 'tyre' END),
   'brand',m.brand,'unit',m.uom,'reviewed',m.reviewed,'label','MIS / ERP catalogue') INTO d
  FROM material_master m WHERE m.id::text=p_id AND m.organisation_id=app_current_org() AND m.country=p_country;
 ELSIF p_source='mis' THEN
  SELECT jsonb_build_object('source','mis','source_id',m.id,'code',m.item_code,'name',m.item_description,
   'kind',stock_item_kind(m.item_description),'brand',m.brand,'unit',m.uom,'reference',m.issue_number,'date',m.txn_date,'label','MIS / ERP') INTO d
  FROM parts_consumption m WHERE m.id::text=p_id AND m.organisation_id=app_current_org() AND m.country=p_country
   AND (app_sees_all_sites() OR upper(btrim(m.cost_center))=ANY(coalesce(app_site_scope(),'{}'::text[]))
    OR upper(btrim(m.site))=ANY(coalesce(app_site_scope(),'{}'::text[])) OR upper(btrim(m.store_code))=ANY(coalesce(app_site_scope(),'{}'::text[])));
 ELSIF p_source='dtr' THEN
  SELECT jsonb_build_object('source','dtr','source_id',t.id,'code','','name',coalesce(nullif(btrim(t.description),''),concat_ws(' ',t.brand,t.size,'tyre')),
   'kind','tyre','brand',t.brand,'size',t.size,'reference',coalesce(nullif(t.job_card,''),nullif(t.mis_number,''),t.id::text),
   'date',t.issue_date,'label','DTR / tyre record') INTO d
  FROM tyre_records t WHERE t.id::text=p_id AND t.organisation_id=app_current_org() AND t.country=p_country AND upper(btrim(t.site))=upper(btrim(p_site))
   AND (stock_item_kind(t.description)='tyre' OR nullif(btrim(t.size),'') IS NOT NULL);
 END IF;
 IF d IS NULL OR d->>'kind' IS NULL OR nullif(btrim(d->>'name'),'') IS NULL THEN RETURN NULL; END IF;
 RETURN d || jsonb_build_object('key',CASE WHEN nullif(btrim(d->>'code'),'') IS NOT NULL
  THEN 'code:'||upper(btrim(d->>'code')) ELSE 'dtr:'||md5(upper(concat_ws('|',d->>'name',d->>'brand',d->>'size'))) END);
END;
$$;
REVOKE ALL ON FUNCTION public.stock_entry_resolve(text,text,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.stock_item_suggestions(p_country text,p_site text,p_query text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE q text:=regexp_replace(upper(coalesce(p_query,'')),'[^A-Z0-9]','','g'); r record; d jsonb; out jsonb:='[]'; seen text[]:='{}';
BEGIN
 IF auth.uid() IS NULL OR NOT is_approved_and_unlocked() OR app_current_org() IS NULL OR NOT app_user_can('stock','view') THEN RAISE EXCEPTION 'Stock access is required.' USING ERRCODE='42501'; END IF;
 IF nullif(btrim(p_country),'') IS NULL OR p_country='All' OR NOT app_write_country_ok(p_country)
  OR nullif(btrim(p_site),'') IS NULL OR NOT (app_sees_all_sites() OR upper(btrim(p_site))=ANY(coalesce(app_site_scope(),'{}'::text[]))) THEN
  RAISE EXCEPTION 'Choose a permitted country and site.' USING ERRCODE='42501'; END IF;
 IF length(q)<2 THEN RETURN out; END IF;
 IF length(q)>80 THEN RAISE EXCEPTION 'Search is too long.' USING ERRCODE='22023'; END IF;
 FOR r IN
  (SELECT 'material' AS src,m.id::text AS id FROM material_master m
   WHERE m.organisation_id=app_current_org() AND m.country=p_country
   AND (stock_item_kind(m.item_name) IS NOT NULL OR (m.reviewed AND m.category='tyre'))
   AND regexp_replace(upper(concat_ws(' ',m.item_code,m.item_name,m.brand)),'[^A-Z0-9]','','g') LIKE '%'||q||'%'
   ORDER BY m.reviewed DESC,m.item_code,m.id LIMIT 40)
  UNION ALL
  (SELECT 'mis',m.id::text FROM parts_consumption m WHERE m.organisation_id=app_current_org() AND m.country=p_country
   AND stock_item_kind(m.item_description) IS NOT NULL
   AND (app_sees_all_sites() OR upper(btrim(m.cost_center))=ANY(coalesce(app_site_scope(),'{}'::text[])) OR upper(btrim(m.site))=ANY(coalesce(app_site_scope(),'{}'::text[])) OR upper(btrim(m.store_code))=ANY(coalesce(app_site_scope(),'{}'::text[])))
   AND regexp_replace(upper(concat_ws(' ',m.item_code,m.item_description,m.brand)),'[^A-Z0-9]','','g') LIKE '%'||q||'%'
   ORDER BY m.txn_date DESC,m.id LIMIT 60)
  UNION ALL
  (SELECT 'dtr',t.id::text FROM tyre_records t WHERE t.organisation_id=app_current_org() AND t.country=p_country AND upper(btrim(t.site))=upper(btrim(p_site))
   AND (stock_item_kind(t.description)='tyre' OR nullif(btrim(t.size),'') IS NOT NULL)
   AND regexp_replace(upper(concat_ws(' ',t.description,t.brand,t.size)),'[^A-Z0-9]','','g') LIKE '%'||q||'%'
   ORDER BY t.issue_date DESC,t.id LIMIT 40)
 LOOP
  d:=stock_entry_resolve(r.src,r.id,p_country,p_site);
  IF d IS NOT NULL AND NOT (d->>'key'=ANY(seen)) THEN out:=out||jsonb_build_array(d); seen:=array_append(seen,d->>'key'); END IF;
  EXIT WHEN jsonb_array_length(out)>=40;
 END LOOP;
 RETURN out;
END;
$$;
REVOKE ALL ON FUNCTION public.stock_item_suggestions(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.stock_item_suggestions(text,text,text) TO authenticated;

-- Keep all existing custom data; only the stock_item namespace is new.
CREATE UNIQUE INDEX IF NOT EXISTS stock_item_location_identity ON public.stock_records
 (organisation_id,country,upper(btrim(site)),((custom_data->'stock_item'->>'key')))
 WHERE custom_data->'stock_item'->>'key' IS NOT NULL;

CREATE TABLE public.stock_entry_requests (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL REFERENCES public.organisations(id),
 country text NOT NULL, site text NOT NULL, created_by uuid NOT NULL REFERENCES public.profiles(id),
 payload_hash text NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_entry_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_entry_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.stock_entry_requests TO authenticated;
CREATE POLICY stock_entry_requests_read ON public.stock_entry_requests FOR SELECT TO authenticated
 USING (organisation_id=app_current_org() AND app_user_can('stock','view') AND is_approved_and_unlocked()
  AND app_write_country_ok(country) AND (app_sees_all_sites() OR upper(btrim(site))=ANY(coalesce(app_site_scope(),'{}'::text[]))));

CREATE OR REPLACE FUNCTION public.save_stock_entry(p_request_id uuid,p_country text,p_site text,p_mode text,p_reference text,p_notes text,p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_org uuid:=app_current_org(); v_uid uuid:=auth.uid(); l jsonb; d jsonb; meta jsonb; r stock_records%ROWTYPE;
 req stock_entry_requests%ROWTYPE; fingerprint text; out jsonb:='[]'; seen text[]:='{}'; key text;
 qty numeric; before_qty integer; after_qty integer; change_qty integer; status text; movement uuid;
BEGIN
 IF v_uid IS NULL OR v_org IS NULL OR NOT is_approved_and_unlocked() OR NOT app_user_can('stock','view') THEN RAISE EXCEPTION 'Stock access is required.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR nullif(btrim(p_country),'') IS NULL OR p_country='All' OR NOT app_write_country_ok(p_country)
 OR nullif(btrim(p_site),'') IS NULL OR NOT (app_sees_all_sites() OR upper(btrim(p_site))=ANY(coalesce(app_site_scope(),'{}'::text[]))) THEN RAISE EXCEPTION 'Choose a permitted country and site.' USING ERRCODE='42501'; END IF;
 IF p_mode NOT IN ('count','receipt') OR p_mode IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid entry.' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100 OR length(coalesce(p_notes,''))>1000 OR length(coalesce(p_reference,''))>200
 OR (p_mode='receipt' AND nullif(btrim(p_reference),'') IS NULL) THEN RAISE EXCEPTION 'Check item count and receipt reference.' USING ERRCODE='22023'; END IF;
 fingerprint:=md5(jsonb_build_array(p_country,btrim(p_site),p_mode,p_reference,p_notes,p_lines)::text);
 INSERT INTO stock_entry_requests(id,organisation_id,country,site,created_by,payload_hash) VALUES(p_request_id,v_org,p_country,btrim(p_site),v_uid,fingerprint) ON CONFLICT DO NOTHING;
 SELECT * INTO req FROM stock_entry_requests WHERE id=p_request_id FOR UPDATE;
 IF req.organisation_id IS DISTINCT FROM v_org OR req.created_by IS DISTINCT FROM v_uid OR req.payload_hash IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'This request identifier was already used. Review the entry again.' USING ERRCODE='23505'; END IF;
 IF req.result IS NOT NULL THEN RETURN req.result||jsonb_build_object('replayed',true); END IF;
 -- Serialise new-item identity creation in this store. Row locks and expected
 -- versions also protect against the older movement/count writers.
 PERFORM pg_advisory_xact_lock(hashtextextended(v_org::text||p_country||upper(btrim(p_site)),0));
 FOR l IN SELECT value FROM jsonb_array_elements(p_lines) ORDER BY coalesce(value->>'stock_id',value->>'source_id',value->>'name') LOOP
  IF coalesce(l->>'quantity','') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Enter a whole quantity.' USING ERRCODE='22023'; END IF;
  qty:=(l->>'quantity')::numeric;
  IF qty>2147483647 OR (p_mode='receipt' AND qty=0) THEN RAISE EXCEPTION 'Quantity is outside the allowed range.' USING ERRCODE='22023'; END IF;
  IF l->>'unit' IS NULL OR l->>'unit' NOT IN ('PCS','SET','PAIR','BOX','KG','L') THEN RAISE EXCEPTION 'Confirm the unit of measure.' USING ERRCODE='22023'; END IF;
  r:=NULL;
  IF nullif(l->>'stock_id','') IS NOT NULL THEN
   IF NOT app_user_can('stock','edit') THEN RAISE EXCEPTION 'Stock edit permission is required.' USING ERRCODE='42501'; END IF;
   SELECT * INTO r FROM stock_records WHERE id=(l->>'stock_id')::uuid FOR UPDATE;
   IF r.id IS NULL OR r.organisation_id IS DISTINCT FROM v_org OR r.country IS DISTINCT FROM p_country OR upper(btrim(r.site))<>upper(btrim(p_site)) THEN RAISE EXCEPTION 'Stock item is outside this store.' USING ERRCODE='42501'; END IF;
   IF (l->>'expected_qty')::integer IS DISTINCT FROM r.stock_qty OR (l->>'expected_updated_at')::timestamptz IS DISTINCT FROM r.updated_at THEN RAISE EXCEPTION 'Stock changed while you were counting. Refresh and review the latest balance.' USING ERRCODE='40001'; END IF;
   meta:=coalesce(r.custom_data->'stock_item','{}');
   IF nullif(meta->>'unit','') IS NOT NULL AND meta->>'unit'<>l->>'unit' THEN RAISE EXCEPTION 'The recorded unit cannot be changed during a count.' USING ERRCODE='22023'; END IF;
   key:='stock:'||r.id;
  ELSE
   IF NOT app_user_can('stock','create') THEN RAISE EXCEPTION 'Stock create permission is required.' USING ERRCODE='42501'; END IF;
   IF l->>'source'='manual' THEN
    IF l->>'kind' IS NULL OR l->>'kind' NOT IN ('tyre','rim','accessory') OR nullif(btrim(l->>'name'),'') IS NULL OR l->>'name' ~* '\m(filter|lubricant|coolant|engine oil|hydraulic oil|labour|labor|service|fitting charge)\M' OR length(l->>'name')>500 OR length(coalesce(l->>'code',''))>100 THEN RAISE EXCEPTION 'Check the manual item details.' USING ERRCODE='22023'; END IF;
    d:=l||jsonb_build_object('key',CASE WHEN nullif(btrim(l->>'code'),'') IS NOT NULL THEN 'code:'||upper(btrim(l->>'code')) ELSE 'manual:'||md5(upper(btrim(l->>'name'))) END);
   ELSE d:=stock_entry_resolve(l->>'source',l->>'source_id',p_country,p_site);
   END IF;
   IF d IS NULL THEN RAISE EXCEPTION 'This MIS/DTR item is unavailable in your scope. Search again.' USING ERRCODE='42501'; END IF;
   IF coalesce(l->>'condition','') NOT IN ('New','Serviceable','Retread','Unspecified') OR length(coalesce(l->>'bin',''))>80 THEN RAISE EXCEPTION 'Check condition and bin.' USING ERRCODE='22023'; END IF;
   key:=(d->>'key')||'|'||coalesce(l->>'condition','Unspecified')||'|'||upper(btrim(coalesce(l->>'bin','')));
   IF EXISTS(SELECT 1 FROM stock_records s WHERE s.organisation_id=v_org AND s.country=p_country AND upper(btrim(s.site))=upper(btrim(p_site)) AND
    (s.custom_data->'stock_item'->>'key'=key OR (s.custom_data->'stock_item' IS NULL AND lower(btrim(s.description))=lower(btrim(d->>'name'))))) THEN
    RAISE EXCEPTION 'This item already has a stock record. Select it from Existing stock and review its balance.' USING ERRCODE='23505'; END IF;
   meta:=jsonb_build_object('key',key,'code',d->>'code','kind',d->>'kind','unit',l->>'unit','condition',l->>'condition','bin',btrim(coalesce(l->>'bin','')),'source',d);
   INSERT INTO stock_records(organisation_id,country,region,site,description,brand,tyre_size,stock_qty,min_level,critical_level,custom_data,updated_by)
    VALUES(v_org,p_country,p_country,btrim(p_site),d->>'name',coalesce(d->>'brand',l->>'brand'),coalesce(d->>'size',l->>'size'),0,0,0,jsonb_build_object('stock_item',meta),v_uid) RETURNING * INTO r;
  END IF;
  IF key=ANY(seen) THEN RAISE EXCEPTION 'Duplicate item in this batch.' USING ERRCODE='23505'; END IF;
  seen:=array_append(seen,key);
  IF EXISTS(SELECT 1 FROM workflow_instances w WHERE w.organisation_id=v_org AND w.entity_type='stock_issue' AND w.entity_id=r.id::text AND w.status IN ('pending','in_review','returned','approved')) THEN
   RAISE EXCEPTION 'An approval workflow protects this stock record.' USING ERRCODE='PT423'; END IF;
  before_qty:=coalesce(r.stock_qty,0); after_qty:=CASE WHEN p_mode='count' THEN qty::integer ELSE before_qty+qty::integer END;
  change_qty:=after_qty-before_qty;
  status:=CASE WHEN after_qty<=coalesce(r.critical_level,0) THEN 'Critical' WHEN after_qty<=coalesce(r.min_level,0) THEN 'Low' ELSE 'OK' END;
  INSERT INTO stock_movements(stock_id,site,description,movement_type,qty_before,qty_change,qty_after,reason,reference_no,created_by,organisation_id)
   VALUES(r.id,r.site,r.description,CASE WHEN p_mode='count' THEN 'stocktake' ELSE 'receipt' END,before_qty,change_qty,after_qty,
    concat_ws(': ',CASE WHEN p_mode='count' THEN 'Physical stock count' ELSE 'Stock receipt' END,nullif(btrim(p_notes),'')),coalesce(nullif(btrim(p_reference),''),'COUNT-'||p_request_id::text),v_uid,v_org) RETURNING id INTO movement;
  UPDATE stock_records SET stock_qty=after_qty,stock_status=status,custom_data=jsonb_set(coalesce(custom_data,'{}'),'{stock_item}',meta||jsonb_build_object('unit',l->>'unit')),
   updated_by=v_uid,updated_at=clock_timestamp(),last_counted_at=CASE WHEN p_mode='count' THEN clock_timestamp() ELSE last_counted_at END WHERE id=r.id;
  PERFORM record_audit_event('stock_quick_entry','stock_records',r.id::text,jsonb_build_object('qty_before',before_qty),jsonb_build_object('request_id',p_request_id,'movement_id',movement,'mode',p_mode,'qty_after',after_qty,'source',meta->'source'));
  out:=out||jsonb_build_array(jsonb_build_object('stock_id',r.id,'movement_id',movement,'qty_before',before_qty,'qty_after',after_qty,'qty_change',change_qty));
 END LOOP;
 UPDATE stock_entry_requests SET result=jsonb_build_object('status','posted','request_id',p_request_id,'items',out) WHERE id=p_request_id RETURNING result INTO d;
 RETURN d;
END;
$$;
REVOKE ALL ON FUNCTION public.save_stock_entry(uuid,text,text,text,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_stock_entry(uuid,text,text,text,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.transfer_stock_entry(p_request_id uuid,p_from uuid,p_to uuid,p_qty integer,p_expected_from integer,p_expected_to integer,p_notes text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a stock_records%ROWTYPE; b stock_records%ROWTYPE; req stock_entry_requests%ROWTYPE; h text; ma jsonb; mb jsonb; v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR app_current_org() IS NULL OR NOT is_approved_and_unlocked() OR NOT app_user_can('stock','edit') THEN RAISE EXCEPTION 'Stock edit permission is required.' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from=p_to OR p_qty IS NULL OR p_qty<=0 OR length(coalesce(p_notes,''))>1000 THEN RAISE EXCEPTION 'Check transfer items and quantity.' USING ERRCODE='22023'; END IF;
 PERFORM id FROM stock_records WHERE id IN (p_from,p_to) ORDER BY id FOR UPDATE;
 SELECT * INTO a FROM stock_records WHERE id=p_from; SELECT * INTO b FROM stock_records WHERE id=p_to;
 IF a.id IS NULL OR b.id IS NULL OR a.organisation_id IS DISTINCT FROM app_current_org() OR b.organisation_id IS DISTINCT FROM app_current_org()
 OR a.country IS NULL OR b.country IS NULL OR nullif(btrim(a.site),'') IS NULL OR nullif(btrim(b.site),'') IS NULL OR a.country IS DISTINCT FROM b.country OR NOT app_write_country_ok(a.country) OR NOT app_write_country_ok(b.country)
 OR NOT (app_sees_all_sites() OR (upper(btrim(a.site))=ANY(coalesce(app_site_scope(),'{}'::text[])) AND upper(btrim(b.site))=ANY(coalesce(app_site_scope(),'{}'::text[])))) THEN RAISE EXCEPTION 'Transfer items are outside your scope.' USING ERRCODE='42501'; END IF;
 IF upper(btrim(a.site))=upper(btrim(b.site)) THEN RAISE EXCEPTION 'Choose different source and destination sites.' USING ERRCODE='22023'; END IF;
 h:=md5(jsonb_build_array('transfer',p_from,p_to,p_qty,p_expected_from,p_expected_to,p_notes)::text);
 INSERT INTO stock_entry_requests(id,organisation_id,country,site,created_by,payload_hash) VALUES(p_request_id,app_current_org(),a.country,a.site,auth.uid(),h) ON CONFLICT DO NOTHING;
 SELECT * INTO req FROM stock_entry_requests WHERE id=p_request_id FOR UPDATE;
 IF req.organisation_id IS DISTINCT FROM app_current_org() OR req.created_by IS DISTINCT FROM auth.uid() OR req.payload_hash IS DISTINCT FROM h THEN RAISE EXCEPTION 'Transfer request identifier was already used.' USING ERRCODE='23505'; END IF;
 IF req.result IS NOT NULL THEN RETURN req.result||jsonb_build_object('replayed',true); END IF;
 ma:=coalesce(a.custom_data->'stock_item','{}'); mb:=coalesce(b.custom_data->'stock_item','{}');
 IF coalesce(ma->>'unit','')<>coalesce(mb->>'unit','') OR coalesce(ma->>'condition','Unspecified')<>coalesce(mb->>'condition','Unspecified')
 OR (CASE WHEN nullif(ma->>'code','') IS NOT NULL AND nullif(mb->>'code','') IS NOT NULL THEN upper(ma->>'code')<>upper(mb->>'code')
 ELSE regexp_replace(upper(coalesce(a.description,'')),'[^A-Z0-9]','','g')<>regexp_replace(upper(coalesce(b.description,'')),'[^A-Z0-9]','','g')
  OR coalesce(a.brand,'')<>coalesce(b.brand,'') OR coalesce(a.tyre_size,'')<>coalesce(b.tyre_size,'') END) THEN
 RAISE EXCEPTION 'Select the same item, condition and unit at the destination.' USING ERRCODE='22023'; END IF;
 IF a.stock_qty IS DISTINCT FROM p_expected_from OR b.stock_qty IS DISTINCT FROM p_expected_to THEN RAISE EXCEPTION 'Stock changed. Refresh and review the transfer.' USING ERRCODE='40001'; END IF;
 IF p_qty>a.stock_qty OR b.stock_qty::bigint+p_qty>2147483647 THEN RAISE EXCEPTION 'Insufficient stock or quantity outside the allowed range.' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM workflow_instances WHERE organisation_id=app_current_org() AND entity_type IN ('tyre_transfer','stock_issue') AND entity_id IN (p_from::text,p_to::text) AND status IN ('pending','in_review','returned','approved')) THEN RAISE EXCEPTION 'An approval workflow protects this transfer.' USING ERRCODE='PT423'; END IF;
 INSERT INTO stock_movements(stock_id,site,description,movement_type,qty_before,qty_change,qty_after,reason,reference_no,created_by,organisation_id) VALUES
 (a.id,a.site,a.description,'transfer_out',a.stock_qty,-p_qty,a.stock_qty-p_qty,concat('Transfer to ',b.site,': ',p_notes),'TRANSFER-'||p_request_id::text,auth.uid(),app_current_org()),
 (b.id,b.site,b.description,'transfer_in',b.stock_qty,p_qty,b.stock_qty+p_qty,concat('Transfer from ',a.site,': ',p_notes),'TRANSFER-'||p_request_id::text,auth.uid(),app_current_org());
 UPDATE stock_records SET stock_qty=stock_qty+CASE WHEN id=p_from THEN -p_qty ELSE p_qty END,
  stock_status=CASE WHEN stock_qty+CASE WHEN id=p_from THEN -p_qty ELSE p_qty END<=coalesce(critical_level,0) THEN 'Critical' WHEN stock_qty+CASE WHEN id=p_from THEN -p_qty ELSE p_qty END<=coalesce(min_level,0) THEN 'Low' ELSE 'OK' END,
  updated_by=auth.uid(),updated_at=clock_timestamp() WHERE id IN (p_from,p_to);
 PERFORM record_audit_event('stock_transfer','stock_records',p_from::text,jsonb_build_object('from_qty',a.stock_qty,'to_qty',b.stock_qty),jsonb_build_object('from_id',p_from,'to_id',p_to,'qty',p_qty,'request_id',p_request_id));
 v_result:=jsonb_build_object('status','posted','from_stock_id',p_from,'to_stock_id',p_to,'qty',p_qty);
 UPDATE stock_entry_requests SET result=v_result WHERE id=p_request_id;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.transfer_stock_entry(uuid,uuid,uuid,integer,integer,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transfer_stock_entry(uuid,uuid,uuid,integer,integer,integer,text) TO authenticated;
COMMIT;
