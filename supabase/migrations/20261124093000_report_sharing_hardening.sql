-- Owner authorised: additive scoped-sharing architecture, no changes to existing share rows.
-- Public workshop snapshots fail closed for a restricted report token.
-- Historical unrestricted tokens remain unrestricted; manually rotate them.
ALTER TABLE public.report_shares ADD COLUMN IF NOT EXISTS allowed_country text;
ALTER TABLE public.report_shares ADD COLUMN IF NOT EXISTS allowed_site text;
CREATE OR REPLACE FUNCTION public.create_report_share_scoped(
 p_name text,p_pages jsonb DEFAULT NULL,p_rotate integer DEFAULT 30,
 p_refresh integer DEFAULT 300,p_password text DEFAULT NULL,
 p_expires timestamptz DEFAULT NULL,p_allowed_country text DEFAULT NULL,
 p_allowed_site text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','extensions' AS $scoped$
DECLARE v_token text;v_id uuid;v_org uuid;
 v_country text:=nullif(btrim(p_allowed_country),'');
 v_site text:=nullif(btrim(p_allowed_site),'');
BEGIN
 IF NOT public.is_elevated_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
 v_org:=public.app_current_org();
 IF v_org IS NULL THEN RAISE EXCEPTION 'Organisation required'; END IF;
 IF v_site IS NOT NULL AND v_country IS NULL THEN RAISE EXCEPTION 'Site requires country'; END IF;
 IF v_country IS NULL AND nullif(btrim(p_password),'') IS NULL THEN RAISE EXCEPTION 'Unrestricted reports require a password'; END IF;
 v_token:='rpt_'||encode(gen_random_bytes(18),'hex');
 INSERT INTO public.report_shares
 (organisation_id,name,token,password_hash,pages,rotate_seconds,refresh_seconds,expires_at,allowed_country,allowed_site,created_by)
 VALUES(v_org,coalesce(nullif(btrim(p_name),''),'Shared report'),v_token,
 CASE WHEN nullif(btrim(p_password),'') IS NOT NULL THEN crypt(p_password,gen_salt('bf')) ELSE NULL END,
 coalesce(p_pages,'["board_kpis","board_trends","board_charts"]'::jsonb),
 greatest(5,least(600,coalesce(p_rotate,30))),
 greatest(30,least(3600,coalesce(p_refresh,300))),
 coalesce(p_expires,now()+interval '30 days'),v_country,v_site,auth.uid())
 RETURNING id INTO v_id;
 RETURN jsonb_build_object('id',v_id,'token',v_token);
END;$scoped$;
REVOKE ALL ON FUNCTION public.create_report_share_scoped(text,jsonb,integer,integer,text,timestamptz,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_report_share_scoped(text,jsonb,integer,integer,text,timestamptz,text,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.get_report_snapshot(p_token text, p_password text DEFAULT NULL::text, p_site text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_from text DEFAULT NULL::text, p_to text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  t public.report_shares%ROWTYPE;
  v_org uuid; v_months text[]; v_company text; v_logo text;
  v_site text := nullif(btrim(p_site),''); v_country text := nullif(btrim(p_country),'');
  v_from date; v_to date; v_cfrom date; v_cto date;
  v_km numeric; v_hours numeric; v_m3 numeric;
  v_tyre_cost numeric; v_maint_cost numeric; v_total_cost numeric;
  result jsonb;
  v_cost jsonb;
BEGIN
  SELECT * INTO t FROM public.report_shares WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid'); END IF;
  IF NOT t.active THEN RETURN jsonb_build_object('ok', false, 'reason', 'revoked'); END IF;
  IF t.expires_at IS NOT NULL AND t.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF t.password_hash IS NOT NULL THEN
    IF p_password IS NULL OR not public.share_password_ok('report', t.id, p_password, t.password_hash) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'password'); END IF;
  END IF;
  IF t.allowed_country IS NOT NULL THEN
    IF v_country IS NOT NULL AND v_country <> t.allowed_country THEN RETURN jsonb_build_object('ok',false,'reason','forbidden'); END IF;
    v_country := t.allowed_country;
  END IF;
  IF t.allowed_site IS NOT NULL THEN
    IF v_site IS NOT NULL AND v_site <> t.allowed_site THEN RETURN jsonb_build_object('ok',false,'reason','forbidden'); END IF;
    v_site := t.allowed_site;
  END IF;
  v_org := t.organisation_id;

  BEGIN v_from := nullif(btrim(p_from),'')::date; EXCEPTION WHEN others THEN v_from := NULL; END;
  BEGIN v_to   := nullif(btrim(p_to),'')::date;   EXCEPTION WHEN others THEN v_to   := NULL; END;

  SELECT array_agg(to_char(m, 'YYYY-MM') ORDER BY m) INTO v_months
  FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m;

  SELECT name INTO v_company FROM public.organisations WHERE id = v_org LIMIT 1;
  v_company := coalesce(nullif(replace(replace(v_company, '"', ''), '\', ''), ''), 'TyrePulse');
  SELECT logo_url INTO v_logo FROM public.organisations WHERE id = v_org LIMIT 1;
  v_logo := nullif(replace(replace(coalesce(v_logo,''), '"', ''), '\', ''), '');

  v_cfrom := coalesce(v_from, (date_trunc('month', now()) - interval '11 months')::date);
  v_cto   := coalesce(v_to, now()::date);

  SELECT coalesce(sum(delta),0) INTO v_km FROM (
    SELECT max(odometer_km)-min(odometer_km) delta FROM public.odometer_logs
    WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)
      AND odometer_km IS NOT NULL AND reading_date>=v_cfrom AND reading_date<=v_cto
    GROUP BY asset_no HAVING count(*)>=2
  ) d;
  SELECT coalesce(sum(delta),0) INTO v_hours FROM (
    SELECT max(engine_hours)-min(engine_hours) delta FROM public.engine_hours_logs
    WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)
      AND engine_hours IS NOT NULL AND reading_date>=v_cfrom AND reading_date<=v_cto
    GROUP BY asset_no HAVING count(*)>=2
  ) d;
  SELECT coalesce(sum(m3),0) INTO v_m3 FROM public.production_logs
    WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)
      AND period_date>=v_cfrom AND period_date<=v_cto;

  SELECT coalesce(round(sum(cost_per_tyre*coalesce(nullif(qty,0),1))),0) INTO v_tyre_cost
    FROM public.tyre_records
    WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)
      AND issue_date>=v_cfrom AND issue_date<=v_cto;

  v_maint_cost := coalesce((
      SELECT round(coalesce(sum(coalesce(labour_cost,0)+coalesce(parts_cost,0)+coalesce(lubricant_cost,0)+coalesce(outside_repair_cost,0)),0))
      FROM public.work_orders
      WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)
        AND coalesce(completed_at,opened_at,created_at)::date>=v_cfrom AND coalesce(completed_at,opened_at,created_at)::date<=v_cto
    ),0)
    + coalesce((
      SELECT round(coalesce(sum(total_cost),0)) FROM public.pm_service_records
      WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)
        AND service_date>=v_cfrom AND service_date<=v_cto
    ),0);
  v_total_cost := coalesce(v_tyre_cost,0) + coalesce(v_maint_cost,0);

  v_cost := public._report_cost_block(v_org,v_site,v_country,v_cfrom,v_cto,v_months);
  result := jsonb_build_object(
    'ok', true, 'company', v_company, 'logo', v_logo, 'name', t.name, 'generated_at', now(),
    'rotate_seconds', t.rotate_seconds, 'refresh_seconds', t.refresh_seconds, 'pages', t.pages,
    'layout', t.layout,
    'filters', jsonb_build_object('site', v_site, 'country', v_country, 'from', v_from, 'to', v_to),
    'sites', (SELECT COALESCE(jsonb_agg(s ORDER BY s),'[]'::jsonb) FROM (SELECT DISTINCT nullif(btrim(site),'') s FROM public.tyre_records WHERE organisation_id=v_org AND site IS NOT NULL UNION SELECT DISTINCT nullif(btrim(site),'') FROM public.accidents WHERE organisation_id=v_org AND site IS NOT NULL) u WHERE s IS NOT NULL AND (t.allowed_site IS NULL OR s=t.allowed_site) LIMIT 60),
    'countries', (SELECT COALESCE(jsonb_agg(c ORDER BY c),'[]'::jsonb) FROM (SELECT DISTINCT nullif(btrim(country),'') c FROM public.tyre_records WHERE organisation_id=v_org AND country IS NOT NULL) u WHERE c IS NOT NULL AND (t.allowed_country IS NULL OR c=t.allowed_country) LIMIT 30),
    'labels', to_jsonb((SELECT array_agg(to_char(to_date(k,'YYYY-MM'),'Mon YY') ORDER BY k) FROM unnest(v_months) k)),
    'kpis', jsonb_build_object(
      'fleet',            (SELECT count(*) FROM public.vehicle_fleet WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'tyres',            (SELECT count(*) FROM public.tyre_records WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR issue_date>=v_from) AND (v_to IS NULL OR issue_date<=v_to)),
      'tyre_spend', (v_cost->>'tyre_cost')::numeric,
      'accidents',        (SELECT count(*) FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to)),
      'open_accidents',   (SELECT count(*) FROM public.accidents WHERE organisation_id=v_org AND release_date IS NULL AND lower(coalesce(status,'')) NOT IN ('closed','released') AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to)),
      'claims_claimed',   (SELECT round(coalesce(sum(claim_amount),0)) FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to)),
      'claims_recovered', (SELECT round(coalesce(sum(recovered_amount),0)) FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to)),
      'inspections',      (SELECT count(*) FROM public.inspections WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR inspection_date>=v_from) AND (v_to IS NULL OR inspection_date<=v_to)),
      'work_orders_open', (SELECT count(*) FROM public.work_orders WHERE organisation_id=v_org AND lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled') AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country))
    ),
    'cost', v_cost,
    'breakdowns', jsonb_build_object(
      'severity',        (SELECT jsonb_agg(jsonb_build_object('label',lbl,'value',c)) FROM (SELECT coalesce(nullif(btrim(severity),''),'Unspecified') lbl, count(*) c FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to) GROUP BY 1 ORDER BY c DESC LIMIT 6) x),
      'accidents_by_site',(SELECT jsonb_agg(jsonb_build_object('label',lbl,'value',c)) FROM (SELECT coalesce(nullif(btrim(site),''),'Unassigned') lbl, count(*) c FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to) GROUP BY 1 ORDER BY c DESC LIMIT 8) x),
      'tyres_by_site',   (SELECT jsonb_agg(jsonb_build_object('label',lbl,'value',c)) FROM (SELECT coalesce(nullif(btrim(site),''),'Unassigned') lbl, count(*) c FROM public.tyre_records WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR issue_date>=v_from) AND (v_to IS NULL OR issue_date<=v_to) GROUP BY 1 ORDER BY c DESC LIMIT 8) x),
      'claim_status',    (SELECT jsonb_agg(jsonb_build_object('label',lbl,'value',c)) FROM (SELECT coalesce(nullif(btrim(claim_status),''),'Unspecified') lbl, count(*) c FROM public.accidents WHERE organisation_id=v_org AND (claim_amount>0 OR claim_status IS NOT NULL OR insurer IS NOT NULL) AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to) GROUP BY 1 ORDER BY c DESC LIMIT 6) x)
    ),
    'heatmap', (SELECT COALESCE(jsonb_agg(jsonb_build_object('site',lbl,'severity',sev,'value',c)),'[]'::jsonb) FROM (SELECT coalesce(nullif(btrim(site),''),'Unassigned') lbl, coalesce(nullif(btrim(severity),''),'Unspecified') sev, count(*) c FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to) GROUP BY 1,2 ORDER BY 1,2) x),
    'ops', jsonb_build_object(
      'work_orders_open', (SELECT count(*) FROM public.work_orders WHERE organisation_id=v_org AND lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled') AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'job_cards_today',  (SELECT count(*) FROM public.work_orders WHERE organisation_id=v_org AND coalesce(opened_at,created_at)::date=current_date AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'tyre_changes_today',(SELECT count(*) FROM public.tyre_records WHERE organisation_id=v_org AND issue_date::date=current_date AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'inspections_today',(SELECT count(*) FROM public.inspections WHERE organisation_id=v_org AND inspection_date::date=current_date AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'accidents_today',  (SELECT count(*) FROM public.accidents WHERE organisation_id=v_org AND incident_date::date=current_date AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'alerts_critical',  (SELECT count(*) FROM public.alerts WHERE organisation_id=v_org AND coalesce(resolved,false)=false AND lower(coalesce(severity,'')) IN ('critical','high') AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'pm_overdue',       (SELECT count(*) FROM public.pm_programs WHERE organisation_id=v_org AND status='active' AND next_due IS NOT NULL AND next_due<current_date AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'pm_due_soon',      (SELECT count(*) FROM public.pm_programs WHERE organisation_id=v_org AND status='active' AND next_due IS NOT NULL AND next_due>=current_date AND next_due<=current_date+14 AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'pm_compliance',    (SELECT CASE WHEN count(*) FILTER (WHERE status='active')>0 THEN round(100.0*count(*) FILTER (WHERE status='active' AND (next_due IS NULL OR next_due>=current_date))/count(*) FILTER (WHERE status='active')) ELSE NULL END FROM public.pm_programs WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'wo_by_status',     (SELECT COALESCE(jsonb_agg(jsonb_build_object('label',lbl,'value',c)),'[]'::jsonb) FROM (SELECT coalesce(nullif(btrim(status),''),'Unspecified') lbl, count(*) c FROM public.work_orders WHERE organisation_id=v_org AND lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled') AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) GROUP BY 1 ORDER BY c DESC LIMIT 6) x),
      'wo_by_site',       (SELECT COALESCE(jsonb_agg(jsonb_build_object('label',lbl,'value',c)),'[]'::jsonb) FROM (SELECT coalesce(nullif(btrim(site),''),'Unassigned') lbl, count(*) c FROM public.work_orders WHERE organisation_id=v_org AND lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled') AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) GROUP BY 1 ORDER BY c DESC LIMIT 8) x),
      'wo_by_type',       (SELECT COALESCE(jsonb_agg(jsonb_build_object('label',lbl,'value',c)),'[]'::jsonb) FROM (SELECT coalesce(nullif(btrim(work_type),''),'Unspecified') lbl, count(*) c FROM public.work_orders WHERE organisation_id=v_org AND lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled') AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) GROUP BY 1 ORDER BY c DESC LIMIT 8) x),
      'wo_trend',         (SELECT jsonb_agg(coalesce(s.v,0) ORDER BY m.k) FROM unnest(v_months) m(k) LEFT JOIN (SELECT to_char(coalesce(opened_at,created_at),'YYYY-MM') k, count(*) v FROM public.work_orders WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) GROUP BY 1) s ON s.k=m.k),
      'wo_heatmap',       (SELECT COALESCE(jsonb_agg(jsonb_build_object('site',lbl,'severity',st,'value',c)),'[]'::jsonb) FROM (SELECT coalesce(nullif(btrim(site),''),'Unassigned') lbl, coalesce(nullif(btrim(status),''),'Unspecified') st, count(*) c FROM public.work_orders WHERE organisation_id=v_org AND lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled') AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) GROUP BY 1,2 ORDER BY 1,2) x),
      'open_job_cards',   (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (SELECT jsonb_build_object('wo_no',work_order_no,'asset_no',asset_no,'status',status,'site',site,'priority',priority,'work_type',work_type) x FROM public.work_orders WHERE organisation_id=v_org AND lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled') AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) ORDER BY coalesce(opened_at,created_at) DESC LIMIT 14) q),
      'pm_due_list',      (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (SELECT jsonb_build_object('name',name,'asset_no',asset_no,'next_due',next_due,'priority',priority) x FROM public.pm_programs WHERE organisation_id=v_org AND status='active' AND next_due IS NOT NULL AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) ORDER BY next_due ASC LIMIT 14) q)
    )
  );

  UPDATE public.report_shares SET last_viewed_at = now(), view_count = view_count + 1 WHERE id = t.id;
  RETURN result;
END; $function$

CREATE OR REPLACE FUNCTION public.get_report_tyre_maintenance(p_token text, p_password text DEFAULT NULL::text, p_site text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_from text DEFAULT NULL::text, p_to text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  t public.report_shares%ROWTYPE;
  v_org uuid;
  v_site text := nullif(btrim(p_site),'');
  v_country text := nullif(btrim(p_country),'');
  v_from date; v_to date;
  result jsonb;
BEGIN
  SELECT * INTO t FROM public.report_shares WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid'); END IF;
  IF NOT t.active THEN RETURN jsonb_build_object('ok', false, 'reason', 'revoked'); END IF;
  IF t.expires_at IS NOT NULL AND t.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF t.password_hash IS NOT NULL THEN
    IF p_password IS NULL OR not public.share_password_ok('report', t.id, p_password, t.password_hash) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'password'); END IF;
  END IF;
  IF t.allowed_country IS NOT NULL THEN
    IF v_country IS NOT NULL AND v_country <> t.allowed_country THEN RETURN jsonb_build_object('ok',false,'reason','forbidden'); END IF;
    v_country := t.allowed_country;
  END IF;
  IF t.allowed_site IS NOT NULL THEN
    IF v_site IS NOT NULL AND v_site <> t.allowed_site THEN RETURN jsonb_build_object('ok',false,'reason','forbidden'); END IF;
    v_site := t.allowed_site;
  END IF;
  v_org := t.organisation_id;
  BEGIN v_from := nullif(btrim(p_from),'')::date; EXCEPTION WHEN others THEN v_from := NULL; END;
  BEGIN v_to   := nullif(btrim(p_to),'')::date;   EXCEPTION WHEN others THEN v_to   := NULL; END;

  WITH tr AS (
    SELECT status, removal_reason, position, site, cost_per_tyre, total_km, brand
    FROM public.tyre_records
    WHERE organisation_id = v_org
      AND (v_site IS NULL OR site = v_site)
      AND (v_country IS NULL OR country = v_country)
  ),
  wo AS (
    SELECT work_type, status, site, COALESCE(labour_cost,0)+COALESCE(parts_cost,0) AS cost, opened_at::date d
    FROM public.work_orders
    WHERE organisation_id = v_org
      AND (v_site IS NULL OR site = v_site)
      AND (v_country IS NULL OR country = v_country)
      AND (v_from IS NULL OR opened_at::date >= v_from)
      AND (v_to   IS NULL OR opened_at::date <= v_to)
  ),
  li AS (
    SELECT task FROM public.work_order_line_items
    WHERE organisation_id = v_org
      AND (v_site IS NULL OR site = v_site)
      AND (v_country IS NULL OR country = v_country)
      AND (v_from IS NULL OR opened_date >= v_from)
      AND (v_to   IS NULL OR opened_date <= v_to)
  )
  SELECT jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'company', coalesce((SELECT name FROM public.organisations WHERE id=v_org LIMIT 1),'TyrePulse'),
    'name', t.name,
    'tyre_failure', jsonb_build_object(
      'active',  (SELECT count(*) FROM tr WHERE status='Active'),
      'removed', (SELECT count(*) FROM tr WHERE status='Removed'),
      'total',   (SELECT count(*) FROM tr),
      'avg_cpk', (SELECT round(avg(cost_per_tyre/nullif(total_km,0))::numeric,3) FROM tr WHERE cost_per_tyre>0 AND total_km>1000),
      'avg_life_km', (SELECT round(avg(total_km)) FROM tr WHERE total_km>0),
      'reasons', (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (
          SELECT removal_reason AS label, count(*) AS n FROM tr WHERE status='Removed' AND removal_reason IS NOT NULL
            AND NOT (regexp_replace(lower(removal_reason), '[^a-z0-9]', '', 'g') = ANY (coalesce(
              (SELECT array_agg(regexp_replace(lower(bt), '[^a-z0-9]', '', 'g'))
                 FROM unnest(public.brain_tokens('tyre_brand') || ARRAY['rock holder','vglory']) bt),
              '{}'::text[])))
          GROUP BY removal_reason ORDER BY count(*) DESC LIMIT 12) x),
      'by_position', (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (
          SELECT COALESCE(NULLIF(position,''),'Unknown') AS label, count(*) AS n FROM tr WHERE status='Removed'
          GROUP BY 1 ORDER BY count(*) DESC LIMIT 14) x)
    ),
    'maintenance', jsonb_build_object(
      'job_cards',   (SELECT count(*) FROM wo),
      'line_items',  (SELECT count(*) FROM li),
      'total_spend', (SELECT COALESCE(round(sum(cost)),0) FROM wo),
      'open_jobs',   (SELECT count(*) FROM wo WHERE status NOT IN ('Completed','Cancelled')),
      'by_work_type', (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (
          SELECT work_type AS label, count(*) AS jobs, COALESCE(round(sum(cost)),0) AS spend
          FROM wo GROUP BY work_type ORDER BY sum(cost) DESC NULLS LAST) x),
      'spend_by_site', (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (
          SELECT COALESCE(NULLIF(site,''),'Unspecified') AS label, COALESCE(round(sum(cost)),0) AS spend
          FROM wo GROUP BY 1 ORDER BY sum(cost) DESC NULLS LAST LIMIT 12) x),
      'top_tasks', (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (
          SELECT task AS label, count(*) AS n FROM li WHERE task IS NOT NULL AND task<>''
          GROUP BY task ORDER BY count(*) DESC LIMIT 12) x),
      'monthly_spend', (SELECT COALESCE(jsonb_agg(x ORDER BY x.m),'[]'::jsonb) FROM (
          SELECT to_char(date_trunc('month', d),'YYYY-MM') AS m, COALESCE(round(sum(cost)),0) AS spend
          FROM wo WHERE d IS NOT NULL AND d >= (current_date - interval '12 months') GROUP BY 1) x)
    )
  ) INTO result;

  UPDATE public.report_shares SET view_count = COALESCE(view_count,0)+1, last_viewed_at = now() WHERE id = t.id;
  RETURN result;
END;
$function$

CREATE OR REPLACE FUNCTION public.get_workshop_snapshot(p_token text, p_password text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  t public.report_shares%ROWTYPE;
  v_org uuid; v_company text;
  v_today date := current_date;
  k_working int; k_available int; k_waiting_parts int; k_waiting_approval int;
  k_waiting_tools int; k_waiting_vehicle int; k_on_break int; k_training int;
  k_on_duty int; k_absent int;
  k_open int; k_overdue int; k_vor int; k_done_today int;
  v_util numeric;
  v_jobs_by_status jsonb; v_open_cards jsonb; v_vor_list jsonb; v_alerts jsonb;
  result jsonb;
BEGIN
  -- Validate the share token EXACTLY like get_report_snapshot.
  SELECT * INTO t FROM public.report_shares WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid'); END IF;
  IF NOT t.active THEN RETURN jsonb_build_object('ok', false, 'reason', 'revoked'); END IF;
  IF t.expires_at IS NOT NULL AND t.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF t.password_hash IS NOT NULL THEN
    IF p_password IS NULL OR not public.share_password_ok('report', t.id, p_password, t.password_hash) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'password'); END IF;
  END IF;
  IF t.allowed_country IS NOT NULL OR t.allowed_site IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason','forbidden'); END IF;
  v_org := t.organisation_id;

  SELECT name INTO v_company FROM public.organisations WHERE id=v_org LIMIT 1;
  v_company := coalesce(nullif(replace(replace(coalesce(v_company,''), '"', ''), '\', ''), ''), 'TyrePulse');

  -- Technician roster + derived live status (defensive: any missing table degrades to zeros).
  -- No PII leaves this block: only aggregate COUNTS are kept.
  BEGIN
    WITH roster AS (
      SELECT id AS user_id FROM public.profiles
      WHERE organisation_id = v_org
        AND lower(coalesce(role,'')) IN ('tyre man','tyre_man','inspector','technician','mechanic','foreman','maintenance supervisor')
    ),
    att AS (
      SELECT DISTINCT user_id FROM public.workshop_attendance
      WHERE organisation_id = v_org AND check_in::date = v_today
    ),
    last_ev AS (
      SELECT DISTINCT ON (user_id) user_id, event_type, reason_code
      FROM public.tech_activity_events
      WHERE organisation_id = v_org AND at >= v_today
        AND event_type NOT IN ('request_assistance','report_problem')
      ORDER BY user_id, at DESC
    ),
    universe AS (
      SELECT user_id FROM roster
      UNION SELECT user_id FROM att
      UNION SELECT user_id FROM last_ev
    ),
    tech AS (
      SELECT u.user_id,
        CASE
          WHEN le.event_type IS NULL AND a.user_id IS NULL THEN 'absent'
          WHEN le.event_type = 'check_out' THEN 'off_duty'
          WHEN le.event_type IN ('start_job','resume_job') THEN 'working'
          WHEN le.event_type = 'start_break' THEN 'on_break'
          WHEN le.event_type = 'training' THEN 'training'
          WHEN le.event_type = 'request_parts' THEN 'waiting_parts'
          WHEN le.event_type = 'waiting_tools' THEN 'waiting_tools'
          WHEN le.event_type = 'waiting_approval' THEN 'waiting_approval'
          WHEN le.event_type = 'waiting_vehicle' THEN 'waiting_vehicle'
          WHEN le.event_type = 'pause_job' THEN
            CASE lower(coalesce(le.reason_code,''))
              WHEN 'parts' THEN 'waiting_parts'
              WHEN 'tools' THEN 'waiting_tools'
              WHEN 'approval' THEN 'waiting_approval'
              WHEN 'vehicle' THEN 'waiting_vehicle'
              WHEN 'break' THEN 'on_break'
              ELSE 'available' END
          ELSE 'available'
        END AS status
      FROM universe u
      LEFT JOIN last_ev le ON le.user_id = u.user_id
      LEFT JOIN att a ON a.user_id = u.user_id
    )
    SELECT
      count(*) FILTER (WHERE status='working'),
      count(*) FILTER (WHERE status='available'),
      count(*) FILTER (WHERE status='waiting_parts'),
      count(*) FILTER (WHERE status='waiting_approval'),
      count(*) FILTER (WHERE status='waiting_tools'),
      count(*) FILTER (WHERE status='waiting_vehicle'),
      count(*) FILTER (WHERE status='on_break'),
      count(*) FILTER (WHERE status='training'),
      count(*) FILTER (WHERE status NOT IN ('off_duty','absent')),
      count(*) FILTER (WHERE status='absent')
    INTO k_working,k_available,k_waiting_parts,k_waiting_approval,k_waiting_tools,k_waiting_vehicle,k_on_break,k_training,k_on_duty,k_absent
    FROM tech;
  EXCEPTION WHEN others THEN
    k_working:=0;k_available:=0;k_waiting_parts:=0;k_waiting_approval:=0;k_waiting_tools:=0;k_waiting_vehicle:=0;k_on_break:=0;k_training:=0;k_on_duty:=0;k_absent:=0;
  END;

  -- Utilization: simple productive-vs-onduty ratio from today's event intervals.
  -- Each event opens an interval until the next event (or now); classify by the
  -- opening event. Honest NULL when there is no on-duty time recorded today.
  BEGIN
    WITH ev AS (
      SELECT event_type,
        extract(epoch from (coalesce(lead(at) OVER (PARTITION BY user_id ORDER BY at), now()) - at))/60.0 AS mins
      FROM public.tech_activity_events
      WHERE organisation_id = v_org AND at >= v_today
        AND event_type NOT IN ('request_assistance','report_problem')
    )
    SELECT CASE WHEN sum(mins) FILTER (WHERE event_type NOT IN ('check_out','start_break','training')) > 0
      THEN round(100.0 * coalesce(sum(mins) FILTER (WHERE event_type IN ('start_job','resume_job')),0)
        / sum(mins) FILTER (WHERE event_type NOT IN ('check_out','start_break','training')))
      ELSE NULL END
    INTO v_util FROM ev;
  EXCEPTION WHEN others THEN v_util := NULL; END;

  -- Job-card KPIs.
  BEGIN
    SELECT
      count(*) FILTER (WHERE lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled')),
      count(*) FILTER (WHERE target_completion IS NOT NULL AND target_completion < now() AND lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled')),
      count(*) FILTER (WHERE vor = true AND lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled')),
      count(*) FILTER (WHERE lower(coalesce(status,'')) IN ('completed','closed','done') AND completed_at::date = v_today)
    INTO k_open,k_overdue,k_vor,k_done_today
    FROM public.work_orders WHERE organisation_id = v_org;
  EXCEPTION WHEN others THEN k_open:=0;k_overdue:=0;k_vor:=0;k_done_today:=0; END;

  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('label',lbl,'value',c)),'[]'::jsonb)
    INTO v_jobs_by_status FROM (
      SELECT coalesce(nullif(btrim(status),''),'Unspecified') lbl, count(*) c
      FROM public.work_orders WHERE organisation_id = v_org
        AND lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled')
      GROUP BY 1 ORDER BY c DESC LIMIT 8) x;
  EXCEPTION WHEN others THEN v_jobs_by_status := '[]'::jsonb; END;

  BEGIN
    SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_open_cards FROM (
      SELECT jsonb_build_object('wo_no',work_order_no,'asset_no',asset_no,'status',status,'priority',priority,'site',site) x
      FROM public.work_orders WHERE organisation_id = v_org
        AND lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled')
      ORDER BY coalesce(opened_at,created_at) DESC LIMIT 14) q;
  EXCEPTION WHEN others THEN v_open_cards := '[]'::jsonb; END;

  BEGIN
    SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) INTO v_vor_list FROM (
      SELECT jsonb_build_object('asset_no',asset_no,'site',site,'since',vor_since) x
      FROM public.work_orders WHERE organisation_id = v_org AND vor = true
        AND lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled')
      ORDER BY vor_since ASC NULLS LAST LIMIT 14) q;
  EXCEPTION WHEN others THEN v_vor_list := '[]'::jsonb; END;

  -- Safety / operations alerts, derived from the aggregate counts (NO PII).
  v_alerts := '[]'::jsonb;
  IF coalesce(k_vor,0) > 0 THEN v_alerts := v_alerts || jsonb_build_object('level','critical','message', k_vor || ' vehicle(s) off road'); END IF;
  IF coalesce(k_overdue,0) > 0 THEN v_alerts := v_alerts || jsonb_build_object('level','warning','message', k_overdue || ' job(s) past target time'); END IF;
  IF coalesce(k_waiting_parts,0) > 0 THEN v_alerts := v_alerts || jsonb_build_object('level','warning','message', k_waiting_parts || ' technician(s) waiting for parts'); END IF;
  IF coalesce(k_waiting_approval,0) > 0 THEN v_alerts := v_alerts || jsonb_build_object('level','info','message', k_waiting_approval || ' technician(s) waiting for approval'); END IF;
  IF coalesce(k_absent,0) > 0 THEN v_alerts := v_alerts || jsonb_build_object('level','info','message', k_absent || ' rostered technician(s) not checked in'); END IF;

  result := jsonb_build_object(
    'ok', true, 'company', v_company, 'generated_at', now(),
    'rotate_seconds', t.rotate_seconds, 'refresh_seconds', t.refresh_seconds,
    'kpis', jsonb_build_object(
      'open_jobs', coalesce(k_open,0),
      'overdue_jobs', coalesce(k_overdue,0),
      'vehicles_off_road', coalesce(k_vor,0),
      'jobs_completed_today', coalesce(k_done_today,0),
      'working', coalesce(k_working,0),
      'available', coalesce(k_available,0),
      'waiting_parts', coalesce(k_waiting_parts,0),
      'waiting_approval', coalesce(k_waiting_approval,0),
      'on_break', coalesce(k_on_break,0),
      'absent', coalesce(k_absent,0),
      'on_duty', coalesce(k_on_duty,0),
      'utilization', v_util
    ),
    'jobs_by_status', v_jobs_by_status,
    'open_job_cards', v_open_cards,
    'vor_list', v_vor_list,
    'safety_alerts', v_alerts
  );

  UPDATE public.report_shares SET last_viewed_at = now(), view_count = view_count + 1 WHERE id = t.id;
  RETURN result;
END; $function$

