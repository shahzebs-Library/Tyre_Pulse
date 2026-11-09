-- Workforce operations core: employee records, task requirements, qualification-gated assignment,
-- audited reassignment, operational-record linking, assignment evidence and a server-side board summary.
-- STATUS: APPLIED LIVE 2026-11-09 (migration workforce_operations_core). Additive; every workforce table this touches held 0 rows on 2026-11-09 (measured).
--
-- What changes for existing behaviour (deliberately):
--  * A status change on workforce_assignments is now accepted ONLY from the audited transition
--    function. Direct UPDATE of status (the web "legacy" fallback, the Flutter advance() path) is refused,
--    because it changed work state without an event row (untraceable work).
--  * workforce_assignment_transition gains optional p_reason_code (blocker cause; NULL = not recorded). The old 5-arg signature is
--    renamed to workforce_assignment_transition_v1_retired (revoked) so PostgREST never sees two overloads (42725). Named-argument callers are unaffected.
--  * 'complete' needs evidence when the task type requires it; 'verify' needs the linked operational
--    record when the task type requires one, and a review note when technical review is required.
--
-- ROLLBACK (all objects are new except the guard + transition function):
--   drop function public.workforce_board_summary(date,date,text);
--   drop function public.workforce_link_operational_record(uuid,text,uuid,text);
--   drop function public.workforce_reassign(uuid,uuid,text,text,text);
--   drop function public.workforce_recommend_assignees(text,text,timestamptz,int);
--   drop function public.workforce_qualification(uuid,text,text,timestamptz);
--   drop trigger zz_workforce_assignment_qualify on public.workforce_assignments; drop function public.workforce_assignment_qualify();
--   drop table public.workforce_assignment_evidence, public.workforce_task_types, public.workforce_employee_certifications,
--     public.workforce_employee_history, public.workforce_employees;
--   alter table public.workforce_assignments drop column asset_no, tyre_serial, tyre_position, operational_record_table,
--     operational_record_id, supporting_employee_ids, qualification, override_reason, overridden_by;
--   then re-apply sections 2 and 4 of 20261023091000_workforce_transitions_and_estimation.sql.

-- 1. Operational employee record. Separate from profiles.role (which is an ACCESS role, not a job).
CREATE TABLE IF NOT EXISTS public.workforce_employees(
 profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
 organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
 employee_code text CHECK(employee_code IS NULL OR char_length(employee_code)<=40),
 designation text NOT NULL CHECK(char_length(btrim(designation)) BETWEEN 1 AND 120),
 department text CHECK(department IS NULL OR char_length(department)<=120),
 team text CHECK(team IS NULL OR char_length(team)<=120),
 supervisor_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
 sites text[] NOT NULL DEFAULT '{}',
 responsibilities text CHECK(responsibilities IS NULL OR char_length(responsibilities)<=4000),
 employment_status text NOT NULL DEFAULT 'active' CHECK(employment_status IN ('active','temporarily_unavailable','inactive')),
 unavailable_until date,
 shift_start time, shift_end time,
 escalation_contact text CHECK(escalation_contact IS NULL OR char_length(escalation_contact)<=200),
 updated_by uuid DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(supervisor_id IS DISTINCT FROM profile_id)
);
CREATE INDEX IF NOT EXISTS workforce_employees_org ON public.workforce_employees(organisation_id,employment_status);
CREATE INDEX IF NOT EXISTS workforce_employees_supervisor ON public.workforce_employees(supervisor_id);
ALTER TABLE public.workforce_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY workforce_employees_org ON public.workforce_employees AS RESTRICTIVE FOR ALL
 USING(organisation_id=public.app_current_org()) WITH CHECK(organisation_id=public.app_current_org());
CREATE POLICY workforce_employees_read ON public.workforce_employees FOR SELECT TO authenticated
 USING(profile_id=auth.uid() OR supervisor_id=auth.uid() OR public.workforce_is_manager());
CREATE POLICY workforce_employees_write ON public.workforce_employees FOR INSERT TO authenticated
 WITH CHECK(public.workforce_is_manager());
CREATE POLICY workforce_employees_update ON public.workforce_employees FOR UPDATE TO authenticated
 USING(public.workforce_is_manager()) WITH CHECK(public.workforce_is_manager());
REVOKE ALL ON public.workforce_employees FROM anon;
GRANT SELECT,INSERT,UPDATE ON public.workforce_employees TO authenticated;

CREATE OR REPLACE FUNCTION public.workforce_employee_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_cur uuid; v_depth int:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=NEW.profile_id AND p.organisation_id=NEW.organisation_id) THEN
   RAISE EXCEPTION 'Employee must belong to this organisation' USING ERRCODE='42501'; END IF;
 IF NEW.supervisor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=NEW.supervisor_id AND p.organisation_id=NEW.organisation_id) THEN
   RAISE EXCEPTION 'Supervisor must belong to this organisation' USING ERRCODE='42501'; END IF;
 -- Reporting line must not loop back to the employee.
 v_cur:=NEW.supervisor_id;
 WHILE v_cur IS NOT NULL AND v_depth<50 LOOP
   IF v_cur=NEW.profile_id THEN RAISE EXCEPTION 'This supervisor would create a reporting loop' USING ERRCODE='23514'; END IF;
   SELECT e.supervisor_id INTO v_cur FROM public.workforce_employees e WHERE e.profile_id=v_cur;
   v_depth:=v_depth+1;
 END LOOP;
 NEW.sites:=ARRAY(SELECT DISTINCT upper(btrim(s)) FROM unnest(coalesce(NEW.sites,'{}')) s WHERE nullif(btrim(s),'') IS NOT NULL ORDER BY 1);
 NEW.designation:=btrim(NEW.designation);
 IF NEW.employment_status<>'temporarily_unavailable' THEN NEW.unavailable_until:=NULL; END IF;
 IF TG_OP='UPDATE' THEN
   IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
     RAISE EXCEPTION 'Employee identity is immutable' USING ERRCODE='42501'; END IF;
   NEW.updated_at:=now(); NEW.updated_by:=auth.uid();
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workforce_employee_guard ON public.workforce_employees;
CREATE TRIGGER workforce_employee_guard BEFORE INSERT OR UPDATE ON public.workforce_employees
FOR EACH ROW EXECUTE FUNCTION public.workforce_employee_guard();

-- Append-only history of every change (reassignment, supervisor, sites, status, designation).
CREATE TABLE IF NOT EXISTS public.workforce_employee_history(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL,
 profile_id uuid NOT NULL,
 changed_by uuid,
 changed_at timestamptz NOT NULL DEFAULT now(),
 old_values jsonb, new_values jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS workforce_employee_history_profile ON public.workforce_employee_history(profile_id,changed_at);
ALTER TABLE public.workforce_employee_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY workforce_employee_history_org ON public.workforce_employee_history AS RESTRICTIVE FOR ALL
 USING(organisation_id=public.app_current_org()) WITH CHECK(organisation_id=public.app_current_org());
CREATE POLICY workforce_employee_history_read ON public.workforce_employee_history FOR SELECT TO authenticated
 USING(profile_id=auth.uid() OR public.workforce_is_manager());
REVOKE ALL ON public.workforce_employee_history FROM anon,authenticated;
GRANT SELECT ON public.workforce_employee_history TO authenticated;
CREATE OR REPLACE FUNCTION public.workforce_employee_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO public.workforce_employee_history(organisation_id,profile_id,changed_by,old_values,new_values)
 VALUES(NEW.organisation_id,NEW.profile_id,auth.uid(),
  CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD)-'updated_at'-'updated_by' END, to_jsonb(NEW)-'updated_at'-'updated_by');
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS workforce_employee_log ON public.workforce_employees;
CREATE TRIGGER workforce_employee_log AFTER INSERT OR UPDATE ON public.workforce_employees
FOR EACH ROW EXECUTE FUNCTION public.workforce_employee_log();
CREATE OR REPLACE FUNCTION public.workforce_history_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'History is append-only'; END $$;
DROP TRIGGER IF EXISTS workforce_employee_history_immutable ON public.workforce_employee_history;
CREATE TRIGGER workforce_employee_history_immutable BEFORE UPDATE OR DELETE ON public.workforce_employee_history
FOR EACH ROW EXECUTE FUNCTION public.workforce_history_immutable();

-- 2. Person-keyed certifications / safety training (public.certifications is keyed by free-text name).
CREATE TABLE IF NOT EXISTS public.workforce_employee_certifications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
 profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 cert_type text NOT NULL CHECK(char_length(btrim(cert_type)) BETWEEN 1 AND 80),
 cert_number text CHECK(cert_number IS NULL OR char_length(cert_number)<=80),
 issued_on date, expires_on date,
 verified_by uuid DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(expires_on IS NULL OR issued_on IS NULL OR expires_on>=issued_on)
);
CREATE INDEX IF NOT EXISTS workforce_employee_certs_profile ON public.workforce_employee_certifications(profile_id,cert_type,expires_on);
ALTER TABLE public.workforce_employee_certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY workforce_employee_certs_org ON public.workforce_employee_certifications AS RESTRICTIVE FOR ALL
 USING(organisation_id=public.app_current_org()) WITH CHECK(organisation_id=public.app_current_org());
CREATE POLICY workforce_employee_certs_read ON public.workforce_employee_certifications FOR SELECT TO authenticated
 USING(profile_id=auth.uid() OR public.workforce_is_manager());
CREATE POLICY workforce_employee_certs_write ON public.workforce_employee_certifications FOR INSERT TO authenticated
 WITH CHECK(public.workforce_is_manager() AND EXISTS(SELECT 1 FROM public.profiles p
  WHERE p.id=workforce_employee_certifications.profile_id AND p.organisation_id=workforce_employee_certifications.organisation_id));
REVOKE ALL ON public.workforce_employee_certifications FROM anon;
GRANT SELECT,INSERT ON public.workforce_employee_certifications TO authenticated;
CREATE OR REPLACE FUNCTION public.workforce_cert_normalize() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.cert_type:=lower(regexp_replace(btrim(NEW.cert_type),'\s+',' ','g')); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS workforce_cert_normalize ON public.workforce_employee_certifications;
CREATE TRIGGER workforce_cert_normalize BEFORE INSERT ON public.workforce_employee_certifications
FOR EACH ROW EXECUTE FUNCTION public.workforce_cert_normalize();

-- 3. Task-type requirements. A row here is what makes a task type skill-, safety- or evidence-gated.
CREATE TABLE IF NOT EXISTS public.workforce_task_types(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
 task_type text NOT NULL CHECK(char_length(btrim(task_type)) BETWEEN 1 AND 80),
 label text,
 required_skill_id text,
 min_skill_level int NOT NULL DEFAULT 1 CHECK(min_skill_level BETWEEN 1 AND 3),
 required_cert_type text,
 safety_critical boolean NOT NULL DEFAULT false,
 evidence_required boolean NOT NULL DEFAULT false,
 technical_review_required boolean NOT NULL DEFAULT false,
 operational_record_table text CHECK(operational_record_table IS NULL OR operational_record_table IN ('tyre_records','tyre_service_events','work_orders','inspections')),
 active boolean NOT NULL DEFAULT true,
 created_by uuid DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organisation_id,task_type),
 -- A safety gate with nothing to check would be a gate in name only.
 CHECK(NOT safety_critical OR required_skill_id IS NOT NULL OR required_cert_type IS NOT NULL)
);
ALTER TABLE public.workforce_task_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY workforce_task_types_org ON public.workforce_task_types AS RESTRICTIVE FOR ALL
 USING(organisation_id=public.app_current_org()) WITH CHECK(organisation_id=public.app_current_org());
CREATE POLICY workforce_task_types_read ON public.workforce_task_types FOR SELECT TO authenticated USING(true);
CREATE POLICY workforce_task_types_insert ON public.workforce_task_types FOR INSERT TO authenticated WITH CHECK(public.workforce_is_manager());
CREATE POLICY workforce_task_types_update ON public.workforce_task_types FOR UPDATE TO authenticated
 USING(public.workforce_is_manager()) WITH CHECK(public.workforce_is_manager());
REVOKE ALL ON public.workforce_task_types FROM anon;
GRANT SELECT,INSERT,UPDATE ON public.workforce_task_types TO authenticated;
CREATE OR REPLACE FUNCTION public.workforce_task_type_normalize() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 NEW.task_type:=lower(regexp_replace(btrim(NEW.task_type),'\s+',' ','g'));
 NEW.required_cert_type:=nullif(lower(regexp_replace(btrim(NEW.required_cert_type),'\s+',' ','g')),'');
 NEW.required_skill_id:=nullif(btrim(NEW.required_skill_id),'');
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workforce_task_type_normalize ON public.workforce_task_types;
CREATE TRIGGER workforce_task_type_normalize BEFORE INSERT OR UPDATE ON public.workforce_task_types
FOR EACH ROW EXECUTE FUNCTION public.workforce_task_type_normalize();

-- 4. Assignment operational context.
ALTER TABLE public.workforce_assignments
 ADD COLUMN IF NOT EXISTS asset_no text,
 ADD COLUMN IF NOT EXISTS tyre_serial text,
 ADD COLUMN IF NOT EXISTS tyre_position text,
 ADD COLUMN IF NOT EXISTS operational_record_table text,
 ADD COLUMN IF NOT EXISTS operational_record_id uuid,
 ADD COLUMN IF NOT EXISTS supporting_employee_ids uuid[] NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS qualification jsonb,
 ADD COLUMN IF NOT EXISTS override_reason text,
 ADD COLUMN IF NOT EXISTS overridden_by uuid;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='workforce_assignments_op_table') THEN
  ALTER TABLE public.workforce_assignments ADD CONSTRAINT workforce_assignments_op_table
   CHECK(operational_record_table IS NULL OR operational_record_table IN ('tyre_records','tyre_service_events','work_orders','inspections'));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='workforce_assignments_override_len') THEN
  ALTER TABLE public.workforce_assignments ADD CONSTRAINT workforce_assignments_override_len
   CHECK(override_reason IS NULL OR char_length(override_reason) BETWEEN 5 AND 1000);
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS workforce_assignments_org_created ON public.workforce_assignments(organisation_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS workforce_assignments_asset ON public.workforce_assignments(organisation_id,asset_no) WHERE asset_no IS NOT NULL;

-- 5. Qualification. Hard blocks (safety) can never be overridden; soft gaps need a recorded reason.
CREATE OR REPLACE FUNCTION public.workforce_qualification(p_profile uuid,p_task_type text,p_site text,p_at timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_org uuid:=public.app_current_org(); e public.workforce_employees; tt public.workforce_task_types; p public.profiles;
 v_hard text[]:='{}'; v_soft text[]:='{}'; v_info text[]:='{}'; v_level int; v_site text:=nullif(upper(btrim(p_site)),'');
 v_task text:=nullif(lower(regexp_replace(btrim(p_task_type),'\s+',' ','g')),''); v_day date:=(coalesce(p_at,now()))::date;
BEGIN
 IF v_org IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','no_org'); END IF;
 SELECT * INTO p FROM public.profiles WHERE id=p_profile AND organisation_id=v_org;
 IF p.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
 IF coalesce(p.locked,false) OR NOT coalesce(p.approved,true) THEN v_hard:=array_append(v_hard,'account_inactive'); END IF;
 SELECT * INTO e FROM public.workforce_employees WHERE profile_id=p_profile AND organisation_id=v_org;
 IF e.profile_id IS NULL THEN v_info:=array_append(v_info,'no_employee_record');
 ELSE
   IF e.employment_status='inactive' THEN v_hard:=array_append(v_hard,'employee_inactive');
   ELSIF e.employment_status='temporarily_unavailable' AND (e.unavailable_until IS NULL OR e.unavailable_until>=v_day) THEN v_soft:=array_append(v_soft,'temporarily_unavailable'); END IF;
   IF v_site IS NOT NULL AND cardinality(e.sites)>0 AND NOT (v_site=ANY(e.sites) OR 'ALL'=ANY(e.sites)) THEN v_soft:=array_append(v_soft,'site_not_assigned'); END IF;
 END IF;
 IF v_task IS NOT NULL THEN
   SELECT * INTO tt FROM public.workforce_task_types WHERE organisation_id=v_org AND task_type=v_task AND active;
 END IF;
 IF tt.id IS NOT NULL THEN
   IF tt.required_skill_id IS NOT NULL THEN
     SELECT max(level) INTO v_level FROM public.technician_skills WHERE user_id=p_profile AND organisation_id=v_org AND skill_id=tt.required_skill_id;
     IF coalesce(v_level,0)<tt.min_skill_level THEN
       IF tt.safety_critical THEN v_hard:=array_append(v_hard,'skill_missing'); ELSE v_soft:=array_append(v_soft,'skill_missing'); END IF;
     END IF;
   END IF;
   IF tt.required_cert_type IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.workforce_employee_certifications c
      WHERE c.profile_id=p_profile AND c.organisation_id=v_org AND c.cert_type=tt.required_cert_type
        AND (c.issued_on IS NULL OR c.issued_on<=v_day) AND (c.expires_on IS NULL OR c.expires_on>=v_day)) THEN
     IF tt.safety_critical THEN v_hard:=array_append(v_hard,'certification_invalid'); ELSE v_soft:=array_append(v_soft,'certification_invalid'); END IF;
   END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'qualified',cardinality(v_hard)=0 AND cardinality(v_soft)=0,
  'safety_blocked',cardinality(v_hard)>0,'hard',to_jsonb(v_hard),'soft',to_jsonb(v_soft),'info',to_jsonb(v_info),
  'task_type_known',tt.id IS NOT NULL,'safety_critical',coalesce(tt.safety_critical,false),
  'required_skill_id',tt.required_skill_id,'min_skill_level',tt.min_skill_level,'skill_level',v_level,
  'required_cert_type',tt.required_cert_type,'designation',e.designation,'evaluated_at',now());
END $$;
REVOKE ALL ON FUNCTION public.workforce_qualification(uuid,text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workforce_qualification(uuid,text,text,timestamptz) TO authenticated;

-- Enforced at the table: every path that creates or reassigns work goes through this check.
CREATE OR REPLACE FUNCTION public.workforce_assignment_qualify() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE q jsonb; tt public.workforce_task_types;
BEGIN
 IF TG_OP='UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN RETURN NEW; END IF;
 q:=public.workforce_qualification(NEW.assigned_to,NEW.task_type,NEW.site,coalesce(NEW.due_at,now()));
 IF coalesce((q->>'ok')::boolean,false) IS NOT TRUE THEN
   RAISE EXCEPTION 'The selected employee is not in this organisation' USING ERRCODE='42501'; END IF;
 IF (q->'hard') ?| ARRAY['account_inactive','employee_inactive'] THEN
   RAISE EXCEPTION 'The selected employee account is not active' USING ERRCODE='23514'; END IF;
 IF (q->>'safety_blocked')::boolean THEN
   RAISE EXCEPTION 'Not qualified for this safety-critical work: %', (SELECT string_agg(x,', ') FROM jsonb_array_elements_text(q->'hard') x)
   USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(q->'soft')>0 THEN
   IF nullif(btrim(NEW.override_reason),'') IS NULL THEN
     RAISE EXCEPTION 'A manager override reason is required: %', (SELECT string_agg(x,', ') FROM jsonb_array_elements_text(q->'soft') x)
     USING ERRCODE='23514'; END IF;
   NEW.overridden_by:=auth.uid();
 ELSE
   NEW.override_reason:=NULL; NEW.overridden_by:=NULL;
 END IF;
 NEW.qualification:=q;
 -- Snapshot the required operational record type so a later task-type edit cannot loosen open work.
 IF TG_OP='INSERT' AND NEW.task_type IS NOT NULL THEN
   SELECT * INTO tt FROM public.workforce_task_types WHERE organisation_id=NEW.organisation_id AND task_type=lower(regexp_replace(btrim(NEW.task_type),'\s+',' ','g')) AND active;
   IF tt.operational_record_table IS NOT NULL AND NEW.operational_record_table IS NULL THEN NEW.operational_record_table:=tt.operational_record_table; END IF;
 END IF;
 NEW.supporting_employee_ids:=ARRAY(SELECT DISTINCT s FROM unnest(coalesce(NEW.supporting_employee_ids,'{}')) s
   WHERE s<>NEW.assigned_to AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=s AND p.organisation_id=NEW.organisation_id));
 NEW.asset_no:=nullif(upper(regexp_replace(btrim(NEW.asset_no),'\s+','','g')),'');
 NEW.tyre_serial:=nullif(btrim(NEW.tyre_serial),'');
 NEW.tyre_position:=nullif(upper(btrim(NEW.tyre_position)),'');
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_workforce_assignment_qualify ON public.workforce_assignments;
-- 'zz' so it runs after workforce_assignment_classify (which canonicalises task_type).
CREATE TRIGGER zz_workforce_assignment_qualify BEFORE INSERT OR UPDATE ON public.workforce_assignments
FOR EACH ROW EXECUTE FUNCTION public.workforce_assignment_qualify();

-- 6. Guard: status, assignee and operational link change only through the audited functions.
CREATE OR REPLACE FUNCTION public.workforce_assignment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE is_manager boolean; v_via text:=coalesce(current_setting('workforce.via',true),'');
BEGIN
 IF TG_OP='UPDATE' THEN
   is_manager=public.workforce_is_manager();
   IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
   THEN RAISE EXCEPTION 'Assignment ownership is immutable'; END IF;
   IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND v_via<>'reassign' THEN RAISE EXCEPTION 'Assignment ownership is immutable'; END IF;
   IF OLD.status IN ('verified','cancelled') THEN RAISE EXCEPTION 'Closed assignments are immutable'; END IF;
   IF NEW.status IS DISTINCT FROM OLD.status AND v_via<>'transition' THEN
     RAISE EXCEPTION 'Status changes must go through the audited transition' USING ERRCODE='42501'; END IF;
   IF (NEW.operational_record_id IS DISTINCT FROM OLD.operational_record_id OR NEW.operational_record_table IS DISTINCT FROM OLD.operational_record_table) AND v_via<>'link' THEN
     RAISE EXCEPTION 'Operational records are linked only through the audited link function' USING ERRCODE='42501'; END IF;
   IF NOT is_manager AND v_via='' THEN
     IF ROW(NEW.title,NEW.instructions,NEW.site,NEW.priority,NEW.due_at,NEW.estimated_minutes,NEW.source_module,NEW.source_record_id,NEW.created_at,NEW.task_type,NEW.vehicle_type,NEW.assignee_role,NEW.asset_no,NEW.tyre_serial,NEW.tyre_position,NEW.supporting_employee_ids,NEW.override_reason)
        IS DISTINCT FROM ROW(OLD.title,OLD.instructions,OLD.site,OLD.priority,OLD.due_at,OLD.estimated_minutes,OLD.source_module,OLD.source_record_id,OLD.created_at,OLD.task_type,OLD.vehicle_type,OLD.assignee_role,OLD.asset_no,OLD.tyre_serial,OLD.tyre_position,OLD.supporting_employee_ids,OLD.override_reason)
     THEN RAISE EXCEPTION 'Employees may change assignment status only'; END IF;
   END IF;
   NEW.updated_at=now();
 END IF;
 RETURN NEW;
END $$;

-- 7. Events: blocker cause, reassignment and record-link actions.
ALTER TABLE public.workforce_assignment_events
 ADD COLUMN IF NOT EXISTS reason_code text,
 ADD COLUMN IF NOT EXISTS from_assignee uuid,
 ADD COLUMN IF NOT EXISTS to_assignee uuid,
 ADD COLUMN IF NOT EXISTS detail jsonb;
ALTER TABLE public.workforce_assignment_events DROP CONSTRAINT IF EXISTS workforce_assignment_events_action_check;
ALTER TABLE public.workforce_assignment_events ADD CONSTRAINT workforce_assignment_events_action_check
 CHECK(action IN ('accept','start','block','resume','complete','verify','return','cancel','reassign','link_record'));
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='workforce_assignment_events_reason_code') THEN
  ALTER TABLE public.workforce_assignment_events ADD CONSTRAINT workforce_assignment_events_reason_code
   CHECK(reason_code IS NULL OR reason_code IN ('waiting_stock','waiting_equipment','vehicle_unavailable','safety_hold','waiting_approval','waiting_manpower','other'));
 END IF;
END $$;

-- 8. Assignment-level evidence (separate from daily-report evidence, same private bucket).
CREATE TABLE IF NOT EXISTS public.workforce_assignment_evidence(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
 assignment_id uuid NOT NULL REFERENCES public.workforce_assignments(id) ON DELETE RESTRICT,
 uploaded_by uuid NOT NULL DEFAULT auth.uid(),
 kind text NOT NULL DEFAULT 'photo' CHECK(kind IN ('photo','document','reading')),
 object_path text NOT NULL UNIQUE,
 file_name text NOT NULL CHECK(char_length(file_name) BETWEEN 1 AND 240),
 mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','application/pdf')),
 byte_size bigint NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workforce_assignment_evidence_a ON public.workforce_assignment_evidence(assignment_id,created_at);
ALTER TABLE public.workforce_assignment_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY workforce_assignment_evidence_org ON public.workforce_assignment_evidence AS RESTRICTIVE FOR ALL
 USING(organisation_id=public.app_current_org()) WITH CHECK(organisation_id=public.app_current_org());
CREATE POLICY workforce_assignment_evidence_read ON public.workforce_assignment_evidence FOR SELECT TO authenticated
 USING(public.workforce_is_manager() OR EXISTS(SELECT 1 FROM public.workforce_assignments a WHERE a.id=assignment_id AND a.assigned_to=auth.uid()));
CREATE POLICY workforce_assignment_evidence_insert ON public.workforce_assignment_evidence FOR INSERT TO authenticated
 WITH CHECK(uploaded_by=auth.uid()
  AND object_path LIKE organisation_id::text||'/assignments/'||assignment_id::text||'/%'
  AND EXISTS(SELECT 1 FROM public.workforce_assignments a WHERE a.id=assignment_id AND a.organisation_id=workforce_assignment_evidence.organisation_id
    AND a.assigned_to=auth.uid() AND a.status IN ('acknowledged','in_progress','blocked')));
REVOKE ALL ON public.workforce_assignment_evidence FROM anon,authenticated;
GRANT SELECT,INSERT ON public.workforce_assignment_evidence TO authenticated;
CREATE OR REPLACE FUNCTION public.workforce_assignment_evidence_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Assignment evidence is append-only'; END $$;
DROP TRIGGER IF EXISTS workforce_assignment_evidence_immutable ON public.workforce_assignment_evidence;
CREATE TRIGGER workforce_assignment_evidence_immutable BEFORE UPDATE OR DELETE ON public.workforce_assignment_evidence
FOR EACH ROW EXECUTE FUNCTION public.workforce_assignment_evidence_immutable();
DROP POLICY IF EXISTS workforce_assignment_files_select ON storage.objects;
CREATE POLICY workforce_assignment_files_select ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='workforce-evidence' AND EXISTS(SELECT 1 FROM public.workforce_assignment_evidence e
  JOIN public.workforce_assignments a ON a.id=e.assignment_id
  WHERE e.object_path=name AND e.organisation_id=public.app_current_org()
    AND (a.assigned_to=auth.uid() OR public.workforce_is_manager())));
DROP POLICY IF EXISTS workforce_assignment_files_insert ON storage.objects;
CREATE POLICY workforce_assignment_files_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='workforce-evidence' AND (storage.foldername(name))[2]='assignments' AND EXISTS(
  SELECT 1 FROM public.workforce_assignments a WHERE a.organisation_id::text=(storage.foldername(name))[1]
   AND a.id::text=(storage.foldername(name))[3] AND a.assigned_to=auth.uid() AND a.status IN ('acknowledged','in_progress','blocked')));

-- 9. Transition: same contract as 20261023091000 plus reason codes and evidence/record/review gates.
-- The old 5-arg signature is retired by RENAME (not drop) so PostgREST sees exactly one function.
ALTER FUNCTION public.workforce_assignment_transition(uuid,text,text,text,timestamptz) RENAME TO workforce_assignment_transition_v1_retired;
REVOKE ALL ON FUNCTION public.workforce_assignment_transition_v1_retired(uuid,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.workforce_assignment_transition(
 p_assignment_id uuid, p_action text, p_idempotency_key text,
 p_note text DEFAULT NULL, p_client_at timestamptz DEFAULT NULL, p_reason_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_uid uuid:=auth.uid(); v_org uuid; a public.workforce_assignments; ev public.workforce_assignment_events; tt public.workforce_task_types;
 v_note text:=nullif(btrim(p_note),''); v_from text[]; v_to text; v_manager_action boolean:=false;
 v_is_mgr boolean; v_prev timestamptz; v_eff timestamptz; v_now timestamptz:=now(); v_new uuid;
 v_reason text:=nullif(btrim(p_reason_code),'');
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='28000'; END IF;
 IF p_idempotency_key IS NULL OR char_length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 100 THEN
   RAISE EXCEPTION 'A valid idempotency key is required' USING ERRCODE='22023'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('accept','start','block','resume','complete','verify','return','cancel') THEN
   RAISE EXCEPTION 'Unknown assignment action' USING ERRCODE='22023'; END IF;
 IF v_reason IS NOT NULL AND v_reason NOT IN ('waiting_stock','waiting_equipment','vehicle_unavailable','safety_hold','waiting_approval','waiting_manpower','other') THEN
   RAISE EXCEPTION 'Unknown blocker reason' USING ERRCODE='22023'; END IF;
 v_org:=public.app_current_org();
 IF v_org IS NULL THEN RAISE EXCEPTION 'No organisation for this account' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.workforce_assignments WHERE id=p_assignment_id AND organisation_id=v_org FOR UPDATE;
 SELECT * INTO ev FROM public.workforce_assignment_events WHERE actor_id=v_uid AND idempotency_key=btrim(p_idempotency_key);
 IF FOUND THEN
   IF ev.assignment_id IS DISTINCT FROM p_assignment_id OR ev.action IS DISTINCT FROM p_action OR ev.organisation_id IS DISTINCT FROM v_org THEN
     RETURN jsonb_build_object('ok',false,'result','rejected','reason','key_reuse');
   END IF;
   RETURN jsonb_build_object('ok',true,'result','replayed','status',a.status,'event_id',ev.id);
 END IF;
 IF a.id IS NULL THEN RETURN jsonb_build_object('ok',false,'result','rejected','reason','not_found'); END IF;
 v_is_mgr:=public.workforce_is_manager();
 CASE p_action
  WHEN 'accept'   THEN v_from:=ARRAY['assigned']; v_to:='acknowledged';
  WHEN 'start'    THEN v_from:=ARRAY['assigned','acknowledged']; v_to:='in_progress';
  WHEN 'block'    THEN v_from:=ARRAY['acknowledged','in_progress']; v_to:='blocked';
  WHEN 'resume'   THEN v_from:=ARRAY['blocked']; v_to:='in_progress';
  WHEN 'complete' THEN v_from:=ARRAY['in_progress']; v_to:='submitted';
  WHEN 'verify'   THEN v_from:=ARRAY['submitted']; v_to:='verified'; v_manager_action:=true;
  WHEN 'return'   THEN v_from:=ARRAY['submitted']; v_to:='in_progress'; v_manager_action:=true;
  WHEN 'cancel'   THEN v_from:=ARRAY['assigned','acknowledged','in_progress','blocked','submitted']; v_to:='cancelled'; v_manager_action:=true;
 END CASE;
 IF v_manager_action THEN
   IF NOT v_is_mgr THEN RETURN jsonb_build_object('ok',false,'result','rejected','reason','not_found'); END IF;
   IF p_action IN ('verify','return') AND (a.assigned_to=v_uid OR v_uid=ANY(a.supporting_employee_ids)) THEN
     RETURN jsonb_build_object('ok',false,'result','rejected','reason','self_review'); END IF;
 ELSIF a.assigned_to IS DISTINCT FROM v_uid THEN
   RETURN jsonb_build_object('ok',false,'result','rejected','reason',CASE WHEN v_is_mgr THEN 'forbidden' ELSE 'not_found' END);
 END IF;
 IF p_action IN ('block','return','cancel') AND v_note IS NULL THEN
   RETURN jsonb_build_object('ok',false,'result','rejected','reason','note_required','current_status',a.status); END IF;
 -- A block without a cause code is still accepted (installed field builds do not send one yet);
 -- it is recorded as NULL and reported as 'not_recorded', never guessed.
 IF NOT (a.status = ANY(v_from)) THEN
   IF a.status=v_to OR (p_action='accept' AND a.status IN ('in_progress','blocked','submitted','verified')) THEN
     RETURN jsonb_build_object('ok',true,'result','already_applied','status',a.status);
   END IF;
   RETURN jsonb_build_object('ok',false,'result','rejected','reason','invalid_transition','current_status',a.status);
 END IF;
 IF a.task_type IS NOT NULL THEN
   SELECT * INTO tt FROM public.workforce_task_types WHERE organisation_id=v_org AND task_type=a.task_type AND active;
 END IF;
 IF p_action='complete' AND coalesce(tt.evidence_required,false)
    AND NOT EXISTS(SELECT 1 FROM public.workforce_assignment_evidence x WHERE x.assignment_id=a.id) THEN
   RETURN jsonb_build_object('ok',false,'result','rejected','reason','evidence_required','current_status',a.status); END IF;
 IF p_action='verify' THEN
   IF a.operational_record_table IS NOT NULL AND a.operational_record_id IS NULL THEN
     RETURN jsonb_build_object('ok',false,'result','rejected','reason','record_required','current_status',a.status); END IF;
   IF coalesce(tt.technical_review_required,false) AND v_note IS NULL THEN
     RETURN jsonb_build_object('ok',false,'result','rejected','reason','review_note_required','current_status',a.status); END IF;
 END IF;
 SELECT greatest(a.created_at,coalesce(max(e.effective_at),a.created_at)) INTO v_prev
   FROM public.workforce_assignment_events e WHERE e.assignment_id=a.id;
 v_eff:=CASE WHEN p_client_at IS NULL THEN v_now
        ELSE least(v_now,greatest(p_client_at,v_prev,v_now-interval '14 days')) END;
 PERFORM set_config('workforce.via','transition',true);
 UPDATE public.workforce_assignments SET status=v_to WHERE id=a.id;
 PERFORM set_config('workforce.via','',true);
 INSERT INTO public.workforce_assignment_events(organisation_id,assignment_id,actor_id,action,from_status,to_status,note,idempotency_key,client_at,occurred_at,effective_at,reason_code)
 VALUES(v_org,a.id,v_uid,p_action,a.status,v_to,v_note,btrim(p_idempotency_key),p_client_at,v_now,v_eff,CASE WHEN p_action='block' THEN v_reason END) RETURNING id INTO v_new;
 RETURN jsonb_build_object('ok',true,'result','applied','status',v_to,'event_id',v_new);
END $$;
REVOKE ALL ON FUNCTION public.workforce_assignment_transition(uuid,text,text,text,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workforce_assignment_transition(uuid,text,text,text,timestamptz,text) TO authenticated;

-- 10. Reassignment / shift handover: qualification re-checked, previous assignee kept in the event.
CREATE OR REPLACE FUNCTION public.workforce_reassign(p_assignment_id uuid,p_new_assignee uuid,p_note text,p_idempotency_key text,p_override_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid:=auth.uid(); v_org uuid:=public.app_current_org(); a public.workforce_assignments; ev public.workforce_assignment_events;
 q jsonb; v_note text:=nullif(btrim(p_note),''); v_new uuid;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='28000'; END IF;
 IF p_idempotency_key IS NULL OR char_length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 100 THEN
   RAISE EXCEPTION 'A valid idempotency key is required' USING ERRCODE='22023'; END IF;
 IF NOT public.workforce_is_manager() THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
 SELECT * INTO a FROM public.workforce_assignments WHERE id=p_assignment_id AND organisation_id=v_org FOR UPDATE;
 SELECT * INTO ev FROM public.workforce_assignment_events WHERE actor_id=v_uid AND idempotency_key=btrim(p_idempotency_key);
 IF FOUND THEN
   IF ev.assignment_id IS DISTINCT FROM p_assignment_id OR ev.action<>'reassign' THEN RETURN jsonb_build_object('ok',false,'reason','key_reuse'); END IF;
   RETURN jsonb_build_object('ok',true,'result','replayed','event_id',ev.id);
 END IF;
 IF a.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
 IF a.status IN ('verified','cancelled','submitted') THEN RETURN jsonb_build_object('ok',false,'reason','invalid_transition','current_status',a.status); END IF;
 IF v_note IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','note_required'); END IF;
 IF p_new_assignee=a.assigned_to THEN RETURN jsonb_build_object('ok',true,'result','already_applied'); END IF;
 q:=public.workforce_qualification(p_new_assignee,a.task_type,a.site,coalesce(a.due_at,now()));
 IF NOT coalesce((q->>'ok')::boolean,false) THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
 IF (q->>'safety_blocked')::boolean THEN RETURN jsonb_build_object('ok',false,'reason','safety_blocked','qualification',q); END IF;
 IF jsonb_array_length(q->'soft')>0 AND nullif(btrim(p_override_reason),'') IS NULL THEN
   RETURN jsonb_build_object('ok',false,'reason','override_required','qualification',q); END IF;
 PERFORM set_config('workforce.via','reassign',true);
 UPDATE public.workforce_assignments SET assigned_to=p_new_assignee,
   override_reason=CASE WHEN jsonb_array_length(q->'soft')>0 THEN btrim(p_override_reason) END
   WHERE id=a.id;
 PERFORM set_config('workforce.via','',true);
 INSERT INTO public.workforce_assignment_events(organisation_id,assignment_id,actor_id,action,from_status,to_status,note,idempotency_key,occurred_at,effective_at,from_assignee,to_assignee,detail)
 VALUES(v_org,a.id,v_uid,'reassign',a.status,a.status,v_note,btrim(p_idempotency_key),now(),now(),a.assigned_to,p_new_assignee,jsonb_build_object('qualification',q)) RETURNING id INTO v_new;
 RETURN jsonb_build_object('ok',true,'result','applied','event_id',v_new);
END $$;
REVOKE ALL ON FUNCTION public.workforce_reassign(uuid,uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workforce_reassign(uuid,uuid,text,text,text) TO authenticated;

-- 11. Link the canonical operational record (tyre replacement, work order, inspection). The record must
-- exist in this organisation and, when the assignment names an asset, belong to that asset.
CREATE OR REPLACE FUNCTION public.workforce_link_operational_record(p_assignment_id uuid,p_table text,p_record_id uuid,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid:=auth.uid(); v_org uuid:=public.app_current_org(); a public.workforce_assignments; ev public.workforce_assignment_events;
 v_asset text; v_found boolean; v_new uuid;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='28000'; END IF;
 IF p_idempotency_key IS NULL OR char_length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 100 THEN
   RAISE EXCEPTION 'A valid idempotency key is required' USING ERRCODE='22023'; END IF;
 IF p_table NOT IN ('tyre_records','tyre_service_events','work_orders','inspections') THEN
   RAISE EXCEPTION 'Unsupported operational record' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM public.workforce_assignments WHERE id=p_assignment_id AND organisation_id=v_org FOR UPDATE;
 SELECT * INTO ev FROM public.workforce_assignment_events WHERE actor_id=v_uid AND idempotency_key=btrim(p_idempotency_key);
 IF FOUND THEN
   IF ev.assignment_id IS DISTINCT FROM p_assignment_id OR ev.action<>'link_record' THEN RETURN jsonb_build_object('ok',false,'reason','key_reuse'); END IF;
   RETURN jsonb_build_object('ok',true,'result','replayed');
 END IF;
 IF a.id IS NULL OR NOT (a.assigned_to=v_uid OR public.workforce_is_manager()) THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
 IF a.status NOT IN ('in_progress','blocked','submitted') THEN RETURN jsonb_build_object('ok',false,'reason','invalid_transition','current_status',a.status); END IF;
 IF a.operational_record_table IS NOT NULL AND a.operational_record_table<>p_table THEN
   RETURN jsonb_build_object('ok',false,'reason','record_type_mismatch','expected',a.operational_record_table); END IF;
 EXECUTE format('SELECT true, upper(regexp_replace(btrim(asset_no),''\s+'','''',''g'')) FROM public.%I WHERE id=$1 AND organisation_id=$2',p_table)
   INTO v_found,v_asset USING p_record_id,v_org;
 IF NOT coalesce(v_found,false) THEN RETURN jsonb_build_object('ok',false,'reason','record_not_found'); END IF;
 IF a.asset_no IS NOT NULL AND v_asset IS DISTINCT FROM a.asset_no THEN
   RETURN jsonb_build_object('ok',false,'reason','asset_mismatch','record_asset',v_asset); END IF;
 -- One operational record backs one assignment: a second task cannot claim the same replacement.
 IF EXISTS(SELECT 1 FROM public.workforce_assignments x WHERE x.organisation_id=v_org AND x.operational_record_id=p_record_id AND x.id<>a.id AND x.status<>'cancelled') THEN
   RETURN jsonb_build_object('ok',false,'reason','record_already_linked'); END IF;
 PERFORM set_config('workforce.via','link',true);
 UPDATE public.workforce_assignments SET operational_record_table=p_table, operational_record_id=p_record_id WHERE id=a.id;
 PERFORM set_config('workforce.via','',true);
 INSERT INTO public.workforce_assignment_events(organisation_id,assignment_id,actor_id,action,from_status,to_status,idempotency_key,occurred_at,effective_at,detail)
 VALUES(v_org,a.id,v_uid,'link_record',a.status,a.status,btrim(p_idempotency_key),now(),now(),jsonb_build_object('table',p_table,'record_id',p_record_id,'previous',a.operational_record_id)) RETURNING id INTO v_new;
 RETURN jsonb_build_object('ok',true,'result','applied','event_id',v_new);
END $$;
REVOKE ALL ON FUNCTION public.workforce_link_operational_record(uuid,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workforce_link_operational_record(uuid,text,uuid,text) TO authenticated;

-- 12. Recommendation: explains, never assigns. Ordered by fit, then by current open workload.
CREATE OR REPLACE FUNCTION public.workforce_recommend_assignees(p_task_type text,p_site text DEFAULT NULL,p_due_at timestamptz DEFAULT NULL,p_limit int DEFAULT 10)
RETURNS TABLE(profile_id uuid,full_name text,employee_id text,designation text,qualified boolean,safety_blocked boolean,
 reasons jsonb,open_assignments int,due_same_day int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
#variable_conflict use_column
DECLARE v_org uuid:=public.app_current_org();
BEGIN
 IF NOT public.workforce_is_manager() THEN RETURN; END IF;
 RETURN QUERY
 WITH c AS (
  SELECT p.id,p.full_name,p.employee_id,public.workforce_qualification(p.id,p_task_type,p_site,coalesce(p_due_at,now())) q
  FROM public.profiles p WHERE p.organisation_id=v_org AND coalesce(p.approved,true) AND NOT coalesce(p.locked,false)
 ), load AS (
  SELECT w.assigned_to,count(*)::int n,
   count(*) FILTER (WHERE p_due_at IS NOT NULL AND w.due_at::date=p_due_at::date)::int same_day
  FROM public.workforce_assignments w WHERE w.organisation_id=v_org AND w.status IN ('assigned','acknowledged','in_progress','blocked')
  GROUP BY 1)
 SELECT c.id,c.full_name,c.employee_id,c.q->>'designation',(c.q->>'qualified')::boolean,(c.q->>'safety_blocked')::boolean,
  (c.q->'hard')||(c.q->'soft'),coalesce(l.n,0),coalesce(l.same_day,0)
 FROM c LEFT JOIN load l ON l.assigned_to=c.id
 WHERE c.q->>'ok'='true'
 ORDER BY (c.q->>'safety_blocked')::boolean, (c.q->>'qualified')::boolean DESC, jsonb_array_length(c.q->'soft'), coalesce(l.n,0), c.full_name
 LIMIT greatest(1,least(coalesce(p_limit,10),50));
END $$;
REVOKE ALL ON FUNCTION public.workforce_recommend_assignees(text,text,timestamptz,int) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workforce_recommend_assignees(text,text,timestamptz,int) TO authenticated;

-- 13. Board summary over the COMPLETE visible dataset (RLS decides what "visible" is).
CREATE OR REPLACE FUNCTION public.workforce_board_summary(p_from date DEFAULT NULL,p_to date DEFAULT NULL,p_site text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public SET plan_cache_mode=force_custom_plan AS $$
 WITH w AS (
  SELECT * FROM public.workforce_assignments
  WHERE (p_from IS NULL OR created_at>=p_from) AND (p_to IS NULL OR created_at<p_to+1)
    AND (nullif(btrim(p_site),'') IS NULL OR upper(site)=upper(btrim(p_site)))),
 e AS (SELECT ev.* FROM public.workforce_assignment_events ev JOIN w ON w.id=ev.assignment_id)
 SELECT jsonb_build_object(
  'total',(SELECT count(*) FROM w),
  'by_status',coalesce((SELECT jsonb_object_agg(status,n) FROM (SELECT status,count(*) n FROM w GROUP BY 1) s),'{}'::jsonb),
  'overdue',(SELECT count(*) FROM w WHERE due_at<now() AND status NOT IN ('verified','cancelled')),
  'override_count',(SELECT count(*) FROM w WHERE override_reason IS NOT NULL),
  'rework_returns',(SELECT count(*) FROM e WHERE action='return'),
  'reassignments',(SELECT count(*) FROM e WHERE action='reassign'),
  'blocked_by_reason',coalesce((SELECT jsonb_object_agg(r,n) FROM (SELECT coalesce(reason_code,'not_recorded') r,count(*) n FROM e WHERE action='block' GROUP BY 1) b),'{}'::jsonb),
  'verified_missing_record',(SELECT count(*) FROM w WHERE status='verified' AND operational_record_table IS NOT NULL AND operational_record_id IS NULL),
  'latest_change',(SELECT max(updated_at) FROM w),
  'generated_at',now())
$$;
REVOKE ALL ON FUNCTION public.workforce_board_summary(date,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workforce_board_summary(date,date,text) TO authenticated;
