-- MIGRATIONS_V29.sql
-- Per-asset aggregates (mirrors computeAssetMetrics, minus raw rows which the
-- UI lazy-loads on demand). Powers FleetAnalytics / asset-list views without
-- downloading the full tyre_records table. Idempotent.

CREATE OR REPLACE FUNCTION public.report_asset_metrics(
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
    SELECT
      COALESCE(asset_no,'Unknown') AS asset_no,
      (COALESCE(cost_per_tyre,0) * COALESCE(qty,1))::numeric AS cost,
      risk_level, brand, site, category, issue_date
    FROM public.tyre_records
    WHERE (p_country = 'All' OR p_country IS NULL OR country = p_country OR country IS NULL)
      AND (p_from IS NULL OR issue_date >= p_from)
      AND (p_to   IS NULL OR issue_date <= p_to)
  ), g AS (
    SELECT
      asset_no,
      count(*) cnt,
      sum(cost) total_cost,
      count(*) FILTER (WHERE risk_level = 'High') high_risk,
      count(*) FILTER (WHERE risk_level IN ('High','Critical')) high_or_crit,
      min(issue_date) first_seen,
      max(issue_date) last_seen,
      array_remove(array_agg(DISTINCT brand), NULL) brands,
      array_remove(array_agg(DISTINCT site), NULL) sites,
      array_remove(array_agg(DISTINCT category), NULL) categories,
      GREATEST( (max(issue_date) - min(issue_date))::numeric / 30.0, 0) span_raw
    FROM f GROUP BY asset_no
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'assetNo', asset_no,
    'count', cnt,
    'totalCost', total_cost,
    'highRiskCount', high_risk,
    'highOrCriticalCount', high_or_crit,
    'firstSeen', first_seen,
    'lastSeen', last_seen,
    'brands', to_jsonb(brands),
    'sites', to_jsonb(sites),
    'categories', to_jsonb(categories),
    'spanMonths', CASE WHEN span_raw > 0 THEN span_raw ELSE 1 END,
    'failureFreqPerMonth', CASE WHEN span_raw > 0 THEN cnt / span_raw ELSE cnt END
  ) ORDER BY cnt DESC), '[]')
  FROM g;
$$;

REVOKE ALL ON FUNCTION public.report_asset_metrics(text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_asset_metrics(text, date, date) TO authenticated;
