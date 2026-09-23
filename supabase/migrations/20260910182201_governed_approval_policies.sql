-- Governed policies are opt-in. Existing submissions retain legacy routing.
-- New submissions use a published policy snapshot; publication never rewrites history.
CREATE TABLE public.approval_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid NOT NULL,
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
 entity_type text NOT NULL CHECK (entity_type IN ('inspection','checklist')),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published','retired')),
 priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 10000),
 match_country text, match_site text, match_role text, match_user_id uuid,
 stages jsonb NOT NULL CHECK (jsonb_typeof(stages)='array' AND jsonb_array_length(stages) BETWEEN 1 AND 5),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), published_by uuid,
 published_at timestamptz, effective_at timestamptz, change_reason text
);
CREATE INDEX approval_policies_route_idx ON public.approval_policies(organisation_id,entity_type,state,priority DESC);
CREATE TABLE public.approval_policy_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, policy_id uuid NOT NULL REFERENCES public.approval_policies(id),
 organisation_id uuid NOT NULL, action text NOT NULL, actor_id uuid NOT NULL,
 reason text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), snapshot jsonb NOT NULL
);
CREATE INDEX approval_policy_events_policy_idx ON public.approval_policy_events(policy_id,id);
ALTER TABLE public.approval_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_policy_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.approval_policies,public.approval_policy_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.approval_policies,public.approval_policy_events TO authenticated;

CREATE FUNCTION public.approval_policy_is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT auth.uid() IS NOT NULL AND app_current_org() IS NOT NULL AND coalesce(app_is_active(),false)
 AND (get_my_role()='Admin' OR is_super_admin())
$$;
CREATE POLICY approval_policies_read ON public.approval_policies TO authenticated
 USING(organisation_id=(SELECT app_current_org()) AND (SELECT approval_policy_is_admin()));
CREATE POLICY approval_policy_events_read ON public.approval_policy_events TO authenticated
 USING(organisation_id=(SELECT app_current_org()) AND (SELECT approval_policy_is_admin()));

-- A private transaction permit cannot be forged with a client-settable GUC.
CREATE SCHEMA IF NOT EXISTS approval_private;
REVOKE ALL ON SCHEMA approval_private FROM PUBLIC,anon,authenticated;
CREATE TABLE approval_private.permits (transaction_id bigint NOT NULL,entity_type text NOT NULL,entity_id uuid NOT NULL,
 PRIMARY KEY(transaction_id,entity_type,entity_id));
REVOKE ALL ON approval_private.permits FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.approval_policy_people() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT coalesce(approval_policy_is_admin(),false) THEN RAISE EXCEPTION 'Approval configuration access denied' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'full_name',coalesce(nullif(full_name,''),username),'role',role,
 'countries',coalesce(country,countries),'sites',coalesce(sites,ARRAY[site])) ORDER BY full_name,id)
 FROM profiles WHERE org_id=app_current_org() AND approved IS TRUE AND locked IS NOT TRUE),'[]'::jsonb);
END $$;

CREATE FUNCTION approval_private.validate_policy(p public.approval_policies) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s jsonb; reviewer uuid; reviewer_role text; seen uuid[]:='{}'::uuid[];
BEGIN
 IF p.match_site IS NOT NULL AND (p.match_country IS NULL OR NOT EXISTS(
  SELECT 1 FROM sites WHERE organisation_id=p.organisation_id AND name=p.match_site AND country=p.match_country AND active IS TRUE)) THEN
  RAISE EXCEPTION 'Select an active site in the selected country' USING ERRCODE='22023'; END IF;
 IF p.match_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM profiles WHERE id=p.match_user_id AND org_id=p.organisation_id AND approved IS TRUE AND locked IS NOT TRUE) THEN
  RAISE EXCEPTION 'Submitting person is unavailable in this organisation' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p.stages)<>'array' OR jsonb_array_length(p.stages) NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Use one to five ordered stages' USING ERRCODE='22023'; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p.stages) LOOP
  reviewer:=nullif(s->>'approver_user_id','')::uuid; reviewer_role:=nullif(btrim(s->>'approver_role'),'');
  IF jsonb_typeof(s)<>'object' OR nullif(btrim(s->>'name'),'') IS NULL OR ((reviewer IS NULL)=(reviewer_role IS NULL)) THEN
   RAISE EXCEPTION 'Each stage needs a name and exactly one person or role' USING ERRCODE='22023'; END IF;
  IF (s-'name'-'approver_user_id'-'approver_role'-'require_signature'-'prevent_self_approval'-'distinct_reviewer'-'sla_hours')<>'{}'::jsonb THEN
   RAISE EXCEPTION 'Unsupported stage setting' USING ERRCODE='22023'; END IF;
  IF (s ? 'require_signature' AND jsonb_typeof(s->'require_signature')<>'boolean')
   OR (s ? 'prevent_self_approval' AND jsonb_typeof(s->'prevent_self_approval')<>'boolean')
   OR (s ? 'distinct_reviewer' AND jsonb_typeof(s->'distinct_reviewer')<>'boolean') THEN
   RAISE EXCEPTION 'Stage evidence and independence settings must be booleans' USING ERRCODE='22023'; END IF;
  IF coalesce((s->>'require_signature')::boolean,true) IS NOT TRUE OR coalesce((s->>'prevent_self_approval')::boolean,true) IS NOT TRUE THEN
   RAISE EXCEPTION 'Signature and prevention of self approval are required' USING ERRCODE='22023'; END IF;
  IF reviewer=ANY(seen) AND coalesce((s->>'distinct_reviewer')::boolean,true) THEN RAISE EXCEPTION 'Independent stages require different named reviewers' USING ERRCODE='22023'; END IF;
  IF reviewer IS NOT NULL THEN seen:=array_append(seen,reviewer); END IF;
  IF s->>'sla_hours' IS NOT NULL AND ((s->>'sla_hours')::numeric NOT BETWEEN 1 AND 8760 OR (s->>'sla_hours')::numeric<>trunc((s->>'sla_hours')::numeric)) THEN
   RAISE EXCEPTION 'SLA must be a whole number of hours from 1 to 8760' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM profiles u WHERE u.org_id=p.organisation_id AND u.approved IS TRUE AND u.locked IS NOT TRUE
    AND (reviewer IS NULL OR u.id=reviewer) AND (reviewer_role IS NULL OR u.role=reviewer_role)
    AND u.role=ANY(CASE WHEN p.entity_type='inspection' THEN ARRAY['Admin','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager','Tyre Data Collector']
    ELSE ARRAY['Admin','Maintenance Supervisor','Workshop Supervisor','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager','Tyre Data Collector'] END)
    AND (p.match_country IS NULL OR EXISTS(SELECT 1 FROM unnest(coalesce(u.country,u.countries)) c WHERE lower(btrim(c)) IN ('all',lower(p.match_country))))
    AND (p.match_site IS NULL OR u.role='Admin' OR u.is_super_admin OR EXISTS(SELECT 1 FROM unnest(coalesce(u.sites,ARRAY[u.site])) x WHERE upper(btrim(x)) IN ('ALL','*',upper(p.match_site))))
  ) THEN RAISE EXCEPTION 'A stage has no active approver with the required module role and scope' USING ERRCODE='22023'; END IF;
 END LOOP;
END $$;

CREATE FUNCTION public.approval_policy_save(p_policy jsonb,p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p approval_policies; existing approval_policies;
BEGIN
 IF NOT coalesce(approval_policy_is_admin(),false) THEN RAISE EXCEPTION 'Approval configuration access denied' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_policy)<>'object' OR (p_policy-'id'-'name'-'entity_type'-'priority'-'match_country'-'match_site'-'match_role'-'match_user_id'-'stages'-'change_reason')<>'{}'::jsonb THEN
  RAISE EXCEPTION 'Unsupported policy field' USING ERRCODE='22023'; END IF;
 p:=jsonb_populate_record(NULL::approval_policies,p_policy);
 IF p.id IS NOT NULL THEN
  SELECT * INTO existing FROM approval_policies WHERE id=p.id AND organisation_id=app_current_org() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Policy unavailable' USING ERRCODE='42501'; END IF;
  IF existing.state<>'draft' THEN RAISE EXCEPTION 'Published policy is immutable; clone a new draft' USING ERRCODE='22023'; END IF;
  IF p_expected_updated_at IS NULL OR existing.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Policy changed; reload before saving' USING ERRCODE='40001'; END IF;
 END IF;
 p.id:=coalesce(p.id,gen_random_uuid()); p.organisation_id:=app_current_org(); p.state:='draft'; p.version:=coalesce(existing.version,1);
 p.priority:=coalesce(p.priority,0); p.name:=btrim(p.name); p.match_country:=nullif(btrim(p.match_country),''); p.match_site:=nullif(btrim(p.match_site),'');
 p.match_role:=nullif(btrim(p.match_role),''); p.created_by:=coalesce(existing.created_by,auth.uid()); p.created_at:=coalesce(existing.created_at,clock_timestamp()); p.updated_at:=clock_timestamp();
 PERFORM approval_private.validate_policy(p);
 INSERT INTO approval_policies SELECT p.* ON CONFLICT(id) DO UPDATE SET name=excluded.name,entity_type=excluded.entity_type,priority=excluded.priority,
 match_country=excluded.match_country,match_site=excluded.match_site,match_role=excluded.match_role,match_user_id=excluded.match_user_id,
 stages=excluded.stages,updated_at=excluded.updated_at,change_reason=excluded.change_reason;
 INSERT INTO approval_policy_events(policy_id,organisation_id,action,actor_id,reason,snapshot)
 VALUES(p.id,p.organisation_id,'draft_saved',auth.uid(),p.change_reason,to_jsonb(p));
 RETURN to_jsonb(p);
END $$;

CREATE FUNCTION public.approval_policy_publish(p_policy_id uuid,p_expected_updated_at timestamptz,p_reason text,p_effective_at timestamptz DEFAULT clock_timestamp()) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p approval_policies;
BEGIN
 IF NOT coalesce(approval_policy_is_admin(),false) THEN RAISE EXCEPTION 'Approval configuration access denied' USING ERRCODE='42501'; END IF;
 IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Publication reason is required' USING ERRCODE='22023'; END IF;
 -- Serialize publication by tenant, including two different competing drafts.
 PERFORM pg_advisory_xact_lock(hashtextextended(app_current_org()::text,13));
 SELECT * INTO p FROM approval_policies WHERE id=p_policy_id AND organisation_id=app_current_org() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Policy unavailable' USING ERRCODE='42501'; END IF;
 IF p.state<>'draft' OR p_expected_updated_at IS NULL OR p.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Policy changed; reload before publishing' USING ERRCODE='40001'; END IF;
 IF p.created_by=auth.uid() THEN RAISE EXCEPTION 'A different administrator must review and publish this policy' USING ERRCODE='42501'; END IF;
 p_effective_at:=coalesce(p_effective_at,clock_timestamp());
 IF p_effective_at<statement_timestamp()-interval '5 minutes' THEN RAISE EXCEPTION 'Effective time must be now or in the future' USING ERRCODE='22023'; END IF;
 PERFORM approval_private.validate_policy(p);
 IF EXISTS(SELECT 1 FROM approval_policies q WHERE q.organisation_id=p.organisation_id AND q.entity_type=p.entity_type AND q.state='published'
  AND q.priority=p.priority
  AND num_nonnulls(q.match_country,q.match_site,q.match_role,q.match_user_id)=num_nonnulls(p.match_country,p.match_site,p.match_role,p.match_user_id)
  AND (q.match_country IS NULL OR p.match_country IS NULL OR q.match_country=p.match_country)
  AND (q.match_site IS NULL OR p.match_site IS NULL OR q.match_site=p.match_site)
  AND (q.match_role IS NULL OR p.match_role IS NULL OR q.match_role=p.match_role)
  AND (q.match_user_id IS NULL OR p.match_user_id IS NULL OR q.match_user_id=p.match_user_id)) THEN
  RAISE EXCEPTION 'Equally ranked published policies overlap; change priority or retire the conflicting policy' USING ERRCODE='22023'; END IF;
 UPDATE approval_policies SET state='published',version=(SELECT coalesce(max(version),0)+1 FROM approval_policies WHERE organisation_id=p.organisation_id AND entity_type=p.entity_type AND state<>'draft'),
 published_by=auth.uid(),published_at=clock_timestamp(),effective_at=p_effective_at,updated_at=clock_timestamp(),change_reason=btrim(p_reason) WHERE id=p.id RETURNING * INTO p;
 INSERT INTO approval_policy_events(policy_id,organisation_id,action,actor_id,reason,snapshot) VALUES(p.id,p.organisation_id,'published',auth.uid(),p_reason,to_jsonb(p));
 RETURN to_jsonb(p);
END $$;

CREATE FUNCTION public.approval_policy_retire(p_policy_id uuid,p_expected_updated_at timestamptz,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p approval_policies;
BEGIN
 IF NOT coalesce(approval_policy_is_admin(),false) THEN RAISE EXCEPTION 'Approval configuration access denied' USING ERRCODE='42501'; END IF;
 IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Retirement reason is required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(app_current_org()::text,13));
 SELECT * INTO p FROM approval_policies WHERE id=p_policy_id AND organisation_id=app_current_org() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Policy unavailable' USING ERRCODE='42501'; END IF;
 IF p.state='retired' OR p_expected_updated_at IS NULL OR p.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'Policy changed; reload before retiring' USING ERRCODE='40001'; END IF;
 UPDATE approval_policies SET state='retired',updated_at=clock_timestamp(),change_reason=btrim(p_reason) WHERE id=p.id RETURNING * INTO p;
 INSERT INTO approval_policy_events(policy_id,organisation_id,action,actor_id,reason,snapshot) VALUES(p.id,p.organisation_id,'retired',auth.uid(),p_reason,to_jsonb(p));
 RETURN to_jsonb(p);
END $$;

CREATE FUNCTION approval_private.resolve(p_org uuid,p_type text,p_country text,p_site text,p_role text,p_user uuid,p_draft uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH candidates AS (
 SELECT p.*,num_nonnulls(match_country,match_site,match_role,match_user_id) specificity,
 dense_rank() OVER(ORDER BY priority DESC,num_nonnulls(match_country,match_site,match_role,match_user_id) DESC) rank
 FROM approval_policies p WHERE organisation_id=p_org AND entity_type=p_type AND ((state='published' AND effective_at<=now()) OR (id=p_draft AND state='draft'))
 AND (match_country IS NULL OR match_country=p_country) AND (match_site IS NULL OR match_site=p_site)
 AND (match_role IS NULL OR match_role=p_role) AND (match_user_id IS NULL OR match_user_id=p_user))
 SELECT jsonb_build_object('mode',CASE WHEN EXISTS(SELECT 1 FROM approval_policies WHERE organisation_id=p_org AND entity_type=p_type AND effective_at<=now()) THEN 'enforced' ELSE 'legacy' END,
 'status',CASE count(*) FILTER(WHERE rank=1) WHEN 0 THEN 'no_route' WHEN 1 THEN 'matched' ELSE 'ambiguous' END,
 'policy',CASE WHEN count(*) FILTER(WHERE rank=1)=1 THEN (jsonb_agg(to_jsonb(candidates)-'rank'-'specificity' ORDER BY rank,id)->0) ELSE NULL END,
 'candidates',coalesce(jsonb_agg(to_jsonb(candidates) ORDER BY rank,id),'[]'::jsonb)) FROM candidates
$$;
CREATE FUNCTION public.approval_policy_simulate(p_entity_type text,p_country text DEFAULT NULL,p_site text DEFAULT NULL,p_role text DEFAULT NULL,p_user_id uuid DEFAULT NULL,p_draft_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT coalesce(approval_policy_is_admin(),false) THEN RAISE EXCEPTION 'Approval configuration access denied' USING ERRCODE='42501'; END IF;
 IF p_entity_type NOT IN ('inspection','checklist') THEN RAISE EXCEPTION 'Unsupported approval module' USING ERRCODE='22023'; END IF;
 IF p_draft_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM approval_policies WHERE id=p_draft_id AND organisation_id=app_current_org() AND entity_type=p_entity_type AND state='draft') THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE='42501'; END IF;
 IF p_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_user_id AND org_id=app_current_org()) THEN RAISE EXCEPTION 'Submitting person unavailable' USING ERRCODE='42501'; END IF;
 RETURN approval_private.resolve(app_current_org(),p_entity_type,p_country,p_site,p_role,p_user_id,p_draft_id);
END $$;

ALTER TABLE public.inspections ADD COLUMN approval_revision bigint NOT NULL DEFAULT 1, ADD COLUMN approval_workflow_id uuid, ADD COLUMN approval_policy_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.checklist_submissions ADD COLUMN approval_revision bigint NOT NULL DEFAULT 1, ADD COLUMN approval_workflow_id uuid, ADD COLUMN approval_policy_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.inspections ADD COLUMN approval_outcome text CHECK(approval_outcome IN ('approved','rejected','returned'));
ALTER TABLE public.checklist_submissions ADD COLUMN approval_outcome text CHECK(approval_outcome IN ('approved','rejected','returned'));
ALTER TABLE public.workflow_instances ADD COLUMN approval_policy_id uuid REFERENCES public.approval_policies(id);
ALTER TABLE public.workflow_instances ADD COLUMN approval_route_revision integer NOT NULL DEFAULT 0;
CREATE INDEX workflow_instances_approval_policy_idx ON public.workflow_instances(approval_policy_id) WHERE approval_policy_id IS NOT NULL;
CREATE INDEX inspections_approval_workflow_idx ON public.inspections(approval_workflow_id) WHERE approval_workflow_id IS NOT NULL;
CREATE INDEX checklist_approval_workflow_idx ON public.checklist_submissions(approval_workflow_id) WHERE approval_workflow_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.lock_inspection_content()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role    text;
  allowed   text[] := ARRAY['approval_status','approver_email','approver_signature',
                            'approved_at','approved_by','locked','locked_at',
                            'completed_date','linked_action_id','approval_revision','approval_workflow_id','approval_policy_required','approval_outcome'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'Done' AND NEW.locked IS NOT TRUE THEN
      NEW.locked := true; NEW.locked_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: auto-lock on transition to Done
  IF NEW.status = 'Done' AND (OLD.status IS DISTINCT FROM 'Done') AND NEW.locked IS NOT TRUE THEN
    NEW.locked := true; NEW.locked_at := now();
  END IF;

  -- Block content edits on a locked checklist for non-elevated users
  IF OLD.locked IS TRUE THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF COALESCE(v_role,'') NOT IN ('admin','manager','director') THEN
      IF (to_jsonb(OLD) - allowed) IS DISTINCT FROM (to_jsonb(NEW) - allowed) THEN
        RAISE EXCEPTION 'This inspection checklist is locked and cannot be edited.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TABLE approval_private.decisions (
 operation_id uuid PRIMARY KEY, organisation_id uuid NOT NULL,actor_id uuid NOT NULL,entity_type text NOT NULL,entity_id uuid NOT NULL,
 request jsonb NOT NULL,result jsonb NOT NULL,accepted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON approval_private.decisions FROM PUBLIC,anon,authenticated;

CREATE FUNCTION approval_private.content(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT p-ARRAY['updated_at','approval_status','approver_name','approver_email','approver_signature','approved_by','approved_at',
 'supervisor_name','supervisor_signature','supervisor_by','supervisor_at','review_note','locked','locked_at','status','approval_workflow_id','approval_outcome']
$$;
CREATE FUNCTION approval_private.decision_fields(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(p) WHERE key=ANY(ARRAY[
 'approval_status','approver_name','approver_email','approver_signature','approved_by','approved_at',
 'supervisor_name','supervisor_signature','supervisor_by','supervisor_at','review_note','locked','locked_at','status'])
$$;

CREATE FUNCTION approval_private.guard_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE kind text:=CASE WHEN TG_TABLE_NAME='inspections' THEN 'inspection' ELSE 'checklist' END;
 old_json jsonb; new_json jsonb; permit boolean; governed boolean;
BEGIN
 new_json:=to_jsonb(NEW);
 SELECT EXISTS(SELECT 1 FROM approval_private.permits WHERE transaction_id=txid_current() AND entity_type=kind AND entity_id=NEW.id) INTO permit;
 IF TG_OP='INSERT' THEN
  NEW.approval_revision:=1; NEW.approval_workflow_id:=NULL; NEW.approval_outcome:=NULL;
  NEW.approval_policy_required:=EXISTS(SELECT 1 FROM approval_policies WHERE organisation_id=NEW.organisation_id AND entity_type=kind AND effective_at<=now());
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
CREATE TRIGGER z_approval_document_guard BEFORE INSERT OR UPDATE ON public.inspections FOR EACH ROW EXECUTE FUNCTION approval_private.guard_document();
CREATE TRIGGER z_approval_document_guard BEFORE INSERT OR UPDATE ON public.checklist_submissions FOR EACH ROW EXECUTE FUNCTION approval_private.guard_document();

CREATE TABLE approval_private.stage_deliveries(delivery_key text PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
REVOKE ALL ON approval_private.stage_deliveries FROM PUBLIC,anon,authenticated;
CREATE FUNCTION approval_private.notify_stage(p_instance uuid,p_event text DEFAULT 'assigned',p_user uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w workflow_instances; recipients jsonb; recipient record; label text; message text; event_id bigint;
BEGIN
 SELECT * INTO w FROM workflow_instances WHERE id=p_instance;
 IF NOT FOUND THEN RETURN; END IF;
 INSERT INTO approval_private.stage_deliveries(delivery_key) VALUES(w.id::text||':'||w.current_step::text||':'||w.approval_route_revision::text||':'||p_event||':'||coalesce(p_user::text,'')) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN; END IF;
 label:=CASE WHEN w.context->>'routing_status'='matched' THEN 'Approval required' ELSE 'Approval routing exception' END;
 message:=coalesce(w.entity_label,w.entity_type)||' ? '||coalesce(w.steps->w.current_step->>'name','publish and recover a matching route');
 recipients:='[]'::jsonb;
 FOR recipient IN SELECT u.id,u.push_token FROM profiles u WHERE u.org_id=w.organisation_id AND u.id IS DISTINCT FROM w.started_by
  AND approval_private.person_eligible(u.id,w.organisation_id,w.entity_type,w.context#>>'{content,country}',w.context#>>'{content,site}')
  AND CASE WHEN p_user IS NOT NULL THEN u.id=p_user
   WHEN w.context->>'routing_status'<>'matched' THEN u.role='Admin' OR u.is_super_admin
   ELSE w.steps->w.current_step->>'approver_user_id'=u.id::text OR w.steps->w.current_step->>'approver_role'=u.role END
 LOOP
  INSERT INTO notifications(user_id,type,title,body,entity_type,entity_id)
  VALUES(recipient.id,'approval',label,message,w.entity_type,w.entity_id::uuid);
  IF nullif(btrim(recipient.push_token),'') IS NOT NULL THEN
   recipients:=recipients||jsonb_build_array(jsonb_build_object('user_id',recipient.id,'push_token',recipient.push_token));
  END IF;
 END LOOP;
 IF jsonb_array_length(recipients)>0 THEN
  INSERT INTO domain_events(event_type,entity_type,entity_id,organisation_id,actor_id,payload,status,processed_at)
  VALUES('approval.matrix_notification',w.entity_type,w.entity_id,w.organisation_id,auth.uid(),jsonb_build_object('instance_id',w.id,'stage',w.current_step,'event',p_event),'processed',clock_timestamp()) RETURNING id INTO event_id;
  -- Persist to the existing deliverer's outbox. Network delivery happens outside this transaction.
  INSERT INTO workflow_notifications(event_id,organisation_id,instance_id,event_type,payload,recipient_count,status)
  VALUES(event_id,w.organisation_id,w.id,'workflow.step_advanced',jsonb_build_object('event_type','workflow.step_advanced','instance_id',w.id,
   'definition_name',w.definition_name,'entity_type',w.entity_type,'entity_label',w.entity_label,'step_name',label,'recipients',recipients,
   'approval_matrix',true,'stage_token',w.id::text||':'||w.current_step::text||':'||w.approval_route_revision::text),jsonb_array_length(recipients),'pending');
 END IF;
END $$;

CREATE FUNCTION approval_private.start_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE kind text:=CASE WHEN TG_TABLE_NAME='inspections' THEN 'inspection' ELSE 'checklist' END;
 route jsonb; requestor uuid; requestor_role text; w uuid; previous uuid; snapshot jsonb; pending boolean; tpl jsonb;
BEGIN
 pending:=NEW.approval_status=CASE WHEN kind='inspection' THEN 'pending_approval' ELSE 'pending' END;
 IF NOT pending OR (TG_OP='UPDATE' AND OLD.approval_status IS NOT DISTINCT FROM NEW.approval_status) THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM approval_policies WHERE organisation_id=NEW.organisation_id AND entity_type=kind AND effective_at<=now()) THEN RETURN NEW; END IF;
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
 IF kind='inspection' THEN UPDATE inspections SET approval_workflow_id=w WHERE id=NEW.id; ELSE UPDATE checklist_submissions SET approval_workflow_id=w WHERE id=NEW.id; END IF;
 INSERT INTO workflow_step_events(instance_id,organisation_id,step_index,step_name,action,actor_id,comment)
 VALUES(w,NEW.organisation_id,0,'Approval Matrix','started',requestor,CASE WHEN route->>'status'='matched' THEN 'Published route selected' ELSE 'Routing exception: '||(route->>'status') END);
 PERFORM approval_private.notify_stage(w);
 DELETE FROM approval_private.permits WHERE transaction_id=txid_current() AND entity_type=kind AND entity_id=NEW.id;
 RETURN NEW;
END $$;
CREATE TRIGGER z_approval_document_start AFTER INSERT OR UPDATE OF approval_status ON public.inspections FOR EACH ROW EXECUTE FUNCTION approval_private.start_document();
CREATE TRIGGER z_approval_document_start AFTER INSERT OR UPDATE OF approval_status ON public.checklist_submissions FOR EACH ROW EXECUTE FUNCTION approval_private.start_document();

-- Governed assignment notifications replace the legacy broad role notification event.
DROP TRIGGER IF EXISTS trg_insp_approval_requested_ins ON public.inspections;
DROP TRIGGER IF EXISTS trg_insp_approval_requested_upd ON public.inspections;
DROP TRIGGER IF EXISTS trg_cl_approval_requested_ins ON public.checklist_submissions;
DROP TRIGGER IF EXISTS trg_cl_approval_requested_upd ON public.checklist_submissions;
CREATE TRIGGER trg_insp_approval_requested_ins AFTER INSERT ON public.inspections FOR EACH ROW
 WHEN(NEW.approval_status='pending_approval' AND NOT NEW.approval_policy_required)
 EXECUTE FUNCTION public.trg_emit_domain_event('inspection.approval_requested','inspection','id,title,asset_no,site,inspector,country');
CREATE TRIGGER trg_insp_approval_requested_upd AFTER UPDATE OF approval_status ON public.inspections FOR EACH ROW
 WHEN(NEW.approval_status='pending_approval' AND OLD.approval_status IS DISTINCT FROM NEW.approval_status AND NOT NEW.approval_policy_required)
 EXECUTE FUNCTION public.trg_emit_domain_event('inspection.approval_requested','inspection','id,title,asset_no,site,inspector,country');
CREATE TRIGGER trg_cl_approval_requested_ins AFTER INSERT ON public.checklist_submissions FOR EACH ROW
 WHEN(NEW.approval_status='pending' AND NOT NEW.approval_policy_required)
 EXECUTE FUNCTION public.trg_emit_domain_event('checklist.approval_requested','checklist_submission','id,template_name,asset_no,site,country');
CREATE TRIGGER trg_cl_approval_requested_upd AFTER UPDATE OF approval_status ON public.checklist_submissions FOR EACH ROW
 WHEN(NEW.approval_status='pending' AND OLD.approval_status IS DISTINCT FROM NEW.approval_status AND NOT NEW.approval_policy_required)
 EXECUTE FUNCTION public.trg_emit_domain_event('checklist.approval_requested','checklist_submission','id,template_name,asset_no,site,country');

-- Block legacy workflow_act and direct workflow mutation on governed snapshots.
CREATE FUNCTION approval_private.guard_workflow() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w workflow_instances; allowed boolean;
BEGIN
 IF TG_TABLE_NAME='workflow_instances' THEN
  IF TG_OP='INSERT' THEN
   IF coalesce((NEW.context->>'approval_matrix')::boolean,false) AND NOT EXISTS(SELECT 1 FROM approval_private.permits WHERE transaction_id=txid_current() AND entity_type=NEW.entity_type AND entity_id=NEW.entity_id::uuid) THEN
    RAISE EXCEPTION 'Approval snapshots are server controlled' USING ERRCODE='42501'; END IF;
   RETURN NEW;
  END IF;
  w:=OLD;
 ELSE SELECT * INTO w FROM workflow_instances WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.instance_id ELSE NEW.instance_id END; END IF;
 IF coalesce((w.context->>'approval_matrix')::boolean,false) THEN
  SELECT EXISTS(SELECT 1 FROM approval_private.permits WHERE transaction_id=txid_current() AND entity_type=w.entity_type AND entity_id=w.entity_id::uuid) INTO allowed;
  IF NOT allowed THEN
   IF TG_TABLE_NAME='workflow_step_events' AND TG_OP='INSERT' THEN
    -- Existing hourly cron records overdue alerts, never approval authority.
    IF NEW.action='escalated' AND auth.uid() IS NULL AND session_user IN ('postgres','supabase_admin') THEN RETURN NEW; END IF;
   END IF;
   RAISE EXCEPTION 'Use the versioned approval decision service' USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER z_approval_workflow_guard BEFORE INSERT OR UPDATE OR DELETE ON public.workflow_instances FOR EACH ROW EXECUTE FUNCTION approval_private.guard_workflow();
CREATE TRIGGER z_approval_event_guard BEFORE INSERT OR UPDATE OR DELETE ON public.workflow_step_events FOR EACH ROW EXECUTE FUNCTION approval_private.guard_workflow();

CREATE FUNCTION public.approval_workflow_visible(p_org uuid,p_type text,p_context jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE WHEN coalesce(p_context->>'approval_matrix','false')<>'true' THEN true ELSE
  p_org=app_current_org() AND coalesce(app_is_active(),false)
  AND (p_context#>>'{content,country}' IS NULL OR is_super_admin() OR app_sees_all_countries()
   OR lower(btrim(p_context#>>'{content,country}'))=ANY(coalesce(app_country_scope(),'{}'::text[])))
  AND (nullif(btrim(p_context#>>'{content,site}'),'') IS NULL OR app_sees_all_sites()
   OR upper(btrim(p_context#>>'{content,site}'))=ANY(coalesce(app_site_scope(),'{}'::text[])))
  AND (approval_policy_is_admin() OR CASE WHEN p_type='inspection' THEN app_user_can('inspections','view') OR app_user_can('mobile:inspections','view')
   WHEN p_type='checklist' THEN app_user_can('checklists','view') OR app_user_can('my_checklists','view') OR app_user_can('mobile:checklists','view') ELSE false END)
 END
$$;
CREATE FUNCTION public.approval_workflow_event_visible(p_instance uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce((SELECT approval_workflow_visible(organisation_id,entity_type,context) FROM workflow_instances WHERE id=p_instance),false)
$$;
ALTER TABLE public.workflow_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_step_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY governed_workflow_scope ON public.workflow_instances AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.approval_workflow_visible(organisation_id,entity_type,context));
CREATE POLICY governed_event_scope ON public.workflow_step_events AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.approval_workflow_event_visible(instance_id));
REVOKE ALL ON FUNCTION public.approval_workflow_visible(uuid,text,jsonb),public.approval_workflow_event_visible(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approval_workflow_visible(uuid,text,jsonb),public.approval_workflow_event_visible(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.approval_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org  uuid := public.app_current_org();
  v_role text := lower(regexp_replace(COALESCE(public.get_my_role(), ''), '\s+', '_', 'g'));
  v_out  jsonb;
BEGIN
  IF v_role = '' THEN
    RAISE EXCEPTION 'not authorised';
  END IF;
  WITH scoped AS (
    SELECT wi.*,
           (wi.status IN ('pending','in_review','returned')
            AND (wi.steps -> wi.current_step) ? 'sla_hours'
            AND wi.step_started_at
                + make_interval(mins => round(
                    (wi.steps -> wi.current_step ->> 'sla_hours')::numeric * 60)::int)
                < now()) AS is_overdue
      FROM public.workflow_instances wi
     WHERE (wi.organisation_id IS NULL OR wi.organisation_id = v_org)
       AND public.approval_workflow_visible(wi.organisation_id,wi.entity_type,wi.context)
  ),
  proj AS (
    SELECT id, definition_id, definition_name, entity_type, entity_id, entity_label,
           status, current_step, approval_policy_id,
           coalesce(context->>'approval_matrix','false')='true' AS governed,
           context#>>'{content,country}' AS country, context#>>'{content,site}' AS site,
           (steps -> current_step ->> 'name')         AS current_step_name,
           (steps -> current_step ->> 'approver_role') AS current_approver_role,
           (steps -> current_step ->> 'sla_hours')     AS current_sla_hours,
           step_started_at, started_at, completed_at, is_overdue
      FROM scoped
  ),
  metrics AS (
    SELECT
      count(*) FILTER (WHERE status IN ('pending','in_review'))         AS pending_count,
      count(*) FILTER (WHERE is_overdue)                                AS overdue_count,
      count(*) FILTER (WHERE status = 'returned')                       AS returned_count,
      count(*) FILTER (WHERE status = 'rejected')                       AS rejected_count,
      count(*) FILTER (WHERE status = 'approved')                       AS approved_count,
      count(*) FILTER (WHERE status = 'cancelled')                      AS cancelled_count,
      count(*)                                                          AS total_count,
      round(avg(EXTRACT(EPOCH FROM (completed_at - started_at)) / 3600.0)
            FILTER (WHERE status = 'approved' AND completed_at IS NOT NULL)::numeric, 2)
                                                                        AS avg_approval_hours
    FROM proj
  )
  SELECT jsonb_build_object(
    'metrics', (SELECT to_jsonb(m) FROM metrics m),
    'buckets', jsonb_build_object(
      'pending', COALESCE((
        SELECT jsonb_agg(to_jsonb(p) ORDER BY p.step_started_at ASC)
          FROM (SELECT * FROM proj WHERE status IN ('pending','in_review')
                 ORDER BY step_started_at ASC LIMIT 25) p), '[]'::jsonb),
      'overdue', COALESCE((
        SELECT jsonb_agg(to_jsonb(p) ORDER BY p.step_started_at ASC)
          FROM (SELECT * FROM proj WHERE is_overdue
                 ORDER BY step_started_at ASC LIMIT 25) p), '[]'::jsonb),
      'returned', COALESCE((
        SELECT jsonb_agg(to_jsonb(p) ORDER BY p.step_started_at DESC)
          FROM (SELECT * FROM proj WHERE status = 'returned'
                 ORDER BY step_started_at DESC LIMIT 25) p), '[]'::jsonb),
      'rejected', COALESCE((
        SELECT jsonb_agg(to_jsonb(p) ORDER BY p.completed_at DESC)
          FROM (SELECT * FROM proj WHERE status = 'rejected'
                 ORDER BY completed_at DESC NULLS LAST LIMIT 25) p), '[]'::jsonb),
      'recently_approved', COALESCE((
        SELECT jsonb_agg(to_jsonb(p) ORDER BY p.completed_at DESC)
          FROM (SELECT * FROM proj WHERE status = 'approved'
                 ORDER BY completed_at DESC NULLS LAST LIMIT 25) p), '[]'::jsonb)
    )
  ) INTO v_out;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.my_pending_approvals()
 RETURNS SETOF workflow_instances
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT lower(regexp_replace(COALESCE(public.get_my_role(), ''), '\s+', '_', 'g')) AS role,
           auth.uid() AS uid
  )
  SELECT wi.*
    FROM public.workflow_instances wi, me
   WHERE wi.status IN ('pending','in_review','returned')
     AND (wi.organisation_id IS NULL OR wi.organisation_id = public.app_current_org())
     AND public.approval_workflow_visible(wi.organisation_id,wi.entity_type,wi.context)
     AND (coalesce(wi.context->>'approval_matrix','false')<>'true' OR (
       wi.started_by IS DISTINCT FROM auth.uid() AND (
        wi.steps->wi.current_step->>'approver_user_id'=auth.uid()::text OR wi.steps->wi.current_step->>'approver_role'=public.get_my_role())
       AND (NOT coalesce((wi.steps->wi.current_step->>'distinct_reviewer')::boolean,true) OR NOT EXISTS(SELECT 1 FROM public.workflow_step_events se WHERE se.instance_id=wi.id AND se.action='approved' AND se.actor_id=auth.uid()))))
     AND (
       me.role = 'admin'
       OR (lower(COALESCE(wi.steps -> wi.current_step ->> 'assignee_type','role')) = 'user'
           AND (wi.steps -> wi.current_step ->> 'approver_user_id') = me.uid::text)
       OR (lower(COALESCE(wi.steps -> wi.current_step ->> 'assignee_type','role')) <> 'user'
           AND lower(regexp_replace(COALESCE(wi.steps -> wi.current_step ->> 'approver_role',''), '\s+', '_', 'g'))
               = me.role)
     )
   ORDER BY wi.started_at;
$function$;

CREATE FUNCTION approval_private.document(p_type text,p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d jsonb; tpl jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(app_is_active(),false) OR app_current_org() IS NULL THEN RAISE EXCEPTION 'Approval access denied' USING ERRCODE='42501'; END IF;
 IF p_type='inspection' THEN
  SELECT to_jsonb(i) INTO d FROM inspections i WHERE id=p_id AND organisation_id=app_current_org() FOR UPDATE;
 ELSIF p_type='checklist' THEN
  SELECT to_jsonb(c) INTO d FROM checklist_submissions c WHERE id=p_id AND organisation_id=app_current_org() FOR UPDATE;
  IF d IS NOT NULL THEN SELECT to_jsonb(t) INTO tpl FROM checklist_templates t WHERE id=(d->>'template_id')::uuid FOR SHARE; d:=d||jsonb_build_object('checklist_templates',tpl); END IF;
 ELSE RAISE EXCEPTION 'Unsupported approval module' USING ERRCODE='22023'; END IF;
 IF d IS NULL THEN RAISE EXCEPTION 'Approval record unavailable' USING ERRCODE='42501'; END IF;
 IF NOT ((d->>'country' IS NULL) OR is_super_admin() OR app_sees_all_countries() OR lower(btrim(d->>'country'))=ANY(coalesce(app_country_scope(),'{}'::text[])))
 OR NOT (nullif(btrim(d->>'site'),'') IS NULL OR app_sees_all_sites() OR upper(btrim(d->>'site'))=ANY(coalesce(app_site_scope(),'{}'::text[]))) THEN
  RAISE EXCEPTION 'Approval record unavailable' USING ERRCODE='42501'; END IF;
 IF NOT (approval_policy_is_admin() OR CASE WHEN p_type='inspection' THEN app_user_can('inspections','view') OR app_user_can('mobile:inspections','view')
  ELSE app_user_can('checklists','view') OR app_user_can('my_checklists','view') OR app_user_can('mobile:checklists','view') END) THEN
  RAISE EXCEPTION 'Approval module access denied' USING ERRCODE='42501'; END IF;
 RETURN d;
END $$;

CREATE FUNCTION approval_private.person_eligible(p_user uuid,p_org uuid,p_type text,p_country text,p_site text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce((SELECT u.approved IS TRUE AND u.locked IS NOT TRUE AND u.org_id=p_org
  AND (u.is_super_admin OR u.role=ANY(CASE WHEN p_type='inspection' THEN ARRAY['Admin','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager','Tyre Data Collector']
   ELSE ARRAY['Admin','Maintenance Supervisor','Workshop Supervisor','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager','Tyre Data Collector'] END))
  AND (p_country IS NULL OR u.is_super_admin OR EXISTS(SELECT 1 FROM unnest(coalesce(u.country,u.countries)) x WHERE lower(btrim(x)) IN ('all',lower(btrim(p_country)))))
  AND (nullif(btrim(p_site),'') IS NULL OR u.is_super_admin OR u.role='Admin' OR EXISTS(SELECT 1 FROM unnest(coalesce(u.sites,ARRAY[u.site])) x WHERE upper(btrim(x)) IN ('ALL','*',upper(btrim(p_site)))))
  AND (u.role='Admin' OR u.is_super_admin OR EXISTS(
   SELECT 1 FROM unnest(CASE WHEN p_type='inspection' THEN ARRAY['inspections','mobile:inspections'] ELSE ARRAY['checklists','my_checklists','mobile:checklists'] END) k
    WHERE NOT EXISTS(SELECT 1 FROM user_access_grants g WHERE g.user_id=u.id AND g.module_key=k AND g.capability='view' AND g.effect='revoke' AND (g.expires_at IS NULL OR g.expires_at>now()))
    AND (coalesce((SELECT m.enabled FROM module_permissions m WHERE m.org_id IS NULL AND m.role=u.role AND m.module_key=k ORDER BY m.updated_at DESC NULLS LAST LIMIT 1),false)
     OR EXISTS(SELECT 1 FROM user_access_grants g WHERE g.user_id=u.id AND g.module_key=k AND g.capability='view' AND g.effect='grant' AND (g.expires_at IS NULL OR g.expires_at>now())))))
 FROM profiles u WHERE u.id=p_user),false)
$$;

ALTER TABLE public.approval_delegations ADD COLUMN approval_workflow_id uuid REFERENCES public.workflow_instances(id), ADD COLUMN approval_stage_token text;
CREATE INDEX approval_delegations_stage_idx ON public.approval_delegations(approval_workflow_id,approval_stage_token,delegate_id) WHERE approval_workflow_id IS NOT NULL AND active;
ALTER TABLE public.workflow_step_events DROP CONSTRAINT workflow_step_events_action_check;
ALTER TABLE public.workflow_step_events ADD CONSTRAINT workflow_step_events_action_check CHECK(action IN ('started','approved','rejected','escalated','cancelled','returned','reassigned','route_recovered','delegated','delegation_revoked'));

CREATE FUNCTION approval_private.guard_delegation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE instance uuid; w workflow_instances;
BEGIN
 instance:=CASE WHEN TG_OP='DELETE' THEN OLD.approval_workflow_id ELSE NEW.approval_workflow_id END;
 IF TG_OP='UPDATE' THEN instance:=coalesce(OLD.approval_workflow_id,instance); END IF;
 IF instance IS NOT NULL THEN
  SELECT * INTO w FROM workflow_instances WHERE id=instance;
  IF NOT EXISTS(SELECT 1 FROM approval_private.permits WHERE transaction_id=txid_current() AND entity_type=w.entity_type AND entity_id=w.entity_id::uuid) THEN
   RAISE EXCEPTION 'Use the scoped approval delegation service' USING ERRCODE='42501'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER z_approval_delegation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.approval_delegations FOR EACH ROW EXECUTE FUNCTION approval_private.guard_delegation();

CREATE FUNCTION approval_private.represented_actor(w public.workflow_instances) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE represented uuid; stage jsonb:=w.steps->w.current_step;
BEGIN
 IF w.started_by=auth.uid() THEN RETURN NULL; END IF;
 IF stage->>'approver_user_id'=auth.uid()::text OR stage->>'approver_role'=get_my_role() THEN RETURN auth.uid(); END IF;
 SELECT a.delegator_id INTO represented FROM approval_delegations a
 WHERE a.approval_workflow_id=w.id AND a.approval_stage_token=w.id::text||':'||w.current_step::text||':'||w.approval_route_revision::text
 AND a.organisation_id=w.organisation_id AND a.delegate_id=auth.uid() AND a.active AND a.starts_at<=now() AND a.ends_at>now()
 AND a.delegator_id IS DISTINCT FROM w.started_by
 AND approval_private.person_eligible(a.delegator_id,w.organisation_id,w.entity_type,w.context#>>'{content,country}',w.context#>>'{content,site}')
 AND (stage->>'approver_user_id'=a.delegator_id::text OR stage->>'approver_role'=(SELECT role FROM profiles WHERE id=a.delegator_id))
 ORDER BY a.created_at,a.id LIMIT 1;
 RETURN represented;
END $$;

CREATE FUNCTION approval_private.context(p_type text,d jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
 'current_stage',coalesce(w.current_step,0),'can_decide',coalesce(eligible AND (p_type<>'checklist' OR w.id IS NULL OR w.context->'template' IS NOT DISTINCT FROM d->'checklist_templates'),false),
 'can_return',coalesce(eligible,false),'workflow_status',coalesce(w.status,d->>'approval_outcome',status),
 'represented_actor_id',represented,'routing_status',w.context->>'routing_status','history',history,
 'can_recover',coalesce(approval_policy_is_admin() AND w.status='pending' AND w.current_step=0 AND w.context->>'routing_status'<>'matched',false),
 'can_reassign',coalesce(approval_policy_is_admin() AND w.status IN ('pending','in_review') AND w.context->>'routing_status'='matched',false),
 'can_delegate',coalesce(eligible AND represented=auth.uid(),false),
 'delegations',coalesce((SELECT jsonb_agg(to_jsonb(a)||jsonb_build_object('delegator_name',p.full_name,'delegate_name',q.full_name,'can_revoke',a.active AND (a.delegator_id=auth.uid() OR approval_policy_is_admin())) ORDER BY a.created_at)
  FROM approval_delegations a JOIN profiles p ON p.id=a.delegator_id JOIN profiles q ON q.id=a.delegate_id WHERE a.approval_workflow_id=w.id),'[]'::jsonb));
END $$;
CREATE FUNCTION public.approval_review_context(p_entity_type text,p_entity_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN RETURN approval_private.context(p_entity_type,approval_private.document(p_entity_type,p_entity_id)); END $$;

CREATE FUNCTION public.decide_approval(p_entity_type text,p_entity_id uuid,p_decision text,p_expected_revision bigint,p_expected_stage text,p_operation_id uuid,
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
   ELSE UPDATE checklist_submissions SET approval_outcome=p_decision WHERE id=p_entity_id; END IF;
  END IF;
  -- Preserve checklist domain stages: the first policy stage advances an area-manager template.
  IF NOT final_stage AND p_entity_type='checklist' AND d->>'approval_status'='pending' AND coalesce((d#>>'{checklist_templates,require_area_manager}')::boolean,false) THEN
   PERFORM decide_checklist_approval(p_entity_id,domain_decision,p_note,p_signature);
  END IF;
  IF final_stage THEN
   IF p_entity_type='inspection' THEN PERFORM decide_inspection_approval(p_entity_id,domain_decision,p_note,p_signature);
   ELSE
    IF p_decision='approved' AND d->>'approval_status'='pending' AND coalesce((d#>>'{checklist_templates,require_area_manager}')::boolean,false) THEN
     RAISE EXCEPTION 'This checklist requires a separate supervisor and area-manager stage' USING ERRCODE='22023'; END IF;
    PERFORM decide_checklist_approval(p_entity_id,domain_decision,p_note,p_signature);
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
  ELSE UPDATE checklist_submissions SET approval_outcome=p_decision WHERE id=p_entity_id; END IF;
  IF p_entity_type='inspection' THEN PERFORM decide_inspection_approval(p_entity_id,domain_decision,p_note,p_signature);
  ELSE PERFORM decide_checklist_approval(p_entity_id,domain_decision,p_note,p_signature); END IF;
 END IF;
 d:=approval_private.document(p_entity_type,p_entity_id); c:=approval_private.context(p_entity_type,d);
 accepted:=jsonb_build_object('ok',true,'decision',p_decision,'status',d->>'approval_status','revision',(c->>'revision')::bigint,
  'stage_token',c->>'stage_token','operation_id',p_operation_id,'accepted_at',accepted_at,'workflow_status',c->>'workflow_status');
 INSERT INTO approval_private.decisions(operation_id,organisation_id,actor_id,entity_type,entity_id,request,result,accepted_at)
 VALUES(p_operation_id,app_current_org(),auth.uid(),p_entity_type,p_entity_id,req,accepted,accepted_at);
 DELETE FROM approval_private.permits WHERE transaction_id=txid_current() AND entity_type=p_entity_type AND entity_id=p_entity_id;
 RETURN accepted;
END $$;

-- Existing decision triggers keep their wiring; the canonical outcome distinguishes return from rejection.
CREATE OR REPLACE FUNCTION public.notify_submission_decision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE requestor uuid; kind text; label text; title_text text; body_text text; token text; event_id bigint;
BEGIN
 IF NEW.approval_status NOT IN ('approved','rejected') THEN RETURN NEW; END IF;
 kind:=CASE WHEN TG_TABLE_NAME='inspections' THEN 'inspection' ELSE 'checklist' END;
 requestor:=nullif(CASE WHEN kind='inspection' THEN to_jsonb(NEW)->>'created_by' ELSE to_jsonb(NEW)->>'submitted_by' END,'')::uuid;
 IF requestor IS NULL OR requestor=NEW.approved_by THEN RETURN NEW; END IF;
 label:=coalesce(nullif(NEW.asset_no,''),nullif(NEW.title,''),'your submission');
 title_text:=initcap(kind)||CASE WHEN NEW.approval_status='approved' THEN ' approved' WHEN NEW.approval_outcome='returned' THEN ' returned for correction' ELSE ' rejected' END;
 body_text:='Your '||kind||' for '||label||CASE WHEN NEW.approval_status='approved' THEN ' was approved.' WHEN NEW.approval_outcome='returned' THEN ' was returned. Please review and resubmit.' ELSE ' was rejected. Review the decision history for the reason.' END;
 BEGIN
  INSERT INTO notifications(user_id,type,title,body,entity_type,entity_id) VALUES(requestor,'approval_decision',title_text,body_text,kind,NEW.id);
 EXCEPTION WHEN OTHERS THEN NULL; END;
 BEGIN
  SELECT push_token INTO token FROM profiles WHERE id=requestor AND org_id=NEW.organisation_id;
  IF nullif(btrim(token),'') IS NOT NULL THEN
   INSERT INTO domain_events(event_type,entity_type,entity_id,organisation_id,actor_id,payload,status,processed_at)
   VALUES('approval.decision_notification',kind,NEW.id::text,NEW.organisation_id,auth.uid(),jsonb_build_object('outcome',coalesce(NEW.approval_outcome,NEW.approval_status)),'processed',clock_timestamp()) RETURNING id INTO event_id;
   INSERT INTO workflow_notifications(event_id,organisation_id,instance_id,event_type,payload,recipient_count,status)
   VALUES(event_id,NEW.organisation_id,NULL,'workflow.step_advanced',jsonb_build_object('event_type','workflow.step_advanced','instance_id',NULL,
    'definition_name',initcap(kind)||' decision','entity_type',kind,'entity_label',label,'step_name',title_text,
    'recipients',jsonb_build_array(jsonb_build_object('user_id',requestor,'push_token',token))),1,'pending');
  END IF;
 EXCEPTION WHEN OTHERS THEN NULL; END;
 RETURN NEW;
END $$;

CREATE FUNCTION public.approval_review_people(p_entity_type text,p_entity_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d jsonb; c jsonb; w workflow_instances;
BEGIN
 d:=approval_private.document(p_entity_type,p_entity_id); c:=approval_private.context(p_entity_type,d);
 IF NOT coalesce(approval_policy_is_admin(),false) AND NOT coalesce((c->>'can_decide')::boolean,false) THEN RAISE EXCEPTION 'Reviewer lookup is unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO w FROM workflow_instances WHERE id=(d->>'approval_workflow_id')::uuid;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'full_name',coalesce(nullif(u.full_name,''),u.username),'role',u.role,'countries',coalesce(u.country,u.countries),'sites',coalesce(u.sites,ARRAY[u.site])) ORDER BY u.full_name,u.id)
  FROM profiles u WHERE u.org_id=app_current_org() AND u.id IS DISTINCT FROM w.started_by
  AND approval_private.person_eligible(u.id,app_current_org(),p_entity_type,d->>'country',d->>'site')
  AND (p_entity_type<>'checklist' OR d->>'approval_status'<>'pending_area_manager' OR u.is_super_admin OR u.role=ANY(ARRAY['Admin','Director','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager']))
  AND (NOT coalesce((w.steps->w.current_step->>'distinct_reviewer')::boolean,true) OR NOT EXISTS(SELECT 1 FROM workflow_step_events e WHERE e.instance_id=w.id AND e.action='approved' AND (e.actor_id=u.id OR e.device_info->>'represented_actor_id'=u.id::text)))),'[]'::jsonb);
END $$;

CREATE FUNCTION public.approval_recover_route(p_entity_type text,p_entity_id uuid,p_expected_stage text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d jsonb; c jsonb; w workflow_instances; route jsonb; requestor_role text; previous jsonb;
BEGIN
 IF NOT coalesce(approval_policy_is_admin(),false) THEN RAISE EXCEPTION 'Approval configuration access denied' USING ERRCODE='42501'; END IF;
 IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A recovery reason is required' USING ERRCODE='22023'; END IF;
 d:=approval_private.document(p_entity_type,p_entity_id); c:=approval_private.context(p_entity_type,d);
 IF c->>'stage_token' IS DISTINCT FROM p_expected_stage THEN RAISE EXCEPTION 'Approval stage changed; reload before recovery' USING ERRCODE='40001'; END IF;
 SELECT * INTO w FROM workflow_instances WHERE id=(d->>'approval_workflow_id')::uuid FOR UPDATE;
 IF NOT FOUND OR w.status<>'pending' OR w.current_step<>0 OR w.context->>'routing_status'='matched'
 OR EXISTS(SELECT 1 FROM workflow_step_events WHERE instance_id=w.id AND action IN ('approved','rejected')) THEN
  RAISE EXCEPTION 'Only unresolved routing exceptions can be recovered' USING ERRCODE='22023'; END IF;
 SELECT role INTO requestor_role FROM profiles WHERE id=w.started_by AND org_id=w.organisation_id;
 route:=approval_private.resolve(w.organisation_id,w.entity_type,d->>'country',d->>'site',requestor_role,w.started_by);
 IF route->>'status'<>'matched' THEN RAISE EXCEPTION 'Publish a single matching policy before recovering this request' USING ERRCODE='22023'; END IF;
 previous:=w.context;
 INSERT INTO approval_private.permits VALUES(txid_current(),p_entity_type,p_entity_id);
 UPDATE workflow_instances SET approval_policy_id=(route#>>'{policy,id}')::uuid,
  steps=(SELECT jsonb_agg(s||jsonb_build_object('assignee_type',CASE WHEN nullif(s->>'approver_user_id','') IS NOT NULL THEN 'user' ELSE 'role' END)) FROM jsonb_array_elements(route#>'{policy,stages}') s),
  context=context||jsonb_build_object('policy',route->'policy','routing_status','matched'),
  approval_route_revision=approval_route_revision+1,last_actor_id=auth.uid(),step_started_at=clock_timestamp() WHERE id=w.id;
 INSERT INTO workflow_step_events(instance_id,organisation_id,step_index,step_name,action,actor_id,comment,device_info)
 VALUES(w.id,w.organisation_id,0,'Routing recovery','route_recovered',auth.uid(),p_reason,jsonb_build_object('previous_routing',previous->>'routing_status','policy',route->'policy'));
 PERFORM approval_private.notify_stage(w.id,'recovered');
 DELETE FROM approval_private.permits WHERE transaction_id=txid_current() AND entity_type=p_entity_type AND entity_id=p_entity_id;
 RETURN approval_private.context(p_entity_type,d);
END $$;

CREATE FUNCTION public.approval_reassign_stage(p_entity_type text,p_entity_id uuid,p_expected_stage text,p_approver_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d jsonb; c jsonb; w workflow_instances; old_stage jsonb; new_stage jsonb;
BEGIN
 IF NOT coalesce(approval_policy_is_admin(),false) THEN RAISE EXCEPTION 'Approval configuration access denied' USING ERRCODE='42501'; END IF;
 IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A reassignment reason is required' USING ERRCODE='22023'; END IF;
 d:=approval_private.document(p_entity_type,p_entity_id); c:=approval_private.context(p_entity_type,d);
 IF c->>'stage_token' IS DISTINCT FROM p_expected_stage THEN RAISE EXCEPTION 'Approval stage changed; reload before reassignment' USING ERRCODE='40001'; END IF;
 SELECT * INTO w FROM workflow_instances WHERE id=(d->>'approval_workflow_id')::uuid FOR UPDATE;
 IF NOT FOUND OR w.status NOT IN ('pending','in_review') OR w.context->>'routing_status'<>'matched' THEN RAISE EXCEPTION 'Only a pending routed stage can be reassigned' USING ERRCODE='22023'; END IF;
 old_stage:=w.steps->w.current_step;
 IF p_approver_id=w.started_by OR NOT approval_private.person_eligible(p_approver_id,w.organisation_id,w.entity_type,d->>'country',d->>'site')
 OR (coalesce((old_stage->>'distinct_reviewer')::boolean,true) AND EXISTS(SELECT 1 FROM workflow_step_events WHERE instance_id=w.id AND action='approved' AND (actor_id=p_approver_id OR device_info->>'represented_actor_id'=p_approver_id::text))) THEN
  RAISE EXCEPTION 'Replacement reviewer is not eligible for this stage' USING ERRCODE='42501'; END IF;
 IF p_entity_type='checklist' AND d->>'approval_status'='pending_area_manager' AND NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_approver_id AND (is_super_admin OR role=ANY(ARRAY['Admin','Director','PMV Manager','Workshop Area Manager','Workshop Maintenance Area Manager']))) THEN
  RAISE EXCEPTION 'Final checklist review requires an area manager' USING ERRCODE='42501'; END IF;
 new_stage:=old_stage||jsonb_build_object('approver_user_id',p_approver_id,'approver_role',NULL,'assignee_type','user');
 INSERT INTO approval_private.permits VALUES(txid_current(),p_entity_type,p_entity_id);
 UPDATE workflow_instances SET steps=jsonb_set(steps,ARRAY[current_step::text],new_stage),approval_route_revision=approval_route_revision+1,last_actor_id=auth.uid() WHERE id=w.id;
 INSERT INTO workflow_step_events(instance_id,organisation_id,step_index,step_name,action,actor_id,comment,device_info)
 VALUES(w.id,w.organisation_id,w.current_step,old_stage->>'name','reassigned',auth.uid(),p_reason,jsonb_build_object('previous_assignment',old_stage,'new_assignment',new_stage));
 PERFORM approval_private.notify_stage(w.id,'reassigned');
 DELETE FROM approval_private.permits WHERE transaction_id=txid_current() AND entity_type=p_entity_type AND entity_id=p_entity_id;
 RETURN approval_private.context(p_entity_type,d);
END $$;

CREATE FUNCTION public.approval_delegate_stage(p_entity_type text,p_entity_id uuid,p_expected_stage text,p_delegate_id uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d jsonb; c jsonb; w workflow_instances; a approval_delegations;
BEGIN
 IF nullif(btrim(p_reason),'') IS NULL OR p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at<=p_starts_at OR p_ends_at<=now() OR p_ends_at-p_starts_at>interval '90 days' THEN
  RAISE EXCEPTION 'A reason and valid delegation period of at most 90 days are required' USING ERRCODE='22023'; END IF;
 d:=approval_private.document(p_entity_type,p_entity_id); c:=approval_private.context(p_entity_type,d);
 IF c->>'stage_token' IS DISTINCT FROM p_expected_stage THEN RAISE EXCEPTION 'Approval stage changed; reload before delegation' USING ERRCODE='40001'; END IF;
 SELECT * INTO w FROM workflow_instances WHERE id=(d->>'approval_workflow_id')::uuid FOR UPDATE;
 IF NOT FOUND OR NOT coalesce((c->>'can_decide')::boolean,false) OR c->>'represented_actor_id' IS DISTINCT FROM auth.uid()::text THEN
  RAISE EXCEPTION 'Only the directly assigned reviewer may delegate; delegation chains are not supported' USING ERRCODE='42501'; END IF;
 IF p_delegate_id IN (auth.uid(),w.started_by) OR NOT approval_private.person_eligible(p_delegate_id,w.organisation_id,w.entity_type,d->>'country',d->>'site')
 OR (coalesce((w.steps->w.current_step->>'distinct_reviewer')::boolean,true) AND EXISTS(SELECT 1 FROM workflow_step_events WHERE instance_id=w.id AND action='approved' AND (actor_id=p_delegate_id OR device_info->>'represented_actor_id'=p_delegate_id::text))) THEN
  RAISE EXCEPTION 'Delegate is not eligible for this stage' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM approval_delegations WHERE approval_workflow_id=w.id AND approval_stage_token=p_expected_stage AND active AND starts_at<p_ends_at AND ends_at>p_starts_at) THEN
  RAISE EXCEPTION 'An overlapping delegation already exists for this stage' USING ERRCODE='22023'; END IF;
 INSERT INTO approval_private.permits VALUES(txid_current(),p_entity_type,p_entity_id);
 INSERT INTO approval_delegations(organisation_id,delegator_id,delegate_id,entity_type,reason,starts_at,ends_at,active,created_by,approval_workflow_id,approval_stage_token)
 VALUES(w.organisation_id,auth.uid(),p_delegate_id,w.entity_type,p_reason,p_starts_at,p_ends_at,true,auth.uid(),w.id,p_expected_stage) RETURNING * INTO a;
 INSERT INTO workflow_step_events(instance_id,organisation_id,step_index,step_name,action,actor_id,comment,device_info)
 VALUES(w.id,w.organisation_id,w.current_step,w.steps->w.current_step->>'name','delegated',auth.uid(),p_reason,jsonb_build_object('delegation_id',a.id,'delegate_id',p_delegate_id,'starts_at',p_starts_at,'ends_at',p_ends_at));
 PERFORM approval_private.notify_stage(w.id,'delegated:'||a.id::text,p_delegate_id);
 DELETE FROM approval_private.permits WHERE transaction_id=txid_current() AND entity_type=p_entity_type AND entity_id=p_entity_id;
 RETURN to_jsonb(a);
END $$;

CREATE FUNCTION public.approval_revoke_delegation(p_delegation_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a approval_delegations; w workflow_instances; d jsonb;
BEGIN
 IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A revocation reason is required' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM approval_delegations WHERE id=p_delegation_id AND organisation_id=app_current_org();
 IF NOT FOUND OR a.approval_workflow_id IS NULL OR (a.delegator_id<>auth.uid() AND NOT coalesce(approval_policy_is_admin(),false)) THEN RAISE EXCEPTION 'Delegation unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO w FROM workflow_instances WHERE id=a.approval_workflow_id;
 d:=approval_private.document(w.entity_type,w.entity_id::uuid);
 PERFORM 1 FROM workflow_instances WHERE id=w.id FOR UPDATE;
 SELECT * INTO a FROM approval_delegations WHERE id=p_delegation_id FOR UPDATE;
 IF NOT a.active THEN RETURN to_jsonb(a); END IF;
 INSERT INTO approval_private.permits VALUES(txid_current(),w.entity_type,w.entity_id::uuid);
 UPDATE approval_delegations SET active=false,updated_at=clock_timestamp() WHERE id=a.id RETURNING * INTO a;
 INSERT INTO workflow_step_events(instance_id,organisation_id,step_index,step_name,action,actor_id,comment,device_info)
 VALUES(w.id,w.organisation_id,w.current_step,w.steps->w.current_step->>'name','delegation_revoked',auth.uid(),p_reason,jsonb_build_object('delegation_id',a.id));
 DELETE FROM approval_private.permits WHERE transaction_id=txid_current() AND entity_type=w.entity_type AND entity_id=w.entity_id::uuid;
 RETURN to_jsonb(a);
END $$;

-- Governed rows include active, scoped delegates and do not give administrators automatic decision authority.
CREATE OR REPLACE FUNCTION public.my_pending_approvals() RETURNS SETOF public.workflow_instances
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT w.* FROM workflow_instances w WHERE w.status IN ('pending','in_review','returned')
 AND (w.organisation_id IS NULL OR w.organisation_id=app_current_org())
 AND approval_workflow_visible(w.organisation_id,w.entity_type,w.context)
 AND CASE WHEN coalesce(w.context->>'approval_matrix','false')='true' THEN
  approval_private.represented_actor(w) IS NOT NULL
  AND (NOT coalesce((w.steps->w.current_step->>'distinct_reviewer')::boolean,true) OR NOT EXISTS(SELECT 1 FROM workflow_step_events e WHERE e.instance_id=w.id AND e.action='approved'
   AND (e.actor_id IN(auth.uid(),approval_private.represented_actor(w)) OR e.device_info->>'represented_actor_id' IN(auth.uid()::text,approval_private.represented_actor(w)::text))))
 ELSE lower(get_my_role())='admin' OR w.steps->w.current_step->>'approver_user_id'=auth.uid()::text
  OR lower(regexp_replace(coalesce(w.steps->w.current_step->>'approver_role',''),'\s+','_','g'))=lower(regexp_replace(coalesce(get_my_role(),''),'\s+','_','g')) END
 ORDER BY w.started_at
$$;

REVOKE ALL ON FUNCTION public.approval_review_people(text,uuid),public.approval_recover_route(text,uuid,text,text),public.approval_reassign_stage(text,uuid,text,uuid,text),
 public.approval_delegate_stage(text,uuid,text,uuid,timestamptz,timestamptz,text),public.approval_revoke_delegation(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approval_review_people(text,uuid),public.approval_recover_route(text,uuid,text,text),public.approval_reassign_stage(text,uuid,text,uuid,text),
 public.approval_delegate_stage(text,uuid,text,uuid,timestamptz,timestamptz,text),public.approval_revoke_delegation(uuid,text) TO authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA approval_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.approval_policy_is_admin(),public.approval_policy_people(),public.approval_policy_save(jsonb,timestamptz),
 public.approval_policy_publish(uuid,timestamptz,text,timestamptz),public.approval_policy_retire(uuid,timestamptz,text),
 public.approval_policy_simulate(text,text,text,text,uuid,uuid),public.approval_review_context(text,uuid),
 public.decide_approval(text,uuid,text,bigint,text,uuid,text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approval_policy_is_admin(),public.approval_policy_people(),public.approval_policy_save(jsonb,timestamptz),
 public.approval_policy_publish(uuid,timestamptz,text,timestamptz),public.approval_policy_retire(uuid,timestamptz,text),
 public.approval_policy_simulate(text,text,text,text,uuid,uuid),public.approval_review_context(text,uuid),
 public.decide_approval(text,uuid,text,bigint,text,uuid,text,text,timestamptz) TO authenticated;
