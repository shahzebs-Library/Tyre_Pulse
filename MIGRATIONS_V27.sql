-- MIGRATIONS_V27.sql
-- Per-country report aggregates (server-side) so CountryComparison no longer
-- downloads the full tyre_records table. Mirrors computeCountryMetrics:
-- count, qty-correct totalCost, high-risk %, avg CPK, brand/site counts.
-- Idempotent.

CREATE OR REPLACE FUNCTION public.report_country_metrics(
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH f AS (
    SELECT
      COALESCE(country,'KSA') AS country,
      (COALESCE(cost_per_tyre,0) * COALESCE(qty,1))::numeric AS cost,
      risk_level, brand, site, cost_per_tyre, km_at_fitment, km_at_removal
    FROM public.tyre_records
    WHERE (p_from IS NULL OR issue_date >= p_from)
      AND (p_to   IS NULL OR issue_date <= p_to)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'country', country,
    'count', cnt,
    'totalCost', total_cost,
    'highRiskPct', CASE WHEN cnt>0 THEN (high_risk::numeric/cnt)*100 ELSE 0 END,
    'avgCpk', avg_cpk,
    'brandCount', brand_count,
    'siteCount', site_count,
    'avgCostPerTyre', CASE WHEN cnt>0 THEN total_cost/cnt ELSE 0 END
  ) ORDER BY total_cost DESC), '[]')
  FROM (
    SELECT
      country,
      count(*) cnt,
      sum(cost) total_cost,
      count(*) FILTER (WHERE risk_level IN ('High','Critical')) high_risk,
      count(DISTINCT brand) brand_count,
      count(DISTINCT site) site_count,
      avg(cost_per_tyre / NULLIF(km_at_removal - km_at_fitment,0))
        FILTER (WHERE cost_per_tyre > 0 AND km_at_removal > km_at_fitment) avg_cpk
    FROM f
    GROUP BY country
  ) g;
$$;

REVOKE ALL ON FUNCTION public.report_country_metrics(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_country_metrics(date, date) TO authenticated;
