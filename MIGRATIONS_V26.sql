-- MIGRATIONS_V26.sql
-- Server-side report aggregates for accurate, scalable reporting.
-- PostgREST caps client result sets at 1000 rows, so client-side aggregation
-- was computing totals/KPIs over only the first 1000 of ~132k tyre_records.
-- report_tyre_summary() aggregates the FULL table server-side with qty-correct
-- cost (cost_per_tyre * coalesce(qty,1)), null-safe country filtering, and an
-- optional issue_date range. Idempotent.

CREATE OR REPLACE FUNCTION public.report_tyre_summary(
  p_country text DEFAULT 'All',
  p_from    date DEFAULT NULL,
  p_to      date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH f AS (
    SELECT r.*, (COALESCE(r.cost_per_tyre,0) * COALESCE(r.qty,1))::numeric AS cost
    FROM public.tyre_records r
    WHERE (p_country = 'All' OR p_country IS NULL OR r.country = p_country OR r.country IS NULL)
      AND (p_from IS NULL OR r.issue_date >= p_from)
      AND (p_to   IS NULL OR r.issue_date <= p_to)
  )
  SELECT jsonb_build_object(
    'total_records',   (SELECT count(*) FROM f),
    'distinct_assets', (SELECT count(DISTINCT asset_no) FROM f WHERE asset_no IS NOT NULL),
    'total_cost',      (SELECT COALESCE(sum(cost),0) FROM f),
    'critical',        (SELECT count(*) FROM f WHERE risk_level = 'Critical'),
    'high',            (SELECT count(*) FROM f WHERE risk_level = 'High'),
    'medium',          (SELECT count(*) FROM f WHERE risk_level = 'Medium'),
    'low',             (SELECT count(*) FROM f WHERE risk_level = 'Low'),
    'high_risk',       (SELECT count(*) FROM f WHERE risk_level IN ('Critical','High')),
    'vehicles_with_alerts', (SELECT count(DISTINCT asset_no) FROM f WHERE risk_level IN ('Critical','High') AND asset_no IS NOT NULL),
    'risk_breakdown',  (SELECT COALESCE(jsonb_agg(jsonb_build_object('level',level,'count',c) ORDER BY c DESC),'[]')
                          FROM (SELECT COALESCE(risk_level,'Unknown') level, count(*) c FROM f GROUP BY 1) t),
    'top_sites',       (SELECT COALESCE(jsonb_agg(jsonb_build_object('site',site,'count',c,'cost',cost) ORDER BY c DESC),'[]')
                          FROM (SELECT site, count(*) c, sum(cost) cost FROM f WHERE site IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 12) t),
    'cost_by_site',    (SELECT COALESCE(jsonb_agg(jsonb_build_object('site',site,'cost',cost) ORDER BY cost DESC),'[]')
                          FROM (SELECT site, sum(cost) cost FROM f WHERE site IS NOT NULL GROUP BY 1 ORDER BY sum(cost) DESC LIMIT 10) t),
    'site_breakdown',  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                              'name', site, 'vehicles', vehicles, 'records', c, 'alerts', alerts,
                              'compliance', CASE WHEN c>0 THEN round((good::numeric/c)*100) ELSE 0 END) ORDER BY c DESC),'[]')
                          FROM (SELECT site, count(*) c, count(DISTINCT asset_no) vehicles,
                                       count(*) FILTER (WHERE risk_level IN ('Critical','High')) alerts,
                                       count(*) FILTER (WHERE risk_level = 'Low') good
                                  FROM f WHERE site IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 10) t),
    'category_breakdown', (SELECT COALESCE(jsonb_agg(jsonb_build_object('category',category,'count',c) ORDER BY c DESC),'[]')
                          FROM (SELECT category, count(*) c FROM f WHERE category IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 12) t),
    'top_brands',      (SELECT COALESCE(jsonb_agg(jsonb_build_object('brand',brand,'count',c,'cost',cost) ORDER BY c DESC),'[]')
                          FROM (SELECT brand, count(*) c, sum(cost) cost FROM f WHERE brand IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC LIMIT 10) t),
    'monthly_trend',   (SELECT COALESCE(jsonb_agg(jsonb_build_object('month',to_char(m,'Mon YY'),'count',c,'cost',cost) ORDER BY m),'[]')
                          FROM (SELECT date_trunc('month', issue_date) m, count(*) c, sum(cost) cost
                                  FROM f WHERE issue_date >= (date_trunc('month', COALESCE(p_to, CURRENT_DATE)) - interval '5 months')
                                  GROUP BY 1) t)
  );
$$;

REVOKE ALL ON FUNCTION public.report_tyre_summary(text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_tyre_summary(text, date, date) TO authenticated;
