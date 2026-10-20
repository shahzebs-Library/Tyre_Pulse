-- Keep search scoped while avoiding full ERP scans and per-row permission helpers.
BEGIN;
SET LOCAL lock_timeout='5s';
-- Index only eligible tyre/rim inventory identities, not general ERP spares.
-- These ordered partial indexes match the RPC predicates and stop after its LIMIT.
CREATE INDEX IF NOT EXISTS parts_consumption_stock_lookup_idx
 ON public.parts_consumption (organisation_id,country,txn_date DESC,id)
 WHERE public.stock_item_kind(item_description) IS NOT NULL;
CREATE INDEX IF NOT EXISTS material_master_stock_lookup_idx
 ON public.material_master (organisation_id,country,reviewed DESC,item_code,id)
 WHERE public.stock_item_kind(item_name) IS NOT NULL OR (reviewed AND category='tyre');
CREATE INDEX IF NOT EXISTS tyre_records_stock_lookup_idx
 ON public.tyre_records (organisation_id,country,upper(btrim(site)),issue_date DESC,id)
 WHERE public.stock_item_kind(description)='tyre' OR nullif(btrim(size),'') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.stock_entry_resolve(p_source text,p_id text,p_country text,p_site text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d jsonb; v_org uuid:=app_current_org(); v_all boolean:=coalesce(app_sees_all_sites(),false); v_sites text[]:=coalesce(app_site_scope(),'{}'::text[]);
BEGIN
 IF p_source='material' THEN
  SELECT jsonb_build_object('source','material','source_id',m.id,'code',m.item_code,'name',m.item_name,
   'kind',coalesce(stock_item_kind(m.item_name),CASE WHEN m.reviewed AND m.category='tyre' THEN 'tyre' END),
   'brand',m.brand,'unit',m.uom,'reviewed',m.reviewed,'label','MIS / ERP catalogue') INTO d
  FROM material_master m WHERE m.id=p_id::uuid AND m.organisation_id=v_org AND m.country=p_country;
 ELSIF p_source='mis' THEN
  SELECT jsonb_build_object('source','mis','source_id',m.id,'code',m.item_code,'name',m.item_description,
   'kind',stock_item_kind(m.item_description),'brand',m.brand,'unit',m.uom,'reference',m.issue_number,'date',m.txn_date,'label','MIS / ERP') INTO d
  FROM parts_consumption m WHERE m.id=p_id::bigint AND m.organisation_id=v_org AND m.country=p_country
   AND (v_all OR upper(btrim(m.cost_center))=ANY(v_sites)
    OR upper(btrim(m.site))=ANY(v_sites) OR upper(btrim(m.store_code))=ANY(v_sites));
 ELSIF p_source='dtr' THEN
  SELECT jsonb_build_object('source','dtr','source_id',t.id,'code','','name',coalesce(nullif(btrim(t.description),''),concat_ws(' ',t.brand,t.size,'tyre')),
   'kind','tyre','brand',t.brand,'size',t.size,'reference',coalesce(nullif(t.job_card,''),nullif(t.mis_number,''),t.id::text),
   'date',t.issue_date,'label','DTR / tyre record') INTO d
  FROM tyre_records t WHERE t.id=p_id::uuid AND t.organisation_id=v_org AND t.country=p_country AND upper(btrim(t.site))=upper(btrim(p_site))
   AND (stock_item_kind(t.description)='tyre' OR nullif(btrim(t.size),'') IS NOT NULL);
 END IF;
 IF d IS NULL OR d->>'kind' IS NULL OR nullif(btrim(d->>'name'),'') IS NULL THEN RETURN NULL; END IF;
 RETURN d || jsonb_build_object('key',CASE WHEN nullif(btrim(d->>'code'),'') IS NOT NULL
  THEN 'code:'||upper(btrim(d->>'code')) ELSE 'dtr:'||md5(upper(concat_ws('|',d->>'name',d->>'brand',d->>'size'))) END);
END;
$$;
REVOKE ALL ON FUNCTION public.stock_entry_resolve(text,text,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.stock_item_suggestions(p_country text,p_site text,p_query text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE q text:=regexp_replace(upper(coalesce(p_query,'')),'[^A-Z0-9]','','g'); r record; d jsonb; out jsonb:='[]'; seen text[]:='{}'; v_org uuid:=app_current_org(); v_all boolean:=coalesce(app_sees_all_sites(),false); v_sites text[]:=coalesce(app_site_scope(),'{}'::text[]);
BEGIN
 IF auth.uid() IS NULL OR (is_approved_and_unlocked() IS NOT TRUE) OR v_org IS NULL OR (app_user_can('stock','view') IS NOT TRUE) THEN RAISE EXCEPTION 'Stock access is required.' USING ERRCODE='42501'; END IF;
 IF nullif(btrim(p_country),'') IS NULL OR p_country='All' OR (app_write_country_ok(p_country) IS NOT TRUE)
  OR nullif(btrim(p_site),'') IS NULL OR NOT (v_all OR upper(btrim(p_site))=ANY(v_sites)) THEN
  RAISE EXCEPTION 'Choose a permitted country and site.' USING ERRCODE='42501'; END IF;
 IF length(q)<2 THEN RETURN out; END IF;
 IF length(q)>80 THEN RAISE EXCEPTION 'Search is too long.' USING ERRCODE='22023'; END IF;
 FOR r IN
  (SELECT 'material' AS src,m.id::text AS id FROM material_master m
   WHERE m.organisation_id=v_org AND m.country=p_country
   AND (stock_item_kind(m.item_name) IS NOT NULL OR (m.reviewed AND m.category='tyre'))
   AND regexp_replace(upper(concat_ws(' ',m.item_code,m.item_name,m.brand)),'[^A-Z0-9]','','g') LIKE '%'||q||'%'
   ORDER BY m.reviewed DESC,m.item_code,m.id LIMIT 40)
  UNION ALL
  (SELECT 'mis',m.id::text FROM parts_consumption m WHERE m.organisation_id=v_org AND m.country=p_country
   AND stock_item_kind(m.item_description) IS NOT NULL
   AND (v_all OR upper(btrim(m.cost_center))=ANY(v_sites) OR upper(btrim(m.site))=ANY(v_sites) OR upper(btrim(m.store_code))=ANY(v_sites))
   AND regexp_replace(upper(concat_ws(' ',m.item_code,m.item_description,m.brand)),'[^A-Z0-9]','','g') LIKE '%'||q||'%'
   ORDER BY m.txn_date DESC,m.id LIMIT 60)
  UNION ALL
  (SELECT 'dtr',t.id::text FROM tyre_records t WHERE t.organisation_id=v_org AND t.country=p_country AND upper(btrim(t.site))=upper(btrim(p_site))
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


NOTIFY pgrst, 'reload schema';
COMMIT;
