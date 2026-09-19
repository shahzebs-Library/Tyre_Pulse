-- Regional approval routing.
--
-- Approval Matrix policies can now match on a REGION (sites.region, e.g. CENTRAL / WESTERN),
-- so a tyre inspection from any site in a region routes to that region's reviewers.
-- The Visual Workflow Builder gains the same key: every launched workflow carries a derived
-- `region` in its context, so a step condition `region = CENTRAL` works at runtime.
--
-- Region is recorded ONCE on the site register. Nothing stores a second region column on a
-- business row; it is always derived site -> sites.region at the moment of routing.
--
-- Precedence stays a COUNT of pinned match fields. A site policy auto-carries its own site's
-- region, so {country, region, site} (3) always outranks {country, region} (2) and a regional
-- policy never ties with a site policy of the same country.
--
-- Measured before writing: approval_policies holds 0 rows (published 0, draft 0) and no
-- workflow definition has a condition on step 0, so neither change alters any live route.

ALTER TABLE public.approval_policies ADD COLUMN IF NOT EXISTS match_region text;

-- The one resolver of "which region is this site in". Country-preferring, active-preferring,
-- case-insensitive. NULL when the site is not on the register or the register has no region.
CREATE OR REPLACE FUNCTION approval_private.site_region(p_org uuid, p_country text, p_site text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT upper(btrim(s.region)) FROM sites s
  WHERE s.organisation_id=p_org AND nullif(btrim(p_site),'') IS NOT NULL
    AND upper(btrim(s.name))=upper(btrim(p_site))
    AND nullif(btrim(s.region),'') IS NOT NULL
    AND (p_country IS NULL OR s.country=p_country OR NOT EXISTS(
      SELECT 1 FROM sites t WHERE t.organisation_id=p_org AND upper(btrim(t.name))=upper(btrim(p_site)) AND t.country=p_country))
  ORDER BY (s.country IS NOT DISTINCT FROM p_country) DESC, s.active DESC NULLS LAST, s.id
  LIMIT 1
$$;

-- Resolver: gains match_region + an optional explicit region (simulation). Drop the 7-arg form
-- so positional callers (start_document, simulate) resolve to exactly one function.
DROP FUNCTION IF EXISTS approval_private.resolve(uuid,text,text,text,text,uuid,uuid);
CREATE FUNCTION approval_private.resolve(p_org uuid,p_type text,p_country text,p_site text,p_role text,p_user uuid,p_draft uuid DEFAULT NULL,p_region text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH ctx AS (
  SELECT coalesce(approval_private.site_region(p_org,p_country,p_site),upper(nullif(btrim(p_region),''))) AS region
 ), candidates AS (
 SELECT p.*,num_nonnulls(p.match_country,p.match_region,p.match_site,p.match_role,p.match_user_id) specificity,
 dense_rank() OVER(ORDER BY p.priority DESC,num_nonnulls(p.match_country,p.match_region,p.match_site,p.match_role,p.match_user_id) DESC) rank
 FROM approval_policies p CROSS JOIN ctx
 WHERE p.organisation_id=p_org AND p.entity_type=p_type AND ((p.state='published' AND p.effective_at<=now()) OR (p.id=p_draft AND p.state='draft'))
 AND (p.match_country IS NULL OR p.match_country=p_country)
 AND (p.match_region IS NULL OR p.match_region=ctx.region)
 AND (p.match_site IS NULL OR p.match_site=p_site)
 AND (p.match_role IS NULL OR p.match_role=p_role) AND (p.match_user_id IS NULL OR p.match_user_id=p_user))
 SELECT jsonb_build_object('mode',CASE WHEN EXISTS(SELECT 1 FROM approval_policies WHERE organisation_id=p_org AND entity_type=p_type AND effective_at<=now()) THEN 'enforced' ELSE 'legacy' END,
 'status',CASE count(*) FILTER(WHERE rank=1) WHEN 0 THEN 'no_route' WHEN 1 THEN 'matched' ELSE 'ambiguous' END,
 'region',(SELECT region FROM ctx),
 'policy',CASE WHEN count(*) FILTER(WHERE rank=1)=1 THEN (jsonb_agg(to_jsonb(candidates)-'rank'-'specificity' ORDER BY rank,id)->0) ELSE NULL END,
 'candidates',coalesce(jsonb_agg(to_jsonb(candidates) ORDER BY rank,id),'[]'::jsonb)) FROM candidates
$$;

CREATE OR REPLACE FUNCTION approval_private.validate_policy(p approval_policies)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s jsonb; reviewer uuid; reviewer_role text; seen uuid[]:='{}'::uuid[];
BEGIN
 IF p.match_site IS NOT NULL AND (p.match_country IS NULL OR NOT EXISTS(
  SELECT 1 FROM sites WHERE organisation_id=p.organisation_id AND name=p.match_site AND country=p.match_country AND active IS TRUE)) THEN
  RAISE EXCEPTION 'Select an active site in the selected country' USING ERRCODE='22023'; END IF;
 IF p.match_region IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM sites WHERE organisation_id=p.organisation_id AND active IS TRUE AND upper(btrim(region))=p.match_region
   AND (p.match_country IS NULL OR country=p.match_country)) THEN
  RAISE EXCEPTION 'Select a region that has active sites in the selected country' USING ERRCODE='22023'; END IF;
 IF p.match_region IS NOT NULL AND p.match_site IS NOT NULL
  AND approval_private.site_region(p.organisation_id,p.match_country,p.match_site) IS DISTINCT FROM p.match_region THEN
  RAISE EXCEPTION 'The selected site is not in the selected region' USING ERRCODE='22023'; END IF;
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
    -- Super admins are country-unscoped; person_eligible() already admits them at runtime.
    AND (p.match_country IS NULL OR u.is_super_admin OR EXISTS(SELECT 1 FROM unnest(coalesce(u.country,u.countries)) c WHERE lower(btrim(c)) IN ('all',lower(p.match_country))))
    AND (p.match_site IS NULL OR u.role='Admin' OR u.is_super_admin OR EXISTS(SELECT 1 FROM unnest(coalesce(u.sites,ARRAY[u.site])) x WHERE upper(btrim(x)) IN ('ALL','*',upper(p.match_site))))
    -- A regional reviewer must cover at least one site of that region (or all sites).
    AND (p.match_region IS NULL OR p.match_site IS NOT NULL OR u.role='Admin' OR u.is_super_admin
     OR EXISTS(SELECT 1 FROM unnest(coalesce(u.sites,ARRAY[u.site])) x WHERE upper(btrim(x)) IN ('ALL','*')
      OR upper(btrim(x)) IN (SELECT upper(btrim(t.name)) FROM sites t WHERE t.organisation_id=p.organisation_id AND upper(btrim(t.region))=p.match_region)))
  ) THEN RAISE EXCEPTION 'A stage has no active approver with the required module role and scope' USING ERRCODE='22023'; END IF;
 END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public.approval_policy_save(p_policy jsonb, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE p approval_policies; existing approval_policies;
BEGIN
 IF NOT coalesce(approval_policy_is_admin(),false) THEN RAISE EXCEPTION 'Approval configuration access denied' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_policy)<>'object' OR (p_policy-'id'-'name'-'entity_type'-'priority'-'match_country'-'match_region'-'match_site'-'match_role'-'match_user_id'-'stages'-'change_reason')<>'{}'::jsonb THEN
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
 p.match_region:=upper(nullif(btrim(p.match_region),''));
 -- A site policy always carries its own site's region so it outranks a regional policy.
 IF p.match_site IS NOT NULL THEN p.match_region:=approval_private.site_region(p.organisation_id,p.match_country,p.match_site); END IF;
 p.match_role:=nullif(btrim(p.match_role),''); p.created_by:=coalesce(existing.created_by,auth.uid()); p.created_at:=coalesce(existing.created_at,clock_timestamp()); p.updated_at:=clock_timestamp();
 PERFORM approval_private.validate_policy(p);
 INSERT INTO approval_policies SELECT p.* ON CONFLICT(id) DO UPDATE SET name=excluded.name,entity_type=excluded.entity_type,priority=excluded.priority,
 match_country=excluded.match_country,match_region=excluded.match_region,match_site=excluded.match_site,match_role=excluded.match_role,match_user_id=excluded.match_user_id,
 stages=excluded.stages,updated_at=excluded.updated_at,change_reason=excluded.change_reason;
 INSERT INTO approval_policy_events(policy_id,organisation_id,action,actor_id,reason,snapshot)
 VALUES(p.id,p.organisation_id,'draft_saved',auth.uid(),p.change_reason,to_jsonb(p));
 RETURN to_jsonb(p);
END $function$;

CREATE OR REPLACE FUNCTION public.approval_policy_publish(p_policy_id uuid, p_expected_updated_at timestamp with time zone, p_reason text, p_effective_at timestamp with time zone DEFAULT clock_timestamp())
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE p approval_policies;
BEGIN
 IF NOT coalesce(approval_policy_is_admin(),false) THEN RAISE EXCEPTION 'Approval configuration access denied' USING ERRCODE='42501'; END IF;
 IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Publication reason is required' USING ERRCODE='22023'; END IF;
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
  AND num_nonnulls(q.match_country,q.match_region,q.match_site,q.match_role,q.match_user_id)=num_nonnulls(p.match_country,p.match_region,p.match_site,p.match_role,p.match_user_id)
  AND (q.match_country IS NULL OR p.match_country IS NULL OR q.match_country=p.match_country)
  AND (q.match_region IS NULL OR p.match_region IS NULL OR q.match_region=p.match_region)
  AND (q.match_site IS NULL OR p.match_site IS NULL OR q.match_site=p.match_site)
  AND (q.match_role IS NULL OR p.match_role IS NULL OR q.match_role=p.match_role)
  AND (q.match_user_id IS NULL OR p.match_user_id IS NULL OR q.match_user_id=p.match_user_id)) THEN
  RAISE EXCEPTION 'Equally ranked published policies overlap; change priority or retire the conflicting policy' USING ERRCODE='22023'; END IF;
 UPDATE approval_policies SET state='published',version=(SELECT coalesce(max(version),0)+1 FROM approval_policies WHERE organisation_id=p.organisation_id AND entity_type=p.entity_type AND state<>'draft'),
 published_by=auth.uid(),published_at=clock_timestamp(),effective_at=p_effective_at,updated_at=clock_timestamp(),change_reason=btrim(p_reason) WHERE id=p.id RETURNING * INTO p;
 INSERT INTO approval_policy_events(policy_id,organisation_id,action,actor_id,reason,snapshot) VALUES(p.id,p.organisation_id,'published',auth.uid(),p_reason,to_jsonb(p));
 RETURN to_jsonb(p);
END $function$;

-- Simulation gains an optional region so an admin can test a regional route without picking a site.
DROP FUNCTION IF EXISTS public.approval_policy_simulate(text,text,text,text,uuid,uuid);
CREATE FUNCTION public.approval_policy_simulate(p_entity_type text, p_country text DEFAULT NULL, p_site text DEFAULT NULL, p_role text DEFAULT NULL, p_user_id uuid DEFAULT NULL, p_draft_id uuid DEFAULT NULL, p_region text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
 IF NOT coalesce(approval_policy_is_admin(),false) THEN RAISE EXCEPTION 'Approval configuration access denied' USING ERRCODE='42501'; END IF;
 IF p_entity_type NOT IN ('inspection','checklist','work_order','tyre_change') THEN RAISE EXCEPTION 'Unsupported approval module' USING ERRCODE='22023'; END IF;
 IF p_draft_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM approval_policies WHERE id=p_draft_id AND organisation_id=app_current_org() AND entity_type=p_entity_type AND state='draft') THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE='42501'; END IF;
 IF p_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_user_id AND org_id=app_current_org()) THEN RAISE EXCEPTION 'Submitting person unavailable' USING ERRCODE='42501'; END IF;
 RETURN approval_private.resolve(app_current_org(),p_entity_type,p_country,p_site,p_role,p_user_id,p_draft_id,p_region);
END $function$;

-- Visual Workflow Builder: derive `region` into the launch context (never overwriting one the
-- caller supplied), and honour a condition on the FIRST step so a region-only route can start
-- at the right reviewer. If no step's condition passes, the instance starts at step 0 as before.
CREATE OR REPLACE FUNCTION public._workflow_launch(p_definition_id uuid, p_entity_type text, p_entity_id text, p_entity_label text, p_context jsonb, p_actor uuid, p_source_event bigint)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_def  public.workflow_definitions%ROWTYPE;
  v_id   uuid;
  v_step jsonb;
  v_ctx  jsonb := COALESCE(p_context, '{}'::jsonb);
  v_region text;
  v_start int := 0;
BEGIN
  SELECT * INTO v_def FROM public.workflow_definitions WHERE id = p_definition_id AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow definition not found or inactive';
  END IF;
  SELECT id INTO v_id FROM public.workflow_instances
   WHERE definition_id = p_definition_id
     AND entity_type = p_entity_type
     AND entity_id IS NOT DISTINCT FROM p_entity_id
     AND status = 'pending'
   LIMIT 1;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  IF jsonb_typeof(v_ctx) <> 'object' THEN v_ctx := '{}'::jsonb; END IF;
  IF nullif(btrim(v_ctx ->> 'region'), '') IS NULL AND nullif(btrim(v_ctx ->> 'site'), '') IS NOT NULL THEN
    -- Definitions are often org-less (shared templates); fall back to the actor's org.
    v_region := approval_private.site_region(
      COALESCE(v_def.organisation_id, (SELECT org_id FROM public.profiles WHERE id = p_actor), public.app_current_org()),
      nullif(btrim(v_ctx ->> 'country'), ''), v_ctx ->> 'site');
    IF v_region IS NOT NULL THEN v_ctx := v_ctx || jsonb_build_object('region', v_region); END IF;
  ELSIF nullif(btrim(v_ctx ->> 'region'), '') IS NOT NULL THEN
    v_ctx := v_ctx || jsonb_build_object('region', upper(btrim(v_ctx ->> 'region')));
  END IF;
  IF NOT public.workflow_step_condition_passes(v_def.steps -> 0, v_ctx) THEN
    v_start := COALESCE(public._workflow_next_runnable_step(v_def.steps, 0, v_ctx), 0);
  END IF;
  INSERT INTO public.workflow_instances
    (definition_id, definition_name, organisation_id, entity_type, entity_id,
     entity_label, steps, current_step, context, source_event_id, started_by)
  VALUES
    (v_def.id, v_def.name, v_def.organisation_id, p_entity_type, p_entity_id,
     p_entity_label, v_def.steps, v_start, v_ctx, p_source_event, p_actor)
  RETURNING id INTO v_id;
  v_step := v_def.steps -> v_start;
  INSERT INTO public.workflow_step_events (instance_id, organisation_id, step_index, step_name, action, actor_id)
  VALUES (v_id, v_def.organisation_id, v_start, v_step ->> 'name', 'started', p_actor);
  PERFORM public.notify_role_in_org(
    v_step ->> 'approver_role', v_def.organisation_id, 'approval',
    'Approval required: ' || v_def.name,
    COALESCE(p_entity_label, p_entity_type || ' ' || COALESCE(p_entity_id, '')) ||
      ' is waiting at step "' || (v_step ->> 'name') || '".',
    'workflow', v_id);
  PERFORM public.emit_domain_event('workflow.started', 'workflow_instance', v_id::text,
    jsonb_build_object('definition', v_def.name, 'entity_type', p_entity_type,
                       'entity_id', p_entity_id, 'step', v_step ->> 'name'),
    v_def.organisation_id, p_actor);
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION approval_private.site_region(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION approval_private.resolve(uuid,text,text,text,text,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.approval_policy_simulate(text,text,text,text,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approval_policy_simulate(text,text,text,text,uuid,uuid,text) TO authenticated;
