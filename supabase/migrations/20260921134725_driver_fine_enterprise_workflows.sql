-- Enterprise traffic-fine workflow: immutable review decisions, correction and
-- reassignment lineage, finance separation of duties, auditable reminders and
-- a staff register. Existing signed responses and evidence are never rewritten.

ALTER TABLE public.driver_fines
  ADD COLUMN review_stage text NOT NULL DEFAULT 'driver'
    CHECK (review_stage IN ('driver','supervisor','finance','complete')),
  ADD COLUMN supersedes_fine_id uuid REFERENCES public.driver_fines(id) DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN superseded_by_fine_id uuid REFERENCES public.driver_fines(id) DEFERRABLE INITIALLY DEFERRED;

UPDATE public.driver_fines SET review_stage=CASE
  WHEN status IN ('settled','cancelled') OR response_status='approved' THEN 'complete'
  WHEN response_status='submitted' THEN 'supervisor'
  ELSE 'driver' END;

ALTER TABLE public.driver_fines
  DROP CONSTRAINT IF EXISTS driver_fines_organisation_id_country_authority_notice_reference_key,
  DROP CONSTRAINT IF EXISTS driver_fines_organisation_id_country_authority_notice_refer_key;
CREATE UNIQUE INDEX driver_fines_current_notice
  ON public.driver_fines(organisation_id,country,authority,notice_reference)
  WHERE superseded_by_fine_id IS NULL;
CREATE INDEX driver_fines_workflow_queue
  ON public.driver_fines(organisation_id,review_stage,due_date,id)
  WHERE status='open';

CREATE TABLE public.driver_fine_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fine_id uuid NOT NULL REFERENCES public.driver_fines(id),
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  organisation_id uuid NOT NULL,
  stage text NOT NULL CHECK(stage IN ('supervisor','finance')),
  decision text NOT NULL CHECK(decision IN ('approve','return','cancel','reopen','payment')),
  reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 2000),
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id),
  notice_version integer NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_fine_reviews_case ON public.driver_fine_reviews(fine_id,created_at,id);

CREATE TABLE public.driver_fine_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fine_id uuid NOT NULL REFERENCES public.driver_fines(id),
  driver_id uuid NOT NULL REFERENCES public.drivers(id),
  organisation_id uuid NOT NULL,
  reminder_date date NOT NULL,
  kind text NOT NULL CHECK(kind IN ('due_7_days','due_today','overdue')),
  status text NOT NULL CHECK(status IN ('sent','skipped')),
  recipient_count integer NOT NULL DEFAULT 0 CHECK(recipient_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(fine_id,reminder_date,kind)
);
CREATE INDEX driver_fine_reminders_case ON public.driver_fine_reminders(fine_id,created_at,id);

ALTER TABLE public.driver_workspace_events ALTER COLUMN actor_id DROP NOT NULL;

ALTER TABLE public.driver_fine_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_fine_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_fine_reviews,public.driver_fine_reminders FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.driver_fine_reviews,public.driver_fine_reminders TO authenticated;
CREATE POLICY driver_fine_reviews_read ON public.driver_fine_reviews FOR SELECT TO authenticated
  USING (organisation_id=public.app_current_org() AND private.driver_workspace_access(driver_id)<>'none');
CREATE POLICY driver_fine_reminders_read ON public.driver_fine_reminders FOR SELECT TO authenticated
  USING (organisation_id=public.app_current_org() AND private.driver_workspace_access(driver_id)<>'none');

CREATE FUNCTION private.driver_workspace_is_finance_reviewer()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(public.app_is_active() AND public.app_current_org() IS NOT NULL AND (
    public.app_user_can('driver_workspace','finance') OR EXISTS(
      SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND lower(btrim(p.role))='finance'
        AND p.approved AND NOT coalesce(p.locked,false)
    )),false)
$$;
REVOKE ALL ON FUNCTION private.driver_workspace_is_finance_reviewer() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.driver_workspace_is_finance_reviewer() TO authenticated;

CREATE OR REPLACE FUNCTION private.driver_workspace_access(p_driver_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.drivers%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.drivers WHERE id=p_driver_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT coalesce(public.app_is_active(),false)
     OR d.organisation_id IS DISTINCT FROM public.app_current_org() THEN RETURN 'none'; END IF;
  IF (public.is_super_admin() OR public.app_sees_all_countries()
      OR lower(btrim(d.country))=ANY(public.app_country_scope()))
     AND EXISTS(SELECT 1 FROM public.driver_account_links l WHERE l.driver_id=d.id
       AND l.user_id=auth.uid() AND l.organisation_id=d.organisation_id) THEN RETURN 'driver';
  END IF;
  IF NOT private.driver_workspace_scope(d.organisation_id,d.country,d.site) THEN RETURN 'none'; END IF;
  IF public.app_user_can('fleet_master','edit') THEN RETURN 'manager'; END IF;
  IF EXISTS(SELECT 1 FROM public.driver_team_assignments a WHERE a.driver_id=d.id AND a.organisation_id=d.organisation_id
    AND a.starts_at<=now() AND (a.ends_at IS NULL OR a.ends_at>now()) AND auth.uid() IN (a.supervisor_id,a.manager_id)) THEN RETURN 'supervisor'; END IF;
  IF private.driver_workspace_is_finance_reviewer() THEN RETURN 'finance'; END IF;
  IF public.app_user_can('driver_workspace','view') THEN RETURN 'viewer'; END IF;
  RETURN 'none';
END $$;

CREATE OR REPLACE FUNCTION private.driver_workspace_read(p_driver_id uuid,p_offset integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; access_mode text; d public.drivers%ROWTYPE; page_size integer:=100;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.app_is_active(),false) OR public.app_current_org() IS NULL THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF p_offset IS NULL OR p_offset<0 OR p_offset>1000000 THEN RAISE EXCEPTION 'Invalid page' USING ERRCODE='22023'; END IF;
  IF p_driver_id IS NULL THEN
    SELECT jsonb_build_object('can_manage',coalesce(public.app_user_can('fleet_master','edit'),false),
      'can_finance',private.driver_workspace_is_finance_reviewer(),
      'drivers',coalesce(jsonb_agg(x ORDER BY x->>'driver_name',x->>'id'),'[]')) INTO result FROM (
      SELECT jsonb_build_object('id',drv.id,'driver_id',drv.driver_id,'driver_name',drv.driver_name,'position',nullif(btrim(drv.custom_data->>'position'),''),'country',drv.country,'site',drv.site,'status',drv.status,
        'access',private.driver_workspace_access(drv.id),'user_id',l.user_id,
        'open_fines',(SELECT count(*) FROM public.driver_fines f WHERE f.driver_id=drv.id AND f.status='open'),
        'awaiting_response',(SELECT count(*) FROM public.driver_fines f WHERE f.driver_id=drv.id AND f.status='open' AND f.review_stage='driver'),
        'pending_supervisor',(SELECT count(*) FROM public.driver_fines f WHERE f.driver_id=drv.id AND f.status='open' AND f.review_stage='supervisor'),
        'pending_finance',(SELECT count(*) FROM public.driver_fines f WHERE f.driver_id=drv.id AND f.status='open' AND f.review_stage='finance'),
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
    'can_review',access_mode IN ('manager','supervisor','finance') AND NOT EXISTS(SELECT 1 FROM public.driver_account_links WHERE driver_id=d.id AND user_id=auth.uid()),
    'can_finance',private.driver_workspace_is_finance_reviewer(),
    'can_manage',coalesce(public.app_user_can('fleet_master','edit'),false),
    'assignments',(SELECT coalesce(jsonb_agg(x ORDER BY x->>'starts_at' DESC),'[]') FROM (
      SELECT to_jsonb(a)||jsonb_build_object('supervisor_name',s.full_name,'manager_name',m.full_name,'asset_no',v.asset_no) x
      FROM public.driver_team_assignments a LEFT JOIN public.profiles s ON s.id=a.supervisor_id LEFT JOIN public.profiles m ON m.id=a.manager_id LEFT JOIN public.vehicle_fleet v ON v.id=a.vehicle_id
      WHERE a.driver_id=d.id ORDER BY a.starts_at DESC,a.id LIMIT page_size+1 OFFSET p_offset) q),
    'fines',(SELECT coalesce(jsonb_agg(x ORDER BY x->>'created_at' DESC,x->>'id'),'[]') FROM (
      SELECT to_jsonb(f)||jsonb_build_object('asset_no',v.asset_no,
        'evidence',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at),'[]') FROM public.driver_fine_evidence e WHERE e.fine_id=f.id),
        'responses',(SELECT coalesce(jsonb_agg(to_jsonb(r)-'signature' ORDER BY r.signed_at),'[]') FROM public.driver_fine_responses r WHERE r.fine_id=f.id),
        'reviews',(SELECT coalesce(jsonb_agg(to_jsonb(rv)||jsonb_build_object('reviewer_name',p.full_name) ORDER BY rv.created_at,rv.id),'[]') FROM public.driver_fine_reviews rv LEFT JOIN public.profiles p ON p.id=rv.reviewer_id WHERE rv.fine_id=f.id),
        'reminders',(SELECT coalesce(jsonb_agg(to_jsonb(rm) ORDER BY rm.created_at,rm.id),'[]') FROM public.driver_fine_reminders rm WHERE rm.fine_id=f.id)) x
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

CREATE OR REPLACE FUNCTION public.driver_workspace_options(p_kind text,p_search text DEFAULT '',p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; org uuid:=public.app_current_org(); can_manage boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.app_is_active(),false) OR org IS NULL THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  can_manage:=coalesce(public.app_user_can('fleet_master','edit'),false);
  IF NOT can_manage AND p_kind IN ('users','drivers') THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF NOT can_manage AND p_kind='vehicles' AND NOT EXISTS(SELECT 1 FROM public.driver_team_assignments a WHERE auth.uid() IN (a.supervisor_id,a.manager_id) AND a.ends_at IS NULL AND private.driver_workspace_access(a.driver_id)='supervisor') THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF NOT can_manage AND p_kind NOT IN ('vehicles') THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF p_offset IS NULL OR p_offset<0 OR p_offset>1000000 OR length(p_search)>160 THEN RAISE EXCEPTION 'Invalid search' USING ERRCODE='22023'; END IF;
  IF p_kind='users' THEN
    SELECT coalesce(jsonb_agg(x),'[]') INTO result FROM (SELECT id,concat_ws(' · ',full_name,employee_id,role) label FROM public.profiles
      WHERE org_id=org AND approved AND NOT coalesce(locked,false) AND concat_ws(' ',full_name,employee_id,username) ILIKE '%'||p_search||'%'
      ORDER BY full_name,id LIMIT 101 OFFSET p_offset) x;
  ELSIF p_kind='drivers' THEN
    SELECT coalesce(jsonb_agg(x),'[]') INTO result FROM (SELECT id,concat_ws(' · ',driver_name,driver_id,site) label FROM public.drivers
      WHERE organisation_id=org AND status='active' AND private.driver_workspace_scope(organisation_id,country,site)
        AND concat_ws(' ',driver_name,driver_id,site) ILIKE '%'||p_search||'%'
      ORDER BY driver_name,id LIMIT 101 OFFSET p_offset) x;
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

CREATE FUNCTION private.driver_fine_sync_review_stage()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.response_status='submitted' AND OLD.response_status IS DISTINCT FROM NEW.response_status THEN NEW.review_stage:='supervisor';
  ELSIF NEW.response_status='returned' AND OLD.response_status IS DISTINCT FROM NEW.response_status THEN NEW.review_stage:='driver';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.driver_fine_sync_review_stage() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER driver_fine_sync_review_stage BEFORE UPDATE OF response_status ON public.driver_fines
  FOR EACH ROW EXECUTE FUNCTION private.driver_fine_sync_review_stage();

CREATE FUNCTION private.driver_fine_enterprise_command(p_action text,p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  actor uuid:=auth.uid(); org uuid:=public.app_current_org(); d public.drivers%ROWTYPE; target_driver public.drivers%ROWTYPE;
  f public.driver_fines%ROWTYPE; vehicle public.vehicle_fleet%ROWTYPE; previous private.driver_workspace_requests%ROWTYPE;
  access_mode text; choice text; target_id uuid; new_fine_id uuid; answer jsonb; detail jsonb:=p_payload; stage_name text;
BEGIN
  IF actor IS NULL OR org IS NULL OR NOT coalesce(public.app_is_active(),false) OR p_request_id IS NULL THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
  SELECT * INTO previous FROM private.driver_workspace_requests WHERE actor_id=actor AND request_id=p_request_id;
  IF FOUND THEN
    IF previous.action<>p_action OR previous.payload<>p_payload THEN RAISE EXCEPTION 'Request key already used' USING ERRCODE='22023'; END IF;
    IF private.driver_workspace_access((previous.result->>'driver_id')::uuid)='none' THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
    RETURN previous.result;
  END IF;
  SELECT * INTO d FROM public.drivers WHERE id=(p_payload->>'driver_id')::uuid AND organisation_id=org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Driver unavailable' USING ERRCODE='42501'; END IF;
  access_mode:=private.driver_workspace_access(d.id);
  IF access_mode='none' OR EXISTS(SELECT 1 FROM public.driver_account_links WHERE driver_id=d.id AND user_id=actor) THEN RAISE EXCEPTION 'Independent staff action required' USING ERRCODE='42501'; END IF;
  SELECT * INTO f FROM public.driver_fines WHERE id=(p_payload->>'fine_id')::uuid AND driver_id=d.id FOR UPDATE;
  IF NOT FOUND OR f.version IS DISTINCT FROM (p_payload->>'version')::integer THEN RAISE EXCEPTION 'Case changed; refresh' USING ERRCODE='40001'; END IF;
  IF length(btrim(coalesce(p_payload->>'reason',''))) < 3 THEN RAISE EXCEPTION 'Reason required' USING ERRCODE='22023'; END IF;

  IF p_action='review_fine' THEN
    choice:=p_payload->>'decision';
    IF choice='approve' AND f.status='open' AND f.review_stage='supervisor' AND access_mode IN ('manager','supervisor') THEN
      stage_name:='supervisor';
      INSERT INTO public.driver_fine_reviews(fine_id,driver_id,organisation_id,stage,decision,reason,reviewer_id,notice_version,details)
        VALUES(f.id,d.id,org,stage_name,choice,p_payload->>'reason',actor,f.version,p_payload) RETURNING id INTO target_id;
      UPDATE public.driver_fines SET review_stage='finance',version=version+1,updated_at=now() WHERE id=f.id;
    ELSIF choice='approve' AND f.status='open' AND f.review_stage='finance' AND private.driver_workspace_is_finance_reviewer() THEN
      IF EXISTS(SELECT 1 FROM public.driver_fine_reviews WHERE fine_id=f.id AND stage='supervisor' AND decision='approve' AND reviewer_id=actor) THEN RAISE EXCEPTION 'A different finance reviewer is required' USING ERRCODE='42501'; END IF;
      stage_name:='finance';
      INSERT INTO public.driver_fine_reviews(fine_id,driver_id,organisation_id,stage,decision,reason,reviewer_id,notice_version,details)
        VALUES(f.id,d.id,org,stage_name,choice,p_payload->>'reason',actor,f.version,p_payload) RETURNING id INTO target_id;
      UPDATE public.driver_fines SET response_status='approved',review_stage='complete',version=version+1,updated_at=now() WHERE id=f.id;
    ELSIF choice='return' AND f.status='open' AND ((f.review_stage='supervisor' AND access_mode IN ('manager','supervisor')) OR (f.review_stage='finance' AND private.driver_workspace_is_finance_reviewer())) THEN
      stage_name:=f.review_stage;
      INSERT INTO public.driver_fine_reviews(fine_id,driver_id,organisation_id,stage,decision,reason,reviewer_id,notice_version,details)
        VALUES(f.id,d.id,org,stage_name,choice,p_payload->>'reason',actor,f.version,p_payload) RETURNING id INTO target_id;
      UPDATE public.driver_fines SET response_status='returned',review_stage='driver',version=version+1,updated_at=now() WHERE id=f.id;
    ELSIF choice='payment' AND f.status='open' AND f.review_stage='complete' AND f.response_status='approved' AND private.driver_workspace_is_finance_reviewer() THEN
      IF length(btrim(coalesce(p_payload->>'payment_reference',''))) < 3 OR (p_payload->>'payment_amount')::numeric IS NULL OR (p_payload->>'payment_amount')::numeric<=0 OR (p_payload->>'payment_amount')::numeric>f.amount-f.paid_amount THEN RAISE EXCEPTION 'Valid payment amount and reference required' USING ERRCODE='22023'; END IF;
      stage_name:='finance';
      INSERT INTO public.driver_fine_reviews(fine_id,driver_id,organisation_id,stage,decision,reason,reviewer_id,notice_version,details)
        VALUES(f.id,d.id,org,stage_name,choice,p_payload->>'reason',actor,f.version,p_payload) RETURNING id INTO target_id;
      UPDATE public.driver_fines SET paid_amount=paid_amount+(p_payload->>'payment_amount')::numeric,
        status=CASE WHEN paid_amount+(p_payload->>'payment_amount')::numeric=amount THEN 'settled' ELSE 'open' END,
        version=version+1,updated_at=now() WHERE id=f.id;
    ELSIF choice='cancel' AND f.status='open' AND f.paid_amount=0 AND access_mode IN ('manager','supervisor') THEN
      stage_name:=CASE WHEN f.review_stage='finance' THEN 'finance' ELSE 'supervisor' END;
      INSERT INTO public.driver_fine_reviews(fine_id,driver_id,organisation_id,stage,decision,reason,reviewer_id,notice_version,details)
        VALUES(f.id,d.id,org,stage_name,choice,p_payload->>'reason',actor,f.version,p_payload) RETURNING id INTO target_id;
      UPDATE public.driver_fines SET status='cancelled',review_stage='complete',version=version+1,updated_at=now() WHERE id=f.id;
    ELSIF choice='reopen' AND f.status<>'open' AND access_mode='manager' THEN
      stage_name:='supervisor';
      INSERT INTO public.driver_fine_reviews(fine_id,driver_id,organisation_id,stage,decision,reason,reviewer_id,notice_version,details)
        VALUES(f.id,d.id,org,stage_name,choice,p_payload->>'reason',actor,f.version,p_payload) RETURNING id INTO target_id;
      UPDATE public.driver_fines SET status='open',response_status=CASE WHEN EXISTS(SELECT 1 FROM public.driver_fine_responses WHERE fine_id=f.id) THEN 'submitted' ELSE 'awaiting_response' END,
        review_stage=CASE WHEN EXISTS(SELECT 1 FROM public.driver_fine_responses WHERE fine_id=f.id) THEN 'supervisor' ELSE 'driver' END,version=version+1,updated_at=now() WHERE id=f.id;
    ELSE RAISE EXCEPTION 'Invalid review transition' USING ERRCODE='22023'; END IF;
    detail:=p_payload||jsonb_build_object('review_stage',stage_name,'review_id',target_id);
    target_id:=f.id;
  ELSIF p_action='correct_fine' THEN
    IF NOT coalesce(public.app_user_can('fleet_master','edit'),false) OR f.status<>'open' OR f.superseded_by_fine_id IS NOT NULL THEN RAISE EXCEPTION 'Correction not permitted' USING ERRCODE='42501'; END IF;
    IF p_payload ? 'vehicle_id' THEN
      SELECT * INTO vehicle FROM public.vehicle_fleet WHERE id=(p_payload->>'vehicle_id')::uuid;
      IF NOT FOUND OR vehicle.organisation_id<>org OR NOT private.driver_workspace_scope(vehicle.organisation_id,vehicle.country,vehicle.site) OR vehicle.country IS DISTINCT FROM d.country THEN RAISE EXCEPTION 'Vehicle outside scope' USING ERRCODE='42501'; END IF;
    END IF;
    IF p_payload ? 'amount' AND ((p_payload->>'amount')::numeric<=0 OR (p_payload->>'amount')::numeric<f.paid_amount) THEN RAISE EXCEPTION 'Amount must cover verified payments' USING ERRCODE='22023'; END IF;
    detail:=jsonb_build_object('reason',p_payload->>'reason','before',to_jsonb(f)-'created_by','changes',p_payload-'reason'-'driver_id'-'fine_id'-'version');
    UPDATE public.driver_fines SET
      vehicle_id=CASE WHEN p_payload ? 'vehicle_id' THEN (p_payload->>'vehicle_id')::uuid ELSE vehicle_id END,
      authority=CASE WHEN p_payload ? 'authority' THEN btrim(p_payload->>'authority') ELSE authority END,
      notice_reference=CASE WHEN p_payload ? 'notice_reference' THEN btrim(p_payload->>'notice_reference') ELSE notice_reference END,
      incident_at=CASE WHEN p_payload ? 'incident_at' THEN (p_payload->>'incident_at')::timestamptz ELSE incident_at END,
      due_date=CASE WHEN p_payload ? 'due_date' THEN nullif(p_payload->>'due_date','')::date ELSE due_date END,
      amount=CASE WHEN p_payload ? 'amount' THEN (p_payload->>'amount')::numeric ELSE amount END,
      description=CASE WHEN p_payload ? 'description' THEN p_payload->>'description' ELSE description END,
      assignment_reason=CASE WHEN p_payload ? 'assignment_reason' THEN p_payload->>'assignment_reason' ELSE assignment_reason END,
      response_status=CASE WHEN EXISTS(SELECT 1 FROM public.driver_fine_responses WHERE fine_id=f.id) THEN 'awaiting_response' ELSE response_status END,
      review_stage='driver',version=version+1,updated_at=now() WHERE id=f.id;
    target_id:=f.id;
  ELSIF p_action='reassign_fine' THEN
    IF NOT coalesce(public.app_user_can('fleet_master','edit'),false) OR f.status<>'open' OR f.paid_amount<>0 OR f.superseded_by_fine_id IS NOT NULL THEN RAISE EXCEPTION 'Reassignment not permitted' USING ERRCODE='42501'; END IF;
    SELECT * INTO target_driver FROM public.drivers WHERE id=(p_payload->>'target_driver_id')::uuid AND organisation_id=org AND status='active';
    IF NOT FOUND OR target_driver.id=d.id OR NOT private.driver_workspace_scope(target_driver.organisation_id,target_driver.country,target_driver.site) THEN RAISE EXCEPTION 'Target driver unavailable' USING ERRCODE='42501'; END IF;
    SELECT * INTO vehicle FROM public.vehicle_fleet WHERE id=coalesce((p_payload->>'vehicle_id')::uuid,f.vehicle_id);
    IF NOT FOUND OR vehicle.organisation_id<>org OR vehicle.country IS DISTINCT FROM target_driver.country OR NOT private.driver_workspace_scope(vehicle.organisation_id,vehicle.country,vehicle.site) THEN RAISE EXCEPTION 'Vehicle outside target scope' USING ERRCODE='42501'; END IF;
    new_fine_id:=gen_random_uuid();
    UPDATE public.driver_fines SET status='cancelled',review_stage='complete',superseded_by_fine_id=new_fine_id,version=version+1,updated_at=now() WHERE id=f.id;
    INSERT INTO public.driver_fines(id,organisation_id,driver_id,vehicle_id,country,site,authority,notice_reference,incident_at,due_date,amount,currency,description,assignment_reason,status,response_status,paid_amount,version,created_by,review_stage,supersedes_fine_id)
      VALUES(new_fine_id,org,target_driver.id,vehicle.id,target_driver.country,target_driver.site,f.authority,f.notice_reference,f.incident_at,f.due_date,f.amount,f.currency,f.description,p_payload->>'reason','open','awaiting_response',0,1,actor,'driver',f.id);
    INSERT INTO public.driver_workspace_events(organisation_id,driver_id,fine_id,actor_id,action,details)
      VALUES(org,target_driver.id,new_fine_id,actor,'fine_reassigned_in',jsonb_build_object('previous_fine_id',f.id,'previous_driver_id',d.id,'reason',p_payload->>'reason'));
    detail:=jsonb_build_object('reason',p_payload->>'reason','replacement_fine_id',new_fine_id,'target_driver_id',target_driver.id);
    INSERT INTO public.notifications(user_id,type,title,body,entity_type,entity_id)
      SELECT l.user_id,'driver_workspace','Traffic fine assigned','Open your driver workspace to review and acknowledge the reassigned notice.','driver_workspace',target_driver.id::text
      FROM public.driver_account_links l JOIN public.profiles p ON p.id=l.user_id WHERE l.driver_id=target_driver.id AND p.approved AND NOT coalesce(p.locked,false);
    target_id:=new_fine_id;
  ELSE RAISE EXCEPTION 'Unsupported enterprise action' USING ERRCODE='22023'; END IF;

  INSERT INTO public.driver_workspace_events(organisation_id,driver_id,fine_id,actor_id,action,details)
    VALUES(org,d.id,f.id,actor,p_action,detail);
  INSERT INTO public.notifications(user_id,type,title,body,entity_type,entity_id)
    SELECT recipient,'driver_workspace','Driver fine workflow updated','Open the driver workspace to review the latest case action.','driver_workspace',d.id::text
    FROM (SELECT l.user_id recipient FROM public.driver_account_links l WHERE l.driver_id=d.id
      UNION SELECT a.supervisor_id FROM public.driver_team_assignments a WHERE a.driver_id=d.id AND a.ends_at IS NULL
      UNION SELECT a.manager_id FROM public.driver_team_assignments a WHERE a.driver_id=d.id AND a.ends_at IS NULL
      UNION SELECT p.id FROM public.profiles p WHERE p.org_id=org AND p.approved AND NOT coalesce(p.locked,false) AND lower(btrim(p.role)) IN ('finance','admin')) q
    WHERE recipient IS NOT NULL AND recipient<>actor;
  answer:=jsonb_build_object('driver_id',CASE WHEN p_action='reassign_fine' THEN target_driver.id ELSE d.id END,'id',target_id,'action',p_action);
  INSERT INTO private.driver_workspace_requests VALUES(actor,p_request_id,p_action,p_payload,answer);
  RETURN answer;
END $$;
REVOKE ALL ON FUNCTION private.driver_fine_enterprise_command(text,jsonb,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.driver_workspace_command(p_action text,p_payload jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_action IN ('review_fine','correct_fine','reassign_fine') THEN
    RETURN private.driver_fine_enterprise_command(p_action,p_payload,p_request_id);
  END IF;
  RETURN private.driver_workspace_command(p_action,p_payload,p_request_id);
END $$;
REVOKE ALL ON FUNCTION private.driver_workspace_command(text,jsonb,uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.driver_workspace_command(text,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_workspace_command(text,jsonb,uuid) TO authenticated;

CREATE FUNCTION public.driver_fine_register(p_filters jsonb DEFAULT '{}'::jsonb,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; org uuid:=public.app_current_org(); query_text text:=left(coalesce(p_filters->>'search',''),160);
BEGIN
  IF auth.uid() IS NULL OR org IS NULL OR NOT coalesce(public.app_is_active(),false) OR p_offset<0 OR p_offset>1000000 THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF NOT (coalesce(public.app_user_can('fleet_master','edit'),false) OR private.driver_workspace_is_finance_reviewer() OR coalesce(public.app_user_can('driver_workspace','view'),false)
    OR EXISTS(SELECT 1 FROM public.driver_team_assignments a WHERE auth.uid() IN (a.supervisor_id,a.manager_id) AND a.ends_at IS NULL)) THEN RAISE EXCEPTION 'Staff access required' USING ERRCODE='42501'; END IF;
  IF coalesce(p_filters->>'status','') NOT IN ('','open','settled','cancelled') OR coalesce(p_filters->>'review_stage','') NOT IN ('','driver','supervisor','finance','complete') THEN RAISE EXCEPTION 'Invalid filter' USING ERRCODE='22023'; END IF;
  SELECT jsonb_build_object('rows',coalesce(jsonb_agg(x ORDER BY x->>'due_date',x->>'id'),'[]')) INTO result FROM (
    SELECT jsonb_build_object('id',f.id,'driver_id',f.driver_id,'driver_name',d.driver_name,'employee_id',d.driver_id,'site',f.site,'country',f.country,
      'asset_no',v.asset_no,'authority',f.authority,'notice_reference',f.notice_reference,'incident_at',f.incident_at,'due_date',f.due_date,
      'amount',f.amount,'currency',f.currency,'paid_amount',f.paid_amount,'balance',f.amount-f.paid_amount,'status',f.status,'response_status',f.response_status,
      'review_stage',f.review_stage,'version',f.version,'created_at',f.created_at,'updated_at',f.updated_at,
      'resolution',(SELECT r.resolution FROM public.driver_fine_responses r WHERE r.fine_id=f.id ORDER BY r.signed_at DESC LIMIT 1),
      'signed_at',(SELECT r.signed_at FROM public.driver_fine_responses r WHERE r.fine_id=f.id ORDER BY r.signed_at DESC LIMIT 1),
      'signature_present',EXISTS(SELECT 1 FROM public.driver_fine_responses r WHERE r.fine_id=f.id),
      'last_reviewer',(SELECT p.full_name FROM public.driver_fine_reviews rv JOIN public.profiles p ON p.id=rv.reviewer_id WHERE rv.fine_id=f.id ORDER BY rv.created_at DESC,rv.id DESC LIMIT 1),
      'last_payment_reference',(SELECT rv.details->>'payment_reference' FROM public.driver_fine_reviews rv WHERE rv.fine_id=f.id AND rv.decision='payment' ORDER BY rv.created_at DESC,rv.id DESC LIMIT 1),
      'reminder_count',(SELECT count(*) FROM public.driver_fine_reminders rm WHERE rm.fine_id=f.id),
      'overdue',f.status='open' AND f.due_date<current_date) x
    FROM public.driver_fines f JOIN public.drivers d ON d.id=f.driver_id LEFT JOIN public.vehicle_fleet v ON v.id=f.vehicle_id
    WHERE f.organisation_id=org AND private.driver_workspace_access(f.driver_id) IN ('manager','supervisor','finance','viewer')
      AND (coalesce(p_filters->>'status','')='' OR f.status=p_filters->>'status')
      AND (coalesce(p_filters->>'review_stage','')='' OR f.review_stage=p_filters->>'review_stage')
      AND (NOT coalesce((p_filters->>'overdue')::boolean,false) OR (f.status='open' AND f.due_date<current_date))
      AND (query_text='' OR concat_ws(' ',d.driver_name,d.driver_id,v.asset_no,f.authority,f.notice_reference,f.site) ILIKE '%'||query_text||'%')
    ORDER BY f.due_date NULLS LAST,f.id LIMIT 101 OFFSET p_offset
  ) q;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.driver_fine_register(jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_fine_register(jsonb,integer) TO authenticated;

CREATE FUNCTION private.driver_fine_dispatch_reminders(p_as_of date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.driver_fines%ROWTYPE; reminder_kind text; reminder_id uuid; recipient_total integer; sent_total integer:=0; skipped_total integer:=0;
BEGIN
  FOR f IN SELECT * FROM public.driver_fines WHERE status='open' AND due_date IS NOT NULL AND superseded_by_fine_id IS NULL
    AND (due_date=p_as_of+7 OR due_date=p_as_of OR due_date<p_as_of) ORDER BY id FOR UPDATE SKIP LOCKED LOOP
    reminder_kind:=CASE WHEN f.due_date=p_as_of+7 THEN 'due_7_days' WHEN f.due_date=p_as_of THEN 'due_today' ELSE 'overdue' END;
    INSERT INTO public.driver_fine_reminders(fine_id,driver_id,organisation_id,reminder_date,kind,status)
      VALUES(f.id,f.driver_id,f.organisation_id,p_as_of,reminder_kind,'skipped') ON CONFLICT DO NOTHING RETURNING id INTO reminder_id;
    IF reminder_id IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.notifications(user_id,type,title,body,entity_type,entity_id)
      SELECT recipient,'driver_workspace','Traffic fine reminder',CASE reminder_kind WHEN 'due_7_days' THEN 'A traffic fine is due in seven days.' WHEN 'due_today' THEN 'A traffic fine is due today.' ELSE 'A traffic fine is overdue.' END,'driver_workspace',f.driver_id::text
      FROM (SELECT l.user_id recipient FROM public.driver_account_links l WHERE l.driver_id=f.driver_id
        UNION SELECT a.supervisor_id FROM public.driver_team_assignments a WHERE a.driver_id=f.driver_id AND a.ends_at IS NULL
        UNION SELECT a.manager_id FROM public.driver_team_assignments a WHERE a.driver_id=f.driver_id AND a.ends_at IS NULL
        UNION SELECT p.id FROM public.profiles p WHERE p.org_id=f.organisation_id AND p.approved AND NOT coalesce(p.locked,false) AND lower(btrim(p.role)) IN ('finance','admin')) q
      JOIN public.profiles p ON p.id=recipient WHERE recipient IS NOT NULL AND p.approved AND NOT coalesce(p.locked,false);
    GET DIAGNOSTICS recipient_total=ROW_COUNT;
    UPDATE public.driver_fine_reminders SET status=CASE WHEN recipient_total>0 THEN 'sent' ELSE 'skipped' END,recipient_count=recipient_total WHERE id=reminder_id;
    INSERT INTO public.driver_workspace_events(organisation_id,driver_id,fine_id,actor_id,action,details)
      VALUES(f.organisation_id,f.driver_id,f.id,NULL,'automated_reminder',jsonb_build_object('kind',reminder_kind,'reminder_date',p_as_of,'recipient_count',recipient_total));
    IF recipient_total>0 THEN sent_total:=sent_total+1; ELSE skipped_total:=skipped_total+1; END IF;
  END LOOP;
  RETURN jsonb_build_object('sent',sent_total,'skipped',skipped_total,'as_of',p_as_of);
END $$;
REVOKE ALL ON FUNCTION private.driver_fine_dispatch_reminders(date) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.driver_workspace_run_reminders()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.app_is_active(),false) OR NOT (coalesce(public.app_user_can('fleet_master','edit'),false) OR private.driver_workspace_is_finance_reviewer()) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  RETURN private.driver_fine_dispatch_reminders(current_date);
END $$;
REVOKE ALL ON FUNCTION public.driver_workspace_run_reminders() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_workspace_run_reminders() TO authenticated;

-- pg_cron is optional in local/test databases. Hosted projects schedule through
-- its API; never write directly to cron.job.
DO $schedule$
DECLARE job_exists boolean;
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname=$1)' INTO job_exists USING 'driver-fine-daily-reminders';
    IF NOT job_exists THEN
      EXECUTE 'SELECT cron.schedule($1,$2,$3)' USING 'driver-fine-daily-reminders','15 5 * * *','SELECT private.driver_fine_dispatch_reminders(current_date)';
    END IF;
  END IF;
END $schedule$;
