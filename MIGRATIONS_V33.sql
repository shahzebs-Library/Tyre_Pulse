-- MIGRATIONS_V33.sql
-- Performance: single-pass rewrite of report_tyre_summary (dashboard RPC).
--
-- Problem
--   The dashboard summary RPC computed ~16 independent sub-aggregates, each of
--   which forced its own full scan of tyre_records and spilled to temp files
--   (EXPLAIN: Execution Time 3178 ms, temp read=138002 written=9822).
--
-- Fix
--   One filtered CTE `f` (computes qty-correct cost = cost_per_tyre * coalesce(qty,1)
--   and applies a null-safe country filter), a single scalar-aggregate pass `agg`,
--   and shared grouping CTEs `by_site` / `by_cat` / `by_brand` / `by_month` reused
--   across all JSON keys. Output keys are byte-for-byte identical to the previous
--   version; risk_breakdown additionally surfaces an 'Unknown' bucket
--   (total - critical - high - medium - low) so the percentages always reconcile.
--
-- Effect (verified)
--   Steady-state Execution Time 3178 ms -> 805 ms (~4x), temp read 138002 -> 4629.
--   Applied on Supabase as migration `optimize_report_tyre_summary_single_pass`.

CREATE OR REPLACE FUNCTION public.report_tyre_summary(
  p_country text DEFAULT 'All'::text,
  p_from date DEFAULT NULL::date,
  p_to date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH f AS (
    SELECT r.asset_no, r.risk_level, r.site, r.brand, r.category, r.issue_date,
           (COALESCE(r.cost_per_tyre,0) * COALESCE(r.qty,1))::numeric AS cost
    FROM public.tyre_records r
    WHERE (p_country = 'All' OR p_country IS NULL OR r.country = p_country OR r.country IS NULL)
      AND (p_from IS NULL OR r.issue_date >= p_from)
      AND (p_to   IS NULL OR r.issue_date <= p_to)
  ),
  agg AS (
    SELECT count(*) total_records,
           count(DISTINCT asset_no) FILTER (WHERE asset_no IS NOT NULL) distinct_assets,
           COALESCE(sum(cost),0) total_cost,
           count(*) FILTER (WHERE risk_level='Critical') crit,
           count(*) FILTER (WHERE risk_level='High') high,
           count(*) FILTER (WHERE risk_level='Medium') med,
           count(*) FILTER (WHERE risk_level='Low') low,
           count(*) FILTER (WHERE risk_level IN ('Critical','High')) high_risk,
           count(DISTINCT asset_no) FILTER (WHERE risk_level IN ('Critical','High') AND asset_no IS NOT NULL) v_alerts
    FROM f
  ),
  by_site AS (
    SELECT site, count(*) cnt, sum(cost) cost, count(DISTINCT asset_no) vehicles,
           count(*) FILTER (WHERE risk_level IN ('Critical','High')) alerts,
           count(*) FILTER (WHERE risk_level='Low') good
    FROM f WHERE site IS NOT NULL GROUP BY site
  ),
  by_cat AS (SELECT category, count(*) c FROM f WHERE category IS NOT NULL GROUP BY category),
  by_brand AS (SELECT brand, count(*) c, sum(cost) cost FROM f WHERE brand IS NOT NULL GROUP BY brand),
  by_month AS (
    SELECT date_trunc('month', issue_date) m, count(*) c, sum(cost) cost
    FROM f WHERE issue_date >= (date_trunc('month', COALESCE(p_to, CURRENT_DATE)) - interval '5 months')
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'total_records', a.total_records, 'distinct_assets', a.distinct_assets, 'total_cost', a.total_cost,
    'critical', a.crit, 'high', a.high, 'medium', a.med, 'low', a.low,
    'high_risk', a.high_risk, 'vehicles_with_alerts', a.v_alerts,
    'risk_breakdown', (SELECT jsonb_agg(jsonb_build_object('level',level,'count',c) ORDER BY c DESC) FROM (
        SELECT 'Critical' level, a.crit c UNION ALL SELECT 'High', a.high UNION ALL
        SELECT 'Medium', a.med UNION ALL SELECT 'Low', a.low
        UNION ALL SELECT 'Unknown', (a.total_records - a.crit - a.high - a.med - a.low)
      ) t WHERE c > 0),
    'top_sites', (SELECT COALESCE(jsonb_agg(jsonb_build_object('site',site,'count',cnt,'cost',cost) ORDER BY cnt DESC),'[]')
                    FROM (SELECT site,cnt,cost FROM by_site ORDER BY cnt DESC LIMIT 12) t),
    'cost_by_site', (SELECT COALESCE(jsonb_agg(jsonb_build_object('site',site,'cost',cost) ORDER BY cost DESC),'[]')
                    FROM (SELECT site,cost FROM by_site ORDER BY cost DESC LIMIT 10) t),
    'site_breakdown', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'name',site,'vehicles',vehicles,'records',cnt,'alerts',alerts,
                        'compliance', CASE WHEN cnt>0 THEN round((good::numeric/cnt)*100) ELSE 0 END) ORDER BY cnt DESC),'[]')
                    FROM (SELECT * FROM by_site ORDER BY cnt DESC LIMIT 10) t),
    'category_breakdown', (SELECT COALESCE(jsonb_agg(jsonb_build_object('category',category,'count',c) ORDER BY c DESC),'[]')
                    FROM (SELECT category,c FROM by_cat ORDER BY c DESC LIMIT 12) t),
    'top_brands', (SELECT COALESCE(jsonb_agg(jsonb_build_object('brand',brand,'count',c,'cost',cost) ORDER BY c DESC),'[]')
                    FROM (SELECT brand,c,cost FROM by_brand ORDER BY c DESC LIMIT 10) t),
    'monthly_trend', (SELECT COALESCE(jsonb_agg(jsonb_build_object('month',to_char(m,'Mon YY'),'count',c,'cost',cost) ORDER BY m),'[]') FROM by_month)
  )
  FROM agg a;
$function$;
