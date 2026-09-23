-- Retain history and reversible evidence when removing an erroneous legacy upload.
CREATE SCHEMA IF NOT EXISTS administration_imports;
REVOKE ALL ON SCHEMA administration_imports FROM PUBLIC,anon,authenticated;
ALTER TABLE public.upload_history ADD COLUMN IF NOT EXISTS organisation_id uuid;
ALTER TABLE public.upload_history ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
ALTER TABLE public.upload_history ADD COLUMN IF NOT EXISTS reversed_by uuid;
ALTER TABLE public.upload_history ADD COLUMN IF NOT EXISTS reversed_count integer;
CREATE TABLE administration_imports.upload_reversals (
 batch_id uuid PRIMARY KEY, organisation_id uuid NOT NULL, actor uuid NOT NULL,
 country text NOT NULL, reason text NOT NULL, reversed_at timestamptz NOT NULL DEFAULT now(), result jsonb NOT NULL
);
CREATE TABLE administration_imports.upload_reversal_rows (
 batch_id uuid NOT NULL REFERENCES administration_imports.upload_reversals(batch_id),
 row_id uuid NOT NULL,row_data jsonb NOT NULL,PRIMARY KEY(batch_id,row_id)
);
ALTER TABLE administration_imports.upload_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE administration_imports.upload_reversal_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON administration_imports.upload_reversals,administration_imports.upload_reversal_rows FROM PUBLIC,anon,authenticated;

-- Attribute existing history only when surviving destination rows prove one tenant.
-- Empty, mixed-tenant and unattributable batches stay NULL (platform-owner review).
UPDATE public.upload_history h SET organisation_id=verified.organisation_id
FROM (
 SELECT upload_batch_id,(array_agg(DISTINCT organisation_id))[1] organisation_id
 FROM public.tyre_records WHERE upload_batch_id IS NOT NULL
 GROUP BY upload_batch_id HAVING count(DISTINCT organisation_id)=1 AND count(*)=count(organisation_id)
) verified WHERE h.batch_id=verified.upload_batch_id AND h.organisation_id IS NULL;
CREATE POLICY upload_history_tenant_guard ON public.upload_history AS RESTRICTIVE FOR ALL TO authenticated
 USING (public.is_super_admin() OR organisation_id=public.app_current_org())
 WITH CHECK (public.is_super_admin() OR (organisation_id=public.app_current_org() AND uploaded_by=auth.uid()));

CREATE FUNCTION administration_imports.guard_upload_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_reversal administration_imports.upload_reversals;
BEGIN
 IF TG_OP='INSERT' THEN
  IF auth.uid() IS NOT NULL THEN
   NEW.organisation_id:=public.app_current_org(); NEW.uploaded_by:=auth.uid();
  END IF;
 ELSIF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
    OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by THEN
  RAISE EXCEPTION 'Upload history ownership is immutable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_reversal FROM administration_imports.upload_reversals WHERE batch_id=NEW.batch_id;
 IF FOUND THEN
  NEW.reversed_at:=v_reversal.reversed_at; NEW.reversed_by:=v_reversal.actor;
  NEW.reversed_count:=(v_reversal.result->>'removed')::integer;
 ELSE
  NEW.reversed_at:=NULL; NEW.reversed_by:=NULL; NEW.reversed_count:=NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION administration_imports.guard_upload_history() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_upload_history BEFORE INSERT OR UPDATE ON public.upload_history
 FOR EACH ROW EXECUTE FUNCTION administration_imports.guard_upload_history();

CREATE FUNCTION public.reverse_legacy_upload(p_batch_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_org uuid:=public.app_current_org(); v_country text; v_count integer; v_result jsonb; v_old administration_imports.upload_reversals;
BEGIN
 IF auth.uid() IS NULL OR v_org IS NULL OR NOT coalesce(public.app_is_active(),false)
   OR NOT coalesce(public.app_can_admin_delete(),false) THEN
  RAISE EXCEPTION 'Only active administrators may reverse an upload' USING ERRCODE='42501';
 END IF;
 IF p_batch_id IS NULL OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 2000 THEN
  RAISE EXCEPTION 'A reversal reason is required' USING ERRCODE='22023';
 END IF;
 -- Serialize destination writers as well as two reviewers. Locks are released on failure.
 LOCK TABLE public.tyre_records IN SHARE ROW EXCLUSIVE MODE;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_batch_id::text,0));
 SELECT * INTO v_old FROM administration_imports.upload_reversals WHERE batch_id=p_batch_id;
 IF FOUND THEN
  IF v_old.organisation_id<>v_org OR NOT coalesce(public.app_write_country_ok(v_old.country),false) THEN
   RAISE EXCEPTION 'Upload access denied' USING ERRCODE='42501';
  END IF;
  RETURN v_old.result;
 END IF;
 PERFORM 1 FROM public.upload_history WHERE batch_id=p_batch_id FOR UPDATE;
 IF NOT FOUND OR EXISTS (
  SELECT 1 FROM public.upload_history h
   WHERE h.batch_id=p_batch_id AND (h.organisation_id IS DISTINCT FROM v_org OR nullif(btrim(h.country),'') IS NULL
     OR NOT coalesce(public.app_write_country_ok(h.country),false))
 ) THEN RAISE EXCEPTION 'Upload ownership or country cannot be verified' USING ERRCODE='42501'; END IF;
 SELECT min(country) INTO v_country FROM public.upload_history WHERE batch_id=p_batch_id;
 IF EXISTS(SELECT 1 FROM public.upload_history WHERE batch_id=p_batch_id AND country<>v_country)
  OR EXISTS(SELECT 1 FROM public.tyre_records WHERE upload_batch_id=p_batch_id AND (organisation_id IS DISTINCT FROM v_org OR country IS DISTINCT FROM v_country)) THEN
  RAISE EXCEPTION 'Upload has conflicting tenant or country rows; administrator reconciliation required' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.cleaning_log c JOIN public.tyre_records t ON t.id=c.tyre_record_id WHERE t.upload_batch_id=p_batch_id)
  OR EXISTS(SELECT 1 FROM public.tyre_disposals d JOIN public.tyre_records t ON t.id=d.tyre_record_id WHERE t.upload_batch_id=p_batch_id) THEN
  RAISE EXCEPTION 'This batch has cleaning or disposal activity. Resolve dependent records before reversal.' USING ERRCODE='23503';
 END IF;
 SELECT count(*) INTO v_count FROM public.tyre_records WHERE upload_batch_id=p_batch_id;
 v_result:=jsonb_build_object('ok',true,'removed',v_count,'batch_id',p_batch_id);
 INSERT INTO administration_imports.upload_reversals(batch_id,organisation_id,actor,country,reason,result)
 VALUES(p_batch_id,v_org,auth.uid(),v_country,btrim(p_reason),v_result);
 INSERT INTO administration_imports.upload_reversal_rows
 SELECT p_batch_id,t.id,to_jsonb(t) FROM public.tyre_records t WHERE t.upload_batch_id=p_batch_id;
 DELETE FROM public.tyre_records WHERE upload_batch_id=p_batch_id;
 UPDATE public.upload_history SET reversed_at=now(),reversed_by=auth.uid(),reversed_count=v_count WHERE batch_id=p_batch_id;
 INSERT INTO public.audit_log_v2(user_id,action,table_name,record_id,org_id,country,record_count,new_values)
 VALUES(auth.uid(),'DELETE','tyre_records',p_batch_id::text,v_org,v_country,v_count,
 jsonb_build_object('reason',btrim(p_reason),'batch_id',p_batch_id,'history_retained',true,'archived_rows',v_count));
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.reverse_legacy_upload(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reverse_legacy_upload(uuid,text) TO authenticated;
