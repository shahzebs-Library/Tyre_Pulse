-- V347 — Authoritative per-asset tyre cost from the parts_consumption grid.
--
-- The single "tyre cost" number in the app must come from the classified expense
-- grid (parts_consumption.tyre_cost) everywhere, so the Tyre module reconciles to
-- the Expense module. get_parts_expense_snapshot only exposes top-20 TOTAL spend
-- per asset; this returns TYRE cost per asset for ALL assets, org-scoped, so
-- per-asset tyre-cost tables can be sourced from the grid instead of summing
-- tyre_records.cost_per_tyre (which is null on ~36% of rows).

CREATE OR REPLACE FUNCTION public.get_tyre_cost_by_asset(
  p_country text DEFAULT NULL,
  p_from    date DEFAULT NULL,
  p_to      date DEFAULT NULL
)
RETURNS TABLE(asset_code text, tyre_cost numeric, lines bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT asset_code,
         round(sum(tyre_cost))::numeric AS tyre_cost,
         count(*)::bigint AS lines
  FROM public.parts_consumption
  WHERE organisation_id = public.app_current_org()
    AND public.app_is_active()
    AND cost_category = 'tyre'
    AND (p_country IS NULL OR country = p_country)
    AND (p_from IS NULL OR event_date >= p_from)
    AND (p_to   IS NULL OR event_date <= p_to)
    AND asset_code IS NOT NULL
  GROUP BY asset_code
  HAVING round(sum(tyre_cost)) <> 0
  ORDER BY sum(tyre_cost) DESC;
$$;

REVOKE ALL ON FUNCTION public.get_tyre_cost_by_asset(text,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tyre_cost_by_asset(text,date,date) TO authenticated;

-- Reversible: DROP FUNCTION IF EXISTS public.get_tyre_cost_by_asset(text,date,date);
