-- Faithful copies of LIVE production functions (project jhssdmeruxtrlqnwfksc), read with
-- pg_get_functiondef on 2026-11-12 (SELECT only). The commercial_*.test.mjs suites check each
-- body by md5(prosrc) against the value recorded from production, so a transcription slip
-- fails the test instead of proving the wrong thing. Do not edit a body here by hand.

CREATE OR REPLACE FUNCTION public.notify_elevated_users(p_type text, p_title text, p_body text, p_entity_type text DEFAULT 'accident'::text, p_entity_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
  SELECT id, p_type, p_title, p_body, p_entity_type, p_entity_id
    FROM public.profiles
   WHERE role IN ('Admin', 'Manager', 'Director')
     AND locked  = false
     AND (approved IS NULL OR approved = true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_workshop_parts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if tg_op = 'INSERT' then
      perform public.notify_elevated_users(
        'parts_request', 'New parts request',
        coalesce('Parts requested for ' || nullif(new.asset_no,''), 'A new parts request was raised'),
        'parts_request', new.id);
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status
          and new.requested_by is not null
          and new.status in ('approved','issued','fulfilled','rejected') then
      insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
      values (
        new.requested_by, 'parts_request',
        case new.status
          when 'approved'  then 'Parts approved'
          when 'issued'    then 'Parts issued'
          when 'fulfilled' then 'Parts fulfilled'
          when 'rejected'  then 'Parts request rejected'
        end,
        coalesce(nullif(new.part_name,'') || ' for ' || nullif(new.asset_no,''), 'Your parts request was updated'),
        'parts_request', new.id);
    end if;
  exception when others then
    -- never block the parts_requests write on a notification failure
    null;
  end;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tyre_life_km_cap(p_vehicle_type text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when upper(coalesce(p_vehicle_type,'')) like '%MIXER%'  then 80000
    when upper(coalesce(p_vehicle_type,'')) like '%PUMP%'   then 56000
    when upper(coalesce(p_vehicle_type,'')) like '%LOADER%' then 15000
    else 100000
  end::numeric
$function$;

CREATE OR REPLACE FUNCTION public.scrap_tyre_by_serial(p_serial text, p_reason text DEFAULT NULL::text, p_country text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.app_current_org();
  v_s   text := upper(btrim(coalesce(p_serial, '')));
  v_prior jsonb; v_n int; v_tot int; v_ok int; v_ctry text;
begin
  if p_country is not null and not public.app_write_country_ok(p_country) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if v_s = '' then
    raise exception 'Serial number is required' using errcode = '22023';
  end if;
  if v_org is null or not public.tyre_scrap_allowed() then
    raise exception 'You do not have permission to scrap a tyre' using errcode = '42501';
  end if;

  select count(*),
         count(*) filter (where t.country is null or public.app_write_country_ok(t.country)),
         min(t.country) filter (where t.country is not null)
    into v_tot, v_ok, v_ctry
    from public.tyre_records t
   where upper(btrim(t.serial_no)) = v_s and t.organisation_id = v_org;

  if v_tot = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_found', 'serial', v_s); end if;
  if v_ok = 0 then
    return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  select coalesce(jsonb_object_agg(t.id::text, coalesce(t.status, 'Active')), '{}'::jsonb)
    into v_prior
    from public.tyre_records t
   where upper(btrim(t.serial_no)) = v_s
     and t.organisation_id = v_org
     and coalesce(t.status, '') <> 'Scrapped'
     and (t.country is null or public.app_write_country_ok(t.country));

  insert into public.tyre_status_marks
    (serial, mark_type, reason, country, created_by, created_at, organisation_id, prior_status)
  values (v_s, 'scrap', nullif(btrim(coalesce(p_reason, '')), ''),
          coalesce(v_ctry, nullif(btrim(coalesce(p_country, '')), '')), auth.uid(), now(), v_org, v_prior)
  on conflict (serial, mark_type) do update
    set reason     = excluded.reason,
        created_by = excluded.created_by,
        created_at = excluded.created_at,
        country    = coalesce(excluded.country, tyre_status_marks.country),
        prior_status = case
          when tyre_status_marks.prior_status is null
            or tyre_status_marks.prior_status = '{}'::jsonb
          then excluded.prior_status
          else tyre_status_marks.prior_status end;

  update public.tyre_records
     set status = 'Scrapped'
   where upper(btrim(serial_no)) = v_s
     and organisation_id = v_org and (country is null or public.app_write_country_ok(country));
  get diagnostics v_n = row_count;

  perform public._log_scrap_action('tyre_scrap', v_s, v_prior,
    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), ''), 'rows', v_n),
    nullif(btrim(coalesce(p_country, '')), ''));

  if v_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'forbidden', 'serial', v_s, 'updated', 0); end if;
  return jsonb_build_object('ok', true, 'serial', v_s, 'updated', v_n);
end $function$;

CREATE OR REPLACE FUNCTION public.evaluate_alert_thresholds()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t       record;
  v_count int;
  v_fired int := 0;
  v_op    text;
  v_is_count boolean;
  v_hit   boolean;
  v_sql   text;
BEGIN
  FOR t IN
    SELECT * FROM public.alert_thresholds
     WHERE active
       AND metric IN ('tread_depth','pressure','tyre_age_days','inspection_overdue_days',
                    'open_breakdowns','stock_below_min','overdue_parts_requests','expiring_certifications',
                    'open_corrective_actions','pending_approvals','overdue_work_orders','open_accidents',
                    'pm_overdue','high_risk_tyres')
       AND (last_triggered_at IS NULL OR last_triggered_at < now() - interval '23 hours')
  LOOP
    v_op := CASE t.operator
              WHEN 'lt' THEN '<' WHEN 'lte' THEN '<='
              WHEN 'gt' THEN '>' WHEN 'gte' THEN '>=' ELSE '=' END;
    v_count := 0;
    v_is_count := false;
    IF t.metric IN ('tread_depth','pressure') THEN
      EXECUTE format(
        'SELECT count(*) FROM public.inspections
          WHERE created_at > now() - interval ''25 hours''
            AND %I IS NOT NULL AND %I %s $1
            AND ($2 IS NULL OR site = $2)',
        CASE t.metric WHEN 'tread_depth' THEN 'tread_depth' ELSE 'pressure_reading' END,
        CASE t.metric WHEN 'tread_depth' THEN 'tread_depth' ELSE 'pressure_reading' END,
        v_op)
      INTO v_count USING t.threshold, NULLIF(t.site_filter, '');
    ELSIF t.metric = 'tyre_age_days' THEN
      EXECUTE format(
        'SELECT count(*) FROM public.tyre_records
          WHERE issue_date IS NOT NULL
            AND (current_date - issue_date) %s $1
            AND ($2 IS NULL OR site = $2)
            AND ($3 IS NULL OR brand = $3)',
        v_op)
      INTO v_count USING t.threshold::int, NULLIF(t.site_filter, ''), NULLIF(t.brand_filter, '');
    ELSIF t.metric = 'inspection_overdue_days' THEN
      EXECUTE format(
        'SELECT count(*) FROM (
           SELECT asset_no,
                  current_date - max(COALESCE(completed_date, scheduled_date)) AS days_since
             FROM public.inspections
            WHERE asset_no IS NOT NULL
              AND ($2 IS NULL OR site = $2)
            GROUP BY asset_no
         ) x WHERE x.days_since %s $1',
        v_op)
      INTO v_count USING t.threshold::int, NULLIF(t.site_filter, '');
    ELSE
      v_is_count := true;
      v_sql := CASE t.metric
        WHEN 'open_breakdowns' THEN
          'SELECT count(*) FROM public.asset_breakdowns WHERE NOT COALESCE(returned_to_service, false)'
        WHEN 'stock_below_min' THEN
          'SELECT count(*) FROM public.stock_records WHERE min_level IS NOT NULL AND stock_qty IS NOT NULL AND stock_qty <= min_level'
        WHEN 'overdue_parts_requests' THEN
          'SELECT count(*) FROM public.parts_requests WHERE needed_by < now() AND lower(COALESCE(status, '''')) NOT IN (''fulfilled'',''rejected'',''cancelled'')'
        WHEN 'expiring_certifications' THEN
          'SELECT count(*) FROM public.certifications WHERE expiry_date BETWEEN current_date AND current_date + 30 AND lower(COALESCE(status, '''')) <> ''revoked'''
        WHEN 'open_corrective_actions' THEN
          'SELECT count(*) FROM public.corrective_actions WHERE lower(COALESCE(status, '''')) NOT IN (''closed'',''completed'',''cancelled'',''resolved'',''verified'')'
        WHEN 'pending_approvals' THEN
          'SELECT count(*) FROM public.inspections WHERE approval_status = ''pending_approval'''
        WHEN 'overdue_work_orders' THEN
          'SELECT count(*) FROM public.work_orders WHERE target_completion < now() AND public.wo_status_canonical(status) NOT IN (''Completed'',''Closed'',''Cancelled'')'
        WHEN 'open_accidents' THEN
          'SELECT count(*) FROM public.accidents WHERE lower(COALESCE(status, '''')) NOT IN (''closed'',''cancelled'')'
        WHEN 'pm_overdue' THEN
          'SELECT count(*) FROM public.pm_programs WHERE lower(COALESCE(status, '''')) = ''active'' AND next_due < current_date'
        WHEN 'high_risk_tyres' THEN
          'SELECT count(*) FROM public.tyre_records WHERE risk_level IN (''High'',''Critical'')'
      END;
      IF v_sql IS NOT NULL THEN
        EXECUTE v_sql || ' AND ($1::text IS NULL OR site = $1) AND ($2::uuid IS NULL OR organisation_id = $2)'
          INTO v_count USING NULLIF(t.site_filter, ''), t.org_id;
      END IF;
    END IF;
    IF v_is_count THEN
      EXECUTE format('SELECT $1 %s $2', v_op) INTO v_hit USING COALESCE(v_count, 0)::numeric, t.threshold;
    ELSE
      v_hit := COALESCE(v_count, 0) > 0;
    END IF;
    IF COALESCE(v_hit, false) THEN
      IF COALESCE(t.notify_in_app, true) AND t.user_id IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
        VALUES (t.user_id, 'threshold',
                'Threshold triggered: ' || t.name,
                v_count || ' record(s) matched ' || t.metric || ' ' || t.operator || ' ' || t.threshold ||
                  COALESCE(' at ' || NULLIF(t.site_filter, ''), '') || '.',
                'alert_threshold', t.id);
      END IF;
      UPDATE public.alert_thresholds
         SET triggered_count = COALESCE(triggered_count, 0) + 1, last_triggered_at = now()
       WHERE id = t.id;
      PERFORM public.emit_domain_event('threshold.triggered', 'alert_threshold', t.id::text,
        jsonb_build_object('name', t.name, 'metric', t.metric, 'operator', t.operator,
                           'threshold', t.threshold, 'matched', v_count, 'site_filter', t.site_filter),
        NULL, t.user_id);
      v_fired := v_fired + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('fired', v_fired);
END;
$function$;

CREATE OR REPLACE FUNCTION public.consume_event_accident_case_notify(ev domain_events)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF ev.event_type = 'accident.workstream_assigned' THEN
    v_ntype := 'info';
    v_title := 'Workstream assigned - ' || v_asset;
    v_body  := COALESCE(v_ws, 'A workstream') || ' assigned. ' || v_ctx;
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
    IF v_requester IS NOT NULL THEN v_targets := array_append(v_targets, v_requester); END IF;

  ELSE
    RETURN;
  END IF;

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

  SELECT COALESCE(array_agg(DISTINCT t), '{}'::uuid[]) INTO v_targets
    FROM unnest(v_targets) AS t WHERE t IS NOT NULL;

  IF array_length(v_targets, 1) IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, entity_type, entity_id)
    SELECT t, v_ntype, v_title, v_body, 'accident', v_accident
      FROM unnest(v_targets) AS t;
  END IF;

  SELECT value INTO v_gate FROM public.system_config WHERE key = 'accident_emails_enabled';
  v_emails_on := lower(COALESCE(v_gate, 'false')) IN ('true','t','1','on','yes');
  IF NOT v_emails_on THEN
    RETURN;
  END IF;

  SELECT value INTO v_to_raw     FROM public.system_config WHERE key = 'accident_email_to';
  SELECT value INTO v_cc_raw     FROM public.system_config WHERE key = 'accident_email_cc';
  SELECT value INTO v_prefix     FROM public.system_config WHERE key = 'accident_email_subject_prefix';

  SELECT COALESCE(array_agg(DISTINCT e), '{}'::text[]) INTO v_emails
    FROM (
      SELECT lower(btrim(x)) AS e
        FROM regexp_split_to_table(
               COALESCE(v_to_raw, '') || E'\n' || COALESCE(v_cc_raw, ''),
               '[,;\n]') AS x
    ) s
   WHERE s.e ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';

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

  SELECT jsonb_agg(jsonb_build_object('email', e))
    INTO v_recipients
    FROM unnest(v_emails) AS e;

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
$function$;

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
           'user_id',p.id,'email',u.email,'push_token',t.tok,'role',p.role)),'[]'::jsonb)
    INTO v_recipients
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN LATERAL public._user_push_tokens(p.id) t(tok) ON true
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
    SELECT DISTINCT (r->>'user_id')::uuid, v_ntype, v_title, v_body, 'accident', acc.id
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
      -- Fixed-mailbox override (V428/V432): admin-configured real accident mailbox.
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
