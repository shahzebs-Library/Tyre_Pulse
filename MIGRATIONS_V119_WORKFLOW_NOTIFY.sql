-- ============================================================================
-- MIGRATIONS_V119_WORKFLOW_NOTIFY.sql
-- Universal Approval & Workflow Engine — Phase 3 (notification fan-out backend).
--
-- APPLY ORDER: run AFTER MIGRATIONS_V118_APPROVAL_DASHBOARD.sql
--              (and therefore after V96 domain_events, V97 workflow engine,
--               V99 webhook-delivery pattern, V117 workflow actions).
--
-- WHAT THIS DOES
--   Mirrors the V99 webhook-delivery architecture, but the delivery target is
--   OUR OWN `workflow-notify` edge function (email / push / WhatsApp fan-out)
--   instead of a customer URL:
--     1. workflow_notifications — a small at-least-once delivery queue.
--     2. consume_event_workflow_notify(domain_events) — an event consumer that,
--        for each `workflow.*` domain event, resolves recipients (specific
--        approver_user_id, else the step's role → users in the org) and enqueues
--        ONE row (email/push/phone captured at enqueue time).
--     3. deliver_workflow_notifications() — a pg_cron (every minute) deliverer
--        that POSTs due rows to the edge function via pg_net.http_post with the
--        `x-workflow-secret` header, then reconciles net._http_response and
--        marks rows delivered (avoids re-send). Backoff 2^n min, 6 attempts.
--
--   Recipients resolve exactly like V97 `notify_role_in_org` (org-scoped,
--   approved, unlocked profiles by normalised role) — plus email from
--   auth.users and push_token/phone from profiles. In-app notifications already
--   exist (V97/V117); this migration adds ONLY the external channels.
--
-- REQUIRED SECRETS / SETTINGS (before the cron will deliver anything):
--   * Postgres side:
--       public.cron_config('workflow_notify_secret')  — auto-seeded below.
--         Must MATCH the edge function's WORKFLOW_NOTIFY_SECRET env var.
--   * Edge function side (set via `supabase secrets set`):
--       WORKFLOW_NOTIFY_SECRET   (must equal cron_config.workflow_notify_secret)
--       RESEND_API_KEY, FROM_EMAIL                 (email channel, optional)
--       TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
--       TWILIO_WHATSAPP_FROM                       (WhatsApp channel, optional)
--     (Push via Expo needs no key.)
--   Any channel whose env is unset is a silent no-op — see the edge function.
--
--   The function URL + gateway anon bearer below are the SAME literals used by
--   V61 (send-scheduled-reports) and V98 (embed-worker): the anon key only
--   satisfies the Supabase gateway; the REAL gate is x-workflow-secret.
--
-- Depends on: V96 (domain_events, event_consumers, emit_domain_event),
--             V97 (workflow_instances, notify_role_in_org, profiles roles),
--             V61 (cron_config, pg_cron, pg_net).
--
-- Rollback:
--   SELECT cron.unschedule('deliver-workflow-notifications');
--   DELETE FROM public.event_consumers WHERE consumer = 'consume_event_workflow_notify';
--   DROP FUNCTION public.deliver_workflow_notifications();
--   DROP FUNCTION public.consume_event_workflow_notify(public.domain_events);
--   DROP TABLE public.workflow_notifications;
--   DELETE FROM public.cron_config WHERE name = 'workflow_notify_secret';
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. SHARED SECRET (private cron_config row; service-role only — same store the
--    V61 cron uses). Auto-seeded; rotate by UPDATE-ing this row AND the edge
--    function's WORKFLOW_NOTIFY_SECRET secret to the same value.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.cron_config (name, value)
VALUES ('workflow_notify_secret', gen_random_uuid()::text)
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DELIVERY QUEUE (at-least-once; one row per (event, resolved payload)).
--    recipients is a snapshot resolved at enqueue time so late profile edits
--    do not change an already-queued notification.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workflow_notifications (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        bigint NOT NULL,
  organisation_id uuid,
  instance_id     uuid,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- exact edge-function body
  recipient_count int NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','delivered','failed','skipped')),
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  request_id      bigint,                                -- pg_net id of last attempt
  response_status int,
  result          jsonb,                                 -- {email,push,whatsapp,skipped}
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz
);

-- One queued notification per domain event (absorbs at-least-once event replays).
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_notifications_event
  ON public.workflow_notifications (event_id);
CREATE INDEX IF NOT EXISTS idx_workflow_notifications_due
  ON public.workflow_notifications (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_workflow_notifications_org_time
  ON public.workflow_notifications (organisation_id, created_at DESC);

ALTER TABLE public.workflow_notifications ENABLE ROW LEVEL SECURITY;
-- Elevated users can read their org's delivery history (dashboard/debug).
-- All writes happen via SECURITY DEFINER functions / cron — no write policies.
DROP POLICY IF EXISTS workflow_notifications_select ON public.workflow_notifications;
CREATE POLICY workflow_notifications_select ON public.workflow_notifications
  FOR SELECT TO authenticated
  USING ((SELECT public.is_elevated_user())
         AND (organisation_id IS NULL OR organisation_id = (SELECT public.app_current_org())));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. EVENT CONSUMER — resolve recipients + enqueue ONE notification per event.
--    Fires for workflow.step_advanced / approved / rejected / returned only.
--
--    Recipient resolution:
--      * step_advanced → the NEXT approver: a specific approver_user_id if the
--        step is user-assigned, else all approved+unlocked users in the org
--        whose normalised role matches the step's approver_role (V97 rules).
--      * approved / rejected / returned → the initiator (workflow_instances
--        .started_by), who is the person waiting on the outcome.
--    email comes from auth.users; push_token/phone from profiles. Rows with no
--    reachable recipient are enqueued as 'skipped' (nothing to send).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_event_workflow_notify(ev public.domain_events)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst        public.workflow_instances%ROWTYPE;
  v_step        jsonb;
  v_step_name   text;
  v_role        text;
  v_user_id     text;
  v_recipients  jsonb := '[]'::jsonb;
  v_payload     jsonb;
BEGIN
  -- Only handle the four workflow lifecycle events.
  IF ev.event_type NOT IN ('workflow.step_advanced','workflow.approved',
                           'workflow.rejected','workflow.returned') THEN
    RETURN;
  END IF;

  -- The workflow.* events carry the instance id as entity_id (text uuid).
  BEGIN
    SELECT * INTO v_inst FROM public.workflow_instances
     WHERE id = ev.entity_id::uuid;
  EXCEPTION WHEN others THEN
    RETURN;  -- malformed id → nothing to do
  END;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_step_name := COALESCE(ev.payload ->> 'step', '');

  IF ev.event_type = 'workflow.step_advanced' THEN
    -- Notify the CURRENT (newly opened) step's assignee(s).
    v_step := v_inst.steps -> v_inst.current_step;
    v_step_name := COALESCE(v_step ->> 'name', v_step_name);

    IF lower(COALESCE(v_step ->> 'assignee_type','role')) = 'user'
       AND COALESCE(v_step ->> 'approver_user_id','') <> '' THEN
      -- Specific user assignment.
      v_user_id := v_step ->> 'approver_user_id';
      SELECT COALESCE(jsonb_agg(r), '[]'::jsonb) INTO v_recipients
        FROM (
          SELECT jsonb_build_object(
                   'user_id',    p.id,
                   'email',      u.email,
                   'push_token', p.push_token,
                   'phone',      NULL,
                   'role',       p.role) AS r
            FROM public.profiles p
            LEFT JOIN auth.users u ON u.id = p.id
           WHERE p.id = v_user_id::uuid
             AND COALESCE(p.locked, false) = false
             AND (p.approved IS NULL OR p.approved = true)
        ) s;
    ELSE
      -- Role assignment → all matching users in the org (V97 notify_role_in_org rules).
      v_role := lower(regexp_replace(COALESCE(v_step ->> 'approver_role',''), '\s+', '_', 'g'));
      SELECT COALESCE(jsonb_agg(r), '[]'::jsonb) INTO v_recipients
        FROM (
          SELECT jsonb_build_object(
                   'user_id',    p.id,
                   'email',      u.email,
                   'push_token', p.push_token,
                   'phone',      NULL,
                   'role',       p.role) AS r
            FROM public.profiles p
            LEFT JOIN auth.users u ON u.id = p.id
           WHERE lower(regexp_replace(COALESCE(p.role,''), '\s+', '_', 'g')) = v_role
             AND COALESCE(p.locked, false) = false
             AND (p.approved IS NULL OR p.approved = true)
             AND (v_inst.organisation_id IS NULL
                  OR p.organisation_id = v_inst.organisation_id)
        ) s;
    END IF;
  ELSE
    -- approved / rejected / returned → notify the initiator.
    IF v_inst.started_by IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(r), '[]'::jsonb) INTO v_recipients
        FROM (
          SELECT jsonb_build_object(
                   'user_id',    p.id,
                   'email',      u.email,
                   'push_token', p.push_token,
                   'phone',      NULL,
                   'role',       p.role) AS r
            FROM public.profiles p
            LEFT JOIN auth.users u ON u.id = p.id
           WHERE p.id = v_inst.started_by
             AND COALESCE(p.locked, false) = false
        ) s;
    END IF;
  END IF;

  -- Build the exact body the edge function expects.
  v_payload := jsonb_build_object(
    'event_type',      ev.event_type,
    'instance_id',     v_inst.id,
    'definition_name', v_inst.definition_name,
    'entity_type',     v_inst.entity_type,
    'entity_label',    COALESCE(v_inst.entity_label, v_inst.entity_type),
    'step_name',       v_step_name,
    'comment',         ev.payload ->> 'comment',
    'recipients',      v_recipients
  );

  INSERT INTO public.workflow_notifications
    (event_id, organisation_id, instance_id, event_type, payload, recipient_count, status)
  VALUES
    (ev.id, v_inst.organisation_id, v_inst.id, ev.event_type, v_payload,
     jsonb_array_length(v_recipients),
     CASE WHEN jsonb_array_length(v_recipients) = 0 THEN 'skipped' ELSE 'pending' END)
  ON CONFLICT (event_id) DO NOTHING;   -- absorbs at-least-once event replays
END;
$$;
REVOKE EXECUTE ON FUNCTION public.consume_event_workflow_notify(public.domain_events)
  FROM PUBLIC, anon, authenticated;

-- Register the consumer (scoped to the four workflow.* events).
INSERT INTO public.event_consumers (consumer, event_types, description)
VALUES ('consume_event_workflow_notify',
        ARRAY['workflow.step_advanced','workflow.approved','workflow.rejected','workflow.returned'],
        'Enqueues workflow_notifications (email/push/WhatsApp fan-out) for workflow lifecycle events.')
ON CONFLICT (consumer) DO UPDATE
  SET enabled = true,
      event_types = EXCLUDED.event_types,
      description = EXCLUDED.description;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. DELIVERER (pg_cron, every minute).
--    Mirrors V99 deliver_pending_webhooks: reconcile prior net responses, then
--    POST due rows to the workflow-notify edge function. Backoff 2^n min,
--    6 attempts. The x-workflow-secret header (from cron_config) is the real
--    gate; the anon bearer only satisfies the Supabase gateway (V61 pattern).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deliver_workflow_notifications()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d        record;
  r        record;
  v_secret text;
  v_req    bigint;
  n_sent   int := 0;
  n_done   int := 0;
  n_dead   int := 0;
BEGIN
  -- 3a. Reconcile responses of previously sent attempts.
  FOR d IN
    SELECT wn.id, wn.attempts, wn.request_id
      FROM public.workflow_notifications wn
     WHERE wn.status = 'pending' AND wn.request_id IS NOT NULL
  LOOP
    SELECT status_code, content, error_msg INTO r
      FROM net._http_response WHERE id = d.request_id;
    IF NOT FOUND THEN
      CONTINUE;  -- response not landed yet
    END IF;

    IF r.status_code BETWEEN 200 AND 299 THEN
      UPDATE public.workflow_notifications
         SET status = 'delivered', delivered_at = now(),
             response_status = r.status_code,
             result = CASE
                        WHEN r.content IS NULL THEN NULL
                        ELSE (r.content)::jsonb
                      END,
             last_error = NULL, request_id = NULL
       WHERE id = d.id;
      n_done := n_done + 1;
    ELSE
      UPDATE public.workflow_notifications
         SET response_status = r.status_code,
             last_error = left(COALESCE(r.error_msg,
                              'HTTP ' || COALESCE(r.status_code::text, '?')), 500),
             request_id = NULL,
             status = CASE WHEN d.attempts >= 6 THEN 'failed' ELSE 'pending' END
       WHERE id = d.id;
      IF d.attempts >= 6 THEN n_dead := n_dead + 1; END IF;
    END IF;
  END LOOP;

  -- Read the shared secret once (may be NULL if this migration ran without V61
  -- seeding — the header is simply omitted then, matching an unset env var).
  SELECT value INTO v_secret FROM public.cron_config WHERE name = 'workflow_notify_secret';

  -- 3b. Send due rows.
  FOR d IN
    SELECT wn.id, wn.payload, wn.attempts
      FROM public.workflow_notifications wn
     WHERE wn.status = 'pending'
       AND wn.request_id IS NULL
       AND wn.next_attempt_at <= now()
       AND wn.attempts < 6
     ORDER BY wn.next_attempt_at
     LIMIT 50
     FOR UPDATE OF wn SKIP LOCKED
  LOOP
    v_req := net.http_post(
      url     := 'https://jhssdmeruxtrlqnwfksc.supabase.co/functions/v1/workflow-notify',
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type',      'application/json',
        'Authorization',     'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impoc3NkbWVydXh0cmxxbndma3NjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1ODYyMzIsImV4cCI6MjA5NjE2MjIzMn0.W18y4ifFRuEkR2-lseAm1cqcnjq-mL4-OtpsgEyzMoM',
        'x-workflow-secret', v_secret)),
      body    := d.payload,
      timeout_milliseconds := 15000
    );

    UPDATE public.workflow_notifications
       SET attempts = d.attempts + 1,
           request_id = v_req,
           next_attempt_at = now() + make_interval(mins => least(power(2, d.attempts + 1)::int, 60))
     WHERE id = d.id;
    n_sent := n_sent + 1;
  END LOOP;

  RETURN jsonb_build_object('sent', n_sent, 'delivered', n_done, 'dead', n_dead);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.deliver_workflow_notifications()
  FROM PUBLIC, anon, authenticated;

-- Schedule (idempotent: unschedule an existing job of the same name first).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'deliver-workflow-notifications') THEN
    PERFORM cron.unschedule('deliver-workflow-notifications');
  END IF;
END $$;

SELECT cron.schedule(
  'deliver-workflow-notifications',
  '* * * * *',
  $$SELECT public.deliver_workflow_notifications();$$
);

COMMENT ON TABLE public.workflow_notifications IS
  'At-least-once queue for external workflow notifications (email/push/WhatsApp). Enqueued by consume_event_workflow_notify(), delivered to the workflow-notify edge function by deliver_workflow_notifications() (pg_cron, every minute).';
