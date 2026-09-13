-- Driver identity, dated team/vehicle assignment and attributable fine decisions.
-- No existing name-based record is automatically claimed by a login.
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE public.driver_account_links (
  driver_id uuid PRIMARY KEY REFERENCES public.drivers(id),
  user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id),
  organisation_id uuid NOT NULL,
  linked_by uuid NOT NULL REFERENCES public.profiles(id),
  linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.driver_team_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  organisation_id uuid NOT NULL,
  supervisor_id uuid REFERENCES public.profiles(id),
  manager_id uuid REFERENCES public.profiles(id),
  vehicle_id uuid REFERENCES public.vehicle_fleet(id),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 2000),
  assigned_by uuid NOT NULL REFERENCES public.profiles(id),
  CHECK(ends_at IS NULL OR ends_at >= starts_at)
);
CREATE UNIQUE INDEX driver_team_current ON public.driver_team_assignments(driver_id) WHERE ends_at IS NULL;
CREATE INDEX driver_team_supervisor ON public.driver_team_assignments(supervisor_id,driver_id) WHERE ends_at IS NULL;
CREATE INDEX driver_team_manager ON public.driver_team_assignments(manager_id,driver_id) WHERE ends_at IS NULL;
CREATE TABLE public.driver_fines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicle_fleet(id),
  country text NOT NULL,
  site text NOT NULL,
  authority text NOT NULL CHECK(length(btrim(authority)) BETWEEN 1 AND 160),
  notice_reference text NOT NULL CHECK(length(btrim(notice_reference)) BETWEEN 1 AND 160),
  incident_at timestamptz NOT NULL,
  due_date date,
  amount numeric(14,2) NOT NULL CHECK(amount > 0 AND amount::text NOT IN ('NaN','Infinity','-Infinity')),
  currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  description text NOT NULL CHECK(length(btrim(description)) BETWEEN 3 AND 4000),
  assignment_reason text NOT NULL CHECK(length(btrim(assignment_reason)) BETWEEN 3 AND 2000),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','settled','cancelled')),
  response_status text NOT NULL DEFAULT 'awaiting_response' CHECK(response_status IN ('awaiting_response','submitted','returned','approved')),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(paid_amount >= 0 AND paid_amount <= amount),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organisation_id,country,authority,notice_reference)
);
CREATE INDEX driver_fines_driver ON public.driver_fines(driver_id,created_at DESC,id);
CREATE TABLE public.driver_fine_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fine_id uuid NOT NULL REFERENCES public.driver_fines(id),
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  organisation_id uuid NOT NULL,
  object_path text NOT NULL UNIQUE,
  file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 160),
  kind text NOT NULL CHECK(kind IN ('notice','payment','supporting')),
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_fine_evidence_case ON public.driver_fine_evidence(fine_id);
CREATE TABLE public.driver_fine_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fine_id uuid NOT NULL REFERENCES public.driver_fines(id),
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  organisation_id uuid NOT NULL,
  notice_version integer NOT NULL,
  signer_id uuid NOT NULL REFERENCES public.profiles(id),
  statement_version text NOT NULL DEFAULT 'receipt-v1',
  statement_language text NOT NULL DEFAULT 'en' CHECK(statement_language IN ('en','ar','ur')),
  resolution text NOT NULL CHECK(resolution IN ('direct_payment','already_paid','dispute','company_recovery','instalments')),
  explanation text NOT NULL CHECK(length(btrim(explanation)) BETWEEN 3 AND 4000),
  payment_reference text,
  proposed_date date,
  signature text NOT NULL CHECK(length(signature) BETWEEN 100 AND 500000),
  notice_snapshot jsonb NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(fine_id,notice_version)
);
CREATE TABLE public.driver_record_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  organisation_id uuid NOT NULL,
  source_type text NOT NULL CHECK(source_type IN ('driver_documents','driver_training','driver_coaching','driver_safety_events','driver_expenses','tyre_records','accidents','wo_tasks','checklist_submissions','odometer_logs','wash_records')),
  source_id uuid NOT NULL,
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 2000),
  linked_by uuid NOT NULL REFERENCES public.profiles(id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_type,source_id)
);
CREATE INDEX driver_records_driver ON public.driver_record_links(driver_id,linked_at DESC,id);
CREATE TABLE public.driver_workspace_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  fine_id uuid REFERENCES public.driver_fines(id),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_events_driver ON public.driver_workspace_events(driver_id,created_at DESC,id);
CREATE TABLE private.driver_workspace_requests (
  actor_id uuid NOT NULL,
  request_id uuid NOT NULL,
  action text NOT NULL,
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY(actor_id,request_id)
);
REVOKE ALL ON private.driver_workspace_requests FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.driver_workspace_scope(p_org uuid,p_country text,p_site text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(auth.uid() IS NOT NULL AND public.app_is_active()
    AND p_org=public.app_current_org()
    AND (public.is_super_admin() OR public.app_sees_all_countries() OR lower(btrim(p_country))=ANY(public.app_country_scope()))
    AND (public.is_super_admin() OR public.app_sees_all_sites() OR upper(btrim(p_site))=ANY(public.app_site_scope())),false);
$$;
CREATE FUNCTION private.driver_workspace_access(p_driver_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.drivers%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.drivers WHERE id=p_driver_id;
  IF NOT FOUND OR NOT private.driver_workspace_scope(d.organisation_id,d.country,d.site) THEN RETURN 'none'; END IF;
  IF public.app_user_can('fleet_master','edit') THEN RETURN 'manager'; END IF;
  IF EXISTS(SELECT 1 FROM public.driver_account_links l WHERE l.driver_id=d.id AND l.user_id=auth.uid() AND l.organisation_id=d.organisation_id) THEN RETURN 'driver'; END IF;
  IF EXISTS(SELECT 1 FROM public.driver_team_assignments a WHERE a.driver_id=d.id AND a.organisation_id=d.organisation_id
    AND a.starts_at<=now() AND (a.ends_at IS NULL OR a.ends_at>now()) AND auth.uid() IN (a.supervisor_id,a.manager_id)) THEN RETURN 'supervisor'; END IF;
  IF public.app_user_can('driver_workspace','view') THEN RETURN 'viewer'; END IF;
  RETURN 'none';
END $$;
REVOKE ALL ON FUNCTION private.driver_workspace_scope(uuid,text,text),private.driver_workspace_access(uuid) FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.driver_workspace_scope(uuid,text,text),private.driver_workspace_access(uuid) TO authenticated;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['driver_account_links','driver_team_assignments','driver_fines','driver_fine_responses','driver_fine_evidence','driver_record_links','driver_workspace_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
    EXECUTE format('CREATE POLICY driver_workspace_read ON public.%I FOR SELECT TO authenticated USING (organisation_id=public.app_current_org() AND private.driver_workspace_access(driver_id)<>''none'')',t);
  END LOOP;
END $$;

-- Explicitly limited projection; linking a case does not expose its internal notes,
-- other participants' signatures, or administrative/insurance workstreams.
CREATE FUNCTION private.driver_record_summary(p_type text,p_id uuid,p_org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;
BEGIN
  IF p_type NOT IN ('driver_documents','driver_training','driver_coaching','driver_safety_events','driver_expenses','tyre_records','accidents','wo_tasks','checklist_submissions','odometer_logs','wash_records') THEN RAISE EXCEPTION 'Unsupported record type' USING ERRCODE='22023'; END IF;
  EXECUTE format('SELECT to_jsonb(r) FROM public.%I r WHERE id=$1 AND organisation_id=$2',p_type) INTO r USING p_id,p_org;
  IF r IS NULL THEN RETURN NULL; END IF;
  RETURN (SELECT coalesce(jsonb_object_agg(key,value),'{}') FROM jsonb_each(r)
    WHERE key IN ('id','country','site','asset_no','driver_name','title','doc_type','doc_number','expiry_date','course_name','result','completed_date','coaching_status','period','event_type','severity','event_at','category','amount','currency','expense_date','status','incident_date','accident_type','due_date','created_at','reading_date','odometer_km','wash_date','template_name','approval_status','brand','serial_no','issue_date','qty','cost_per_tyre'));
END $$;
REVOKE ALL ON FUNCTION private.driver_record_summary(text,uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.driver_workspace_read(p_driver_id uuid,p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; access_mode text; d public.drivers%ROWTYPE; page_size integer:=100;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.app_is_active(),false) OR public.app_current_org() IS NULL THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF p_offset IS NULL OR p_offset<0 OR p_offset>1000000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
  IF p_driver_id IS NULL THEN
    SELECT jsonb_build_object('can_manage',coalesce(public.app_user_can('fleet_master','edit'),false),
      'drivers',coalesce(jsonb_agg(x ORDER BY x->>'driver_name',x->>'id'),'[]')) INTO result FROM (
      SELECT jsonb_build_object('id',drv.id,'driver_id',drv.driver_id,'driver_name',drv.driver_name,'position',nullif(btrim(drv.custom_data->>'position'),''),'country',drv.country,'site',drv.site,'status',drv.status,
        'access',private.driver_workspace_access(drv.id),'user_id',l.user_id,
        'open_fines',(SELECT count(*) FROM public.driver_fines f WHERE f.driver_id=drv.id AND f.status='open'),
        'awaiting_response',(SELECT count(*) FROM public.driver_fines f WHERE f.driver_id=drv.id AND f.status='open' AND f.response_status IN ('awaiting_response','returned')),
        'overdue_fines',(SELECT count(*) FROM public.driver_fines f WHERE f.driver_id=drv.id AND f.status='open' AND f.due_date<current_date)) x
      FROM public.drivers drv LEFT JOIN public.driver_account_links l ON l.driver_id=drv.id
      WHERE drv.organisation_id=public.app_current_org() AND private.driver_workspace_access(drv.id)<>'none'
      ORDER BY drv.driver_name,drv.id LIMIT page_size+1 OFFSET p_offset
    ) q;
    RETURN result;
  END IF;
  access_mode:=private.driver_workspace_access(p_driver_id);
  IF access_mode='none' THEN RAISE EXCEPTION 'Driver unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO d FROM public.drivers WHERE id=p_driver_id;
  RETURN jsonb_build_object('access',access_mode,'driver',jsonb_build_object('id',d.id,'driver_id',d.driver_id,'driver_name',d.driver_name,'position',nullif(btrim(d.custom_data->>'position'),''),'country',d.country,'site',d.site,'status',d.status),
    'can_respond',EXISTS(SELECT 1 FROM public.driver_account_links WHERE driver_id=d.id AND user_id=auth.uid()),
    'can_review',access_mode IN ('manager','supervisor') AND NOT EXISTS(SELECT 1 FROM public.driver_account_links WHERE driver_id=d.id AND user_id=auth.uid()),
    'can_manage',coalesce(public.app_user_can('fleet_master','edit'),false),
    'assignments',(SELECT coalesce(jsonb_agg(x ORDER BY x->>'starts_at' DESC),'[]') FROM (
      SELECT to_jsonb(a)||jsonb_build_object('supervisor_name',s.full_name,'manager_name',m.full_name,'asset_no',v.asset_no) x
      FROM public.driver_team_assignments a LEFT JOIN public.profiles s ON s.id=a.supervisor_id LEFT JOIN public.profiles m ON m.id=a.manager_id LEFT JOIN public.vehicle_fleet v ON v.id=a.vehicle_id
      WHERE a.driver_id=d.id ORDER BY a.starts_at DESC,a.id LIMIT page_size+1 OFFSET p_offset) q),
    'fines',(SELECT coalesce(jsonb_agg(x ORDER BY x->>'created_at' DESC,x->>'id'),'[]') FROM (
      SELECT to_jsonb(f)||jsonb_build_object('asset_no',v.asset_no,'evidence',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at),'[]') FROM public.driver_fine_evidence e WHERE e.fine_id=f.id),'responses',(SELECT coalesce(jsonb_agg(to_jsonb(r)-'signature' ORDER BY r.signed_at),'[]') FROM public.driver_fine_responses r WHERE r.fine_id=f.id)) x
      FROM public.driver_fines f LEFT JOIN public.vehicle_fleet v ON v.id=f.vehicle_id WHERE f.driver_id=d.id ORDER BY f.created_at DESC,f.id LIMIT page_size+1 OFFSET p_offset) q),
    'records',(SELECT coalesce(jsonb_agg(x ORDER BY x->>'linked_at' DESC,x->>'id'),'[]') FROM (
      SELECT to_jsonb(l)||jsonb_build_object('record',private.driver_record_summary(l.source_type,l.source_id,l.organisation_id)) x FROM public.driver_record_links l WHERE l.driver_id=d.id ORDER BY l.linked_at DESC,l.id LIMIT page_size+1 OFFSET p_offset) q),
    'work',(SELECT coalesce(jsonb_agg(x ORDER BY x->>'id'),'[]') FROM (
      SELECT jsonb_build_object('id',t.id,'title',t.title,'status',t.status,'source_type','wo_tasks','job_id',t.job_id) x
      FROM public.wo_tasks t JOIN public.driver_account_links l ON l.user_id=t.assignee_user_id AND l.driver_id=d.id
      WHERE t.organisation_id=d.organisation_id AND private.driver_workspace_scope(t.organisation_id,t.country,t.site)
      ORDER BY t.id LIMIT page_size+1 OFFSET p_offset) q),
    'events',(SELECT coalesce(jsonb_agg(x ORDER BY x->>'created_at' DESC,x->>'id'),'[]') FROM (
      SELECT to_jsonb(e)||jsonb_build_object('actor_name',p.full_name) x FROM public.driver_workspace_events e LEFT JOIN public.profiles p ON p.id=e.actor_id WHERE e.driver_id=d.id ORDER BY e.created_at DESC,e.id LIMIT page_size+1 OFFSET p_offset) q),
    'balances',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT currency,sum(amount-paid_amount) outstanding FROM public.driver_fines WHERE driver_id=d.id AND status='open' GROUP BY currency) x));
END $$;
REVOKE ALL ON FUNCTION private.driver_workspace_read(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.driver_workspace_read(uuid,integer) TO authenticated;
CREATE FUNCTION public.driver_workspace(p_driver_id uuid DEFAULT NULL,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$ SELECT private.driver_workspace_read(p_driver_id,p_offset) $$;
REVOKE ALL ON FUNCTION public.driver_workspace(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_workspace(uuid,integer) TO authenticated;

-- Searchable real account/vehicle/record pickers, never a client-provided tenant.
CREATE FUNCTION public.driver_workspace_options(p_kind text,p_search text DEFAULT '',p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; org uuid:=public.app_current_org(); can_manage boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.app_is_active(),false) OR org IS NULL THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  can_manage:=coalesce(public.app_user_can('fleet_master','edit'),false);
  IF NOT can_manage AND (p_kind<>'vehicles' OR NOT EXISTS(SELECT 1 FROM public.driver_team_assignments a WHERE auth.uid() IN (a.supervisor_id,a.manager_id) AND a.ends_at IS NULL AND private.driver_workspace_access(a.driver_id)='supervisor')) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF p_offset IS NULL OR p_offset<0 OR p_offset>1000000 OR length(p_search)>160 THEN RAISE EXCEPTION 'Invalid search' USING ERRCODE='22023'; END IF;
  IF p_kind='users' THEN
    SELECT coalesce(jsonb_agg(x),'[]') INTO result FROM (SELECT id,concat_ws(' · ',full_name,employee_id,role) label FROM public.profiles
      WHERE org_id=org AND approved AND NOT coalesce(locked,false) AND concat_ws(' ',full_name,employee_id,username) ILIKE '%'||p_search||'%'
      ORDER BY full_name,id LIMIT 101 OFFSET p_offset) x;
  ELSIF p_kind='vehicles' THEN
    SELECT coalesce(jsonb_agg(x),'[]') INTO result FROM (SELECT id,concat_ws(' · ',asset_no,registration_no,site) label FROM public.vehicle_fleet
      WHERE private.driver_workspace_scope(organisation_id,country,site) AND concat_ws(' ',asset_no,registration_no) ILIKE '%'||p_search||'%'
      ORDER BY asset_no,id LIMIT 101 OFFSET p_offset) x;
  ELSIF p_kind IN ('driver_documents','driver_training','driver_coaching','driver_safety_events','driver_expenses','tyre_records','accidents','wo_tasks','checklist_submissions','odometer_logs','wash_records') THEN
    EXECUTE format('SELECT coalesce(jsonb_agg(x),''[]'') FROM (SELECT r.id,private.driver_record_summary($1,r.id,$2) record FROM public.%I r WHERE r.organisation_id=$2 AND (to_jsonb(r)->>''country'' IS NULL OR private.driver_workspace_scope(r.organisation_id,to_jsonb(r)->>''country'',coalesce(nullif(to_jsonb(r)->>''site'',''''),(SELECT s FROM unnest(public.app_site_scope()) s LIMIT 1)))) AND to_jsonb(r)::text ILIKE $3 ORDER BY r.id LIMIT 101 OFFSET $4) x',p_kind)
      INTO result USING p_kind,org,'%'||p_search||'%',p_offset;
  ELSE RAISE EXCEPTION 'Unsupported search' USING ERRCODE='22023'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.driver_workspace_options(text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_workspace_options(text,text,integer) TO authenticated;

CREATE FUNCTION private.driver_workspace_command(p_action text,p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); org uuid:=public.app_current_org();
  d public.drivers%ROWTYPE; f public.driver_fines%ROWTYPE; v public.vehicle_fleet%ROWTYPE;
  previous private.driver_workspace_requests%ROWTYPE; answer jsonb; detail jsonb:=p_payload;
  access_mode text; target_user uuid; target_id uuid; record_data jsonb; choice text;
BEGIN
  IF actor IS NULL OR org IS NULL OR NOT coalesce(public.app_is_active(),false) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>600000 THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
  SELECT * INTO previous FROM private.driver_workspace_requests WHERE actor_id=actor AND request_id=p_request_id;
  IF FOUND THEN
    IF previous.action<>p_action OR previous.payload<>p_payload THEN RAISE EXCEPTION 'Request already used' USING ERRCODE='22023'; END IF;
    IF private.driver_workspace_access((previous.result->>'driver_id')::uuid)='none' THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
    RETURN previous.result;
  END IF;
  IF p_action='create_driver' THEN
    IF NOT coalesce(public.app_user_can('fleet_master','edit'),false) OR NOT private.driver_workspace_scope(org,p_payload->>'country',p_payload->>'site') THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
    IF length(btrim(coalesce(p_payload->>'driver_id',''))) NOT BETWEEN 1 AND 80 OR length(btrim(coalesce(p_payload->>'driver_name',''))) NOT BETWEEN 2 AND 160 THEN RAISE EXCEPTION 'Driver name and employee ID required' USING ERRCODE='22023'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(org::text||lower(btrim(p_payload->>'driver_id')),0));
    IF EXISTS(SELECT 1 FROM public.drivers WHERE organisation_id=org AND lower(btrim(driver_id))=lower(btrim(p_payload->>'driver_id'))) THEN RAISE EXCEPTION 'Employee ID already exists' USING ERRCODE='22023'; END IF;
    INSERT INTO public.drivers(driver_id,driver_name,country,site,organisation_id,created_by)
      VALUES(btrim(p_payload->>'driver_id'),btrim(p_payload->>'driver_name'),p_payload->>'country',p_payload->>'site',org,actor) RETURNING * INTO d;
  ELSE
    SELECT * INTO d FROM public.drivers WHERE id=(p_payload->>'driver_id')::uuid FOR UPDATE;
    access_mode:=private.driver_workspace_access(d.id);
    IF NOT FOUND OR access_mode='none' THEN RAISE EXCEPTION 'Driver unavailable' USING ERRCODE='42501'; END IF;
    IF p_action IN ('link_account','assign_team','link_record','unlink_record') AND access_mode<>'manager' THEN RAISE EXCEPTION 'Assignment management not permitted' USING ERRCODE='42501'; END IF;
    IF p_action IN ('create_fine','review_fine') AND (access_mode NOT IN ('manager','supervisor') OR EXISTS(SELECT 1 FROM public.driver_account_links WHERE driver_id=d.id AND user_id=actor)) THEN RAISE EXCEPTION 'Independent reviewer required' USING ERRCODE='42501'; END IF;
    CASE p_action
    WHEN 'link_account' THEN
      IF length(btrim(coalesce(p_payload->>'reason',''))) < 3 THEN RAISE EXCEPTION 'Link reason required' USING ERRCODE='22023'; END IF;
      target_user:=(p_payload->>'user_id')::uuid;
      IF target_user IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=target_user AND p.org_id=org AND p.approved AND NOT coalesce(p.locked,false)) THEN RAISE EXCEPTION 'Approved account in this organisation required' USING ERRCODE='22023'; END IF;
      detail:=p_payload||jsonb_build_object('previous_user_id',(SELECT user_id FROM public.driver_account_links WHERE driver_id=d.id));
      DELETE FROM public.driver_account_links WHERE driver_id=d.id;
      IF target_user IS NOT NULL THEN INSERT INTO public.driver_account_links VALUES(d.id,target_user,org,actor,now()); END IF;
    WHEN 'assign_team' THEN
      IF length(btrim(coalesce(p_payload->>'reason',''))) < 3 THEN RAISE EXCEPTION 'Assignment reason required' USING ERRCODE='22023'; END IF;
      FOREACH target_user IN ARRAY ARRAY[(p_payload->>'supervisor_id')::uuid,(p_payload->>'manager_id')::uuid] LOOP
        IF target_user IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=target_user AND p.org_id=org AND p.approved AND NOT coalesce(p.locked,false)) OR EXISTS(SELECT 1 FROM public.driver_account_links WHERE driver_id=d.id AND user_id=target_user)) THEN RAISE EXCEPTION 'Independent active team member required' USING ERRCODE='22023'; END IF;
      END LOOP;
      IF p_payload->>'vehicle_id' IS NOT NULL THEN
        SELECT * INTO v FROM public.vehicle_fleet WHERE id=(p_payload->>'vehicle_id')::uuid;
        IF NOT FOUND OR NOT private.driver_workspace_scope(v.organisation_id,v.country,v.site) OR v.country IS DISTINCT FROM d.country THEN RAISE EXCEPTION 'Vehicle outside scope' USING ERRCODE='42501'; END IF;
      END IF;
      UPDATE public.driver_team_assignments SET ends_at=now() WHERE driver_id=d.id AND ends_at IS NULL;
      INSERT INTO public.driver_team_assignments(driver_id,organisation_id,supervisor_id,manager_id,vehicle_id,reason,assigned_by)
        VALUES(d.id,org,(p_payload->>'supervisor_id')::uuid,(p_payload->>'manager_id')::uuid,(p_payload->>'vehicle_id')::uuid,p_payload->>'reason',actor) RETURNING id INTO target_id;
    WHEN 'create_fine' THEN
      SELECT * INTO v FROM public.vehicle_fleet WHERE id=(p_payload->>'vehicle_id')::uuid;
      IF NOT FOUND OR NOT private.driver_workspace_scope(v.organisation_id,v.country,v.site) OR v.country IS DISTINCT FROM d.country THEN RAISE EXCEPTION 'Vehicle outside scope' USING ERRCODE='42501'; END IF;
      IF (p_payload->>'incident_at')::timestamptz>now() THEN RAISE EXCEPTION 'Incident cannot be in the future' USING ERRCODE='22023'; END IF;
      INSERT INTO public.driver_fines(organisation_id,driver_id,vehicle_id,country,site,authority,notice_reference,incident_at,due_date,amount,currency,description,assignment_reason,created_by)
        VALUES(org,d.id,v.id,d.country,d.site,btrim(p_payload->>'authority'),btrim(p_payload->>'notice_reference'),(p_payload->>'incident_at')::timestamptz,(p_payload->>'due_date')::date,(p_payload->>'amount')::numeric,upper(p_payload->>'currency'),p_payload->>'description',p_payload->>'assignment_reason',actor) RETURNING * INTO f;
      target_id:=f.id;
    WHEN 'respond_fine' THEN
      IF NOT EXISTS(SELECT 1 FROM public.driver_account_links WHERE driver_id=d.id AND user_id=actor) THEN RAISE EXCEPTION 'Only the linked driver may sign' USING ERRCODE='42501'; END IF;
      SELECT * INTO f FROM public.driver_fines WHERE id=(p_payload->>'fine_id')::uuid AND driver_id=d.id FOR UPDATE;
      IF NOT FOUND OR f.status<>'open' OR f.response_status NOT IN ('awaiting_response','returned') OR f.version IS DISTINCT FROM (p_payload->>'version')::integer THEN RAISE EXCEPTION 'Notice changed; refresh and review again' USING ERRCODE='40001'; END IF;
      IF (p_payload->>'acknowledged')::boolean IS DISTINCT FROM true OR p_payload->>'statement_version' IS DISTINCT FROM 'receipt-v1' THEN RAISE EXCEPTION 'Review and acknowledge the statement' USING ERRCODE='22023'; END IF;
      choice:=p_payload->>'resolution';
      IF choice='already_paid' AND length(btrim(coalesce(p_payload->>'payment_reference',''))) < 3 THEN RAISE EXCEPTION 'Payment reference required' USING ERRCODE='22023'; END IF;
      IF choice='direct_payment' AND ((p_payload->>'proposed_date')::date IS NULL OR (p_payload->>'proposed_date')::date<current_date) THEN RAISE EXCEPTION 'Proposed payment date required' USING ERRCODE='22023'; END IF;
      -- PNG or this application's path-only SVG format; never active SVG content.
      IF NOT (coalesce(p_payload->>'signature','') ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' OR
        coalesce(p_payload->>'signature','') ~ '^<svg xmlns="http://www.w3.org/2000/svg" width="[0-9]+" height="[0-9]+" viewBox="[0-9 .]+">(<path d="[ML0-9 .-]+" fill="none" stroke="#[a-fA-F0-9]{6}" stroke-width="[0-9.]+" stroke-linecap="round" stroke-linejoin="round"/>)+</svg>$') THEN RAISE EXCEPTION 'Valid signature required' USING ERRCODE='22023'; END IF;
      INSERT INTO public.driver_fine_responses(fine_id,driver_id,organisation_id,notice_version,signer_id,statement_language,resolution,explanation,payment_reference,proposed_date,signature,notice_snapshot)
        VALUES(f.id,d.id,org,f.version,actor,coalesce(p_payload->>'statement_language','en'),choice,p_payload->>'explanation',p_payload->>'payment_reference',(p_payload->>'proposed_date')::date,p_payload->>'signature',to_jsonb(f)||jsonb_build_object('evidence',(SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') FROM public.driver_fine_evidence e WHERE e.fine_id=f.id))) RETURNING id INTO target_id;
      UPDATE public.driver_fines SET response_status='submitted',version=version+1,updated_at=now() WHERE id=f.id;
      detail:=p_payload-'signature'||jsonb_build_object('response_id',target_id);
    WHEN 'review_fine' THEN
      SELECT * INTO f FROM public.driver_fines WHERE id=(p_payload->>'fine_id')::uuid AND driver_id=d.id FOR UPDATE;
      IF NOT FOUND OR f.version IS DISTINCT FROM (p_payload->>'version')::integer THEN RAISE EXCEPTION 'Case changed; refresh' USING ERRCODE='40001'; END IF;
      IF length(btrim(coalesce(p_payload->>'reason',''))) < 3 THEN RAISE EXCEPTION 'Review reason required' USING ERRCODE='22023'; END IF;
      choice:=p_payload->>'decision';
      IF choice='reopen' AND f.status<>'open' THEN
        UPDATE public.driver_fines SET status='open',version=version+1,updated_at=now() WHERE id=f.id;
      ELSIF f.status<>'open' THEN RAISE EXCEPTION 'Case is closed' USING ERRCODE='40001';
      ELSIF choice='return' AND f.response_status IN ('submitted','approved') THEN
        UPDATE public.driver_fines SET response_status='returned',version=version+1,updated_at=now() WHERE id=f.id;
      ELSIF choice='approve' AND f.response_status='submitted' THEN
        UPDATE public.driver_fines SET response_status='approved',version=version+1,updated_at=now() WHERE id=f.id;
      ELSIF choice='cancel' AND f.paid_amount=0 THEN
        UPDATE public.driver_fines SET status='cancelled',version=version+1,updated_at=now() WHERE id=f.id;
      ELSIF choice='payment' THEN
        IF length(btrim(coalesce(p_payload->>'payment_reference',''))) < 3 OR (p_payload->>'payment_amount')::numeric IS NULL OR (p_payload->>'payment_amount')::numeric<=0 OR (p_payload->>'payment_amount')::numeric>f.amount-f.paid_amount THEN RAISE EXCEPTION 'Valid payment amount and reference required' USING ERRCODE='22023'; END IF;
        UPDATE public.driver_fines SET paid_amount=paid_amount+(p_payload->>'payment_amount')::numeric,
          status=CASE WHEN paid_amount+(p_payload->>'payment_amount')::numeric=amount THEN 'settled' ELSE 'open' END,version=version+1,updated_at=now() WHERE id=f.id;
      ELSE RAISE EXCEPTION 'Invalid transition' USING ERRCODE='22023'; END IF;
      target_id:=f.id;
    WHEN 'attach_evidence' THEN
      SELECT * INTO f FROM public.driver_fines WHERE id=(p_payload->>'fine_id')::uuid AND driver_id=d.id FOR UPDATE;
      IF NOT FOUND OR f.status<>'open' OR access_mode='viewer' THEN RAISE EXCEPTION 'Evidence upload not permitted' USING ERRCODE='42501'; END IF;
      IF p_payload->>'kind'='notice' AND (access_mode NOT IN ('manager','supervisor') OR f.response_status NOT IN ('awaiting_response','returned')) THEN RAISE EXCEPTION 'Signed notice cannot be changed' USING ERRCODE='40001'; END IF;
      IF p_payload->>'object_path' NOT LIKE org::text||'/'||d.id::text||'/'||f.id::text||'/%'
        OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='driver-fine-evidence' AND o.name=p_payload->>'object_path' AND o.owner_id=actor::text) THEN RAISE EXCEPTION 'Uploaded file unavailable' USING ERRCODE='42501'; END IF;
      INSERT INTO public.driver_fine_evidence(fine_id,driver_id,organisation_id,object_path,file_name,kind,uploaded_by)
        VALUES(f.id,d.id,org,p_payload->>'object_path',p_payload->>'file_name',p_payload->>'kind',actor) RETURNING id INTO target_id;
      IF p_payload->>'kind'='notice' THEN UPDATE public.driver_fines SET version=version+1,updated_at=now() WHERE id=f.id; END IF;
    WHEN 'link_record' THEN
      record_data:=private.driver_record_summary(p_payload->>'source_type',(p_payload->>'source_id')::uuid,org);
      IF record_data IS NULL OR (record_data->>'country' IS NOT NULL AND record_data->>'country' IS DISTINCT FROM d.country)
        OR (nullif(record_data->>'site','') IS NOT NULL AND record_data->>'site' IS DISTINCT FROM d.site) THEN RAISE EXCEPTION 'Record unavailable in driver scope' USING ERRCODE='42501'; END IF;
      INSERT INTO public.driver_record_links(driver_id,organisation_id,source_type,source_id,reason,linked_by)
        VALUES(d.id,org,p_payload->>'source_type',(p_payload->>'source_id')::uuid,p_payload->>'reason',actor) RETURNING id INTO target_id;
    WHEN 'unlink_record' THEN
      IF length(btrim(coalesce(p_payload->>'reason',''))) < 3 THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023'; END IF;
      DELETE FROM public.driver_record_links WHERE id=(p_payload->>'link_id')::uuid AND driver_id=d.id RETURNING to_jsonb(driver_record_links) INTO record_data;
      IF NOT FOUND THEN RAISE EXCEPTION 'Link unavailable' USING ERRCODE='42501'; END IF;
      detail:=p_payload||jsonb_build_object('previous_link',record_data);
    ELSE RAISE EXCEPTION 'Unsupported action' USING ERRCODE='22023';
    END CASE;
  END IF;
  INSERT INTO public.driver_workspace_events(organisation_id,driver_id,fine_id,actor_id,action,details)
    VALUES(org,d.id,f.id,actor,p_action,detail);
  -- Inbox notifications are part of the same transaction as the action.
  INSERT INTO public.notifications(user_id,type,title,body,entity_type,entity_id)
    SELECT recipient,'driver_workspace','Driver workspace updated','Open your driver workspace to review the latest action.','driver_workspace',d.id::text
    FROM (SELECT l.user_id recipient FROM public.driver_account_links l WHERE l.driver_id=d.id
      UNION SELECT a.supervisor_id FROM public.driver_team_assignments a WHERE a.driver_id=d.id AND a.ends_at IS NULL
      UNION SELECT a.manager_id FROM public.driver_team_assignments a WHERE a.driver_id=d.id AND a.ends_at IS NULL) q
    WHERE recipient IS NOT NULL AND recipient<>actor;
  answer:=jsonb_build_object('driver_id',d.id,'id',coalesce(target_id,d.id),'action',p_action);
  INSERT INTO private.driver_workspace_requests VALUES(actor,p_request_id,p_action,p_payload,answer);
  RETURN answer;
END $$;
REVOKE ALL ON FUNCTION private.driver_workspace_command(text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.driver_workspace_command(text,jsonb,uuid) TO authenticated;
CREATE FUNCTION public.driver_workspace_command(p_action text,p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.driver_workspace_command(p_action,p_payload,p_request_id) $$;
REVOKE ALL ON FUNCTION public.driver_workspace_command(text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_workspace_command(text,jsonb,uuid) TO authenticated;
