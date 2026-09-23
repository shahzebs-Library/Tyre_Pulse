-- Pre-execution approval adapters. No tyre fitment or work start occurs on approval itself.
ALTER TABLE public.approval_policies DROP CONSTRAINT approval_policies_entity_type_check;
ALTER TABLE public.approval_policies ADD CONSTRAINT approval_policies_entity_type_check CHECK(entity_type IN ('inspection','checklist','work_order','tyre_change'));

CREATE TABLE public.approval_execution_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid NOT NULL,
 entity_type text NOT NULL CHECK(entity_type IN ('work_order','tyre_change')),
 work_order_id uuid REFERENCES public.work_orders(id),vehicle_id uuid REFERENCES public.vehicle_fleet(id),
 asset_no text NOT NULL,country text,site text,title text NOT NULL,
 payload jsonb NOT NULL,source_snapshot jsonb NOT NULL,operation_id uuid NOT NULL UNIQUE,
 submitted_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 approval_status text NOT NULL DEFAULT 'pending' CHECK(approval_status IN ('pending','approved','rejected')),
 status text NOT NULL DEFAULT 'submitted',approval_outcome text,
 approval_revision bigint NOT NULL DEFAULT 1,approval_workflow_id uuid,approval_policy_required boolean NOT NULL DEFAULT true,
 approved_by uuid,approver_name text,approver_signature text,approved_at timestamptz,review_note text,
 executed_at timestamptz,executed_by uuid,execution_operation_id uuid UNIQUE,execution_result jsonb,
 CHECK((entity_type='work_order' AND work_order_id IS NOT NULL) OR (entity_type='tyre_change' AND vehicle_id IS NOT NULL))
);
CREATE INDEX approval_execution_work_order_idx ON public.approval_execution_requests(work_order_id,created_at DESC) WHERE work_order_id IS NOT NULL;
CREATE INDEX approval_execution_vehicle_idx ON public.approval_execution_requests(vehicle_id,created_at DESC) WHERE vehicle_id IS NOT NULL;
CREATE INDEX approval_execution_workflow_idx ON public.approval_execution_requests(approval_workflow_id);
ALTER TABLE public.approval_execution_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.approval_execution_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.approval_execution_requests TO authenticated;
CREATE POLICY execution_request_scope ON public.approval_execution_requests FOR SELECT TO authenticated
 USING(public.approval_workflow_visible(organisation_id,entity_type,jsonb_build_object('approval_matrix',true,'content',jsonb_build_object('country',country,'site',site))));

CREATE FUNCTION approval_private.module_keys(p_type text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE p_type WHEN 'inspection' THEN ARRAY['inspections','mobile:inspections'] WHEN 'checklist' THEN ARRAY['checklists','my_checklists','mobile:checklists']
 WHEN 'work_order' THEN ARRAY['work_orders','mobile:workorders','mobile:work_orders'] WHEN 'tyre_change' THEN ARRAY['tyre_records','mobile:tyreChange','mobile:tyre_records'] ELSE '{}'::text[] END
$$;
CREATE FUNCTION approval_private.caller_module_access(p_type text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(approval_policy_is_admin() OR EXISTS(SELECT 1 FROM unnest(approval_private.module_keys(p_type)) k WHERE app_user_can(k,'view')),false)
$$;
CREATE FUNCTION approval_private.enforced(p_type text,p_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM approval_policies WHERE organisation_id=p_org AND entity_type=p_type AND effective_at<=now())
$$;
CREATE FUNCTION approval_private.can_execute(p_type text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(app_is_active(),false) AND coalesce(approval_policy_is_admin() OR app_user_can(CASE WHEN p_type='work_order' THEN 'work_orders' ELSE 'tyre_records' END,'edit'),false)
$$;
CREATE FUNCTION approval_private.assert_scope(p_type text,p_org uuid,p_country text,p_site text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(app_is_active(),false) OR p_org IS DISTINCT FROM app_current_org() OR NOT approval_private.caller_module_access(p_type)
 OR NOT coalesce(p_country IS NULL OR is_super_admin() OR app_sees_all_countries() OR lower(btrim(p_country))=ANY(coalesce(app_country_scope(),'{}'::text[])),false)
 OR NOT coalesce(nullif(btrim(p_site),'') IS NULL OR app_sees_all_sites() OR upper(btrim(p_site))=ANY(coalesce(app_site_scope(),'{}'::text[])),false) THEN
  RAISE EXCEPTION 'Execution request unavailable in your scope' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION approval_private.work_order_content(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT p-ARRAY['updated_at','status','started_at','completed_at','execution_approval_id']
$$;
CREATE FUNCTION approval_private.source_matches(p_type text,p_original jsonb,p_current jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN p_type='work_order' THEN approval_private.work_order_content(p_original)=approval_private.work_order_content(p_current)
 ELSE p_original=p_current END
$$;

CREATE FUNCTION approval_private.tyre_source(p_vehicle uuid,p_change jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v vehicle_fleet; dest vehicle_fleet; src tyre_records; occupant tyre_records; source_id uuid; position_text text; target_asset text;
BEGIN
 SELECT * INTO v FROM vehicle_fleet WHERE id=p_vehicle AND organisation_id=app_current_org();
 IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle unavailable' USING ERRCODE='42501'; END IF;
 PERFORM approval_private.assert_scope('tyre_change',v.organisation_id,v.country,v.site);
 target_asset:=coalesce(nullif(upper(btrim(p_change->>'to_asset_no')),''),upper(btrim(v.asset_no)));
 SELECT * INTO dest FROM vehicle_fleet WHERE organisation_id=v.organisation_id AND upper(btrim(asset_no))=target_asset AND country IS NOT DISTINCT FROM v.country;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination vehicle unavailable in the same country' USING ERRCODE='42501'; END IF;
 PERFORM approval_private.assert_scope('tyre_change',dest.organisation_id,dest.country,dest.site);
 IF dest.site IS DISTINCT FROM v.site THEN RAISE EXCEPTION 'Cross-site tyre transfer requires a separate transfer workflow' USING ERRCODE='22023'; END IF;
 -- A stable fleet lock serializes empty-position installs and opposite-direction swaps.
 PERFORM id FROM vehicle_fleet WHERE id IN(v.id,dest.id) ORDER BY id FOR UPDATE;
 SELECT * INTO v FROM vehicle_fleet WHERE id=v.id; SELECT * INTO dest FROM vehicle_fleet WHERE id=dest.id;
 source_id:=nullif(coalesce(p_change->>'tyre_id',p_change->>'removed_record_id'),'')::uuid;
 position_text:=nullif(upper(btrim(coalesce(p_change->>'to_position',p_change->>'position'))),'');
 PERFORM id FROM tyre_records WHERE organisation_id=v.organisation_id AND country IS NOT DISTINCT FROM v.country
  AND (id=source_id OR (upper(btrim(coalesce(asset_no,asset_number)))=target_asset AND upper(btrim(coalesce(tyre_position,position)))=position_text AND tyre_status_is_active(status))) ORDER BY id FOR UPDATE;
 IF source_id IS NOT NULL THEN
  SELECT * INTO src FROM tyre_records WHERE id=source_id AND organisation_id=v.organisation_id AND country IS NOT DISTINCT FROM v.country AND upper(btrim(coalesce(asset_no,asset_number)))=upper(btrim(v.asset_no));
  IF NOT FOUND OR NOT tyre_status_is_active(src.status) THEN RAISE EXCEPTION 'Source tyre is no longer active on this vehicle' USING ERRCODE='40001'; END IF;
 END IF;
 SELECT * INTO occupant FROM tyre_records WHERE organisation_id=v.organisation_id AND country IS NOT DISTINCT FROM v.country
  AND upper(btrim(coalesce(asset_no,asset_number)))=target_asset AND upper(btrim(coalesce(tyre_position,position)))=position_text AND tyre_status_is_active(status) AND id IS DISTINCT FROM source_id LIMIT 1;
 RETURN jsonb_build_object('vehicle',to_jsonb(v),'source_tyre',CASE WHEN src.id IS NULL THEN NULL ELSE to_jsonb(src) END,
 'destination_tyre',CASE WHEN occupant.id IS NULL THEN NULL ELSE to_jsonb(occupant) END,'destination_vehicle',to_jsonb(dest));
END $$;

CREATE FUNCTION approval_private.execution_document(p_type text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r approval_execution_requests; source jsonb;
BEGIN
 SELECT * INTO r FROM approval_execution_requests WHERE id=p_id AND entity_type=p_type AND organisation_id=app_current_org();
 IF NOT FOUND THEN RAISE EXCEPTION 'Execution request unavailable' USING ERRCODE='42501'; END IF;
 PERFORM approval_private.assert_scope(p_type,r.organisation_id,r.country,r.site);
 IF p_type='work_order' THEN
  SELECT to_jsonb(w) INTO source FROM work_orders w WHERE id=r.work_order_id AND organisation_id=app_current_org() FOR UPDATE;
 ELSE
  IF r.executed_at IS NULL THEN source:=approval_private.tyre_source(r.vehicle_id,r.payload); ELSE source:=r.source_snapshot; END IF;
 END IF;
 IF source IS NULL THEN RAISE EXCEPTION 'Source record unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM approval_execution_requests WHERE id=p_id FOR UPDATE;
 RETURN to_jsonb(r)||jsonb_build_object('current_source_snapshot',source);
END $$;

CREATE FUNCTION approval_private.execution_decide(p_type text,p_id uuid,p_decision text,p_note text,p_signature text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE approval_execution_requests SET approval_status=p_decision,approved_by=auth.uid(),approved_at=clock_timestamp(),
 approver_signature=p_signature,approver_name=(SELECT coalesce(full_name,username) FROM profiles WHERE id=auth.uid()),review_note=p_note
 WHERE id=p_id AND entity_type=p_type AND organisation_id=app_current_org() AND approval_status='pending';
 IF NOT FOUND THEN RAISE EXCEPTION 'Execution approval stage changed' USING ERRCODE='40001'; END IF;
 RETURN jsonb_build_object('ok',true,'status',p_decision);
END $$;

ALTER TABLE public.work_orders ADD COLUMN execution_approval_id uuid REFERENCES public.approval_execution_requests(id);
CREATE INDEX work_orders_execution_approval_idx ON public.work_orders(execution_approval_id) WHERE execution_approval_id IS NOT NULL;
CREATE TABLE approval_private.tyre_execution_permits(transaction_id bigint NOT NULL,request_id uuid NOT NULL,record_id uuid,asset_no text,country text,position text,may_insert boolean NOT NULL DEFAULT false);
REVOKE ALL ON approval_private.tyre_execution_permits FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.work_order_approval_context(p_work_order_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w work_orders; r approval_execution_requests; c jsonb; enabled boolean; can_start boolean;
BEGIN
 SELECT * INTO w FROM work_orders WHERE id=p_work_order_id AND organisation_id=app_current_org() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Work order unavailable' USING ERRCODE='42501'; END IF;
 PERFORM approval_private.assert_scope('work_order',w.organisation_id,w.country,w.site);
 enabled:=approval_private.enforced('work_order',w.organisation_id);
 SELECT * INTO r FROM approval_execution_requests WHERE work_order_id=w.id ORDER BY created_at DESC,id DESC LIMIT 1;
 enabled:=enabled OR r.id IS NOT NULL;
 IF r.id IS NOT NULL THEN c:=approval_review_context('work_order',r.id); END IF;
 can_start:=NOT enabled OR (r.approval_status='approved' AND r.approval_outcome='approved' AND approval_private.source_matches('work_order',r.source_snapshot,to_jsonb(w)));
 RETURN jsonb_build_object('mode',CASE WHEN enabled THEN 'enforced' ELSE 'legacy' END,'can_submit',approval_private.can_execute('work_order') AND w.started_at IS NULL AND lower(w.status) IN ('open','new','draft','pending') AND (r.id IS NULL OR r.approval_status='rejected' OR (r.approval_status='approved' AND NOT approval_private.source_matches('work_order',r.source_snapshot,to_jsonb(w)))),
 'can_execute',approval_private.can_execute('work_order') AND (coalesce(can_start,false) OR w.execution_approval_id IS NOT NULL OR (w.started_at IS NOT NULL AND w.execution_approval_id IS NULL)),
 'request_id',r.id,'review',c,'work_order',to_jsonb(w));
END $$;

CREATE FUNCTION public.request_work_order_approval(p_work_order_id uuid,p_operation_id uuid,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w work_orders; r approval_execution_requests;
BEGIN
 IF p_operation_id IS NULL OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'An operation ID and request reason are required' USING ERRCODE='22023'; END IF;
 SELECT * INTO w FROM work_orders WHERE id=p_work_order_id AND organisation_id=app_current_org() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Work order unavailable' USING ERRCODE='42501'; END IF;
 PERFORM approval_private.assert_scope('work_order',w.organisation_id,w.country,w.site);
 IF NOT approval_private.can_execute('work_order') THEN RAISE EXCEPTION 'Work-order edit permission is required to request execution' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM approval_execution_requests WHERE operation_id=p_operation_id;
 IF FOUND THEN
  IF r.submitted_by<>auth.uid() OR r.work_order_id IS DISTINCT FROM w.id OR r.payload->>'reason' IS DISTINCT FROM p_reason THEN RAISE EXCEPTION 'Operation ID already used for a different request' USING ERRCODE='22023'; END IF;
  RETURN work_order_approval_context(w.id);
 END IF;
 IF w.started_at IS NOT NULL OR lower(w.status) NOT IN ('open','new','draft','pending') THEN RAISE EXCEPTION 'Approval must be requested before work starts' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM approval_execution_requests WHERE work_order_id=w.id AND (approval_status='pending' OR (approval_status='approved' AND approval_private.source_matches('work_order',source_snapshot,to_jsonb(w))))) THEN RAISE EXCEPTION 'An active request already exists for this work order' USING ERRCODE='22023'; END IF;
 INSERT INTO approval_execution_requests(organisation_id,entity_type,work_order_id,asset_no,country,site,title,payload,source_snapshot,operation_id,submitted_by)
 VALUES(w.organisation_id,'work_order',w.id,w.asset_no,w.country,w.site,'Work order '||w.work_order_no,
 jsonb_build_object('work_order_id',w.id,'reason',p_reason),to_jsonb(w),p_operation_id,auth.uid());
 RETURN work_order_approval_context(w.id);
END $$;

CREATE FUNCTION approval_private.guard_work_start() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r approval_execution_requests; starting boolean; enabled boolean;
BEGIN
 enabled:=approval_private.enforced('work_order',NEW.organisation_id) OR EXISTS(SELECT 1 FROM approval_execution_requests WHERE work_order_id=NEW.id);
 IF TG_OP='INSERT' THEN
  NEW.execution_approval_id:=NULL;
  IF enabled AND (NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL OR lower(NEW.status) NOT IN ('open','new','draft','pending','cancelled','canceled')) THEN
   RAISE EXCEPTION 'Create the work order and obtain approval before starting work' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 NEW.execution_approval_id:=OLD.execution_approval_id;
 IF NOT enabled THEN RETURN NEW; END IF;
 IF OLD.execution_approval_id IS NULL AND OLD.created_at<(SELECT min(effective_at) FROM approval_policies WHERE organisation_id=OLD.organisation_id AND entity_type='work_order' AND effective_at<=now())
  AND (OLD.started_at IS NOT NULL OR lower(OLD.status) NOT IN ('open','new','draft','pending')) THEN RETURN NEW; END IF;
 IF OLD.organisation_id IS DISTINCT FROM NEW.organisation_id THEN RAISE EXCEPTION 'Work-order organisation is immutable' USING ERRCODE='42501'; END IF;
 starting:=(OLD.started_at IS NULL AND NEW.started_at IS NOT NULL)
  OR (OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL)
  OR (lower(OLD.status) IN ('open','new','draft','pending') AND lower(NEW.status) NOT IN ('open','new','draft','pending','cancelled','canceled'));
 IF NOT starting OR OLD.execution_approval_id IS NOT NULL THEN RETURN NEW; END IF;
 PERFORM approval_private.assert_scope('work_order',NEW.organisation_id,NEW.country,NEW.site);
 IF NOT approval_private.can_execute('work_order') THEN RAISE EXCEPTION 'Work-order edit permission is required to start execution' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM approval_execution_requests WHERE work_order_id=NEW.id ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND OR r.approval_status<>'approved' OR r.approval_outcome<>'approved' OR NOT approval_private.source_matches('work_order',r.source_snapshot,to_jsonb(NEW)) THEN
  RAISE EXCEPTION 'This work order needs approval of its current scope before work can start' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM workflow_instances WHERE id=r.approval_workflow_id AND status='approved') THEN RAISE EXCEPTION 'Approval has not completed all stages' USING ERRCODE='42501'; END IF;
 NEW.execution_approval_id:=r.id; NEW.started_at:=coalesce(OLD.started_at,clock_timestamp());
 INSERT INTO approval_private.permits VALUES(txid_current(),'work_order',r.id) ON CONFLICT DO NOTHING;
 UPDATE approval_execution_requests SET executed_at=clock_timestamp(),executed_by=auth.uid(),status='executed',execution_result=jsonb_build_object('work_order_id',NEW.id) WHERE id=r.id;
 DELETE FROM approval_private.permits WHERE transaction_id=txid_current() AND entity_type='work_order' AND entity_id=r.id;
 RETURN NEW;
END $$;
CREATE TRIGGER z_approval_work_start BEFORE INSERT OR UPDATE ON public.work_orders FOR EACH ROW EXECUTE FUNCTION approval_private.guard_work_start();

CREATE FUNCTION public.request_tyre_change_approval(p_vehicle_id uuid,p_change jsonb,p_operation_id uuid,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE snapshot jsonb; p jsonb:=p_change; r approval_execution_requests; action text:=p_change->>'action';
BEGIN
 IF p_operation_id IS NULL OR nullif(btrim(p_reason),'') IS NULL OR action IS NULL OR action NOT IN ('install','replace','remove','move') THEN RAISE EXCEPTION 'Action, operation ID and reason are required' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p)<>'object' OR (p-ARRAY['action','position','removed_record_id','serial_no','brand','size','tread_depth','photos','km_at_fitment','cost_per_tyre','issue_date','fitment_date','removal_reason','km_at_removal','removal_date','tyre_id','reason','km','date','to_asset_no','to_position'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Unsupported tyre-change field' USING ERRCODE='22023'; END IF;
 IF p->'photos' IS NOT NULL AND jsonb_typeof(p->'photos') NOT IN ('array','null') THEN RAISE EXCEPTION 'Photos must be an array' USING ERRCODE='22023'; END IF;
 IF action IN ('install','replace') AND (nullif(btrim(p->>'position'),'') IS NULL OR nullif(btrim(p->>'serial_no'),'') IS NULL) THEN RAISE EXCEPTION 'A tyre position and serial number are required' USING ERRCODE='22023'; END IF;
 IF action='replace' AND nullif(p->>'removed_record_id','') IS NULL THEN RAISE EXCEPTION 'Replacement requires the currently fitted tyre' USING ERRCODE='22023'; END IF;
 IF action='install' AND nullif(p->>'removed_record_id','') IS NOT NULL THEN RAISE EXCEPTION 'Use replacement when removing a fitted tyre' USING ERRCODE='22023'; END IF;
 IF action IN ('remove','move') AND nullif(p->>'tyre_id','') IS NULL THEN RAISE EXCEPTION 'Source tyre is required' USING ERRCODE='22023'; END IF;
 IF action='move' AND nullif(btrim(p->>'to_position'),'') IS NULL THEN RAISE EXCEPTION 'Destination position is required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each_text(p) x WHERE x.key IN ('km','km_at_fitment','km_at_removal','cost_per_tyre','tread_depth') AND x.value IS NOT NULL AND x.value::numeric<0) THEN RAISE EXCEPTION 'Meters, tread depth and cost cannot be negative' USING ERRCODE='22023'; END IF;
 snapshot:=approval_private.tyre_source(p_vehicle_id,p);
 IF NOT approval_private.can_execute('tyre_change') THEN RAISE EXCEPTION 'Tyre edit permission is required to request execution' USING ERRCODE='42501'; END IF;
 IF action IN ('install','replace') AND snapshot->'destination_tyre'<>'null'::jsonb THEN RAISE EXCEPTION 'Destination position is occupied' USING ERRCODE='22023'; END IF;
 IF action='replace' AND upper(btrim(coalesce(snapshot#>>'{source_tyre,tyre_position}',snapshot#>>'{source_tyre,position}'))) IS DISTINCT FROM upper(btrim(p->>'position')) THEN RAISE EXCEPTION 'Removed tyre does not match the selected position' USING ERRCODE='22023'; END IF;
 p:=p||jsonb_build_object('asset_no',snapshot#>>'{vehicle,asset_no}','country',snapshot#>>'{vehicle,country}','site',snapshot#>>'{vehicle,site}','request_reason',p_reason);
 IF action IN ('install','replace') THEN p:=p||jsonb_build_object('issue_date',coalesce(p->>'issue_date',p->>'fitment_date',current_date::text),'removal_date',coalesce(p->>'removal_date',current_date::text)); END IF;
 IF action='remove' THEN p:=p||jsonb_build_object('date',coalesce(p->>'date',current_date::text),'reason',coalesce(nullif(p->>'reason',''),p_reason)); END IF;
 SELECT * INTO r FROM approval_execution_requests WHERE operation_id=p_operation_id;
 IF FOUND THEN
  IF r.submitted_by<>auth.uid() OR r.vehicle_id IS DISTINCT FROM p_vehicle_id OR r.payload IS DISTINCT FROM p THEN RAISE EXCEPTION 'Operation ID already used for a different request' USING ERRCODE='22023'; END IF;
  RETURN to_jsonb(r);
 END IF;
 INSERT INTO approval_execution_requests(organisation_id,entity_type,vehicle_id,asset_no,country,site,title,payload,source_snapshot,operation_id,submitted_by)
 VALUES((snapshot#>>'{vehicle,organisation_id}')::uuid,'tyre_change',p_vehicle_id,p->>'asset_no',p->>'country',p->>'site',initcap(action)||' tyre on '||(p->>'asset_no'),p,snapshot,p_operation_id,auth.uid()) RETURNING * INTO r;
 SELECT * INTO r FROM approval_execution_requests WHERE id=r.id;
 RETURN to_jsonb(r);
END $$;

CREATE FUNCTION public.tyre_change_approval_context(p_vehicle_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v vehicle_fleet; r approval_execution_requests; items jsonb:='[]'; snapshot jsonb; can_execute boolean; enabled boolean;
BEGIN
 SELECT * INTO v FROM vehicle_fleet WHERE id=p_vehicle_id AND organisation_id=app_current_org();
 IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle unavailable' USING ERRCODE='42501'; END IF;
 PERFORM approval_private.assert_scope('tyre_change',v.organisation_id,v.country,v.site);
 enabled:=approval_private.enforced('tyre_change',v.organisation_id);
 FOR r IN SELECT * FROM approval_execution_requests WHERE vehicle_id=v.id ORDER BY created_at DESC,id DESC LIMIT 100 LOOP
  can_execute:=false;
  IF r.approval_status='approved' AND r.executed_at IS NULL THEN
   BEGIN snapshot:=approval_private.tyre_source(v.id,r.payload); can_execute:=approval_private.can_execute('tyre_change') AND approval_private.source_matches('tyre_change',r.source_snapshot,snapshot);
   EXCEPTION WHEN SQLSTATE '40001' THEN can_execute:=false; END;
  END IF;
  items:=items||jsonb_build_array(to_jsonb(r)||jsonb_build_object('action',r.payload->>'action','status',CASE WHEN r.executed_at IS NOT NULL THEN 'executed' ELSE coalesce(r.approval_outcome,r.approval_status) END,'can_execute',can_execute));
 END LOOP;
 RETURN jsonb_build_object('mode',CASE WHEN enabled OR jsonb_array_length(items)>0 THEN 'enforced' ELSE 'legacy' END,'can_submit',approval_private.can_execute('tyre_change'),'vehicle',to_jsonb(v),'requests',items);
END $$;

CREATE FUNCTION approval_private.guard_tyre_execution() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE enabled boolean; changes_live boolean;
BEGIN
 enabled:=approval_private.enforced('tyre_change',NEW.organisation_id) OR EXISTS(SELECT 1 FROM approval_execution_requests WHERE entity_type='tyre_change' AND organisation_id=NEW.organisation_id AND upper(btrim(asset_no))=upper(btrim(coalesce(NEW.asset_no,NEW.asset_number))) AND executed_at IS NULL);
 IF NOT enabled THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT tyre_status_is_active(NEW.status) THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM approval_private.tyre_execution_permits WHERE transaction_id=txid_current() AND may_insert
   AND asset_no=upper(btrim(coalesce(NEW.asset_no,NEW.asset_number))) AND country IS NOT DISTINCT FROM NEW.country AND position=upper(btrim(coalesce(NEW.tyre_position,NEW.position)))) THEN
   RAISE EXCEPTION 'An approved tyre-change request is required before fitting a tyre' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 changes_live:=(tyre_status_is_active(OLD.status) OR tyre_status_is_active(NEW.status)) AND
  (to_jsonb(OLD)-ARRAY['pressure_reading','tread_depth','findings','photos','remarks','remarks_cleaned']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['pressure_reading','tread_depth','findings','photos','remarks','remarks_cleaned']);
 IF changes_live AND NOT EXISTS(SELECT 1 FROM approval_private.tyre_execution_permits WHERE transaction_id=txid_current() AND record_id=OLD.id) THEN
  RAISE EXCEPTION 'Execute an approved tyre-change request before changing active fitment' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER z_approval_tyre_execution BEFORE INSERT OR UPDATE ON public.tyre_records FOR EACH ROW EXECUTE FUNCTION approval_private.guard_tyre_execution();

CREATE FUNCTION public.execute_approved_tyre_change(p_request_id uuid,p_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r approval_execution_requests; d jsonb; payload jsonb; result jsonb; stamp timestamptz:=clock_timestamp(); fitted uuid;
BEGIN
 IF p_operation_id IS NULL THEN RAISE EXCEPTION 'Execution operation ID is required' USING ERRCODE='22023'; END IF;
 d:=approval_private.execution_document('tyre_change',p_request_id);
 IF NOT approval_private.can_execute('tyre_change') THEN RAISE EXCEPTION 'Tyre edit permission is required to execute this request' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM approval_execution_requests WHERE id=p_request_id FOR UPDATE;
 IF r.executed_at IS NOT NULL THEN
  IF r.executed_by<>auth.uid() OR r.execution_operation_id<>p_operation_id THEN RAISE EXCEPTION 'This tyre request was already executed' USING ERRCODE='40001'; END IF;
  RETURN r.execution_result;
 END IF;
 IF r.approval_status<>'approved' OR r.approval_outcome<>'approved' OR NOT EXISTS(SELECT 1 FROM workflow_instances WHERE id=r.approval_workflow_id AND status='approved') THEN
  RAISE EXCEPTION 'Complete approval before executing the tyre change' USING ERRCODE='42501'; END IF;
 IF NOT approval_private.source_matches('tyre_change',r.source_snapshot,d->'current_source_snapshot') THEN RAISE EXCEPTION 'Tyre fitment changed; submit a fresh request' USING ERRCODE='40001'; END IF;
 payload:=r.payload;
 INSERT INTO approval_private.tyre_execution_permits(transaction_id,request_id,record_id)
 SELECT txid_current(),r.id,nullif(x->>'id','')::uuid FROM jsonb_array_elements(jsonb_build_array(r.source_snapshot->'source_tyre',r.source_snapshot->'destination_tyre')) x WHERE x->>'id' IS NOT NULL;
 INSERT INTO approval_private.tyre_execution_permits(transaction_id,request_id,asset_no,country,position,may_insert)
 VALUES(txid_current(),r.id,upper(btrim(r.asset_no)),r.country,upper(btrim(payload->>'position')),payload->>'action' IN ('install','replace'));
 IF payload->>'action' IN ('install','replace') THEN
  fitted:=public.apply_tyre_change(payload-'action'-'request_reason'); result:=jsonb_build_object('fitment_record_id',fitted);
  INSERT INTO approval_private.tyre_execution_permits(transaction_id,request_id,record_id) VALUES(txid_current(),r.id,fitted);
  UPDATE tyre_records SET size=coalesce(payload->>'size',size),tread_depth=coalesce(nullif(payload->>'tread_depth','')::numeric,tread_depth),photos=coalesce(nullif(payload->'photos','null'::jsonb),photos) WHERE id=fitted;
 ELSIF payload->>'action'='move' THEN result:=public.tyre_move(payload);
 ELSE
  UPDATE tyre_records SET status='Removed',removal_date=(payload->>'date')::date,km_at_removal=nullif(payload->>'km','')::numeric,removal_reason=payload->>'reason' WHERE id=(payload->>'tyre_id')::uuid;
  result:=jsonb_build_object('removed_record_id',payload->>'tyre_id');
 END IF;
 result:=jsonb_build_object('ok',true,'request_id',r.id,'status','executed','result',result,'executed_at',stamp,'operation_id',p_operation_id);
 INSERT INTO approval_private.permits VALUES(txid_current(),'tyre_change',r.id);
 UPDATE approval_execution_requests SET status='executed',executed_at=stamp,executed_by=auth.uid(),execution_operation_id=p_operation_id,execution_result=result WHERE id=r.id;
 DELETE FROM approval_private.permits WHERE transaction_id=txid_current() AND entity_type='tyre_change' AND entity_id=r.id;
 DELETE FROM approval_private.tyre_execution_permits WHERE transaction_id=txid_current() AND request_id=r.id;
 RETURN result;
END $$;
-- Extend the existing engine's module adapters; preserve the inspection/checklist contract.
CREATE OR REPLACE FUNCTION approval_private.content(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT p-ARRAY['updated_at','approval_status','approver_name','approver_email','approver_signature','approved_by','approved_at',
 'supervisor_name','supervisor_signature','supervisor_by','supervisor_at','review_note','locked','locked_at','status','approval_workflow_id','approval_outcome','executed_at','executed_by','execution_operation_id','execution_result']
$$;

CREATE OR REPLACE FUNCTION approval_private.guard_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE kind text:=coalesce(to_jsonb(NEW)->>'entity_type',CASE WHEN TG_TABLE_NAME='inspections' THEN 'inspection' ELSE 'checklist' END);
 old_json jsonb; new_json jsonb; permit boolean; governed boolean;
BEGIN
 new_json:=to_jsonb(NEW);
 SELECT EXISTS(SELECT 1 FROM approval_private.permits WHERE transaction_id=txid_current() AND entity_type=kind AND entity_id=NEW.id) INTO permit;
 IF TG_OP='INSERT' THEN
  NEW.approval_revision:=1; NEW.approval_workflow_id:=NULL; NEW.approval_outcome:=NULL;
  NEW.approval_policy_required:=TG_TABLE_NAME='approval_execution_requests' OR EXISTS(SELECT 1 FROM approval_policies WHERE organisation_id=NEW.organisation_id AND entity_type=kind AND effective_at<=now());
  IF NEW.approval_policy_required
   AND NEW.approval_status IN ('approved','pending_area_manager') THEN RAISE EXCEPTION 'Submit for approval before a decision' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 old_json:=to_jsonb(OLD); governed:=OLD.approval_workflow_id IS NOT NULL OR OLD.approval_policy_required;
 NEW.approval_policy_required:=OLD.approval_policy_required;
 IF NOT permit THEN
  NEW.approval_outcome:=OLD.approval_outcome;
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
   NEW.approval_outcome:=CASE WHEN NEW.approval_status IN ('approved','rejected') THEN NEW.approval_status ELSE NULL END;
  END IF;
 END IF;
 IF NEW.approval_status IN ('pending','pending_approval') AND NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
  NEW.approval_policy_required:=EXISTS(SELECT 1 FROM approval_policies WHERE organisation_id=NEW.organisation_id AND entity_type=kind AND effective_at<=now());
 END IF;
 IF NOT permit AND (NEW.approval_workflow_id IS DISTINCT FROM OLD.approval_workflow_id) THEN RAISE EXCEPTION 'Approval workflow is server controlled' USING ERRCODE='42501'; END IF;
 NEW.approval_revision:=OLD.approval_revision;
 IF approval_private.content(old_json)-'approval_revision'-'approval_policy_required' IS DISTINCT FROM approval_private.content(new_json)-'approval_revision'-'approval_policy_required'
  OR (NEW.approval_status IS DISTINCT FROM OLD.approval_status AND NEW.approval_status IN ('pending','pending_approval')) THEN
  NEW.approval_revision:=OLD.approval_revision+1;
  IF governed AND (OLD.approval_status IN ('pending','pending_area_manager','pending_approval','approved')
   OR EXISTS(SELECT 1 FROM workflow_instances WHERE id=OLD.approval_workflow_id AND status='rejected')) THEN
   RAISE EXCEPTION 'Submitted approval content is immutable; reject and resubmit a corrected revision' USING ERRCODE='40001'; END IF;
 END IF;
 IF governed AND NOT permit AND approval_private.decision_fields(new_json) IS DISTINCT FROM approval_private.decision_fields(old_json) THEN
  -- Existing rejected submissions may start a new revision through normal submission writes.
  IF NOT(OLD.approval_status='rejected' AND NEW.approval_status IN ('pending','pending_approval')
   AND EXISTS(SELECT 1 FROM workflow_instances WHERE id=OLD.approval_workflow_id AND status='returned')) THEN
   RAISE EXCEPTION 'Use the versioned approval decision service' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION approval_private.start_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE kind text:=coalesce(to_jsonb(NEW)->>'entity_type',CASE WHEN TG_TABLE_NAME='inspections' THEN 'inspection' ELSE 'checklist' END);
 route jsonb; requestor uuid; requestor_role text; w uuid; previous uuid; snapshot jsonb; pending boolean; tpl jsonb;
BEGIN
 pending:=NEW.approval_status=CASE WHEN kind='inspection' THEN 'pending_approval' ELSE 'pending' END;
 IF NOT pending OR (TG_OP='UPDATE' AND OLD.approval_status IS NOT DISTINCT FROM NEW.approval_status) THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME<>'approval_execution_requests' AND NOT EXISTS(SELECT 1 FROM approval_policies WHERE organisation_id=NEW.organisation_id AND entity_type=kind AND effective_at<=now()) THEN RETURN NEW; END IF;
 requestor:=nullif(CASE WHEN kind='inspection' THEN to_jsonb(NEW)->>'created_by' ELSE to_jsonb(NEW)->>'submitted_by' END,'')::uuid;
 IF requestor IS NULL OR (auth.uid() IS NOT NULL AND requestor<>auth.uid()) THEN RAISE EXCEPTION 'Submitter identity must match the signed-in user' USING ERRCODE='42501'; END IF;
 SELECT role INTO requestor_role FROM profiles WHERE id=requestor AND org_id=NEW.organisation_id AND approved IS TRUE AND locked IS NOT TRUE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Submitting user is unavailable in this organisation' USING ERRCODE='42501'; END IF;
 route:=approval_private.resolve(NEW.organisation_id,kind,NEW.country,NEW.site,requestor_role,requestor);
 IF kind='checklist' THEN SELECT to_jsonb(t) INTO tpl FROM checklist_templates t WHERE id=(to_jsonb(NEW)->>'template_id')::uuid; END IF;
 snapshot:=route->'policy'; previous:=NEW.approval_workflow_id;
 INSERT INTO approval_private.permits VALUES(txid_current(),kind,NEW.id) ON CONFLICT DO NOTHING;
 INSERT INTO workflow_instances(organisation_id,entity_type,entity_id,entity_label,definition_name,steps,current_step,status,context,started_by,step_started_at,approval_policy_id)
 VALUES(NEW.organisation_id,kind,NEW.id::text,coalesce(NEW.title,NEW.asset_no),'Approval Matrix',
 coalesce((SELECT jsonb_agg(s||jsonb_build_object('assignee_type',CASE WHEN nullif(s->>'approver_user_id','') IS NOT NULL THEN 'user' ELSE 'role' END)) FROM jsonb_array_elements(snapshot->'stages') s),'[]'::jsonb),0,'pending',
 jsonb_build_object('approval_matrix',true,'policy',snapshot,'routing_status',route->>'status','template',tpl,'content',approval_private.content(to_jsonb(NEW))),requestor,clock_timestamp(),nullif(snapshot->>'id','')::uuid) RETURNING id INTO w;
 IF kind='inspection' THEN UPDATE inspections SET approval_workflow_id=w WHERE id=NEW.id; ELSIF kind='checklist' THEN UPDATE checklist_submissions SET approval_workflow_id=w WHERE id=NEW.id; ELSE UPDATE approval_execution_requests SET approval_workflow_id=w WHERE id=NEW.id; END IF;
 INSERT INTO workflow_step_events(instance_id,organisation_id,step_index,step_name,action,actor_id,comment)
 VALUES(w,NEW.organisation_id,0,'Approval Matrix','started',requestor,CASE WHEN route->>'status'='matched' THEN 'Published route selected' ELSE 'Routing exception: '||(route->>'status') END);
 PERFORM approval_private.notify_stage(w);
 DELETE FROM approval_private.permits WHERE transaction_id=txid_current() AND entity_type=kind AND entity_id=NEW.id;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION approval_private.document(p_type text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d jsonb; tpl jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(app_is_active(),false) OR app_current_org() IS NULL THEN RAISE EXCEPTION 'Approval access denied' USING ERRCODE='42501'; END IF;
 IF p_type='inspection' THEN
  SELECT to_jsonb(i) INTO d FROM inspections i WHERE id=p_id AND organisation_id=app_current_org() FOR UPDATE;
 ELSIF p_type='checklist' THEN
  SELECT to_jsonb(c) INTO d FROM checklist_submissions c WHERE id=p_id AND organisation_id=app_current_org() FOR UPDATE;
  IF d IS NOT NULL THEN SELECT to_jsonb(t) INTO tpl FROM checklist_templates t WHERE id=(d->>'template_id')::uuid FOR SHARE; d:=d||jsonb_build_object('checklist_templates',tpl); END IF;
 ELSIF p_type IN ('work_order','tyre_change') THEN d:=approval_private.execution_document(p_type,p_id);
 ELSE RAISE EXCEPTION 'Unsupported approval module' USING ERRCODE='22023'; END IF;
 IF d IS NULL THEN RAISE EXCEPTION 'Approval record unavailable' USING ERRCODE='42501'; END IF;
 IF NOT ((d->>'country' IS NULL) OR is_super_admin() OR app_sees_all_countries() OR lower(btrim(d->>'country'))=ANY(coalesce(app_country_scope(),'{}'::text[])))
 OR NOT (nullif(btrim(d->>'site'),'') IS NULL OR app_sees_all_sites() OR upper(btrim(d->>'site'))=ANY(coalesce(app_site_scope(),'{}'::text[]))) THEN
  RAISE EXCEPTION 'Approval record unavailable' USING ERRCODE='42501'; END IF;
 IF NOT approval_private.caller_module_access(p_type) THEN
  RAISE EXCEPTION 'Approval module access denied' USING ERRCODE='42501'; END IF;
 RETURN d;
END $$;

CREATE OR REPLACE FUNCTION public.approval_workflow_visible(p_org uuid,p_type text,p_context jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE WHEN coalesce(p_context->>'approval_matrix','false')<>'true' THEN true ELSE
  p_org=app_current_org() AND coalesce(app_is_active(),false)
  AND (p_context#>>'{content,country}' IS NULL OR is_super_admin() OR app_sees_all_countries()
   OR lower(btrim(p_context#>>'{content,country}'))=ANY(coalesce(app_country_scope(),'{}'::text[])))
  AND (nullif(btrim(p_context#>>'{content,site}'),'') IS NULL OR app_sees_all_sites()
   OR upper(btrim(p_context#>>'{content,site}'))=ANY(coalesce(app_site_scope(),'{}'::text[])))
  AND approval_private.caller_module_access(p_type)
 END
$$;

CREATE OR REPLACE FUNCTION approval_private.person_eligible(p_user uuid,p_org uuid,p_type text,p_country text,p_site text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce((SELECT u.approved IS TRUE AND u.locked IS NOT TRUE AND u.org_id=p_org
  AND (u.is_super_admin OR u.role=ANY(CASE WHEN p_type='inspection' THEN ARRAY['Admin','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager','Tyre Data Collector']
   ELSE ARRAY['Admin','Maintenance Supervisor','Workshop Supervisor','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager','Tyre Data Collector'] END))
  AND (p_country IS NULL OR u.is_super_admin OR EXISTS(SELECT 1 FROM unnest(coalesce(u.country,u.countries)) x WHERE lower(btrim(x)) IN ('all',lower(btrim(p_country)))))
  AND (nullif(btrim(p_site),'') IS NULL OR u.is_super_admin OR u.role='Admin' OR EXISTS(SELECT 1 FROM unnest(coalesce(u.sites,ARRAY[u.site])) x WHERE upper(btrim(x)) IN ('ALL','*',upper(btrim(p_site)))))
  AND (u.role='Admin' OR u.is_super_admin OR EXISTS(
   SELECT 1 FROM unnest(approval_private.module_keys(p_type)) k
    WHERE NOT EXISTS(SELECT 1 FROM user_access_grants g WHERE g.user_id=u.id AND g.module_key=k AND g.capability='view' AND g.effect='revoke' AND (g.expires_at IS NULL OR g.expires_at>now()))
    AND (coalesce((SELECT m.enabled FROM module_permissions m WHERE m.org_id IS NULL AND m.role=u.role AND m.module_key=k ORDER BY m.updated_at DESC NULLS LAST LIMIT 1),false)
     OR EXISTS(SELECT 1 FROM user_access_grants g WHERE g.user_id=u.id AND g.module_key=k AND g.capability='view' AND g.effect='grant' AND (g.expires_at IS NULL OR g.expires_at>now())))))
 FROM profiles u WHERE u.id=p_user),false)
$$;

CREATE OR REPLACE FUNCTION public.approval_policy_simulate(p_entity_type text,p_country text DEFAULT NULL,p_site text DEFAULT NULL,p_role text DEFAULT NULL,p_user_id uuid DEFAULT NULL,p_draft_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT coalesce(approval_policy_is_admin(),false) THEN RAISE EXCEPTION 'Approval configuration access denied' USING ERRCODE='42501'; END IF;
 IF p_entity_type NOT IN ('inspection','checklist','work_order','tyre_change') THEN RAISE EXCEPTION 'Unsupported approval module' USING ERRCODE='22023'; END IF;
 IF p_draft_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM approval_policies WHERE id=p_draft_id AND organisation_id=app_current_org() AND entity_type=p_entity_type AND state='draft') THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE='42501'; END IF;
 IF p_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_user_id AND org_id=app_current_org()) THEN RAISE EXCEPTION 'Submitting person unavailable' USING ERRCODE='42501'; END IF;
 RETURN approval_private.resolve(app_current_org(),p_entity_type,p_country,p_site,p_role,p_user_id,p_draft_id);
END $$;

CREATE OR REPLACE FUNCTION approval_private.context(p_type text,d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w workflow_instances; stage jsonb; eligible boolean; token text; history jsonb; revision bigint; represented uuid; status text:=d->>'approval_status';
BEGIN
 revision:=('x'||substr(md5(approval_private.content(d)::text),1,13))::bit(52)::bigint;
 IF d->>'approval_workflow_id' IS NOT NULL THEN
  SELECT * INTO w FROM workflow_instances WHERE id=(d->>'approval_workflow_id')::uuid AND organisation_id=app_current_org();
  stage:=w.steps->w.current_step; token:=w.id::text||':'||w.current_step::text||':'||w.approval_route_revision::text;
  represented:=approval_private.represented_actor(w);
  eligible:=w.status IN ('pending','in_review') AND w.context->>'routing_status'='matched'
   AND represented IS NOT NULL
   AND w.started_by IS DISTINCT FROM auth.uid()
   AND (NOT coalesce((stage->>'distinct_reviewer')::boolean,true) OR NOT EXISTS(SELECT 1 FROM workflow_step_events WHERE instance_id=w.id AND action='approved'
    AND (actor_id IN(auth.uid(),represented) OR device_info->>'represented_actor_id' IN(auth.uid()::text,represented::text))));
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) INTO history FROM workflow_step_events e WHERE instance_id=w.id;
 ELSE token:=status; eligible:=NOT coalesce((d->>'approval_policy_required')::boolean,false); history:='[]'::jsonb; END IF;
 eligible:=coalesce(eligible,false) AND CASE WHEN p_type='inspection' THEN status='pending_approval' AND (is_super_admin() OR get_my_role()=ANY(ARRAY['Admin','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager','Tyre Data Collector']))
 ELSE status IN ('pending','pending_area_manager') AND checklist_is_supervisor() AND (status<>'pending_area_manager' OR checklist_is_area_manager()) END;
 RETURN jsonb_build_object('entity_type',p_type,'entity_id',d->>'id','mode',CASE WHEN w.id IS NULL AND NOT coalesce((d->>'approval_policy_required')::boolean,false) THEN 'legacy' ELSE 'enforced' END,
 'revision',revision,'stage_token',token,'status',status,'document',d,'policy',w.context->'policy','stages',coalesce(w.steps,'[]'::jsonb),
 'current_stage',coalesce(w.current_step,0),'can_decide',coalesce(eligible AND (p_type<>'checklist' OR w.id IS NULL OR w.context->'template' IS NOT DISTINCT FROM d->'checklist_templates') AND (p_type NOT IN ('work_order','tyre_change') OR approval_private.source_matches(p_type,d->'source_snapshot',d->'current_source_snapshot')),false),
 'can_return',coalesce(eligible,false),'workflow_status',coalesce(w.status,d->>'approval_outcome',status),
 'represented_actor_id',represented,'routing_status',w.context->>'routing_status','history',history,
 'can_recover',coalesce(approval_policy_is_admin() AND w.status='pending' AND w.current_step=0 AND w.context->>'routing_status'<>'matched',false),
 'can_reassign',coalesce(approval_policy_is_admin() AND w.status IN ('pending','in_review') AND w.context->>'routing_status'='matched',false),
 'can_delegate',coalesce(eligible AND represented=auth.uid(),false),
 'delegations',coalesce((SELECT jsonb_agg(to_jsonb(a)||jsonb_build_object('delegator_name',p.full_name,'delegate_name',q.full_name,'can_revoke',a.active AND (a.delegator_id=auth.uid() OR approval_policy_is_admin())) ORDER BY a.created_at)
  FROM approval_delegations a JOIN profiles p ON p.id=a.delegator_id JOIN profiles q ON q.id=a.delegate_id WHERE a.approval_workflow_id=w.id),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.decide_approval(p_entity_type text,p_entity_id uuid,p_decision text,p_expected_revision bigint,p_expected_stage text,p_operation_id uuid,
 p_note text DEFAULT NULL,p_signature text DEFAULT NULL,p_client_captured_at timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d jsonb; c jsonb; w workflow_instances; req jsonb; accepted jsonb; prev approval_private.decisions; final_stage boolean; domain_decision text; accepted_at timestamptz:=clock_timestamp();
BEGIN
 IF p_decision IS NULL OR p_decision NOT IN ('approved','rejected','returned') OR p_operation_id IS NULL OR p_expected_revision IS NULL OR p_expected_stage IS NULL THEN
  RAISE EXCEPTION 'Decision, reviewed revision, stage and operation ID are required' USING ERRCODE='22023'; END IF;
 d:=approval_private.document(p_entity_type,p_entity_id);
 req:=jsonb_build_object('entity_type',p_entity_type,'entity_id',p_entity_id,'decision',p_decision,'revision',p_expected_revision,'stage',p_expected_stage,'note',p_note,'signature',p_signature,'captured_at',p_client_captured_at);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text,37));
 SELECT * INTO prev FROM approval_private.decisions WHERE operation_id=p_operation_id;
 IF FOUND THEN
  IF prev.organisation_id<>app_current_org() OR prev.actor_id<>auth.uid() OR prev.request IS DISTINCT FROM req THEN RAISE EXCEPTION 'Operation ID was already used for a different decision' USING ERRCODE='22023'; END IF;
  RETURN prev.result;
 END IF;
 c:=approval_private.context(p_entity_type,d);
 IF (c->>'revision')::bigint<>p_expected_revision OR c->>'stage_token' IS DISTINCT FROM p_expected_stage THEN RAISE EXCEPTION 'Approval changed; review the current revision' USING ERRCODE='40001'; END IF;
 IF NOT coalesce((c->>CASE WHEN p_decision='returned' THEN 'can_return' ELSE 'can_decide' END)::boolean,false) THEN RAISE EXCEPTION 'You are not eligible to decide this stage' USING ERRCODE='42501'; END IF;
 IF p_decision='approved' AND nullif(btrim(p_signature),'') IS NULL THEN RAISE EXCEPTION 'A signature is required' USING ERRCODE='22023'; END IF;
 IF p_decision IN ('rejected','returned') AND nullif(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'A rejection or return reason is required' USING ERRCODE='22023'; END IF;
 domain_decision:=CASE WHEN p_decision='returned' THEN 'rejected' ELSE p_decision END;
 INSERT INTO approval_private.permits VALUES(txid_current(),p_entity_type,p_entity_id);
 IF d->>'approval_workflow_id' IS NOT NULL THEN
  SELECT * INTO w FROM workflow_instances WHERE id=(d->>'approval_workflow_id')::uuid FOR UPDATE;
  final_stage:=p_decision<>'approved' OR w.current_step+1>=jsonb_array_length(w.steps);
  IF final_stage THEN
   IF p_entity_type='inspection' THEN UPDATE inspections SET approval_outcome=p_decision WHERE id=p_entity_id;
   ELSIF p_entity_type='checklist' THEN UPDATE checklist_submissions SET approval_outcome=p_decision WHERE id=p_entity_id; ELSE UPDATE approval_execution_requests SET approval_outcome=p_decision WHERE id=p_entity_id; END IF;
  END IF;
  -- Preserve checklist domain stages: the first policy stage advances an area-manager template.
  IF NOT final_stage AND p_entity_type='checklist' AND d->>'approval_status'='pending' AND coalesce((d#>>'{checklist_templates,require_area_manager}')::boolean,false) THEN
   IF p_entity_type='checklist' THEN PERFORM decide_checklist_approval(p_entity_id,domain_decision,p_note,p_signature); ELSE PERFORM approval_private.execution_decide(p_entity_type,p_entity_id,domain_decision,p_note,p_signature); END IF;
  END IF;
  IF final_stage THEN
   IF p_entity_type='inspection' THEN PERFORM decide_inspection_approval(p_entity_id,domain_decision,p_note,p_signature);
   ELSE
    IF p_decision='approved' AND d->>'approval_status'='pending' AND coalesce((d#>>'{checklist_templates,require_area_manager}')::boolean,false) THEN
     RAISE EXCEPTION 'This checklist requires a separate supervisor and area-manager stage' USING ERRCODE='22023'; END IF;
    IF p_entity_type='checklist' THEN PERFORM decide_checklist_approval(p_entity_id,domain_decision,p_note,p_signature); ELSE PERFORM approval_private.execution_decide(p_entity_type,p_entity_id,domain_decision,p_note,p_signature); END IF;
   END IF;
  END IF;
  INSERT INTO workflow_step_events(instance_id,organisation_id,step_index,step_name,action,actor_id,comment,signature_data,printed_name,device_info)
  VALUES(w.id,w.organisation_id,w.current_step,w.steps->w.current_step->>'name',p_decision,auth.uid(),p_note,p_signature,
   (SELECT coalesce(full_name,username) FROM profiles WHERE id=auth.uid()),jsonb_build_object('operation_id',p_operation_id,'content_revision',p_expected_revision,'client_captured_at',p_client_captured_at,'accepted_at',accepted_at,'represented_actor_id',c->>'represented_actor_id'));
  UPDATE workflow_instances SET current_step=CASE WHEN final_stage THEN current_step ELSE current_step+1 END,
   status=CASE WHEN final_stage THEN p_decision ELSE 'pending' END,last_actor_id=auth.uid(),
   step_started_at=CASE WHEN final_stage THEN step_started_at ELSE accepted_at END,completed_at=CASE WHEN final_stage THEN accepted_at ELSE NULL END WHERE id=w.id;
  IF NOT final_stage THEN PERFORM approval_private.notify_stage(w.id); END IF;
 ELSE
  IF p_entity_type='inspection' THEN UPDATE inspections SET approval_outcome=p_decision WHERE id=p_entity_id;
  ELSIF p_entity_type='checklist' THEN UPDATE checklist_submissions SET approval_outcome=p_decision WHERE id=p_entity_id; ELSE UPDATE approval_execution_requests SET approval_outcome=p_decision WHERE id=p_entity_id; END IF;
  IF p_entity_type='inspection' THEN PERFORM decide_inspection_approval(p_entity_id,domain_decision,p_note,p_signature);
  ELSE IF p_entity_type='checklist' THEN PERFORM decide_checklist_approval(p_entity_id,domain_decision,p_note,p_signature); ELSE PERFORM approval_private.execution_decide(p_entity_type,p_entity_id,domain_decision,p_note,p_signature); END IF; END IF;
 END IF;
 d:=approval_private.document(p_entity_type,p_entity_id); c:=approval_private.context(p_entity_type,d);
 accepted:=jsonb_build_object('ok',true,'decision',p_decision,'status',d->>'approval_status','revision',(c->>'revision')::bigint,
  'stage_token',c->>'stage_token','operation_id',p_operation_id,'accepted_at',accepted_at,'workflow_status',c->>'workflow_status');
 INSERT INTO approval_private.decisions(operation_id,organisation_id,actor_id,entity_type,entity_id,request,result,accepted_at)
 VALUES(p_operation_id,app_current_org(),auth.uid(),p_entity_type,p_entity_id,req,accepted,accepted_at);
 DELETE FROM approval_private.permits WHERE transaction_id=txid_current() AND entity_type=p_entity_type AND entity_id=p_entity_id;
 RETURN accepted;
END $$;
CREATE TRIGGER z_approval_document_guard BEFORE INSERT OR UPDATE ON public.approval_execution_requests FOR EACH ROW EXECUTE FUNCTION approval_private.guard_document();
CREATE TRIGGER z_approval_document_start AFTER INSERT OR UPDATE OF approval_status ON public.approval_execution_requests FOR EACH ROW EXECUTE FUNCTION approval_private.start_document();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA approval_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.work_order_approval_context(uuid),public.request_work_order_approval(uuid,uuid,text),public.tyre_change_approval_context(uuid),
 public.request_tyre_change_approval(uuid,jsonb,uuid,text),public.execute_approved_tyre_change(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.work_order_approval_context(uuid),public.request_work_order_approval(uuid,uuid,text),public.tyre_change_approval_context(uuid),
 public.request_tyre_change_approval(uuid,jsonb,uuid,text),public.execute_approved_tyre_change(uuid,uuid) TO authenticated;
