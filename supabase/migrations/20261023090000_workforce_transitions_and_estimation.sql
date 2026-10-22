-- Workforce assignments: audited idempotent transitions + historical duration estimation.
-- STATUS: AUTHORED, NOT APPLIED. Review with database-migration-safety before applying.
--
-- Additive only: three nullable columns, one append-only event table, one view, two functions,
-- and a replacement of workforce_assignment_guard() (adds the new columns to the employee
-- immutable-field list; every other rule is identical to 20261022113000).
-- No UPDATE/DELETE over existing rows, no data backfill (new columns stay NULL for old rows,
-- which are simply excluded from estimates: "not enough history" is the honest answer).
--
-- ROLLBACK (manual, nothing else depends on these objects yet):
--   DROP FUNCTION public.workforce_duration_estimate(text,text,text,numeric,numeric);
--   DROP VIEW public.workforce_assignment_durations;
--   DROP FUNCTION public.workforce_assignment_transition(uuid,text,text,text,timestamptz);
--   DROP TABLE public.workforce_assignment_events;
--   DROP TRIGGER workforce_assignment_classify ON public.workforce_assignments;
--   DROP FUNCTION public.workforce_assignment_classify();
--   ALTER TABLE public.workforce_assignments DROP COLUMN task_type, DROP COLUMN vehicle_type, DROP COLUMN assignee_role;
--   -- then re-apply the guard body from 20261022113000_workforce_transition_guard.sql

-- 1. Classification columns used for estimation (set by the manager at assignment creation).
ALTER TABLE public.workforce_assignments
  ADD COLUMN IF NOT EXISTS task_type text,
  ADD COLUMN IF NOT EXISTS vehicle_type text,
  ADD COLUMN IF NOT EXISTS assignee_role text;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='workforce_assignments_classification_len') THEN
  ALTER TABLE public.workforce_assignments ADD CONSTRAINT workforce_assignments_classification_len
   CHECK (char_length(task_type)<=80 AND char_length(vehicle_type)<=80 AND char_length(assignee_role)<=80);
 END IF;
END $$;

-- Canonical forms: task_type lower-case, vehicle_type UPPER (same convention as V245), blanks -> NULL.
-- assignee_role is a snapshot of profiles.role at creation so a later promotion does not rewrite history.
CREATE OR REPLACE FUNCTION public.workforce_assignment_classify() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 NEW.task_type=nullif(lower(regexp_replace(btrim(NEW.task_type),'\s+',' ','g')),'');
 NEW.vehicle_type=nullif(upper(regexp_replace(btrim(NEW.vehicle_type),'\s+',' ','g')),'');
 IF TG_OP='INSERT' THEN
   NEW.assignee_role=coalesce(nullif(btrim(NEW.assignee_role),''),(SELECT p.role FROM public.profiles p WHERE p.id=NEW.assigned_to));
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workforce_assignment_classify ON public.workforce_assignments;
CREATE TRIGGER workforce_assignment_classify BEFORE INSERT OR UPDATE ON public.workforce_assignments
FOR EACH ROW EXECUTE FUNCTION public.workforce_assignment_classify();

-- 2. Guard: identical to 20261022113000 plus the three new columns in the employee read-only list.
CREATE OR REPLACE FUNCTION public.workforce_assignment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE is_manager boolean;
BEGIN
 IF TG_OP='UPDATE' THEN
   is_manager=public.workforce_is_manager();
   IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
   THEN RAISE EXCEPTION 'Assignment ownership is immutable'; END IF;
   IF OLD.status IN ('verified','cancelled') THEN RAISE EXCEPTION 'Closed assignments are immutable'; END IF;
   IF NOT is_manager THEN
     IF (OLD.status='assigned' AND NEW.status NOT IN ('acknowledged','in_progress')) OR
        (OLD.status='acknowledged' AND NEW.status NOT IN ('in_progress','blocked')) OR
        (OLD.status='in_progress' AND NEW.status NOT IN ('blocked','submitted')) OR
        (OLD.status='blocked' AND NEW.status NOT IN ('in_progress','submitted'))
     THEN RAISE EXCEPTION 'Invalid employee assignment transition'; END IF;
     IF ROW(NEW.title,NEW.instructions,NEW.site,NEW.priority,NEW.due_at,NEW.estimated_minutes,NEW.source_module,NEW.source_record_id,NEW.created_at,NEW.task_type,NEW.vehicle_type,NEW.assignee_role)
        IS DISTINCT FROM ROW(OLD.title,OLD.instructions,OLD.site,OLD.priority,OLD.due_at,OLD.estimated_minutes,OLD.source_module,OLD.source_record_id,OLD.created_at,OLD.task_type,OLD.vehicle_type,OLD.assignee_role)
     THEN RAISE EXCEPTION 'Employees may change assignment status only'; END IF;
   END IF;
   NEW.updated_at=now();
 END IF;
 RETURN NEW;
END $$;

-- 2b. SECURITY FIX. The create policy from 20261022112500 compared `p.organisation_id=organisation_id`
-- inside the EXISTS subquery. An unqualified column resolves to the innermost scope (profiles p), so
-- the test was `p.organisation_id=p.organisation_id` (always true) and a manager could assign work to
-- an employee of ANOTHER organisation (proven in supabase/tests/workforce_assignment_permissions.test.mjs).
-- The assignee must belong to the assignment's organisation and be an approved, unlocked account.
-- Rollback: re-create the policy from 20261022112500 (restores the defect; do not).
DROP POLICY IF EXISTS workforce_assignments_create ON public.workforce_assignments;
CREATE POLICY workforce_assignments_create ON public.workforce_assignments FOR INSERT TO authenticated
WITH CHECK(public.workforce_is_manager() AND assigned_by=auth.uid() AND EXISTS(
  SELECT 1 FROM public.profiles p
  WHERE p.id=workforce_assignments.assigned_to AND p.organisation_id=workforce_assignments.organisation_id
    AND coalesce(p.approved,true) AND NOT coalesce(p.locked,false)));

-- 2c. FUNCTIONAL FIX. 20261022112500 let Managers/Directors read workforce_evidence ROWS but the
-- storage.objects select policy still used app_is_org_admin() (Admin only), so a manager saw the
-- evidence list yet could not open any file. Same condition, workforce_is_manager() instead.
-- Rollback: re-create the policy from 20261022104000.
DROP POLICY IF EXISTS workforce_files_select ON storage.objects;
CREATE POLICY workforce_files_select ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='workforce-evidence' AND EXISTS(
 SELECT 1 FROM public.workforce_evidence e
 WHERE e.object_path=name AND e.organisation_id=public.app_current_org() AND
 (e.employee_id=auth.uid() OR public.workforce_is_manager())));

-- 3. Append-only transition ledger. Written ONLY by workforce_assignment_transition().
CREATE TABLE IF NOT EXISTS public.workforce_assignment_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL,
 assignment_id uuid NOT NULL REFERENCES public.workforce_assignments(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('accept','start','block','resume','complete','verify','return','cancel')),
 from_status text NOT NULL,
 to_status text NOT NULL,
 note text CHECK(note IS NULL OR char_length(note)<=2000),
 idempotency_key text NOT NULL CHECK(char_length(idempotency_key) BETWEEN 8 AND 100),
 client_at timestamptz,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 effective_at timestamptz NOT NULL DEFAULT now(),
 CHECK(action NOT IN ('block','return','cancel') OR nullif(btrim(note),'') IS NOT NULL),
 UNIQUE(actor_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS workforce_assignment_events_assignment ON public.workforce_assignment_events(assignment_id,effective_at);
ALTER TABLE public.workforce_assignment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY workforce_assignment_events_org ON public.workforce_assignment_events AS RESTRICTIVE FOR ALL
 USING(organisation_id=public.app_current_org()) WITH CHECK(organisation_id=public.app_current_org());
CREATE POLICY workforce_assignment_events_read ON public.workforce_assignment_events FOR SELECT TO authenticated
 USING(public.workforce_is_manager() OR EXISTS(SELECT 1 FROM public.workforce_assignments a WHERE a.id=assignment_id AND a.assigned_to=auth.uid()));
REVOKE ALL ON public.workforce_assignment_events FROM anon,authenticated;
GRANT SELECT ON public.workforce_assignment_events TO authenticated;
CREATE OR REPLACE FUNCTION public.workforce_assignment_events_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Assignment events are append-only'; END $$;
DROP TRIGGER IF EXISTS workforce_assignment_events_immutable ON public.workforce_assignment_events;
CREATE TRIGGER workforce_assignment_events_immutable BEFORE UPDATE OR DELETE ON public.workforce_assignment_events
FOR EACH ROW EXECUTE FUNCTION public.workforce_assignment_events_immutable();

-- 4. Idempotent transition RPC. Domain refusals are RETURNED (ok=false) so an offline client can
-- reconcile them; only malformed input / missing session raises.
-- result: applied | replayed | already_applied | rejected
CREATE OR REPLACE FUNCTION public.workforce_assignment_transition(
 p_assignment_id uuid, p_action text, p_idempotency_key text,
 p_note text DEFAULT NULL, p_client_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_uid uuid:=auth.uid(); v_org uuid; a public.workforce_assignments; ev public.workforce_assignment_events;
 v_note text:=nullif(btrim(p_note),''); v_from text[]; v_to text; v_manager_action boolean:=false;
 v_is_mgr boolean; v_prev timestamptz; v_eff timestamptz; v_now timestamptz:=now(); v_new uuid;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='28000'; END IF;
 IF p_idempotency_key IS NULL OR char_length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 100 THEN
   RAISE EXCEPTION 'A valid idempotency key is required' USING ERRCODE='22023'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('accept','start','block','resume','complete','verify','return','cancel') THEN
   RAISE EXCEPTION 'Unknown assignment action' USING ERRCODE='22023'; END IF;
 v_org:=public.app_current_org();
 IF v_org IS NULL THEN RAISE EXCEPTION 'No organisation for this account' USING ERRCODE='42501'; END IF;
 -- Serialise concurrent calls on the same assignment before deciding anything.
 SELECT * INTO a FROM public.workforce_assignments WHERE id=p_assignment_id AND organisation_id=v_org FOR UPDATE;
 -- Replay check AFTER the lock so two concurrent sends of one key cannot both look "new".
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
   IF p_action IN ('verify','return') AND a.assigned_to=v_uid THEN
     RETURN jsonb_build_object('ok',false,'result','rejected','reason','self_review'); END IF;
 ELSIF a.assigned_to IS DISTINCT FROM v_uid THEN
   -- Do not reveal that the assignment exists to anyone who is not its assignee.
   RETURN jsonb_build_object('ok',false,'result','rejected','reason',CASE WHEN v_is_mgr THEN 'forbidden' ELSE 'not_found' END);
 END IF;
 IF p_action IN ('block','return','cancel') AND v_note IS NULL THEN
   RETURN jsonb_build_object('ok',false,'result','rejected','reason','note_required','current_status',a.status); END IF;
 IF NOT (a.status = ANY(v_from)) THEN
   IF a.status=v_to OR (p_action='accept' AND a.status IN ('in_progress','blocked','submitted','verified')) THEN
     RETURN jsonb_build_object('ok',true,'result','already_applied','status',a.status);
   END IF;
   RETURN jsonb_build_object('ok',false,'result','rejected','reason','invalid_transition','current_status',a.status);
 END IF;
 -- effective_at: the client's clock bounded to [last event | created_at | 14 days ago, now].
 SELECT greatest(a.created_at,coalesce(max(e.effective_at),a.created_at)) INTO v_prev
   FROM public.workforce_assignment_events e WHERE e.assignment_id=a.id;
 v_eff:=CASE WHEN p_client_at IS NULL THEN v_now
        ELSE least(v_now,greatest(p_client_at,v_prev,v_now-interval '14 days')) END;
 UPDATE public.workforce_assignments SET status=v_to WHERE id=a.id;
 INSERT INTO public.workforce_assignment_events(organisation_id,assignment_id,actor_id,action,from_status,to_status,note,idempotency_key,client_at,occurred_at,effective_at)
 VALUES(v_org,a.id,v_uid,p_action,a.status,v_to,v_note,btrim(p_idempotency_key),p_client_at,v_now,v_eff) RETURNING id INTO v_new;
 RETURN jsonb_build_object('ok',true,'result','applied','status',v_to,'event_id',v_new);
END $$;
REVOKE ALL ON FUNCTION public.workforce_assignment_transition(uuid,text,text,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workforce_assignment_transition(uuid,text,text,text,timestamptz) TO authenticated;

-- 5. Completed-duration history: ACTIVE minutes only (time spent in_progress). Blocked and
-- waiting-for-review time are excluded. Assignments without events (completed through the legacy
-- direct status update) have no trustworthy timestamps and are NOT included.
CREATE OR REPLACE VIEW public.workforce_assignment_durations WITH (security_invoker=on) AS
WITH seq AS (
 SELECT e.assignment_id,e.action,e.to_status,e.effective_at,
        lead(e.effective_at) OVER w AS next_at,
        max(e.effective_at) FILTER (WHERE e.action='complete') OVER (PARTITION BY e.assignment_id) AS completed_at
 FROM public.workforce_assignment_events e
 WINDOW w AS (PARTITION BY e.assignment_id ORDER BY e.effective_at,e.occurred_at,e.id)
), spans AS (
 SELECT assignment_id,completed_at,
        sum(extract(epoch FROM (next_at-effective_at))/60.0)
          FILTER (WHERE to_status='in_progress' AND next_at IS NOT NULL AND effective_at<completed_at) AS active_minutes
 FROM seq GROUP BY assignment_id,completed_at
)
SELECT a.id AS assignment_id,a.organisation_id,a.task_type,a.vehicle_type,a.assignee_role,
       round(s.active_minutes::numeric,1) AS active_minutes,s.completed_at
FROM spans s JOIN public.workforce_assignments a ON a.id=s.assignment_id
WHERE s.completed_at IS NOT NULL AND s.active_minutes IS NOT NULL AND a.status IN ('submitted','verified');
REVOKE ALL ON public.workforce_assignment_durations FROM anon;
GRANT SELECT ON public.workforce_assignment_durations TO authenticated;

-- 6. Raw per-tier statistics. The decision (minimum sample size, confidence, wording) lives in
-- src/lib/workforceEstimate.js so it is one tested definition; SQL only aggregates.
-- Samples outside [p_min_minutes, p_max_minutes] are excluded as accidental taps / forgotten timers.
CREATE OR REPLACE FUNCTION public.workforce_duration_estimate(
 p_task_type text, p_vehicle_type text DEFAULT NULL, p_role text DEFAULT NULL,
 p_min_minutes numeric DEFAULT 1, p_max_minutes numeric DEFAULT 10080)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $$
DECLARE t text; v text; r text; tiers jsonb;
BEGIN
 IF NOT public.workforce_is_manager() THEN RAISE EXCEPTION 'Managers only' USING ERRCODE='42501'; END IF;
 t:=nullif(lower(regexp_replace(btrim(p_task_type),'\s+',' ','g')),'');
 v:=nullif(upper(regexp_replace(btrim(p_vehicle_type),'\s+',' ','g')),'');
 r:=nullif(btrim(p_role),'');
 IF t IS NULL THEN
   RETURN jsonb_build_object('task_type',NULL,'vehicle_type',v,'role',r,'min_minutes',p_min_minutes,'max_minutes',p_max_minutes,'tiers','[]'::jsonb);
 END IF;
 WITH base AS (
   SELECT d.active_minutes::float8 AS m,d.vehicle_type AS vt,d.assignee_role AS ar
   FROM public.workforce_assignment_durations d
   WHERE d.task_type=t AND d.active_minutes BETWEEN p_min_minutes AND p_max_minutes
 ), tiers(tier,use_v,use_r,ord) AS (
   VALUES ('task_vehicle_role',true,true,1),('task_vehicle',true,false,2),('task_role',false,true,3),('task',false,false,4)
 )
 SELECT jsonb_agg(jsonb_build_object('tier',s.tier,'n',s.n,'p25',s.p25,'median',s.med,'p75',s.p75,'p90',s.p90) ORDER BY s.ord) INTO tiers
 FROM (
   SELECT tr.tier,tr.ord,count(b.m) AS n,
          round((percentile_cont(0.25) WITHIN GROUP (ORDER BY b.m))::numeric,1) AS p25,
          round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY b.m))::numeric,1) AS med,
          round((percentile_cont(0.75) WITHIN GROUP (ORDER BY b.m))::numeric,1) AS p75,
          round((percentile_cont(0.9)  WITHIN GROUP (ORDER BY b.m))::numeric,1) AS p90
   FROM tiers tr LEFT JOIN base b
     ON (NOT tr.use_v OR (v IS NOT NULL AND b.vt=v)) AND (NOT tr.use_r OR (r IS NOT NULL AND b.ar=r))
   GROUP BY tr.tier,tr.ord
 ) s;
 RETURN jsonb_build_object('task_type',t,'vehicle_type',v,'role',r,'min_minutes',p_min_minutes,'max_minutes',p_max_minutes,'tiers',coalesce(tiers,'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.workforce_duration_estimate(text,text,text,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workforce_duration_estimate(text,text,text,numeric,numeric) TO authenticated;
