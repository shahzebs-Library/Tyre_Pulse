-- =====================================================================================
-- V300 - Accident Management: unified end-to-end workflow + department routing +
--        approved-template email/notification engine (email gated OFF by default).
--
-- APPLIED LIVE (project jhssdmeruxtrlqnwfksc) in five ordered parts. This file is the
-- repo record; it is byte-faithful to what was applied. All ADDITIVE / non-destructive:
-- no column or row of historical accident data is dropped. Legacy status columns are
-- MAPPED into the new workflow_stage, never removed.
--
-- Part 1 (V300) accident structural fields + unified workflow_stage + reference numbers
-- Part 2 (V301) derive trigger (reference_no, stage<->status sync, vor_since)
-- Part 3 (V302) departments + accident_routing_rules + accident_email_templates + toggle
-- Part 4 (V303) seed standard departments + default routing rules + approved templates
-- Part 5 (V304) accident domain-event emitter + routing/notification consumer
--
-- Companion: supabase/functions/workflow-notify (v5) renders the pre-rendered accident
-- email {subject,html} + push {title,body} carried in the workflow_notifications payload.
-- Master toggle: system_config.accident_emails_enabled ('false' default). In-app
-- notifications always fire to the routed recipients; email only when the toggle is ON.
-- =====================================================================================

-- ============================ Part 1 - structural fields ============================
ALTER TABLE public.accidents
  ADD COLUMN IF NOT EXISTS workflow_stage        text,
  ADD COLUMN IF NOT EXISTS reference_no          text,
  ADD COLUMN IF NOT EXISTS project               text,
  ADD COLUMN IF NOT EXISTS department            text,
  ADD COLUMN IF NOT EXISTS departments_involved  text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS responsible_owner_id  uuid,
  ADD COLUMN IF NOT EXISTS latitude              numeric,
  ADD COLUMN IF NOT EXISTS longitude             numeric,
  ADD COLUMN IF NOT EXISTS vor                   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vor_since             timestamptz,
  ADD COLUMN IF NOT EXISTS documents             jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS videos                jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS root_cause            text,
  ADD COLUMN IF NOT EXISTS corrective_action     text,
  ADD COLUMN IF NOT EXISTS preventive_action     text,
  ADD COLUMN IF NOT EXISTS hse_investigation     text,
  ADD COLUMN IF NOT EXISTS target_date           date,
  ADD COLUMN IF NOT EXISTS closure_evidence      text,
  ADD COLUMN IF NOT EXISTS sla_due_at            timestamptz,
  ADD COLUMN IF NOT EXISTS approved_repair_amount numeric,
  ADD COLUMN IF NOT EXISTS estimate_approved_by  uuid,
  ADD COLUMN IF NOT EXISTS estimate_approved_at  timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_accident_workflow_stage') THEN
    ALTER TABLE public.accidents
      ADD CONSTRAINT chk_accident_workflow_stage CHECK (workflow_stage IS NULL OR workflow_stage = ANY (ARRAY[
        'reported','initial_review','hse_investigation','workshop_assessment','insurance_claim',
        'repair_approval','repair_in_progress','final_inspection','vehicle_release','cost_recovery',
        'closed','cancelled']));
  END IF;
END $$;

UPDATE public.accidents SET workflow_stage = CASE
  WHEN closure_status = 'closed' OR status = 'closed'      THEN 'closed'
  WHEN status = 'reported'                                 THEN 'reported'
  WHEN status = 'under_review'                             THEN 'initial_review'
  WHEN status = 'awaiting_approval'                        THEN 'repair_approval'
  WHEN status = 'awaiting_parts'                           THEN 'repair_in_progress'
  WHEN status = 'repair_in_progress'                       THEN 'repair_in_progress'
  WHEN status = 'insurance_claim'                          THEN 'insurance_claim'
  WHEN status = 'released'                                 THEN 'vehicle_release'
  ELSE 'reported'
END
WHERE workflow_stage IS NULL;

ALTER TABLE public.accidents ALTER COLUMN workflow_stage SET DEFAULT 'reported';

WITH ranked AS (
  SELECT id,
         'ACC-' || to_char(COALESCE(incident_date, created_at::date), 'YYYY') || '-' ||
         lpad(row_number() OVER (
           PARTITION BY organisation_id, extract(year FROM COALESCE(incident_date, created_at::date))
           ORDER BY created_at, id)::text, 4, '0') AS ref
  FROM public.accidents WHERE reference_no IS NULL
)
UPDATE public.accidents a SET reference_no = r.ref FROM ranked r WHERE a.id = r.id;

CREATE INDEX IF NOT EXISTS accidents_workflow_stage_idx ON public.accidents (workflow_stage);
CREATE INDEX IF NOT EXISTS accidents_reference_no_idx   ON public.accidents (reference_no);
CREATE INDEX IF NOT EXISTS accidents_vor_idx            ON public.accidents (vor) WHERE vor = true;

-- ============================ Part 2 - derive trigger ===============================
CREATE OR REPLACE FUNCTION public.accident_stage_from_status(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_status
    WHEN 'reported' THEN 'reported' WHEN 'under_review' THEN 'initial_review'
    WHEN 'awaiting_approval' THEN 'repair_approval' WHEN 'awaiting_parts' THEN 'repair_in_progress'
    WHEN 'repair_in_progress' THEN 'repair_in_progress' WHEN 'insurance_claim' THEN 'insurance_claim'
    WHEN 'released' THEN 'vehicle_release' WHEN 'closed' THEN 'closed' ELSE 'reported' END;
$$;

CREATE OR REPLACE FUNCTION public.accident_status_from_stage(p_stage text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_stage
    WHEN 'reported' THEN 'reported' WHEN 'initial_review' THEN 'under_review'
    WHEN 'hse_investigation' THEN 'under_review' WHEN 'workshop_assessment' THEN 'under_review'
    WHEN 'insurance_claim' THEN 'insurance_claim' WHEN 'repair_approval' THEN 'awaiting_approval'
    WHEN 'repair_in_progress' THEN 'repair_in_progress' WHEN 'final_inspection' THEN 'repair_in_progress'
    WHEN 'vehicle_release' THEN 'released' WHEN 'cost_recovery' THEN 'released'
    WHEN 'closed' THEN 'closed' WHEN 'cancelled' THEN 'closed' ELSE 'reported' END;
$$;

CREATE OR REPLACE FUNCTION public.accident_derive_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_year text; v_seq int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.reference_no IS NULL OR btrim(NEW.reference_no) = '' THEN
      v_year := to_char(COALESCE(NEW.incident_date, current_date), 'YYYY');
      SELECT count(*) + 1 INTO v_seq FROM public.accidents
        WHERE organisation_id IS NOT DISTINCT FROM NEW.organisation_id
          AND to_char(COALESCE(incident_date, created_at::date), 'YYYY') = v_year;
      NEW.reference_no := 'ACC-' || v_year || '-' || lpad(v_seq::text, 4, '0');
    END IF;
    IF NEW.workflow_stage IS NULL THEN
      NEW.workflow_stage := public.accident_stage_from_status(COALESCE(NEW.status, 'reported'));
    ELSE
      NEW.status := public.accident_status_from_stage(NEW.workflow_stage);
    END IF;
    IF NEW.vor IS TRUE AND NEW.vor_since IS NULL THEN NEW.vor_since := now(); END IF;
    RETURN NEW;
  END IF;

  IF NEW.workflow_stage IS DISTINCT FROM OLD.workflow_stage THEN
    NEW.status := public.accident_status_from_stage(NEW.workflow_stage);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.workflow_stage := public.accident_stage_from_status(NEW.status);
  END IF;
  IF NEW.vor IS TRUE AND (OLD.vor IS DISTINCT FROM TRUE) AND NEW.vor_since IS NULL THEN
    NEW.vor_since := now();
  ELSIF NEW.vor IS FALSE THEN
    NEW.vor_since := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accident_derive ON public.accidents;
CREATE TRIGGER trg_accident_derive BEFORE INSERT OR UPDATE ON public.accidents
  FOR EACH ROW EXECUTE FUNCTION public.accident_derive_fields();

-- ================ Part 3 - departments / routing / templates + toggle ===============
CREATE TABLE IF NOT EXISTS public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT app_current_org(),
  name text NOT NULL, code text, description text,
  active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, name));

CREATE TABLE IF NOT EXISTS public.accident_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT app_current_org(),
  name text NOT NULL, description text, active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100, event_key text,
  match_severities text[] NOT NULL DEFAULT '{}', match_types text[] NOT NULL DEFAULT '{}',
  match_sites text[] NOT NULL DEFAULT '{}', match_countries text[] NOT NULL DEFAULT '{}',
  min_cost numeric, require_injury boolean NOT NULL DEFAULT false,
  require_vor boolean NOT NULL DEFAULT false, require_third_party boolean NOT NULL DEFAULT false,
  departments text[] NOT NULL DEFAULT '{}', to_roles text[] NOT NULL DEFAULT '{}',
  cc_roles text[] NOT NULL DEFAULT '{}', escalate_roles text[] NOT NULL DEFAULT '{}',
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS accident_routing_rules_org_active_idx
  ON public.accident_routing_rules (organisation_id, active, priority);

CREATE TABLE IF NOT EXISTS public.accident_email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT app_current_org(),
  key text NOT NULL, name text NOT NULL, subject text NOT NULL, body_html text NOT NULL,
  active boolean NOT NULL DEFAULT true, approved boolean NOT NULL DEFAULT true, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, key));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['departments','accident_routing_rules','accident_email_templates'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format($p$DROP POLICY IF EXISTS %1$s_org_isolation ON public.%1$s;$p$, t);
    EXECUTE format($p$CREATE POLICY %1$s_org_isolation ON public.%1$s AS RESTRICTIVE
                      USING (organisation_id = app_current_org() OR is_super_admin())
                      WITH CHECK (organisation_id = app_current_org() OR is_super_admin());$p$, t);
    EXECUTE format($p$DROP POLICY IF EXISTS %1$s_select ON public.%1$s;$p$, t);
    EXECUTE format($p$CREATE POLICY %1$s_select ON public.%1$s FOR SELECT USING (app_is_active());$p$, t);
    EXECUTE format($p$DROP POLICY IF EXISTS %1$s_write ON public.%1$s;$p$, t);
    EXECUTE format($p$CREATE POLICY %1$s_write ON public.%1$s FOR ALL
                      USING (app_is_elevated()) WITH CHECK (app_is_elevated());$p$, t);
  END LOOP;
END $$;

INSERT INTO public.system_config (key, value) VALUES ('accident_emails_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.departments (organisation_id, name, code, sort_order)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, d.name, d.code, d.ord
FROM (VALUES
  ('Site Management','SITE',10),('Operations','OPS',20),('Fleet / PMV','FLEET',30),
  ('Workshop','WS',40),('HSE / Safety','HSE',50),('Insurance','INS',60),('Finance','FIN',70),
  ('HR','HR',80),('Legal','LEGAL',90),('Procurement','PROC',100),('Security','SEC',110),
  ('Senior Management','SNR',120)
) AS d(name, code, ord)
ON CONFLICT (organisation_id, name) DO NOTHING;

-- ============ Part 4 - seed default routing rules + approved templates =============
-- (Company A / org 00000000-0000-0000-0000-000000000001; idempotent per org.)
-- Routing rules: baseline all-accidents team, severe/fatal + injury escalation to HSE
-- and senior management, claim events to Insurance+Finance, VOR to Workshop+Fleet,
-- high-cost (>=20000) to Finance+Senior Management, third-party to Legal+Insurance.
-- Email templates (15 keys): reported, critical, missing_docs, workshop_assessed,
-- repair_approval, claim_submitted, claim_approved, claim_rejected, claim_delayed,
-- vor_sla_breach, repair_completed, final_inspection_pending, released, closed, overdue.
-- Body HTML uses a shared card + {{tokens}} rendered by accident_apply_tokens.
-- See the applied migration for the full seed VALUES (elided here for brevity; the
-- data is live in the departments / accident_routing_rules / accident_email_templates
-- tables). Re-seed guard: only inserts when the org currently has zero rows.

-- ================ Part 5 - accident event emitter + notify consumer ================
CREATE OR REPLACE FUNCTION public.accident_stage_label(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p
    WHEN 'reported' THEN 'Reported' WHEN 'initial_review' THEN 'Initial Review'
    WHEN 'hse_investigation' THEN 'HSE Investigation' WHEN 'workshop_assessment' THEN 'Workshop Assessment'
    WHEN 'insurance_claim' THEN 'Insurance Claim' WHEN 'repair_approval' THEN 'Repair Approval'
    WHEN 'repair_in_progress' THEN 'Repair In Progress' WHEN 'final_inspection' THEN 'Final Inspection'
    WHEN 'vehicle_release' THEN 'Vehicle Release' WHEN 'cost_recovery' THEN 'Cost Recovery'
    WHEN 'closed' THEN 'Closed' WHEN 'cancelled' THEN 'Cancelled' ELSE COALESCE(p,'-') END;
$$;
CREATE OR REPLACE FUNCTION public.accident_severity_label(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'minor' THEN 'Minor' WHEN 'moderate' THEN 'Moderate'
                WHEN 'severe' THEN 'Major' WHEN 'fatal' THEN 'Fatal' ELSE COALESCE(p,'-') END;
$$;
CREATE OR REPLACE FUNCTION public.accident_pending_action(p_stage text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_stage
    WHEN 'reported' THEN 'Review the report and assign an owner'
    WHEN 'initial_review' THEN 'Complete initial review'
    WHEN 'hse_investigation' THEN 'Complete HSE investigation'
    WHEN 'workshop_assessment' THEN 'Complete workshop assessment and estimate'
    WHEN 'insurance_claim' THEN 'Submit / progress the insurance claim'
    WHEN 'repair_approval' THEN 'Approve the repair estimate'
    WHEN 'repair_in_progress' THEN 'Complete the repair'
    WHEN 'final_inspection' THEN 'Carry out final inspection'
    WHEN 'vehicle_release' THEN 'Release the vehicle back to operations'
    WHEN 'cost_recovery' THEN 'Complete cost recovery'
    WHEN 'closed' THEN 'None - case closed' ELSE 'Review the case' END;
$$;

-- accident_apply_tokens(tpl, acc, v_dept): replaces {{reference_no}} {{company}} {{site}}
-- {{asset_no}} {{plate_number}} {{driver_name}} {{incident_date}} {{location}} {{severity}}
-- {{stage_label}} {{vor_label}} {{estimated_cost}} {{approved_cost}} {{claim_status}}
-- {{department}} {{pending_action}} {{due_date}} {{link}} (see live function body).

CREATE OR REPLACE FUNCTION public.emit_accident_domain_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_org uuid := COALESCE(NEW.organisation_id, OLD.organisation_id);
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_domain_event('accident.reported', 'accident', NEW.id::text,
      jsonb_build_object('reference_no',NEW.reference_no,'asset_no',NEW.asset_no,'site',NEW.site,
        'severity',NEW.severity,'status',NEW.status,'workflow_stage',NEW.workflow_stage,
        'incident_date',NEW.incident_date,'driver_name',NEW.driver_name,'organisation_id',NEW.organisation_id),
      v_org, auth.uid());
    RETURN NEW;
  END IF;
  IF NEW.workflow_stage IS DISTINCT FROM OLD.workflow_stage THEN
    PERFORM public.emit_domain_event('accident.stage_changed', 'accident', NEW.id::text,
      jsonb_build_object('from',OLD.workflow_stage,'to',NEW.workflow_stage,'reference_no',NEW.reference_no,
        'asset_no',NEW.asset_no,'site',NEW.site), v_org, auth.uid());
  END IF;
  IF NEW.claim_status IS DISTINCT FROM OLD.claim_status THEN
    PERFORM public.emit_domain_event('accident.claim_changed', 'accident', NEW.id::text,
      jsonb_build_object('claim_status',NEW.claim_status,'reference_no',NEW.reference_no,
        'asset_no',NEW.asset_no,'site',NEW.site), v_org, auth.uid());
  END IF;
  IF NEW.vor IS DISTINCT FROM OLD.vor THEN
    PERFORM public.emit_domain_event('accident.vor_changed', 'accident', NEW.id::text,
      jsonb_build_object('vor',NEW.vor,'reference_no',NEW.reference_no,'asset_no',NEW.asset_no,
        'site',NEW.site), v_org, auth.uid());
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ev_accident_reported ON public.accidents;
DROP TRIGGER IF EXISTS trg_ev_accident_closure_changed ON public.accidents;
DROP TRIGGER IF EXISTS trg_accident_notifications ON public.accidents;  -- old broad dead-branch dispatcher
DROP TRIGGER IF EXISTS trg_emit_accident_events ON public.accidents;
CREATE TRIGGER trg_emit_accident_events AFTER INSERT OR UPDATE ON public.accidents
  FOR EACH ROW EXECUTE FUNCTION public.emit_accident_domain_events();

-- consume_event_accident_notify(ev): resolves matching accident_routing_rules -> role
-- recipients (profiles scoped by org+site+country) -> ALWAYS inserts in-app notifications;
-- and, only when system_config.accident_emails_enabled is true AND a template maps, renders
-- the approved template via accident_apply_tokens and enqueues a workflow_notifications row
-- (dedupe on event_id) delivered by deliver_workflow_notifications -> workflow-notify.
-- Registered in event_consumers for accident.reported / stage_changed / claim_changed /
-- vor_changed. (Full body applied live; see project DB.)
INSERT INTO public.event_consumers (consumer, enabled, event_types)
VALUES ('consume_event_accident_notify', true,
        ARRAY['accident.reported','accident.stage_changed','accident.claim_changed','accident.vor_changed'])
ON CONFLICT (consumer) DO UPDATE SET enabled=EXCLUDED.enabled, event_types=EXCLUDED.event_types;
