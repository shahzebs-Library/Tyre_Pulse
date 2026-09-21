-- Regional approval routing follows the VEHICLE'S BASE SITE.
--
-- Owner rule (2026-09-19): an inspection's approval goes to the region the vehicle is based
-- in, as recorded in the fleet register (vehicle_fleet.site) and Site Management
-- (sites.region). Where the vehicle is not on the register, or its base site has no
-- region, the site written on the document is used instead.
--
-- Measured before writing (Company A, active fleet): KSA 491 CENTRAL, 118 WESTERN,
-- 6 unmapped (GULF OF AQABA); UAE 452 and Egypt 135 have no region at all. Of 1,278
-- inspections, 29 were recorded at a site in a DIFFERENT region from the vehicle's base,
-- which is exactly the case this rule settles.
--
-- The region used, and where it came from, is written into the workflow context so any
-- routed request can be checked afterwards.

CREATE OR REPLACE FUNCTION approval_private.document_region(p_org uuid, p_country text, p_asset text, p_site text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH v AS (
  SELECT f.site FROM vehicle_fleet f
   WHERE f.organisation_id=p_org AND nullif(btrim(p_asset),'') IS NOT NULL
     AND upper(btrim(f.asset_no))=upper(btrim(p_asset))
   ORDER BY (f.country IS NOT DISTINCT FROM p_country) DESC, (coalesce(f.status,'Active')='Active') DESC, f.id
   LIMIT 1
 ), r AS (
  SELECT (SELECT site FROM v) AS base_site,
         approval_private.site_region(p_org,p_country,(SELECT site FROM v)) AS vehicle_region,
         approval_private.site_region(p_org,p_country,p_site) AS site_region
 )
 SELECT jsonb_build_object(
  'region', coalesce(vehicle_region, site_region),
  'basis', CASE WHEN vehicle_region IS NOT NULL THEN 'vehicle_base_site' WHEN site_region IS NOT NULL THEN 'document_site' ELSE 'none' END,
  'base_site', base_site)
 FROM r
$$;

-- An explicit region (the vehicle's, or the one picked in the simulator) now wins over the
-- document's own site; with no explicit region the site still decides, as before.
CREATE OR REPLACE FUNCTION approval_private.resolve(p_org uuid,p_type text,p_country text,p_site text,p_role text,p_user uuid,p_draft uuid DEFAULT NULL,p_region text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH ctx AS (
  SELECT coalesce(upper(nullif(btrim(p_region),'')),approval_private.site_region(p_org,p_country,p_site)) AS region
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

CREATE OR REPLACE FUNCTION approval_private.start_document()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE kind text:=coalesce(to_jsonb(NEW)->>'entity_type',CASE WHEN TG_TABLE_NAME='inspections' THEN 'inspection' ELSE 'checklist' END);
 route jsonb; requestor uuid; requestor_role text; w uuid; previous uuid; snapshot jsonb; pending boolean; tpl jsonb; place jsonb;
BEGIN
 pending:=NEW.approval_status=CASE WHEN kind='inspection' THEN 'pending_approval' ELSE 'pending' END;
 IF NOT pending OR (TG_OP='UPDATE' AND OLD.approval_status IS NOT DISTINCT FROM NEW.approval_status) THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME<>'approval_execution_requests' AND NOT EXISTS(SELECT 1 FROM approval_policies WHERE organisation_id=NEW.organisation_id AND entity_type=kind AND effective_at<=now()) THEN RETURN NEW; END IF;
 requestor:=nullif(CASE WHEN kind='inspection' THEN to_jsonb(NEW)->>'created_by' ELSE to_jsonb(NEW)->>'submitted_by' END,'')::uuid;
 IF requestor IS NULL OR (auth.uid() IS NOT NULL AND requestor<>auth.uid()) THEN RAISE EXCEPTION 'Submitter identity must match the signed-in user' USING ERRCODE='42501'; END IF;
 SELECT role INTO requestor_role FROM profiles WHERE id=requestor AND org_id=NEW.organisation_id AND approved IS TRUE AND locked IS NOT TRUE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Submitting user is unavailable in this organisation' USING ERRCODE='42501'; END IF;
 place:=approval_private.document_region(NEW.organisation_id,NEW.country,to_jsonb(NEW)->>'asset_no',NEW.site);
 route:=approval_private.resolve(NEW.organisation_id,kind,NEW.country,NEW.site,requestor_role,requestor,NULL,place->>'region');
 IF kind='checklist' THEN SELECT to_jsonb(t) INTO tpl FROM checklist_templates t WHERE id=(to_jsonb(NEW)->>'template_id')::uuid; END IF;
 snapshot:=route->'policy'; previous:=NEW.approval_workflow_id;
 INSERT INTO approval_private.permits VALUES(txid_current(),kind,NEW.id) ON CONFLICT DO NOTHING;
 INSERT INTO workflow_instances(organisation_id,entity_type,entity_id,entity_label,definition_name,steps,current_step,status,context,started_by,step_started_at,approval_policy_id)
 VALUES(NEW.organisation_id,kind,NEW.id::text,coalesce(NEW.title,NEW.asset_no),'Approval Matrix',
 coalesce((SELECT jsonb_agg(s||jsonb_build_object('assignee_type',CASE WHEN nullif(s->>'approver_user_id','') IS NOT NULL THEN 'user' ELSE 'role' END)) FROM jsonb_array_elements(snapshot->'stages') s),'[]'::jsonb),0,'pending',
 jsonb_build_object('approval_matrix',true,'policy',snapshot,'routing_status',route->>'status','template',tpl,'content',approval_private.content(to_jsonb(NEW)),
  'region',place->>'region','region_basis',place->>'basis','vehicle_base_site',place->>'base_site'),requestor,clock_timestamp(),nullif(snapshot->>'id','')::uuid) RETURNING id INTO w;
 IF kind='inspection' THEN UPDATE inspections SET approval_workflow_id=w WHERE id=NEW.id; ELSIF kind='checklist' THEN UPDATE checklist_submissions SET approval_workflow_id=w WHERE id=NEW.id; ELSE UPDATE approval_execution_requests SET approval_workflow_id=w WHERE id=NEW.id; END IF;
 INSERT INTO workflow_step_events(instance_id,organisation_id,step_index,step_name,action,actor_id,comment)
 VALUES(w,NEW.organisation_id,0,'Approval Matrix','started',requestor,CASE WHEN route->>'status'='matched' THEN 'Published route selected' ELSE 'Routing exception: '||(route->>'status') END);
 PERFORM approval_private.notify_stage(w);
 DELETE FROM approval_private.permits WHERE transaction_id=txid_current() AND entity_type=kind AND entity_id=NEW.id;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.approval_recover_route(p_entity_type text, p_entity_id uuid, p_expected_stage text, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE d jsonb; c jsonb; w workflow_instances; route jsonb; requestor_role text; previous jsonb; place jsonb;
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
 place:=approval_private.document_region(w.organisation_id,d->>'country',d->>'asset_no',d->>'site');
 route:=approval_private.resolve(w.organisation_id,w.entity_type,d->>'country',d->>'site',requestor_role,w.started_by,NULL,place->>'region');
 IF route->>'status'<>'matched' THEN RAISE EXCEPTION 'Publish a single matching policy before recovering this request' USING ERRCODE='22023'; END IF;
 previous:=w.context;
 INSERT INTO approval_private.permits VALUES(txid_current(),p_entity_type,p_entity_id);
 UPDATE workflow_instances SET approval_policy_id=(route#>>'{policy,id}')::uuid,
  steps=(SELECT jsonb_agg(s||jsonb_build_object('assignee_type',CASE WHEN nullif(s->>'approver_user_id','') IS NOT NULL THEN 'user' ELSE 'role' END)) FROM jsonb_array_elements(route#>'{policy,stages}') s),
  context=context||jsonb_build_object('policy',route->'policy','routing_status','matched','region',place->>'region','region_basis',place->>'basis','vehicle_base_site',place->>'base_site'),
  approval_route_revision=approval_route_revision+1,last_actor_id=auth.uid(),step_started_at=clock_timestamp() WHERE id=w.id;
 INSERT INTO workflow_step_events(instance_id,organisation_id,step_index,step_name,action,actor_id,comment,device_info)
 VALUES(w.id,w.organisation_id,0,'Routing recovery','route_recovered',auth.uid(),p_reason,jsonb_build_object('previous_routing',previous->>'routing_status','policy',route->'policy'));
 PERFORM approval_private.notify_stage(w.id,'recovered');
 DELETE FROM approval_private.permits WHERE transaction_id=txid_current() AND entity_type=p_entity_type AND entity_id=p_entity_id;
 RETURN approval_private.context(p_entity_type,d);
END $function$;

-- Simulator: test a real vehicle. Its base site decides the region, exactly as a submission would.
DROP FUNCTION IF EXISTS public.approval_policy_simulate(text,text,text,text,uuid,uuid,text);
CREATE FUNCTION public.approval_policy_simulate(p_entity_type text, p_country text DEFAULT NULL, p_site text DEFAULT NULL, p_role text DEFAULT NULL, p_user_id uuid DEFAULT NULL, p_draft_id uuid DEFAULT NULL, p_region text DEFAULT NULL, p_asset_no text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE place jsonb;
BEGIN
 IF NOT coalesce(approval_policy_is_admin(),false) THEN RAISE EXCEPTION 'Approval configuration access denied' USING ERRCODE='42501'; END IF;
 IF p_entity_type NOT IN ('inspection','checklist','work_order','tyre_change') THEN RAISE EXCEPTION 'Unsupported approval module' USING ERRCODE='22023'; END IF;
 IF p_draft_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM approval_policies WHERE id=p_draft_id AND organisation_id=app_current_org() AND entity_type=p_entity_type AND state='draft') THEN RAISE EXCEPTION 'Draft unavailable' USING ERRCODE='42501'; END IF;
 IF p_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_user_id AND org_id=app_current_org()) THEN RAISE EXCEPTION 'Submitting person unavailable' USING ERRCODE='42501'; END IF;
 IF nullif(btrim(p_asset_no),'') IS NOT NULL THEN
  place:=approval_private.document_region(app_current_org(),p_country,p_asset_no,p_site);
  RETURN approval_private.resolve(app_current_org(),p_entity_type,p_country,p_site,p_role,p_user_id,p_draft_id,coalesce(place->>'region',p_region))
   || jsonb_build_object('region_basis',place->>'basis','vehicle_base_site',place->>'base_site');
 END IF;
 RETURN approval_private.resolve(app_current_org(),p_entity_type,p_country,p_site,p_role,p_user_id,p_draft_id,p_region);
END $function$;

-- Which vehicles land in which region, and which route each region has, so an admin can
-- confirm the setup before and after publishing.
CREATE OR REPLACE FUNCTION public.approval_region_coverage(p_entity_type text DEFAULT 'inspection')
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_org uuid:=app_current_org();
BEGIN
 IF NOT coalesce(approval_policy_is_admin(),false) THEN RAISE EXCEPTION 'Approval configuration access denied' USING ERRCODE='42501'; END IF;
 RETURN (WITH f AS (
   SELECT f.country, f.site, approval_private.site_region(v_org,f.country,f.site) AS region
   FROM vehicle_fleet f WHERE f.organisation_id=v_org AND coalesce(f.status,'Active')='Active')
  SELECT jsonb_build_object(
   'regions', coalesce((SELECT jsonb_agg(x ORDER BY x->>'country', x->>'region') FROM (
     SELECT jsonb_build_object('country',country,'region',coalesce(region,''),'vehicles',count(*),
       'sites',(SELECT jsonb_agg(DISTINCT s.site) FROM f s WHERE s.country=f.country AND s.region IS NOT DISTINCT FROM f.region),
       'route',approval_private.resolve(v_org,p_entity_type,country,NULL,NULL,NULL,NULL,region)->'policy'->>'name',
       'route_status',approval_private.resolve(v_org,p_entity_type,country,NULL,NULL,NULL,NULL,region)->>'status') x
     FROM f GROUP BY country, region) q),'[]'::jsonb),
   'unmapped_sites', coalesce((SELECT jsonb_agg(jsonb_build_object('country',country,'site',site,'vehicles',n) ORDER BY n DESC)
     FROM (SELECT country, site, count(*) n FROM f WHERE region IS NULL AND country IN (SELECT DISTINCT country FROM f WHERE region IS NOT NULL) GROUP BY 1,2) u),'[]'::jsonb)));
END $function$;

REVOKE ALL ON FUNCTION approval_private.document_region(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.approval_policy_simulate(text,text,text,text,uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approval_policy_simulate(text,text,text,text,uuid,uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.approval_region_coverage(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approval_region_coverage(text) TO authenticated;
