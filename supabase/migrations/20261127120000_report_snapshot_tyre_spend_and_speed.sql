-- Shared TV board (get_report_snapshot): tyre spend from the expense grid per
-- currency, the 12-month trends restored, and the call made fast enough for
-- the anon 3 s statement timeout.
--
-- STATUS: AUTHORED, NOT APPLIED. The main session applies it.
--
-- WHAT WAS WRONG (live, measured 2026-11-27 on the only active share,
-- "Shared report", no country/site restriction = all three countries)
--   1. "Tyre spend 0". kpis.tyre_spend is cost.tyre_cost from
--      _report_cost_block, which is NULL whenever more than one currency is in
--      scope (correct - SAR+AED+EGP is not a quantity). The board has no
--      per-country value to fall back on, so the tile printed 0.
--   2. "Tyre spend and accidents" chart empty. The 2026-11-24 report-sharing
--      hardening migration rebuilt get_report_snapshot and the top-level
--      'trends' object was not carried over at all. Every viewer page that
--      reads snapshot.trends (Trends, Spend trend, Cost & claims, Risk,
--      sparklines, custom-board series blocks) has drawn nothing since.
--   3. Slow / "Report sharing is not available right now". anon runs with
--      statement_timeout = 3 s. The call took 23.2 s cold, 5.7 s warm
--      (EXPLAIN ANALYZE as anon, real token, rolled back), so the first open
--      always timed out. Part timings (warm, ms):
--        work_orders maintenance cost (result never used) ...... 897
--        work_orders open job-card list ........................ 861
--        work_orders 12-month trend (reads all history) ........ 967
--        work_orders "job cards today" (coalesce()::date) ...... 739
--        work_orders open-status filter, run 7 times ........ 7 x 71
--        _report_cost_block (two trends read all history) ...... 402
--        odometer / engine hours / m3 / cost_per_tyre (unused)  ~ 56
--
-- WHAT THIS DOES
--   _report_cost_block: the two 12-month trend subqueries get a lower bound
--     on the first month of the window. Rows older than the window never
--     reached the output (they are LEFT JOINed onto the 12 month keys), so
--     the result is identical; the planner can now use the
--     (organisation_id, event_date) / (organisation_id, period_date) indexes.
--   get_report_snapshot:
--     a. drops the six local computations whose results were never put in the
--        payload (v_km, v_hours, v_m3, v_tyre_cost, v_maint_cost,
--        v_total_cost) - the cost block computes the real ones;
--     b. reads open work orders ONCE (MATERIALIZED CTE) and derives
--        work_orders_open (kpis + ops), wo_by_status, wo_by_site, wo_by_type,
--        wo_heatmap and open_job_cards from it - same filters and limits. open_job_cards
--        gains a tie-break (work_order_no DESC) and wo_by_status/site/type gain
--        one (label): many KSA job cards share a date-only timestamp and
--        several groups share a count, so the old order inside a tie was
--        arbitrary and could differ between two calls;
--     c. job_cards_today and wo_trend use OR-split sargable predicates that
--        are exactly equivalent to coalesce(opened_at, created_at) (session
--        time zone unchanged), so the opened_at index is used;
--     d. CORRECTION 1: kpis.tyre_spend_by_country = [{country, currency,
--        value}] from the cost block's by_country (parts_consumption.tyre_cost,
--        each in its own currency). kpis.tyre_spend is unchanged: the scalar
--        when one currency is in scope, NULL otherwise;
--     e. CORRECTION 2: 'trends' restored with the V279 keys. tyre_spend comes
--        from parts_consumption.tyre_cost (the expense grid), NOT
--        tyre_records.cost_per_tyre, and is NULL when more than one currency
--        is in scope; trends.tyre_spend_by_country carries one 12-month series
--        per country with its currency. accidents / claims_claimed /
--        claims_recovered / inspections are as V279 (bounded to the window).
--   Every other key is byte-identical: proven by md5 of the payload minus
--   generated_at, trends and kpis.tyre_spend_by_country, old vs new, in one
--   rolled-back transaction (see VERIFY). Security, token, password,
--   allowed_country/site and view_count behaviour are copied verbatim.
--
-- KNOWN, NOT CHANGED HERE: kpis.claims_claimed / claims_recovered and the
-- claims trends still add accident claim amounts across countries under the
-- all-countries scope (as before this migration). Accident claims carry no
-- currency column; fixing it needs a decision on how a claim's currency is
-- known.
--
-- TIMING, measured in one rolled-back transaction as anon, real token, same
-- warm cache, six scopes (all / KSA / UAE / KSA+NHC / 2026 YTD / Egypt from
-- June), old -> new ms: 1575->1318, 1410->588, 537->187, 564->256,
-- 1456->838, 2283->1431. The cold first call that started all this was
-- 23.2 s, dominated by the four full work_orders scans now removed.
--
-- PARITY (same transaction): every key of the payload except generated_at,
-- the new trends object and the new kpis.tyre_spend_by_country is
-- byte-identical for UAE, KSA+NHC and Egypt. For the all / KSA / YTD scopes
-- the ONLY text differences are ops.wo_by_site (the 8th slot, where several
-- sites tie on 1 open job card: old picked RIY-MET arbitrarily, new picks
-- by label) and ops.open_job_cards (same-day ties). Counts are identical.
-- cost (all six scopes) is byte-identical.
--
-- ROLLBACK: re-run the saved definitions:
--   select def from _bak.report_snapshot_v20261127b where fn='get_report_snapshot';
--   select def from _bak.report_snapshot_v20261127b where fn='_report_cost_block';

begin;

create schema if not exists _bak;
create table if not exists _bak.report_snapshot_v20261127b (saved_at timestamptz, fn text, def text);
insert into _bak.report_snapshot_v20261127b
select now(), 'get_report_snapshot', pg_get_functiondef('public.get_report_snapshot(text,text,text,text,text,text)'::regprocedure)
union all
select now(), '_report_cost_block', pg_get_functiondef('public._report_cost_block(uuid,text,text,date,date,text[])'::regprocedure);

-- Guard: this body was written against these exact live definitions.
do $g$
begin
  if md5(pg_get_functiondef('public.get_report_snapshot(text,text,text,text,text,text)'::regprocedure)) <> '1272068171f5cfb094bae1a8a742439f' then
    raise exception 'get_report_snapshot changed since this migration was written; re-derive it';
  end if;
  if md5(pg_get_functiondef('public._report_cost_block(uuid,text,text,date,date,text[])'::regprocedure)) <> '4d434a1646767d8f795a19e78cb80375' then
    raise exception '_report_cost_block changed since this migration was written; re-derive it';
  end if;
end $g$;

CREATE OR REPLACE FUNCTION public._report_cost_block(p_org uuid, p_site text, p_country text, p_from date, p_to date, p_months text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_by jsonb;
  v_curs text[];
  v_one boolean;
  v_internal numeric; v_tyre numeric; v_maint numeric;
  v_sco numeric; v_sany numeric; v_total numeric;
  v_km numeric; v_hours numeric; v_m3 numeric;
  v_dropped int;
  v_days int := greatest(1, (p_to - p_from) + 1);
  -- First day of the first trend month. Rows before it cannot join a month key.
  v_m0 date := to_date(p_months[1], 'YYYY-MM');
begin
  -- Per country, each in its own currency, internal + SCO + SANY so the board
  -- and the Cost per M3 screen answer the same question the same way.
  select coalesce(jsonb_agg(jsonb_build_object(
           'country', c.country, 'currency', c.currency,
           'total', c.internal + c.sco + c.sany,
           'internal', c.internal, 'tyre', c.tyre, 'maintenance', c.maint,
           'sco', c.sco, 'sany', c.sany
         ) ORDER BY c.country), '[]'::jsonb),
         coalesce(array_agg(distinct c.currency) filter (where c.currency is not null), '{}')
    into v_by, v_curs
    from (
      select p.country,
             max(p.currency) as currency,
             round(sum(coalesce(p.line_cost, 0))) as internal,
             round(sum(coalesce(p.tyre_cost, 0))) as tyre,
             round(sum(coalesce(p.spare_cost, 0) + coalesce(p.oil_cost, 0))) as maint,
             coalesce((select round(sum(s.amount)) from public.sco_costs s
                        where s.organisation_id = p_org and s.country = p.country
                          and (p_site is null or s.site = p_site)
                          and s.period_date between p_from and p_to), 0) as sco,
             coalesce((select round(sum(y.amount)) from public.sany_invoices y
                        where y.organisation_id = p_org and y.country = p.country
                          and (p_site is null or y.site = p_site)
                          and coalesce(y.doc_type, '') <> 'detail'
                          and y.period_date between p_from and p_to), 0) as sany
        from public.parts_consumption p
       where p.organisation_id = p_org
         and (p_site is null or p.site = p_site)
         and (p_country is null or p.country = p_country)
         and p.event_date between p_from and p_to
       group by p.country
    ) c;

  v_one := coalesce(array_length(v_curs, 1), 0) = 1;

  if v_one then
    select coalesce((v_by->0->>'internal')::numeric, 0),
           coalesce((v_by->0->>'tyre')::numeric, 0),
           coalesce((v_by->0->>'maintenance')::numeric, 0),
           coalesce((v_by->0->>'sco')::numeric, 0),
           coalesce((v_by->0->>'sany')::numeric, 0)
      into v_internal, v_tyre, v_maint, v_sco, v_sany;
    v_total := v_internal + v_sco + v_sany;
  end if;

  select coalesce(sum(d.km), 0) into v_km from (
    select max(odometer_km) - min(odometer_km) as km
      from public.odometer_logs
     where organisation_id = p_org and (p_site is null or site = p_site)
       and (p_country is null or country = p_country)
       and odometer_km is not null and reading_date between p_from and p_to
     group by asset_no having count(*) >= 2
  ) d;

  -- An asset cannot run more hours than the window has. A span above that is a
  -- bad reading; it is dropped and counted, never quietly folded into the total.
  select coalesce(sum(d.h) filter (where d.h <= v_days * 24), 0),
         count(*) filter (where d.h > v_days * 24)
    into v_hours, v_dropped
    from (
      select max(engine_hours) - min(engine_hours) as h
        from public.engine_hours_logs
       where organisation_id = p_org and (p_site is null or site = p_site)
         and (p_country is null or country = p_country)
         and engine_hours is not null and reading_date between p_from and p_to
       group by asset_no having count(*) >= 2
    ) d;

  select coalesce(sum(coalesce(approved_m3, m3, 0)), 0) into v_m3
    from public.production_logs
   where organisation_id = p_org and (p_site is null or site = p_site)
     and (p_country is null or country = p_country)
     and period_date between p_from and p_to;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'basis', 'expense grid + SCO + SANY',
    'by_country', v_by,
    'currencies', to_jsonb(v_curs),
    'mixed_currency', not v_one,
    'tyre_cost', case when v_one then v_tyre else null end,
    'maintenance_cost', case when v_one then v_maint else null end,
    'internal_cost', case when v_one then v_internal else null end,
    'sco_cost', case when v_one then v_sco else null end,
    'sany_cost', case when v_one then v_sany else null end,
    'total_cost', case when v_one then v_total else null end,
    'km', round(coalesce(v_km, 0)),
    'engine_hours', round(coalesce(v_hours, 0), 1),
    'hours_assets_dropped', coalesce(v_dropped, 0),
    'm3', round(coalesce(v_m3, 0), 1),
    'cost_per_km',   case when v_one and coalesce(v_km, 0) > 0    then round(v_total / v_km, 2)    end,
    'cost_per_hour', case when v_one and coalesce(v_hours, 0) > 0 then round(v_total / v_hours, 2) end,
    -- Same floor the Cost per M3 screen uses: below it the rate is arithmetic,
    -- not a measurement.
    'cost_per_m3',   case when v_one and coalesce(v_m3, 0) >= 1000 then round(v_total / v_m3, 2) end,
    'm3_too_thin',   coalesce(v_m3, 0) > 0 and coalesce(v_m3, 0) < 1000,
    'tyre_cpk',      case when v_one and coalesce(v_km, 0) > 0    then round(v_tyre / v_km, 2)     end,
    'trend', jsonb_build_object(
      'total', (select jsonb_agg(round(coalesce(s.v, 0)) order by m.k) from unnest(p_months) m(k)
                 left join (
                   select to_char(event_date, 'YYYY-MM') k, sum(coalesce(line_cost, 0)) v
                     from public.parts_consumption
                    where organisation_id = p_org and (p_site is null or site = p_site)
                      and (p_country is null or country = p_country)
                      and event_date >= v_m0
                    group by 1
                 ) s on s.k = m.k),
      'm3', (select jsonb_agg(round(coalesce(s.v, 0), 1) order by m.k) from unnest(p_months) m(k)
              left join (
                select to_char(period_date, 'YYYY-MM') k, sum(coalesce(approved_m3, m3, 0)) v
                  from public.production_logs
                 where organisation_id = p_org and (p_site is null or site = p_site)
                   and (p_country is null or country = p_country)
                   and period_date >= v_m0
                 group by 1
              ) s on s.k = m.k)
    )
  );
end $function$;

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
  v_m0 timestamptz; v_m0d date;
  v_day0 timestamptz; v_day1 timestamptz;
  v_cost jsonb;
  v_wo_open bigint; v_wo_by_status jsonb; v_wo_by_site jsonb; v_wo_by_type jsonb;
  v_wo_heatmap jsonb; v_open_cards jsonb;
  v_tyre_by jsonb; v_tyre_trend jsonb; v_tyre_trend_by jsonb;
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

  SELECT array_agg(to_char(m, 'YYYY-MM') ORDER BY m) INTO v_months
  FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m;
  -- Start of the first trend month (session time zone, same as to_char above).
  v_m0  := date_trunc('month', now()) - interval '11 months';
  v_m0d := v_m0::date;
  -- "Today" as a timestamptz range, equal to ts::date = current_date.
  v_day0 := current_date::timestamptz;
  v_day1 := (current_date + 1)::timestamptz;

  SELECT name INTO v_company FROM public.organisations WHERE id = v_org LIMIT 1;
  v_company := coalesce(nullif(replace(replace(v_company, '"', ''), '\', ''), ''), 'TyrePulse');
  SELECT logo_url INTO v_logo FROM public.organisations WHERE id = v_org LIMIT 1;
  v_logo := nullif(replace(replace(coalesce(v_logo,''), '"', ''), '\', ''), '');

  v_cfrom := coalesce(v_from, (date_trunc('month', now()) - interval '11 months')::date);
  v_cto   := coalesce(v_to, now()::date);

  v_cost := public._report_cost_block(v_org,v_site,v_country,v_cfrom,v_cto,v_months);

  -- Tyre spend per country, each in its own currency (expense grid).
  SELECT coalesce(jsonb_agg(jsonb_build_object('country', e->>'country', 'currency', e->>'currency',
                                               'value', (e->>'tyre')::numeric) ORDER BY e->>'country'), '[]'::jsonb)
    INTO v_tyre_by
    FROM jsonb_array_elements(coalesce(v_cost->'by_country', '[]'::jsonb)) e;

  -- 12-month tyre spend series from the expense grid, one per country.
  WITH pc AS MATERIALIZED (
    SELECT country, max(currency) OVER (PARTITION BY country) AS currency,
           to_char(event_date,'YYYY-MM') k, tyre_cost
      FROM public.parts_consumption
     WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)
       AND event_date >= v_m0d
  ), by_c AS (
    SELECT c.country, c.currency,
           (SELECT jsonb_agg(round(coalesce(s.v,0)) ORDER BY m.k)
              FROM unnest(v_months) m(k)
              LEFT JOIN (SELECT k, sum(coalesce(tyre_cost,0)) v FROM pc WHERE pc.country IS NOT DISTINCT FROM c.country GROUP BY k) s ON s.k=m.k) AS series
      FROM (SELECT DISTINCT country, currency FROM pc) c
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('country', country, 'currency', currency, 'series', series) ORDER BY country), '[]'::jsonb),
         CASE WHEN count(DISTINCT currency) = 1 THEN
           (SELECT jsonb_agg(round(coalesce(s.v,0)) ORDER BY m.k) FROM unnest(v_months) m(k)
              LEFT JOIN (SELECT k, sum(coalesce(tyre_cost,0)) v FROM pc GROUP BY k) s ON s.k=m.k)
         ELSE NULL END
    INTO v_tyre_trend_by, v_tyre_trend
    FROM by_c;

  -- Open work orders, read once.
  WITH o AS MATERIALIZED (
    SELECT status, site, work_type, work_order_no, asset_no, priority, coalesce(opened_at,created_at) AS ts
      FROM public.work_orders
     WHERE organisation_id=v_org AND lower(coalesce(status,'')) NOT IN ('completed','closed','done','cancelled')
       AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)
  )
  SELECT (SELECT count(*) FROM o),
         (SELECT COALESCE(jsonb_agg(jsonb_build_object('label',lbl,'value',c)),'[]'::jsonb) FROM (SELECT coalesce(nullif(btrim(status),''),'Unspecified') lbl, count(*) c FROM o GROUP BY 1 ORDER BY c DESC, lbl LIMIT 6) x),
         (SELECT COALESCE(jsonb_agg(jsonb_build_object('label',lbl,'value',c)),'[]'::jsonb) FROM (SELECT coalesce(nullif(btrim(site),''),'Unassigned') lbl, count(*) c FROM o GROUP BY 1 ORDER BY c DESC, lbl LIMIT 8) x),
         (SELECT COALESCE(jsonb_agg(jsonb_build_object('label',lbl,'value',c)),'[]'::jsonb) FROM (SELECT coalesce(nullif(btrim(work_type),''),'Unspecified') lbl, count(*) c FROM o GROUP BY 1 ORDER BY c DESC, lbl LIMIT 8) x),
         (SELECT COALESCE(jsonb_agg(jsonb_build_object('site',lbl,'severity',st,'value',c)),'[]'::jsonb) FROM (SELECT coalesce(nullif(btrim(site),''),'Unassigned') lbl, coalesce(nullif(btrim(status),''),'Unspecified') st, count(*) c FROM o GROUP BY 1,2 ORDER BY 1,2) x),
         (SELECT COALESCE(jsonb_agg(q.x),'[]'::jsonb) FROM (SELECT jsonb_build_object('wo_no',work_order_no,'asset_no',asset_no,'status',status,'site',site,'priority',priority,'work_type',work_type) x FROM o ORDER BY ts DESC, work_order_no DESC LIMIT 14) q)
    INTO v_wo_open, v_wo_by_status, v_wo_by_site, v_wo_by_type, v_wo_heatmap, v_open_cards;

  result := jsonb_build_object(
    'ok', true, 'company', v_company, 'logo', v_logo, 'name', t.name, 'generated_at', now(),
    'rotate_seconds', t.rotate_seconds, 'refresh_seconds', t.refresh_seconds, 'pages', t.pages,
    'layout', t.layout,
    'filters', jsonb_build_object('site', v_site, 'country', v_country, 'from', v_from, 'to', v_to),
    'sites', (SELECT COALESCE(jsonb_agg(s ORDER BY s),'[]'::jsonb) FROM (SELECT DISTINCT nullif(btrim(site),'') s FROM public.tyre_records WHERE organisation_id=v_org AND site IS NOT NULL AND (v_country IS NULL OR country=v_country) UNION SELECT DISTINCT nullif(btrim(site),'') FROM public.accidents WHERE organisation_id=v_org AND site IS NOT NULL AND (v_country IS NULL OR country=v_country)) u WHERE s IS NOT NULL AND (t.allowed_site IS NULL OR s=t.allowed_site) LIMIT 60),
    'countries', (SELECT COALESCE(jsonb_agg(c ORDER BY c),'[]'::jsonb) FROM (SELECT DISTINCT nullif(btrim(country),'') c FROM public.tyre_records WHERE organisation_id=v_org AND country IS NOT NULL) u WHERE c IS NOT NULL AND (t.allowed_country IS NULL OR c=t.allowed_country) LIMIT 30),
    'labels', to_jsonb((SELECT array_agg(to_char(to_date(k,'YYYY-MM'),'Mon YY') ORDER BY k) FROM unnest(v_months) k)),
    'kpis', jsonb_build_object(
      'fleet',            (SELECT count(*) FROM public.vehicle_fleet WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'tyres',            (SELECT count(*) FROM public.tyre_records WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR issue_date>=v_from) AND (v_to IS NULL OR issue_date<=v_to)),
      'tyre_spend', (v_cost->>'tyre_cost')::numeric,
      'tyre_spend_by_country', v_tyre_by,
      'accidents',        (SELECT count(*) FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to)),
      'open_accidents',   (SELECT count(*) FROM public.accidents WHERE organisation_id=v_org AND release_date IS NULL AND lower(coalesce(status,'')) NOT IN ('closed','released') AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to)),
      'claims_claimed',   (SELECT round(coalesce(sum(claim_amount),0)) FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to)),
      'claims_recovered', (SELECT round(coalesce(sum(recovered_amount),0)) FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to)),
      'inspections',      (SELECT count(*) FROM public.inspections WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR inspection_date>=v_from) AND (v_to IS NULL OR inspection_date<=v_to)),
      'work_orders_open', v_wo_open
    ),
    'cost', v_cost,
    'trends', jsonb_build_object(
      'tyre_spend',            v_tyre_trend,
      'tyre_spend_by_country', v_tyre_trend_by,
      'accidents',        (SELECT jsonb_agg(coalesce(s.v,0) ORDER BY m.k) FROM unnest(v_months) m(k) LEFT JOIN (SELECT to_char(incident_date,'YYYY-MM') k, count(*) v FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND incident_date>=v_m0d GROUP BY 1) s ON s.k=m.k),
      'claims_claimed',   (SELECT jsonb_agg(coalesce(s.v,0) ORDER BY m.k) FROM unnest(v_months) m(k) LEFT JOIN (SELECT to_char(incident_date,'YYYY-MM') k, round(sum(claim_amount)) v FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND incident_date>=v_m0d GROUP BY 1) s ON s.k=m.k),
      'claims_recovered', (SELECT jsonb_agg(coalesce(s.v,0) ORDER BY m.k) FROM unnest(v_months) m(k) LEFT JOIN (SELECT to_char(incident_date,'YYYY-MM') k, round(sum(recovered_amount)) v FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND incident_date>=v_m0d GROUP BY 1) s ON s.k=m.k),
      'inspections',      (SELECT jsonb_agg(coalesce(s.v,0) ORDER BY m.k) FROM unnest(v_months) m(k) LEFT JOIN (SELECT to_char(inspection_date,'YYYY-MM') k, count(*) v FROM public.inspections WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND inspection_date>=v_m0d GROUP BY 1) s ON s.k=m.k)
    ),
    'breakdowns', jsonb_build_object(
      'severity',        (SELECT jsonb_agg(jsonb_build_object('label',lbl,'value',c)) FROM (SELECT coalesce(nullif(btrim(severity),''),'Unspecified') lbl, count(*) c FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to) GROUP BY 1 ORDER BY c DESC LIMIT 6) x),
      'accidents_by_site',(SELECT jsonb_agg(jsonb_build_object('label',lbl,'value',c)) FROM (SELECT coalesce(nullif(btrim(site),''),'Unassigned') lbl, count(*) c FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to) GROUP BY 1 ORDER BY c DESC LIMIT 8) x),
      'tyres_by_site',   (SELECT jsonb_agg(jsonb_build_object('label',lbl,'value',c)) FROM (SELECT coalesce(nullif(btrim(site),''),'Unassigned') lbl, count(*) c FROM public.tyre_records WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR issue_date>=v_from) AND (v_to IS NULL OR issue_date<=v_to) GROUP BY 1 ORDER BY c DESC LIMIT 8) x),
      'claim_status',    (SELECT jsonb_agg(jsonb_build_object('label',lbl,'value',c)) FROM (SELECT coalesce(nullif(btrim(claim_status),''),'Unspecified') lbl, count(*) c FROM public.accidents WHERE organisation_id=v_org AND (claim_amount>0 OR claim_status IS NOT NULL OR insurer IS NOT NULL) AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to) GROUP BY 1 ORDER BY c DESC LIMIT 6) x)
    ),
    'heatmap', (SELECT COALESCE(jsonb_agg(jsonb_build_object('site',lbl,'severity',sev,'value',c)),'[]'::jsonb) FROM (SELECT coalesce(nullif(btrim(site),''),'Unassigned') lbl, coalesce(nullif(btrim(severity),''),'Unspecified') sev, count(*) c FROM public.accidents WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) AND (v_from IS NULL OR incident_date>=v_from) AND (v_to IS NULL OR incident_date<=v_to) GROUP BY 1,2 ORDER BY 1,2) x),
    'ops', jsonb_build_object(
      'work_orders_open', v_wo_open,
      'job_cards_today',  (SELECT count(*) FROM public.work_orders WHERE organisation_id=v_org
                             AND ((opened_at >= v_day0 AND opened_at < v_day1) OR (opened_at IS NULL AND created_at >= v_day0 AND created_at < v_day1))
                             AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'tyre_changes_today',(SELECT count(*) FROM public.tyre_records WHERE organisation_id=v_org AND issue_date::date=current_date AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'inspections_today',(SELECT count(*) FROM public.inspections WHERE organisation_id=v_org AND inspection_date::date=current_date AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'accidents_today',  (SELECT count(*) FROM public.accidents WHERE organisation_id=v_org AND incident_date::date=current_date AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'alerts_critical',  (SELECT count(*) FROM public.alerts WHERE organisation_id=v_org AND coalesce(resolved,false)=false AND lower(coalesce(severity,'')) IN ('critical','high') AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'pm_overdue',       (SELECT count(*) FROM public.pm_programs WHERE organisation_id=v_org AND status='active' AND next_due IS NOT NULL AND next_due<current_date AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'pm_due_soon',      (SELECT count(*) FROM public.pm_programs WHERE organisation_id=v_org AND status='active' AND next_due IS NOT NULL AND next_due>=current_date AND next_due<=current_date+14 AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'pm_compliance',    (SELECT CASE WHEN count(*) FILTER (WHERE status='active')>0 THEN round(100.0*count(*) FILTER (WHERE status='active' AND (next_due IS NULL OR next_due>=current_date))/count(*) FILTER (WHERE status='active')) ELSE NULL END FROM public.pm_programs WHERE organisation_id=v_org AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country)),
      'wo_by_status',     v_wo_by_status,
      'wo_by_site',       v_wo_by_site,
      'wo_by_type',       v_wo_by_type,
      'wo_trend',         (SELECT jsonb_agg(coalesce(s.v,0) ORDER BY m.k) FROM unnest(v_months) m(k) LEFT JOIN (SELECT to_char(coalesce(opened_at,created_at),'YYYY-MM') k, count(*) v FROM public.work_orders WHERE organisation_id=v_org
                             AND (opened_at >= v_m0 OR (opened_at IS NULL AND created_at >= v_m0))
                             AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) GROUP BY 1) s ON s.k=m.k),
      'wo_heatmap',       v_wo_heatmap,
      'open_job_cards',   v_open_cards,
      'pm_due_list',      (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (SELECT jsonb_build_object('name',name,'asset_no',asset_no,'next_due',next_due,'priority',priority) x FROM public.pm_programs WHERE organisation_id=v_org AND status='active' AND next_due IS NOT NULL AND (v_site IS NULL OR site=v_site) AND (v_country IS NULL OR country=v_country) ORDER BY next_due ASC LIMIT 14) q)
    )
  );

  UPDATE public.report_shares SET last_viewed_at = now(), view_count = view_count + 1 WHERE id = t.id;
  RETURN result;
END; $function$;

-- Grants are unchanged by CREATE OR REPLACE; restated for clarity.
REVOKE ALL ON FUNCTION public.get_report_snapshot(text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_report_snapshot(text,text,text,text,text,text) TO anon, authenticated;

commit;

-- VERIFY (rolled back; run as the migration author)
--   begin; set local role anon;
--   explain (analyze) select public.get_report_snapshot('<token>');   -- expect well under 3 s
--   select (public.get_report_snapshot('<token>')->'kpis'->'tyre_spend_by_country');
--   select jsonb_array_length(public.get_report_snapshot('<token>')->'trends'->'accidents');  -- 12
--   rollback;
-- Parity: save old payload into a temp table before applying, then compare
--   md5((old - 'generated_at')::text) = md5(((new - 'generated_at' - 'trends')
--   || jsonb_build_object('kpis', (new->'kpis') - 'tyre_spend_by_country'))::text)
