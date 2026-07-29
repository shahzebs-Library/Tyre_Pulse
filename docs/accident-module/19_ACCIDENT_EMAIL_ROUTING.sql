-- =============================================================================
-- 19_ACCIDENT_EMAIL_ROUTING.sql  -  Fixed-mailbox routing for accident emails
--
-- STATUS: APPLIED LIVE as V428 (project jhssdmeruxtrlqnwfksc), rolled-back-verified.
--   Verified: 3-address To+CC deduped -> status 'pending', prefixed subject, signature
--   "Action by: <name> (<role>)"; blank To+CC -> status 'skipped' (no profile fallback).
--
-- Runs AFTER: docs/accident-module/11_NOTIFICATIONS.sql (applied as V421), which
-- created public.consume_event_accident_case_notify and registered it in
-- event_consumers. This file REPLACES that function's EMAIL half only; the
-- in-app-notification half and every trigger / consumer registration are
-- untouched. It claims the next free migration number at apply time.
--
-- WHY
--   Most Tyre Pulse logins are synthetic, non-routable @users.tyrepulse.app
--   addresses that cannot receive mail, so building the email recipient list
--   from each routed profile's `email` column silently sends into the void.
--   The accident workflow needs a SINGLE, admin-configured mailbox list (To +
--   CC) that real people monitor, sent from the verified Resend sender
--   info@tyrepulse.app, with the acting user's name added in the signature.
--
-- WHAT CHANGES (email half only; everything else reproduced faithfully)
--   * Reads three system_config keys (all optional text):
--       accident_email_to              - To recipients (comma / semicolon / newline)
--       accident_email_cc              - CC recipients (comma / semicolon / newline)
--       accident_email_subject_prefix  - prepended to the subject
--   * Parses To + CC: split on comma/semicolon/newline, trim, lowercase, keep
--     only valid-looking emails, dedupe across BOTH lists.
--   * Empty combined list  -> enqueue a 'skipped' row and RETURN. NO fallback to
--     profile emails (a fixed mailbox list is the whole point).
--   * v_recipients is now [{ "email": <addr> }, ...] from that combined list
--     (workflow-notify delivers to every address; it has no separate cc field,
--     so To+CC are merged into the recipient array by design).
--   * Resolves the acting user (ev.actor_id -> profiles) into a signature
--     "<full_name or username> (<role>)"; 'System' when there is no actor.
--     NOTE: the live domain_events column is `actor_id` (V96), not `actor`.
--   * Sets payload.email.subject = trim(prefix + ' ' + title) and
--     payload.email.html = the body wrapped as HTML plus a signature line.
--   * Push copy is unchanged.
--
-- PRESERVED
--   SECURITY DEFINER, SET search_path = public, ON CONFLICT (event_id) DO
--   NOTHING, the trailing REVOKE, and the existing event_consumers registration
--   (not re-registered here). Idempotent (CREATE OR REPLACE).
--
-- ROLLBACK
--   Re-apply docs/accident-module/11_NOTIFICATIONS.sql PART 2 (the CREATE OR
--   REPLACE of consume_event_accident_case_notify) to restore the profile-email
--   behaviour. The triggers, consumer registration and REVOKE are unaffected.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.consume_event_accident_case_notify(ev public.domain_events)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org        uuid := ev.organisation_id;
  v_country    text := NULLIF(ev.payload ->> 'country', '');
  v_accident   uuid := NULLIF(ev.payload ->> 'accident_id', '')::uuid;
  v_owner      uuid := NULLIF(ev.payload ->> 'owner_id', '')::uuid;
  v_requester  uuid := NULLIF(ev.payload ->> 'requested_by', '')::uuid;
  v_reviewer   uuid := NULLIF(ev.payload ->> 'reviewer_id', '')::uuid;
  v_ws         text := NULLIF(ev.payload ->> 'workstream_key', '');
  v_appr       text := NULLIF(ev.payload ->> 'approval_type', '');
  v_level      text := NULLIF(ev.payload ->> 'level', '');
  v_decision   text := NULLIF(ev.payload ->> 'decision', '');
  v_ntype      text := 'info';
  v_ref        text;
  v_asset      text;
  v_site       text;
  v_ctx        text;
  v_title      text;
  v_body       text;
  v_targets    uuid[] := '{}';
  v_recipients jsonb;
  v_wf_payload jsonb;
  v_gate       text;
  v_emails_on  boolean;
  -- fixed-mailbox routing (this file)
  v_to_raw     text;
  v_cc_raw     text;
  v_prefix     text;
  v_emails     text[];
  v_actor_name text;
  v_actor_role text;
  v_signature  text := 'System';
  v_subject    text;
  v_html       text;
BEGIN
  -- Case context for a readable label (accident_id travels in the payload).
  IF v_accident IS NOT NULL THEN
    SELECT COALESCE(NULLIF(a.reference_no, ''), NULLIF(a.case_no, ''), 'Case'),
           COALESCE(NULLIF(a.asset_no, ''), 'Unknown asset'),
           COALESCE(NULLIF(a.site, ''), v_country, '')
      INTO v_ref, v_asset, v_site
      FROM public.accidents a
     WHERE a.id = v_accident;
  END IF;
  v_ref  := COALESCE(v_ref, 'Case');
  v_asset := COALESCE(v_asset, 'Unknown asset');
  v_ctx  := v_ref || ' | ' || v_asset || CASE WHEN NULLIF(v_site,'') IS NOT NULL
                                              THEN ' (' || v_site || ')' ELSE '' END;

  -- Build the message + recipient target set per event type.
  IF ev.event_type = 'accident.workstream_assigned' THEN
    v_ntype := 'info';
    v_title := 'Workstream assigned - ' || v_asset;
    v_body  := COALESCE(v_ws, 'A workstream') || ' assigned. ' || v_ctx;
    -- The assigned owner is the recipient; fall back to elevated when unowned.
    IF v_owner IS NOT NULL THEN
      v_targets := ARRAY[v_owner];
    END IF;

  ELSIF ev.event_type = 'accident.approval_requested' THEN
    v_ntype := 'warning';
    v_title := 'Approval requested - ' || v_asset;
    v_body  := COALESCE(v_appr, 'An approval')
               || CASE WHEN NULLIF(ev.payload ->> 'amount','') IS NOT NULL
                       THEN ' (' || (ev.payload ->> 'amount') || ')' ELSE '' END
               || ' requires a decision. ' || v_ctx;

  ELSIF ev.event_type = 'accident.closure_requested' THEN
    v_ntype := 'info';
    v_title := 'Closure requested - ' || v_asset;
    v_body  := 'Closure review'
               || CASE WHEN v_level IS NOT NULL THEN ' (' || v_level || ')' ELSE '' END
               || ' awaiting a decision. ' || v_ctx;

  ELSIF ev.event_type = 'accident.closure_decided' THEN
    v_ntype := CASE WHEN v_decision = 'approved' THEN 'success'
                    WHEN v_decision = 'rejected' THEN 'warning' ELSE 'info' END;
    v_title := 'Closure ' || COALESCE(v_decision, 'updated') || ' - ' || v_asset;
    v_body  := 'Closure review'
               || CASE WHEN v_level IS NOT NULL THEN ' (' || v_level || ')' ELSE '' END
               || ' decided: ' || COALESCE(v_decision, 'updated') || '. ' || v_ctx;
    -- Let the person who requested closure know the outcome, plus the elevated approvers.
    IF v_requester IS NOT NULL THEN v_targets := array_append(v_targets, v_requester); END IF;

  ELSE
    RETURN;  -- not one of ours
  END IF;

  -- Add the elevated approver pool (approvals + closures always; workstream only
  -- when it has no owner to notify). Scoped to org + payload country.
  IF ev.event_type IN ('accident.approval_requested','accident.closure_requested','accident.closure_decided')
     OR (ev.event_type = 'accident.workstream_assigned' AND v_owner IS NULL) THEN
    v_targets := v_targets || COALESCE((
      SELECT array_agg(p.id)
        FROM public.profiles p
       WHERE p.role IN ('Admin','Manager','Director')
         AND COALESCE(p.locked, false) = false
         AND (p.approved IS NULL OR p.approved = true)
         AND (v_org IS NULL OR p.organisation_id = v_org OR p.org_id = v_org)
         AND (v_country IS NULL
              OR p.country IS NULL OR cardinality(p.country) = 0
              OR v_country = ANY (p.country))
    ), '{}'::uuid[]);
  END IF;

  -- De-duplicate the target set.
  SELECT COALESCE(array_agg(DISTINCT t), '{}'::uuid[]) INTO v_targets
    FROM unnest(v_targets) AS t WHERE t IS NOT NULL;

  -- (a) ALWAYS write one in-app notification per recipient (linked to the case).
  IF array_length(v_targets, 1) IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
    SELECT t, v_ntype, v_title, v_body, 'accident', v_accident
      FROM unnest(v_targets) AS t;
  END IF;

  -- (b) Email/push half - gated OFF by default, mirrors the accident notifier.
  SELECT value INTO v_gate FROM public.system_config WHERE key = 'accident_emails_enabled';
  v_emails_on := lower(COALESCE(v_gate, 'false')) IN ('true','t','1','on','yes');
  IF NOT v_emails_on THEN
    RETURN;
  END IF;

  -- Fixed-mailbox routing: accident emails go from info@tyrepulse.app to a single
  -- admin-configured To + CC list, never to per-profile (mostly synthetic) emails.
  SELECT value INTO v_to_raw     FROM public.system_config WHERE key = 'accident_email_to';
  SELECT value INTO v_cc_raw     FROM public.system_config WHERE key = 'accident_email_cc';
  SELECT value INTO v_prefix     FROM public.system_config WHERE key = 'accident_email_subject_prefix';

  -- Parse + dedupe To and CC: split on comma / semicolon / newline, trim,
  -- lowercase, keep only valid-looking addresses, unique across BOTH lists.
  SELECT COALESCE(array_agg(DISTINCT e), '{}'::text[]) INTO v_emails
    FROM (
      SELECT lower(btrim(x)) AS e
        FROM regexp_split_to_table(
               COALESCE(v_to_raw, '') || E'\n' || COALESCE(v_cc_raw, ''),
               '[,;\n]') AS x
    ) s
   WHERE s.e ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';

  -- No configured mailbox -> enqueue nothing for delivery. Record a 'skipped'
  -- row (honest no-op) and RETURN; never fall back to profile emails.
  IF array_length(v_emails, 1) IS NULL THEN
    INSERT INTO public.workflow_notifications
      (event_id, organisation_id, instance_id, event_type, payload, recipient_count, status)
    VALUES
      (ev.id, v_org, NULL, ev.event_type,
       jsonb_build_object('recipients', '[]'::jsonb, 'reason', 'no_accident_email_recipients'),
       0, 'skipped')
    ON CONFLICT (event_id) DO NOTHING;
    RETURN;
  END IF;

  -- Recipient array is the fixed mailbox list ({ email } objects only).
  SELECT jsonb_agg(jsonb_build_object('email', e))
    INTO v_recipients
    FROM unnest(v_emails) AS e;

  -- Resolve the acting user for the signature (ev.actor_id -> profiles).
  IF ev.actor_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.username), ''), 'A user'),
           NULLIF(btrim(p.role), '')
      INTO v_actor_name, v_actor_role
      FROM public.profiles p
     WHERE p.id = ev.actor_id;
    IF v_actor_name IS NOT NULL THEN
      v_signature := v_actor_name
                     || CASE WHEN v_actor_role IS NOT NULL
                             THEN ' (' || v_actor_role || ')' ELSE '' END;
    END IF;
  END IF;

  -- Subject carries the admin prefix; HTML body carries the signature line.
  v_subject := btrim(COALESCE(v_prefix, '') || ' ' || v_title);
  v_html := '<p>' || v_body || '</p>'
            || '<p style="color:#666;font-size:12px">Action by: ' || v_signature
            || ' - ' || v_ctx || '. Official record inside Tyre Pulse.</p>';

  v_wf_payload := jsonb_build_object(
    'event_type',      'workflow.step_advanced',
    'instance_id',     NULL,
    'definition_name', 'Accident case',
    'entity_type',     'accident',
    'entity_label',    v_ctx,
    'step_name',       v_title,
    'body',            v_body,
    'email',           jsonb_build_object('subject', v_subject, 'html', v_html),
    'push',            jsonb_build_object('title', v_title, 'body', v_body),
    'recipients',      v_recipients);

  INSERT INTO public.workflow_notifications
    (event_id, organisation_id, instance_id, event_type, payload, recipient_count, status)
  VALUES
    (ev.id, v_org, NULL, ev.event_type, v_wf_payload,
     jsonb_array_length(v_recipients),
     CASE WHEN jsonb_array_length(v_recipients) = 0 THEN 'skipped' ELSE 'pending' END)
  ON CONFLICT (event_id) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_event_accident_case_notify(public.domain_events)
  FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- VERIFY (after apply, impersonating a real user - app_current_org() is NULL in
-- an MCP session, so emit + consume both need a session org). Run in ONE
-- rolled-back transaction and confirm 0 rows persist:
--   1. Set the three keys, e.g.
--        INSERT INTO public.system_config(key,value) VALUES
--          ('accident_emails_enabled','true'),
--          ('accident_email_to','ops@example.com, claims@example.com'),
--          ('accident_email_cc','manager@example.com'),
--          ('accident_email_subject_prefix','[Tyre Pulse Accident]')
--        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--   2. Raise a pending approval -> exactly ONE workflow_notifications row,
--      status 'pending', payload.recipients = 3 distinct { email } objects,
--      payload.email.subject starts with '[Tyre Pulse Accident]',
--      payload.email.html ends with an "Action by: <name> (<role>) ..." line.
--   3. Blank accident_email_to + accident_email_cc, repeat -> ONE row status
--      'skipped', recipient_count 0, NO profile emails.
--   4. Duplicate an address across To and CC -> it appears ONCE in recipients.
-- ROLLBACK the transaction.
-- =============================================================================
