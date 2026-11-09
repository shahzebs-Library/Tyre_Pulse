-- Workforce time & activity accounting: explainable daily time categories, server-side interval
-- integrity across reports, assignment-linked activity, and authorised corrections that never
-- overwrite the original record.
-- STATUS: APPLIED LIVE 2026-11-09 (migration workforce_time_accounting). Additive. workforce_daily_reports / workforce_daily_entries held
-- 0 rows on 2026-11-09 (measured), so the stricter guard cannot invalidate a stored row.
--
-- TIMEZONE RULE (load-bearing): every interval is a timestamptz instant. A report's work_date is a
-- calendar day in Asia/Riyadh, which is a FIXED UTC+03:00 offset with no daylight saving (none since
-- the 1950s). The day of an instant is therefore computed as ((ts AT TIME ZONE 'UTC') + 3h)::date by
-- public.workforce_riyadh_date(), deliberately not via a tzdata lookup, so the rule is identical on
-- every server and in PGlite tests. An entry must start no earlier than work_date-1 and end no later
-- than work_date+1 (Riyadh days), which covers night shifts that cross midnight in either direction.
-- UAE (+04) and Egypt (+02/+03) crews still fall inside the +/-1 day window.
--
-- What the guard now refuses (server side, every write path including the correction RPC):
--   * ended_at <= started_at, an interval longer than 16 hours, an instant more than 5 minutes in the
--     future, and an interval outside the work_date +/- 1 day window (Riyadh).
--   * an interval overlapping ANY other entry of the same employee, across reports, so the same
--     minutes can never be recorded twice. Back-to-back ([) half-open) is allowed. A per-employee
--     transaction advisory lock serialises concurrent writes so two parallel inserts cannot both pass.
--   * an assignment_id that is not in the same organisation or not assigned to the same employee.
--   * changing an entry's identity (report_id, employee_id, organisation_id) or its correction stamps.
--   * any edit while the report is submitted/verified, EXCEPT inside workforce_correct_daily_entry,
--     which first writes the correction ledger row in the same transaction (the guard checks for it,
--     so no client can fake the bypass: the ledger has no client INSERT grant).
--
-- Missing records are never idle: the database stores only what someone recorded; gaps are reported by
-- the client accounting engine (src/lib/workforceTimeAccounting.js) as 'not_recorded'.
--
-- ROLLBACK:
--   drop function public.workforce_correct_daily_entry(uuid,jsonb,text,text);
--   drop trigger workforce_entry_correction_append_only on public.workforce_daily_entry_corrections;
--   drop function public.workforce_entry_correction_append_only();
--   drop table public.workforce_daily_entry_corrections;
--   alter table public.workforce_daily_entries drop constraint workforce_daily_entries_category_v2;
--   delete/convert rows using the new categories, then
--   alter table public.workforce_daily_entries add constraint workforce_daily_entries_category_check
--     check (category in ('productive','coordination','reporting','training','break','blocked','unassigned'));
--   alter table public.workforce_daily_entries drop column assignment_id, drop column correction_count,
--     drop column last_corrected_at, drop column last_corrected_by;
--   drop function public.workforce_riyadh_date(timestamptz);
--   then re-create public.workforce_guard_daily_entry() from 20261022093000_workforce_daily_work.sql.

-- 1. Day-of-instant helper (fixed Riyadh offset, see header).
CREATE OR REPLACE FUNCTION public.workforce_riyadh_date(p_ts timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
 SELECT ((p_ts AT TIME ZONE 'UTC') + interval '3 hours')::date $$;
REVOKE ALL ON FUNCTION public.workforce_riyadh_date(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workforce_riyadh_date(timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.workforce_riyadh_date(timestamptz) TO authenticated;

-- 2. Wider category vocabulary. 'blocked' is kept for back-compat (existing clients write it).
DO $$
DECLARE c record;
BEGIN
 FOR c IN SELECT conname FROM pg_constraint
   WHERE conrelid='public.workforce_daily_entries'::regclass AND contype='c'
     AND pg_get_constraintdef(oid) ILIKE '%category%'
     AND pg_get_constraintdef(oid) NOT ILIKE '%blocked_reason%'
 LOOP
   EXECUTE format('ALTER TABLE public.workforce_daily_entries DROP CONSTRAINT %I', c.conname);
 END LOOP;
END $$;
ALTER TABLE public.workforce_daily_entries ADD CONSTRAINT workforce_daily_entries_category_v2 CHECK (category IN (
 'productive','coordination','reporting','training','break','blocked','unassigned',
 'travel','waiting_stock','waiting_equipment','vehicle_unavailable','safety_hold'));

-- 3. Assignment link + correction stamps (set only by the correction RPC).
ALTER TABLE public.workforce_daily_entries
 ADD COLUMN IF NOT EXISTS assignment_id uuid REFERENCES public.workforce_assignments(id) ON DELETE RESTRICT,
 ADD COLUMN IF NOT EXISTS correction_count integer NOT NULL DEFAULT 0 CHECK (correction_count >= 0),
 ADD COLUMN IF NOT EXISTS last_corrected_at timestamptz,
 ADD COLUMN IF NOT EXISTS last_corrected_by uuid;
CREATE INDEX IF NOT EXISTS workforce_entries_employee_time
 ON public.workforce_daily_entries(organisation_id, employee_id, started_at, ended_at);
CREATE INDEX IF NOT EXISTS workforce_entries_assignment
 ON public.workforce_daily_entries(assignment_id) WHERE assignment_id IS NOT NULL;

-- 4. Append-only correction ledger. Every row keeps the full entry exactly as it was before that
-- correction, so the first row for an entry is the original as the employee submitted it.
CREATE TABLE IF NOT EXISTS public.workforce_daily_entry_corrections(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL,
 entry_id uuid NOT NULL REFERENCES public.workforce_daily_entries(id) ON DELETE RESTRICT,
 report_id uuid NOT NULL REFERENCES public.workforce_daily_reports(id) ON DELETE RESTRICT,
 employee_id uuid NOT NULL,
 original jsonb NOT NULL,
 patch jsonb NOT NULL,
 corrected jsonb NOT NULL,
 reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 1000),
 corrected_by uuid NOT NULL,
 corrected_at timestamptz NOT NULL DEFAULT now(),
 idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 100),
 xact_id bigint NOT NULL DEFAULT txid_current(),
 UNIQUE (corrected_by, idempotency_key),
 CHECK (corrected_by <> employee_id)
);
CREATE INDEX IF NOT EXISTS workforce_entry_corrections_entry
 ON public.workforce_daily_entry_corrections(entry_id, corrected_at);
ALTER TABLE public.workforce_daily_entry_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workforce_entry_corrections_org ON public.workforce_daily_entry_corrections;
CREATE POLICY workforce_entry_corrections_org ON public.workforce_daily_entry_corrections AS RESTRICTIVE FOR ALL
 USING (organisation_id=public.app_current_org()) WITH CHECK (organisation_id=public.app_current_org());
DROP POLICY IF EXISTS workforce_entry_corrections_read ON public.workforce_daily_entry_corrections;
CREATE POLICY workforce_entry_corrections_read ON public.workforce_daily_entry_corrections FOR SELECT TO authenticated
 USING (employee_id=auth.uid() OR public.workforce_is_manager());
REVOKE ALL ON public.workforce_daily_entry_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.workforce_daily_entry_corrections TO authenticated;

CREATE OR REPLACE FUNCTION public.workforce_entry_correction_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 RAISE EXCEPTION 'Correction history is append-only' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION public.workforce_entry_correction_append_only() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS workforce_entry_correction_append_only ON public.workforce_daily_entry_corrections;
CREATE TRIGGER workforce_entry_correction_append_only BEFORE UPDATE OR DELETE ON public.workforce_daily_entry_corrections
FOR EACH ROW EXECUTE FUNCTION public.workforce_entry_correction_append_only();

-- 5. The entry guard (replaces the 20261022093000 body; keeps every rule it had).
CREATE OR REPLACE FUNCTION public.workforce_guard_daily_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.workforce_daily_reports; v_correction boolean;
BEGIN
 SELECT * INTO r FROM public.workforce_daily_reports WHERE id=NEW.report_id;
 IF NOT FOUND OR r.organisation_id IS DISTINCT FROM NEW.organisation_id OR r.employee_id IS DISTINCT FROM NEW.employee_id
 THEN RAISE EXCEPTION 'Entry/report identity mismatch' USING ERRCODE='42501'; END IF;

 v_correction := TG_OP='UPDATE' AND EXISTS(
   SELECT 1 FROM public.workforce_daily_entry_corrections c WHERE c.entry_id=NEW.id AND c.xact_id=txid_current());

 IF TG_OP='UPDATE' THEN
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.report_id IS DISTINCT FROM OLD.report_id
      OR NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
   THEN RAISE EXCEPTION 'Entry identity cannot be changed' USING ERRCODE='42501'; END IF;
   IF NOT v_correction AND (NEW.correction_count IS DISTINCT FROM OLD.correction_count
      OR NEW.last_corrected_at IS DISTINCT FROM OLD.last_corrected_at OR NEW.last_corrected_by IS DISTINCT FROM OLD.last_corrected_by)
   THEN RAISE EXCEPTION 'Correction stamps are set only by an authorised correction' USING ERRCODE='42501'; END IF;
 ELSIF NEW.correction_count<>0 OR NEW.last_corrected_at IS NOT NULL OR NEW.last_corrected_by IS NOT NULL THEN
   RAISE EXCEPTION 'Correction stamps are set only by an authorised correction' USING ERRCODE='42501';
 END IF;

 IF NOT v_correction AND r.status NOT IN ('draft','returned') THEN
   RAISE EXCEPTION 'Submitted or verified reports cannot be edited' USING ERRCODE='42501'; END IF;
 IF v_correction AND r.status NOT IN ('submitted','returned') THEN
   RAISE EXCEPTION 'Only submitted or returned reports can be corrected' USING ERRCODE='42501'; END IF;

 -- Impossible intervals.
 IF NEW.started_at IS NULL OR NEW.ended_at IS NULL OR NEW.ended_at<=NEW.started_at THEN
   RAISE EXCEPTION 'Activity must end after it starts' USING ERRCODE='23514'; END IF;
 IF NEW.ended_at-NEW.started_at > interval '16 hours' THEN
   RAISE EXCEPTION 'Activity longer than 16 hours is not possible' USING ERRCODE='23514'; END IF;
 IF NEW.started_at > now()+interval '5 minutes' OR NEW.ended_at > now()+interval '5 minutes' THEN
   RAISE EXCEPTION 'Activity cannot be in the future' USING ERRCODE='23514'; END IF;
 IF public.workforce_riyadh_date(NEW.started_at) < r.work_date-1
    OR public.workforce_riyadh_date(NEW.ended_at) > r.work_date+1 THEN
   RAISE EXCEPTION 'Activity does not belong to workday' USING ERRCODE='23514'; END IF;
 IF NEW.category='blocked' AND nullif(btrim(NEW.blocked_reason),'') IS NULL THEN
   RAISE EXCEPTION 'Blocked time requires a reason' USING ERRCODE='23514'; END IF;

 -- Assignment link: same organisation and assigned to this employee. Checked only when it changes,
 -- so a later reassignment never invalidates time already recorded against it.
 IF NEW.assignment_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id) THEN
   IF NOT EXISTS(SELECT 1 FROM public.workforce_assignments a
                 WHERE a.id=NEW.assignment_id AND a.organisation_id=NEW.organisation_id AND a.assigned_to=NEW.employee_id)
   THEN RAISE EXCEPTION 'Activity can only be linked to work assigned to this employee' USING ERRCODE='42501'; END IF;
 END IF;

 -- No double-counted minutes: overlap check across ALL of this employee's reports, serialised.
 PERFORM pg_advisory_xact_lock(hashtext('workforce_entry:'||NEW.organisation_id::text||':'||NEW.employee_id::text));
 IF EXISTS(SELECT 1 FROM public.workforce_daily_entries e
           WHERE e.organisation_id=NEW.organisation_id AND e.employee_id=NEW.employee_id
             AND e.id IS DISTINCT FROM NEW.id
             AND e.started_at < NEW.ended_at AND e.ended_at > NEW.started_at)
 THEN RAISE EXCEPTION 'Overlapping activity' USING ERRCODE='23P01'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workforce_guard_daily_entry() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER workforce_entry_guard BEFORE INSERT OR UPDATE ON public.workforce_daily_entries
FOR EACH ROW EXECUTE FUNCTION public.workforce_guard_daily_entry();

-- 6. Authorised correction. Manager/Director/Admin only, never their own entries, report must be
-- submitted or returned. The original is kept in the ledger; the guard re-runs every rule above.
CREATE OR REPLACE FUNCTION public.workforce_correct_daily_entry(
 p_entry_id uuid, p_patch jsonb, p_reason text, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
 v_uid uuid := auth.uid(); v_org uuid := public.app_current_org();
 v_key text := btrim(coalesce(p_idempotency_key,'')); v_reason text := btrim(coalesce(p_reason,''));
 e public.workforce_daily_entries; r public.workforce_daily_reports; prior public.workforce_daily_entry_corrections;
 v_allowed text[] := ARRAY['title','details','deliverable','category','started_at','ended_at','blocked_reason','assignment_id'];
 v_bad text; v_new jsonb; v_id uuid; v_out public.workforce_daily_entries;
BEGIN
 IF v_uid IS NULL OR v_org IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 IF char_length(v_key) NOT BETWEEN 8 AND 100 THEN
   RAISE EXCEPTION 'A valid idempotency key is required' USING ERRCODE='22023'; END IF;

 SELECT * INTO prior FROM public.workforce_daily_entry_corrections WHERE corrected_by=v_uid AND idempotency_key=v_key;
 IF FOUND THEN
   IF prior.entry_id IS DISTINCT FROM p_entry_id OR prior.patch IS DISTINCT FROM coalesce(p_patch,'{}'::jsonb) THEN
     RAISE EXCEPTION 'Idempotency key already used for a different correction' USING ERRCODE='22023'; END IF;
   RETURN jsonb_build_object('ok',true,'replayed',true,'correction_id',prior.id,'entry_id',prior.entry_id,
     'original',prior.original,'corrected',prior.corrected);
 END IF;

 IF NOT public.workforce_is_manager() THEN
   RAISE EXCEPTION 'Only a manager can correct recorded activity' USING ERRCODE='42501'; END IF;
 IF char_length(v_reason) NOT BETWEEN 5 AND 1000 THEN
   RAISE EXCEPTION 'A correction reason is required' USING ERRCODE='22023'; END IF;
 IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::jsonb THEN
   RAISE EXCEPTION 'Nothing to correct' USING ERRCODE='22023'; END IF;
 SELECT k INTO v_bad FROM jsonb_object_keys(p_patch) k WHERE k <> ALL(v_allowed) LIMIT 1;
 IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'Field cannot be corrected: %', v_bad USING ERRCODE='22023'; END IF;

 SELECT * INTO e FROM public.workforce_daily_entries WHERE id=p_entry_id AND organisation_id=v_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Activity not found' USING ERRCODE='42501'; END IF;
 IF e.employee_id=v_uid THEN
   RAISE EXCEPTION 'You cannot correct your own recorded activity' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.workforce_daily_reports WHERE id=e.report_id FOR UPDATE;
 IF r.status NOT IN ('submitted','returned') THEN
   RAISE EXCEPTION 'Only submitted or returned reports can be corrected' USING ERRCODE='42501'; END IF;

 v_new := to_jsonb(e) || p_patch;
 -- Ledger first: its presence in this transaction is what lets the guard accept the edit.
 INSERT INTO public.workforce_daily_entry_corrections(organisation_id,entry_id,report_id,employee_id,original,patch,corrected,
   reason,corrected_by,idempotency_key)
 VALUES (e.organisation_id,e.id,e.report_id,e.employee_id,to_jsonb(e),p_patch,v_new,v_reason,v_uid,v_key)
 RETURNING id INTO v_id;

 UPDATE public.workforce_daily_entries SET
   title = CASE WHEN p_patch ? 'title' THEN btrim(p_patch->>'title') ELSE title END,
   details = CASE WHEN p_patch ? 'details' THEN coalesce(p_patch->>'details','') ELSE details END,
   deliverable = CASE WHEN p_patch ? 'deliverable' THEN p_patch->>'deliverable' ELSE deliverable END,
   category = CASE WHEN p_patch ? 'category' THEN p_patch->>'category' ELSE category END,
   started_at = CASE WHEN p_patch ? 'started_at' THEN (p_patch->>'started_at')::timestamptz ELSE started_at END,
   ended_at = CASE WHEN p_patch ? 'ended_at' THEN (p_patch->>'ended_at')::timestamptz ELSE ended_at END,
   blocked_reason = CASE WHEN p_patch ? 'blocked_reason' THEN p_patch->>'blocked_reason' ELSE blocked_reason END,
   assignment_id = CASE WHEN p_patch ? 'assignment_id' THEN (p_patch->>'assignment_id')::uuid ELSE assignment_id END,
   correction_count = correction_count+1, last_corrected_at = now(), last_corrected_by = v_uid
 WHERE id=e.id RETURNING * INTO v_out;

 RETURN jsonb_build_object('ok',true,'replayed',false,'correction_id',v_id,'entry_id',e.id,
   'original',to_jsonb(e),'corrected',to_jsonb(v_out));
END $$;
REVOKE ALL ON FUNCTION public.workforce_correct_daily_entry(uuid,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workforce_correct_daily_entry(uuid,jsonb,text,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.workforce_correct_daily_entry(uuid,jsonb,text,text) TO authenticated;
