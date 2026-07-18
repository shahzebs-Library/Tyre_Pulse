-- V279 - Report share snapshot: Cost-per-unit + richer Operations Command data
-- Extends the anon-callable get_report_snapshot aggregate (V252/V262/V263/V264)
-- with two additions, using ONLY org/site/country-scoped server aggregates (no
-- new grant, no table exposed):
--   * cost  = unit-aware cost intelligence for the filtered window:
--             tyre_cost + maintenance_cost (+ pm service) = total_cost, the
--             running units (km from odometer_logs deltas, engine hours from
--             engine_hours_logs deltas, m3 from production_logs), the per-unit
--             costs (cost per km / hour / m3, tyre CPK; NULL when the denominator
--             is 0 - never faked), and 12-month total-cost + m3 trends.
--   * ops.* gains wo_by_status / wo_by_site / wo_by_type / wo_trend (12mo) /
--             pm_compliance (0..100, NULL when no active plans) / wo_heatmap
--             (site x status of open work orders) for the Operations Command page.
-- Cost window: honours p_from/p_to when set, else the rolling 12-month window.
-- SECURITY DEFINER; search_path pinned; grants preserved (re-granted at foot).

CREATE OR REPLACE FUNCTION public.get_report_snapshot(
  p_token text, p_password text DEFAULT NULL::text,
  p_site text DEFAULT NULL::text, p_country text DEFAULT NULL::text,
  p_from text DEFAULT NULL::text, p_to text DEFAULT NULL::text)
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
BEGIN
  SELECT * INTO t FROM public.report_shares WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid'); END IF;
  IF NOT t.active THEN RETURN jsonb_build_object('ok', false, 'reason', 'revoked'); END IF;
  IF t.expires_at IS NOT NULL AND t.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF t.password_hash IS NOT NULL THEN
    IF p_password IS NULL OR crypt(p_password, t.password_hash) <> t.password_hash THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'password'); END IF;
  END IF;
  v_org := t.organisation_id;

  BEGIN v_from := nullif(btrim(p_from),'')::date; EXCEPTION WHEN others THEN v_from := NULL; END;
  BEGIN v_to   := nullif(btrim(p_to),'')::date;   EXCEPTION WHEN others THEN v_to   := NULL; END;

  SELECT array_agg(to_char(m, 'YYYY-MM') ORDER BY m) INTO v_months
  FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m;

  SELECT value::text INTO v_company FROM public.settings WHERE key = 'company_name' LIMIT 1;
  v_company := coalesce(nullif(replace(replace(v_company, '"', ''), '\', ''), ''), 'TyrePulse');
  SELECT coalesce(value_text, value::text) INTO v_logo FROM public.system_config WHERE key = 'company_logo' LIMIT 1;
  v_logo := nullif(replace(replace(coalesce(v_logo,''), '"', ''), '\', ''), '');

  -- Cost window: explicit range if given, else the rolling 12-month window.
  v_cfrom := coalesce(v_from, (date_trunc('month', now()) - interval '11 months')::date);
  v_cto   := coalesce(v_to, now()::date);

  -- Running units (distance/hours = last minus first reading per asset in window;
  -- assets with a single reading contribute 0, which is honest, not fabricated).
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

  result := jsonb_build_object(
    'ok', true, 'company', v_company, 'logo', v_logo, 'name', t.name, 'generated_at', now(),
    'rotate_seconds', t.rotate_seconds, 'refresh_seconds', t.refresh_seconds, 'pages', t.pages,
    'layout', t.layout,
    'filters', jsonb_build_object('site', v_site, 'country', v_country, 'from', v_from, 'to', v_to),
    'sites', (SELECT COALESCE(jsonb_agg(s ORDER BY s),'[]'::jsonb) FROM (SELECT DISTINCT nullif(btrim(site),'') s FROM public.tyre_records WHERE organisation_id=v_org AND site IS NOT NULL UNION SELECT DISTINCT nullif(btrim(site),'') FROM public.accidents WHERE organisation_id=v_org AND site IS NOT NULL) u WHERE s IS NOT NULL LIMIT 60),
    'countries', (SELECT COALESCE(jsonb_agg(c ORDER BY c),'[]'::jsonb) FROM (SELECT DISTINCT nullif(btrim(country),'') c FROM public.tyre_records WHERE organisation_id=v_org AND country IS NOT NULL) u WHERE c IS NOT NULL LIMIT 30),
    'labels', to_jsonb((SELECT array_agg(to_char(to_date(k,'YYYY-MM'),'Mon YY') ORDER BY k) FROM unnest(v_months) k)),
    'kpis', jsonb_build_object(
      'fleet',            (SELECT count(*) FROM public.vehicle_fleet WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'tyres',            (SELECT count(*) FROM public.tyre_records WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR issue_date>=v_from) AND (v_to IS NULL OR issue_date<=v_to)),
      'tyre_spend',       (SELECT round(coalesce(sum(cost_per_tyre*coalesce(nullif(qty,0),1)),0)) FROM public.tyre_records WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR issue_date>=v_from) AND (v_to IS NULL OR issue_date<=v_to)),
      'accidents',        (SELECT count(*) FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to)),
      'open_accidents',   (SELECT count(*) FROM public.accidents WHERE organisation_id=v_org AND release_date IS NULL AND lower(coalesce(status,'')) NOT IN ('closed','released') AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to)),
      'claims_claimed',   (SELECT round(coalesce(sum(claim_amount),0)) FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to)),
      'claims_recovered', (SELECT round(coalesce(sum(recovered_amount),0)) FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to)),
      'inspections',      (SELECT count(*) FROM public.inspections WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR inspection_date>=v_from) AND (v_to IS NULL OR inspection_date<=v_to)),
      'work_orders_open', (SELECT count(*) FROM public.work_orders WHERE organisation_id=v_org AND lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled') AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country))
    ),
    'cost', jsonb_build_object(
      'from', v_cfrom, 'to', v_cto,
      'tyre_cost', v_tyre_cost, 'maintenance_cost', v_maint_cost, 'total_cost', v_total_cost,
      'km', round(coalesce(v_km,0)), 'engine_hours', round(coalesce(v_hours,0),1), 'm3', round(coalesce(v_m3,0),1),
      'cost_per_km',   CASE WHEN coalesce(v_km,0)>0    THEN round(v_total_cost/v_km,2)    ELSE NULL END,
      'cost_per_hour', CASE WHEN coalesce(v_hours,0)>0 THEN round(v_total_cost/v_hours,2) ELSE NULL END,
      'cost_per_m3',   CASE WHEN coalesce(v_m3,0)>0    THEN round(v_total_cost/v_m3,2)    ELSE NULL END,
      'tyre_cpk',      CASE WHEN coalesce(v_km,0)>0    THEN round(v_tyre_cost/v_km,2)     ELSE NULL END,
      'trend', jsonb_build_object(
        'total', (SELECT jsonb_agg(round(coalesce(tt.v,0)+coalesce(ww.v,0)+coalesce(pp.v,0)) ORDER BY m.k) FROM unnest(v_months) m(k)
          LEFT JOIN (SELECT to_char(issue_date,'YYYY-MM') k, sum(cost_per_tyre*coalesce(nullif(qty,0),1)) v FROM public.tyre_records WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) GROUP BY 1) tt ON tt.k=m.k
          LEFT JOIN (SELECT to_char(coalesce(completed_at,opened_at,created_at),'YYYY-MM') k, sum(coalesce(labour_cost,0)+coalesce(parts_cost,0)+coalesce(lubricant_cost,0)+coalesce(outside_repair_cost,0)) v FROM public.work_orders WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) GROUP BY 1) ww ON ww.k=m.k
          LEFT JOIN (SELECT to_char(service_date,'YYYY-MM') k, sum(total_cost) v FROM public.pm_service_records WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) GROUP BY 1) pp ON pp.k=m.k),
        'm3', (SELECT jsonb_agg(coalesce(s.v,0) ORDER BY m.k) FROM unnest(v_months) m(k) LEFT JOIN (SELECT to_char(period_date,'YYYY-MM') k, sum(m3) v FROM public.production_logs WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) GROUP BY 1) s ON s.k=m.k)
      )
    ),
    'trends', jsonb_build_object(
      'tyre_spend',       (SELECT jsonb_agg(coalesce(s.v,0) ORDER BY m.k) FROM unnest(v_months) m(k) LEFT JOIN (SELECT to_char(issue_date,'YYYY-MM') k, sum(cost_per_tyre*coalesce(nullif(qty,0),1)) v FROM public.tyre_records WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) GROUP BY 1) s ON s.k=m.k),
      'accidents',        (SELECT jsonb_agg(coalesce(s.v,0) ORDER BY m.k) FROM unnest(v_months) m(k) LEFT JOIN (SELECT to_char(incident_date,'YYYY-MM') k, count(*) v FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) GROUP BY 1) s ON s.k=m.k),
      'claims_claimed',   (SELECT jsonb_agg(coalesce(s.v,0) ORDER BY m.k) FROM unnest(v_months) m(k) LEFT JOIN (SELECT to_char(incident_date,'YYYY-MM') k, sum(claim_amount) v FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) GROUP BY 1) s ON s.k=m.k),
      'claims_recovered', (SELECT jsonb_agg(coalesce(s.v,0) ORDER BY m.k) FROM unnest(v_months) m(k) LEFT JOIN (SELECT to_char(incident_date,'YYYY-MM') k, sum(recovered_amount) v FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) GROUP BY 1) s ON s.k=m.k),
      'inspections',      (SELECT jsonb_agg(coalesce(s.v,0) ORDER BY m.k) FROM unnest(v_months) m(k) LEFT JOIN (SELECT to_char(inspection_date,'YYYY-MM') k, count(*) v FROM public.inspections WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) GROUP BY 1) s ON s.k=m.k)
    ),
    'breakdowns', jsonb_build_object(
      'severity',        (SELECT jsonb_agg(jsonb_build_object('label',lbl,'value',c)) FROM (SELECT coalesce(nullif(btrim(severity),''),'Unspecified') lbl, count(*) c FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to) GROUP BY 1 ORDER BY c DESC LIMIT 6) x),
      'accidents_by_site',(SELECT jsonb_agg(jsonb_build_object('label',lbl,'value',c)) FROM (SELECT coalesce(nullif(btrim(site),''),'Unassigned') lbl, count(*) c FROM public.accidents WHERE organisation_id=v_org AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to) GROUP BY 1 ORDER BY c DESC LIMIT 8) x),
      'tyres_by_site',   (SELECT jsonb_agg(jsonb_build_object('label',lbl,'value',c)) FROM (SELECT coalesce(nullif(btrim(site),''),'Unassigned') lbl, count(*) c FROM public.tyre_records WHERE organisation_id=v_org AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR issue_date>=v_from) AND (v_to IS NULL OR issue_date<=v_to) GROUP BY 1 ORDER BY c DESC LIMIT 8) x),
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
      'wo_by_site',       (SELECT COALESCE(jsonb_agg(jsonb_build_object('label',lbl,'value',c)),'[]'::jsonb) FROM (SELECT coalesce(nullif(btrim(site),''),'Unassigned') lbl, count(*) c FROM public.work_orders WHERE organisation_id=v_org AND lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled') AND (v_country IS NULL OR country=v_country) GROUP BY 1 ORDER BY c DESC LIMIT 8) x),
      'wo_by_type',       (SELECT COALESCE(jsonb_agg(jsonb_build_object('label',lbl,'value',c)),'[]'::jsonb) FROM (SELECT coalesce(nullif(btrim(work_type),''),'Unspecified') lbl, count(*) c FROM public.work_orders WHERE organisation_id=v_org AND lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled') AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) GROUP BY 1 ORDER BY c DESC LIMIT 8) x),
      'wo_trend',         (SELECT jsonb_agg(coalesce(s.v,0) ORDER BY m.k) FROM unnest(v_months) m(k) LEFT JOIN (SELECT to_char(coalesce(opened_at,created_at),'YYYY-MM') k, count(*) v FROM public.work_orders WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) GROUP BY 1) s ON s.k=m.k),
      'wo_heatmap',       (SELECT COALESCE(jsonb_agg(jsonb_build_object('site',lbl,'severity',st,'value',c)),'[]'::jsonb) FROM (SELECT coalesce(nullif(btrim(site),''),'Unassigned') lbl, coalesce(nullif(btrim(status),''),'Unspecified') st, count(*) c FROM public.work_orders WHERE organisation_id=v_org AND lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled') AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) GROUP BY 1,2 ORDER BY 1,2) x),
      'open_job_cards',   (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (SELECT jsonb_build_object('wo_no',work_order_no,'asset_no',asset_no,'status',status,'site',site,'priority',priority,'work_type',work_type) x FROM public.work_orders WHERE organisation_id=v_org AND lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled') AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) ORDER BY coalesce(opened_at,created_at) DESC LIMIT 14) q),
      'pm_due_list',      (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (SELECT jsonb_build_object('name',name,'asset_no',asset_no,'next_due',next_due,'priority',priority) x FROM public.pm_programs WHERE organisation_id=v_org AND status='active' AND next_due IS NOT NULL AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) ORDER BY next_due ASC LIMIT 14) q)
    )
  );

  UPDATE public.report_shares SET last_viewed_at = now(), view_count = view_count + 1 WHERE id = t.id;
  RETURN result;
END; $function$;

REVOKE ALL ON FUNCTION public.get_report_snapshot(text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_report_snapshot(text,text,text,text,text,text) TO anon, authenticated;
