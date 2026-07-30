-- =============================================================================
-- V429 - Accident workstream loop: lifecycle timestamps + who-did-what audit trail
--
-- STATUS: APPLIED LIVE (project jhssdmeruxtrlqnwfksc), rolled-back-verified.
--
-- WHY. The case is a closed loop that stays open until every required team
-- finishes. accident_case_workstreams already had assigned_at / started_at /
-- completed_at columns but nothing populated them, there was no "who last touched
-- it", and no per-change ledger for the audit trail (who did what, when). This
-- migration adds all three: a BEFORE trigger stamps the lifecycle timestamps +
-- updated_by from the effective row status, and an AFTER trigger appends an
-- append-only event to accident_case_workstream_events for every meaningful change.
--
-- VERIFIED (rolled back): inserting a workstream then advancing it
-- assigned -> in_progress -> completed stamps assigned_at/started_at/completed_at
-- and writes three ledger rows (created, status_changed x2) each with actor + at.
-- =============================================================================

ALTER TABLE public.accident_case_workstreams
  ADD COLUMN IF NOT EXISTS updated_by uuid;

CREATE TABLE IF NOT EXISTS public.accident_case_workstream_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT app_current_org(),
  accident_id     uuid NOT NULL,
  country         text,
  site            text,
  workstream_key  text NOT NULL,
  action          text NOT NULL,       -- created | status_changed | assigned | na_marked | reopened
  from_status     text,
  to_status       text,
  from_owner      uuid,
  to_owner        uuid,
  note            text,
  actor_id        uuid,
  at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accident_ws_events_case_idx
  ON public.accident_case_workstream_events(accident_id, at DESC);

ALTER TABLE public.accident_case_workstream_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS acc_ws_events_org ON public.accident_case_workstream_events;
CREATE POLICY acc_ws_events_org ON public.accident_case_workstream_events
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (organisation_id = app_current_org())
  WITH CHECK (organisation_id = app_current_org());

DROP POLICY IF EXISTS acc_ws_events_select ON public.accident_case_workstream_events;
CREATE POLICY acc_ws_events_select ON public.accident_case_workstream_events
  FOR SELECT TO authenticated
  USING (app_can_see_country(country));

REVOKE INSERT, UPDATE, DELETE ON public.accident_case_workstream_events FROM authenticated, anon;
GRANT SELECT ON public.accident_case_workstream_events TO authenticated;

CREATE OR REPLACE FUNCTION public.accident_ws_stamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  IF NEW.owner_id IS NOT NULL AND NEW.assigned_at IS NULL THEN
    NEW.assigned_at := now();
  END IF;
  IF NEW.status IS NOT NULL
     AND NEW.status NOT IN ('not_started', 'not_required')
     AND NEW.started_at IS NULL THEN
    NEW.started_at := now();
  END IF;
  IF NEW.status = 'completed' THEN
    IF NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_accident_ws_stamp ON public.accident_case_workstreams;
CREATE TRIGGER trg_accident_ws_stamp
  BEFORE INSERT OR UPDATE ON public.accident_case_workstreams
  FOR EACH ROW EXECUTE FUNCTION public.accident_ws_stamp();

CREATE OR REPLACE FUNCTION public.accident_ws_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_action := CASE
      WHEN NEW.status = 'not_required' THEN 'na_marked'
      WHEN OLD.status = 'completed' AND NEW.status <> 'completed' THEN 'reopened'
      ELSE 'status_changed' END;
  ELSIF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    v_action := 'assigned';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.accident_case_workstream_events
    (organisation_id, accident_id, country, site, workstream_key, action,
     from_status, to_status, from_owner, to_owner, note, actor_id, at)
  VALUES
    (NEW.organisation_id, NEW.accident_id, NEW.country, NEW.site, NEW.workstream_key, v_action,
     CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
     CASE WHEN TG_OP = 'UPDATE' THEN OLD.owner_id END, NEW.owner_id,
     NEW.na_reason, COALESCE(auth.uid(), NEW.updated_by, NEW.created_by), now());
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.accident_ws_audit() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_accident_ws_audit ON public.accident_case_workstreams;
CREATE TRIGGER trg_accident_ws_audit
  AFTER INSERT OR UPDATE ON public.accident_case_workstreams
  FOR EACH ROW EXECUTE FUNCTION public.accident_ws_audit();

-- ROLLBACK:
--   DROP TRIGGER trg_accident_ws_audit ON public.accident_case_workstreams;
--   DROP TRIGGER trg_accident_ws_stamp ON public.accident_case_workstreams;
--   DROP FUNCTION public.accident_ws_audit(); DROP FUNCTION public.accident_ws_stamp();
--   DROP TABLE public.accident_case_workstream_events;
--   ALTER TABLE public.accident_case_workstreams DROP COLUMN updated_by;
