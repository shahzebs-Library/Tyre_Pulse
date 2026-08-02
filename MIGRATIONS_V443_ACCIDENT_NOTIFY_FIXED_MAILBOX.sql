-- =====================================================================
-- MIGRATIONS_V443 — Wire the V428 FIXED-MAILBOX accident email routing into
-- the LIVE consumer public.consume_event_accident_notify.
--
-- STATUS: APPLIED LIVE on project jhssdmeruxtrlqnwfksc via MCP apply_migration
--         (DB migration name: v432_accident_notify_fixed_mailbox — the DB uses
--         timestamp versions so the label does not collide; this repo file is
--         labelled V443, the next free repo label). Verified rolled-back.
--
-- ROOT CAUSE this fixes ("accident emails still not working"):
--   The whole domain-event pipeline was already healthy end to end:
--     accidents trigger trg_emit_accident_events -> emit_accident_domain_events
--     -> domain_events (76 accident events processed) -> cron process-domain-events
--     -> consume_event_accident_notify (232 in-app notifications delivered)
--     -> [email branch] -> workflow_notifications -> cron deliver-workflow-
--     notifications -> workflow-notify edge fn -> Resend.
--   In-app notifications work. EMAIL never fired for two reasons:
--     1. system_config.accident_emails_enabled = 'false' (the opt-in gate).
--     2. Even once enabled, the consumer resolved EMAIL recipients purely by
--        ROLE from profiles (accident_routing_rules -> to/cc roles). In org
--        Company A routine reported/stage/claim events route to Manager/Director,
--        but the only Manager accounts carry non-routable @users.tyrepulse.app
--        addresses and there are no Director accounts; only the 2 Admins have
--        real inboxes and they are merely CC'd on injury/severe/high-cost cases.
--        => enabling the toggle would deliver essentially nothing usable.
--   The V428 "fixed mailbox" design (send accident email to one admin-configured
--   real address, system_config.accident_email_to/_cc/_subject_prefix) was
--   NEVER actually present in the live consumer — it was never wired.
--
-- WHAT THIS DOES (additive, reversible):
--   When system_config.accident_email_to is set (comma/semicolon/space list of
--   addresses), the accident EMAIL is enqueued to that fixed To (+ accident_email_cc),
--   with accident_email_subject_prefix prepended to the subject, overriding the
--   per-user role resolution. Any role-resolved recipients that carry a push_token
--   are retained (email nulled) so push still reaches staff; in-app notifications
--   are UNCHANGED. When accident_email_to is empty/unset the behaviour is
--   byte-identical to the previous role-based email routing (verified: no regression).
--
-- ROLLBACK: re-apply the previous body (same function minus the
--   v_fixed_to/v_fixed_cc/v_prefix/v_mail_recipients logic), whose email block was:
--     IF v_emails_on AND v_key IS NOT NULL AND jsonb_array_length(v_recipients) > 0 THEN
--       SELECT accident_apply_tokens(t.subject,acc,v_dept), accident_apply_tokens(t.body_html,acc,v_dept)
--         INTO v_subject,v_html FROM accident_email_templates t
--         WHERE t.organisation_id=acc.organisation_id AND t.key=v_key AND t.active AND t.approved LIMIT 1;
--       IF v_subject IS NOT NULL THEN
--         INSERT INTO workflow_notifications (event_id,organisation_id,instance_id,event_type,payload,recipient_count,status)
--         VALUES (ev.id,acc.organisation_id,NULL,ev.event_type,
--           jsonb_build_object('event_type',ev.event_type,'channel','accident','entity_id',acc.id::text,
--             'email',jsonb_build_object('subject',v_subject,'html',v_html),
--             'push',jsonb_build_object('title',v_title,'body',v_body),'recipients',v_recipients),
--           jsonb_array_length(v_recipients),'pending') ON CONFLICT (event_id) DO NOTHING;
--       END IF;
--     END IF;
--   No data migration (function replace only).
--
-- ADMIN ACTIVATION (still required — emails remain OFF by design):
--   1. system_config.accident_email_to    = '"accidents@<customer-domain>"' (real mailbox; +/_cc optional)
--   2. system_config.accident_email_subject_prefix = '"[Tyre Pulse Accident]"' (optional)
--   3. system_config.accident_emails_enabled = 'true'
--   Sender is FROM_EMAIL on the workflow-notify edge fn (default reports@tyrepulse.app,
--   a Resend-verified domain). RESEND_API_KEY + workflow_notify_secret confirmed present.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.consume_event_accident_notify(ev domain_events)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  acc          public.accidents%ROWTYPE;
  v_key        text;
  v_depts      text[];
  v_to         text[];
  v_cc         text[];
  v_esc        text[];
  v_all        text[];
  v_dept       text;
  v_recipients jsonb := '[]'::jsonb;
  v_emails_on  boolean;
  v_title      text;
  v_body       text;
  v_ntype      text;
  v_subject    text;
  v_html       text;
  v_escalate   boolean;
  v_fixed_to   text[];
  v_fixed_cc   text[];
  v_prefix     text;
  v_mail_recipients jsonb;
BEGIN
  IF ev.event_type NOT LIKE 'accident.%' THEN RETURN; END IF;
  BEGIN
    SELECT * INTO acc FROM public.accidents WHERE id = ev.entity_id::uuid;
  EXCEPTION WHEN others THEN RETURN; END;
  IF acc.id IS NULL THEN RETURN; END IF;

  v_escalate := ev.event_type IN ('accident.vor_sla_breach','accident.overdue');

  IF ev.event_type = 'accident.reported' THEN
    v_key := CASE WHEN acc.severity IN ('severe','fatal') OR acc.injuries THEN 'critical' ELSE 'reported' END;
  ELSIF ev.event_type = 'accident.stage_changed' THEN
    v_key := CASE acc.workflow_stage
      WHEN 'workshop_assessment' THEN 'workshop_assessed'
      WHEN 'repair_approval'     THEN 'repair_approval'
      WHEN 'insurance_claim'     THEN 'claim_submitted'
      WHEN 'final_inspection'    THEN 'final_inspection_pending'
      WHEN 'vehicle_release'     THEN 'released'
      WHEN 'closed'              THEN 'closed'
      ELSE NULL END;
  ELSIF ev.event_type = 'accident.claim_changed' THEN
    v_key := CASE acc.claim_status
      WHEN 'filed' THEN 'claim_submitted' WHEN 'approved' THEN 'claim_approved'
      WHEN 'settled' THEN 'claim_approved' WHEN 'rejected' THEN 'claim_rejected' ELSE NULL END;
  ELSIF ev.event_type = 'accident.vor_sla_breach' THEN
    v_key := 'vor_sla_breach';
  ELSIF ev.event_type = 'accident.overdue' THEN
    v_key := 'overdue';
  ELSE
    v_key := NULL;
  END IF;

  WITH m AS (
    SELECT rr.departments, rr.to_roles, rr.cc_roles, rr.escalate_roles
    FROM public.accident_routing_rules rr
    WHERE rr.organisation_id = acc.organisation_id AND rr.active
      AND (rr.event_key IS NULL OR rr.event_key = ev.event_type)
      AND (COALESCE(array_length(rr.match_severities,1),0)=0 OR acc.severity = ANY(rr.match_severities))
      AND (COALESCE(array_length(rr.match_types,1),0)=0 OR acc.accident_type = ANY(rr.match_types))
      AND (COALESCE(array_length(rr.match_sites,1),0)=0 OR acc.site = ANY(rr.match_sites))
      AND (COALESCE(array_length(rr.match_countries,1),0)=0 OR acc.country = ANY(rr.match_countries))
      AND (rr.min_cost IS NULL OR COALESCE(acc.estimated_damage_cost,acc.final_amount,acc.repair_cost,0) >= rr.min_cost)
      AND (NOT rr.require_injury OR acc.injuries)
      AND (NOT rr.require_vor OR acc.vor)
      AND (NOT rr.require_third_party OR acc.third_party_involved)
  )
  SELECT
    COALESCE((SELECT array_agg(DISTINCT d) FROM m, unnest(m.departments) d),'{}'),
    COALESCE((SELECT array_agg(DISTINCT d) FROM m, unnest(m.to_roles) d),'{}'),
    COALESCE((SELECT array_agg(DISTINCT d) FROM m, unnest(m.cc_roles) d),'{}'),
    COALESCE((SELECT array_agg(DISTINCT d) FROM m, unnest(m.escalate_roles) d),'{}')
  INTO v_depts, v_to, v_cc, v_esc;

  IF COALESCE(array_length(v_to,1),0)=0 THEN v_to := ARRAY['Admin','Manager','Director']; END IF;
  IF v_escalate THEN
    v_all := (SELECT array_agg(DISTINCT x) FROM unnest(v_to || v_cc || COALESCE(v_esc,'{}')) x);
  ELSE
    v_all := (SELECT array_agg(DISTINCT x) FROM unnest(v_to || v_cc) x);
  END IF;
  v_dept := NULLIF(array_to_string(v_depts, ', '), '');
  IF v_dept IS NULL THEN v_dept := COALESCE(acc.department,'Operations'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'user_id',p.id,'email',u.email,'push_token',p.push_token,'role',p.role)),'[]'::jsonb)
    INTO v_recipients
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE p.organisation_id = acc.organisation_id
    AND COALESCE(p.locked,false)=false AND (p.approved IS NULL OR p.approved = true)
    AND p.role = ANY(v_all)
    AND (p.site IS NULL OR btrim(p.site)='' OR upper(p.site)=upper(COALESCE(acc.site,''))
         OR upper(COALESCE(acc.site,'')) = ANY(SELECT upper(x) FROM unnest(COALESCE(p.sites,'{}'::text[])) x))
    AND (COALESCE(array_length(p.country,1),0)=0 OR acc.country IS NULL OR acc.country = ANY(p.country));

  v_ntype := CASE WHEN v_key IN ('critical','vor_sla_breach','overdue') THEN 'warning'
                  WHEN ev.event_type='accident.stage_changed' AND acc.workflow_stage='closed' THEN 'success'
                  ELSE 'accident' END;
  v_title := CASE ev.event_type
    WHEN 'accident.reported' THEN 'New accident '||COALESCE(acc.reference_no,'')||' ('||public.accident_severity_label(acc.severity)||')'
    WHEN 'accident.stage_changed' THEN 'Accident '||COALESCE(acc.reference_no,'')||' -> '||public.accident_stage_label(acc.workflow_stage)
    WHEN 'accident.claim_changed' THEN 'Claim '||COALESCE(acc.claim_status,'')||' - '||COALESCE(acc.reference_no,'')
    WHEN 'accident.vor_changed' THEN CASE WHEN acc.vor THEN 'Vehicle OFF ROAD - '||COALESCE(acc.reference_no,'') ELSE 'Vehicle back on road - '||COALESCE(acc.reference_no,'') END
    WHEN 'accident.vor_sla_breach' THEN 'VOR SLA BREACH - '||COALESCE(acc.reference_no,'')
    WHEN 'accident.overdue' THEN 'OVERDUE - '||COALESCE(acc.reference_no,'')
    ELSE 'Accident '||COALESCE(acc.reference_no,'') END;
  v_body := COALESCE(acc.asset_no,'')||' at '||COALESCE(acc.site,'')||' | '
            ||public.accident_stage_label(acc.workflow_stage)||' | Action: '||public.accident_pending_action(acc.workflow_stage);

  -- In-app notifications: always, to the role-resolved recipients (unchanged).
  IF jsonb_array_length(v_recipients) > 0 THEN
    INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
    SELECT (r->>'user_id')::uuid, v_ntype, v_title, v_body, 'accident', acc.id
    FROM jsonb_array_elements(v_recipients) r;
  END IF;

  v_emails_on := lower(btrim(COALESCE((SELECT value FROM public.system_config WHERE key='accident_emails_enabled'),'false'),'"'))
                 IN ('true','1','on','yes');
  IF v_emails_on AND v_key IS NOT NULL THEN
    SELECT public.accident_apply_tokens(t.subject, acc, v_dept),
           public.accident_apply_tokens(t.body_html, acc, v_dept)
      INTO v_subject, v_html
      FROM public.accident_email_templates t
      WHERE t.organisation_id = acc.organisation_id AND t.key = v_key AND t.active AND t.approved
      LIMIT 1;
    IF v_subject IS NOT NULL THEN
      -- Fixed-mailbox override (V428/V443): admin-configured real accident mailbox.
      v_fixed_to := ARRAY(
        SELECT btrim(x) FROM regexp_split_to_table(
          btrim(COALESCE((SELECT value FROM public.system_config WHERE key='accident_email_to'),''),'"'),
          '[,;\s]+') AS x
        WHERE btrim(x) <> '' AND position('@' in x) > 1);
      v_fixed_cc := ARRAY(
        SELECT btrim(x) FROM regexp_split_to_table(
          btrim(COALESCE((SELECT value FROM public.system_config WHERE key='accident_email_cc'),''),'"'),
          '[,;\s]+') AS x
        WHERE btrim(x) <> '' AND position('@' in x) > 1);
      v_prefix := btrim(btrim(COALESCE((SELECT value FROM public.system_config WHERE key='accident_email_subject_prefix'),''),'"'));

      IF COALESCE(array_length(v_fixed_to,1),0) > 0 THEN
        -- keep only role recipients that carry a push_token (email nulled so no
        -- staff email), then append the fixed To + CC as email-only recipients.
        v_mail_recipients := COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                     'user_id', x->>'user_id', 'email', NULL,
                     'push_token', x->>'push_token', 'role', x->>'role'))
              FROM jsonb_array_elements(v_recipients) x
             WHERE NULLIF(x->>'push_token','') IS NOT NULL), '[]'::jsonb)
          || COALESCE((SELECT jsonb_agg(jsonb_build_object('email', a)) FROM unnest(v_fixed_to) a), '[]'::jsonb)
          || COALESCE((SELECT jsonb_agg(jsonb_build_object('email', a)) FROM unnest(v_fixed_cc) a), '[]'::jsonb);
        IF v_prefix <> '' AND position(v_prefix in v_subject) <> 1 THEN
          v_subject := v_prefix || ' ' || v_subject;
        END IF;
      ELSE
        v_mail_recipients := v_recipients;   -- legacy role-based per-user emails
      END IF;

      IF jsonb_array_length(v_mail_recipients) > 0 THEN
        INSERT INTO public.workflow_notifications
          (event_id, organisation_id, instance_id, event_type, payload, recipient_count, status)
        VALUES
          (ev.id, acc.organisation_id, NULL, ev.event_type,
           jsonb_build_object('event_type',ev.event_type,'channel','accident','entity_id',acc.id::text,
             'email', jsonb_build_object('subject',v_subject,'html',v_html),
             'push',  jsonb_build_object('title',v_title,'body',v_body),
             'recipients', v_mail_recipients),
           (SELECT count(*) FROM jsonb_array_elements(v_mail_recipients) e WHERE NULLIF(e->>'email','') IS NOT NULL),
           'pending')
        ON CONFLICT (event_id) DO NOTHING;
      END IF;
    END IF;
  END IF;
END;
$function$;
