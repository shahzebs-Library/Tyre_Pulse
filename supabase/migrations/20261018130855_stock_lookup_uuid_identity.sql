-- Production MIS identities are UUIDs; preserve indexed equality.
BEGIN;
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
  FROM parts_consumption m WHERE m.id=p_id::uuid AND m.organisation_id=v_org AND m.country=p_country
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


NOTIFY pgrst, 'reload schema';
COMMIT;
