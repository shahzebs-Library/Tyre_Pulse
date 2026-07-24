-- V356 — Single Asset Master for checking assets across countries.
--
-- The same physical vehicle transfers between countries, so an asset number can
-- appear in more than one country's data. get_asset_master collapses each asset_no
-- to ONE master (one vehicle) and rolls up its activity across ALL countries:
-- countries operated in, merged identity, and tyre/work-order counts, with tyre
-- expense kept PER COUNTRY (each in its own currency, no blending) in by_country.
-- Cross-country expenses are NORMAL. Read-only, org-scoped; the per-country
-- vehicle_fleet rows are left intact so country-scoped visibility is unchanged.

DROP FUNCTION IF EXISTS public.get_asset_master(text,integer);

CREATE OR REPLACE FUNCTION public.get_asset_master(
  p_search text DEFAULT NULL,
  p_limit  integer DEFAULT 1000
)
RETURNS TABLE(
  asset_no text, countries text, country_count integer,
  make text, model text, vehicle_type text,
  tyres bigint, work_orders bigint, by_country jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH org AS (SELECT public.app_current_org() AS oid),
  fleet AS (
    SELECT asset_no, country FROM public.vehicle_fleet
    WHERE organisation_id = (SELECT oid FROM org) AND asset_no IS NOT NULL
    GROUP BY asset_no, country
  ),
  tr AS (
    SELECT asset_no, country, count(*) AS n FROM public.tyre_records
    WHERE organisation_id = (SELECT oid FROM org) AND asset_no IS NOT NULL GROUP BY asset_no, country
  ),
  wo AS (
    SELECT asset_no, country, count(*) AS n FROM public.work_orders
    WHERE organisation_id = (SELECT oid FROM org) AND asset_no IS NOT NULL GROUP BY asset_no, country
  ),
  ex AS (
    SELECT asset_code AS asset_no, country, round(sum(tyre_cost)) AS c FROM public.parts_consumption
    WHERE organisation_id = (SELECT oid FROM org) AND cost_category = 'tyre' AND asset_code IS NOT NULL
    GROUP BY asset_code, country
  ),
  ident AS (
    SELECT asset_no, max(make) make, max(model) model, max(vehicle_type) vehicle_type
    FROM public.vehicle_fleet WHERE organisation_id = (SELECT oid FROM org) AND asset_no IS NOT NULL
    GROUP BY asset_no
  ),
  per AS (
    SELECT f.asset_no, f.country,
      COALESCE(tr.n,0) AS tyres, COALESCE(wo.n,0) AS work_orders, COALESCE(ex.c,0) AS tyre_expense
    FROM fleet f
    LEFT JOIN tr ON tr.asset_no=f.asset_no AND tr.country=f.country
    LEFT JOIN wo ON wo.asset_no=f.asset_no AND wo.country=f.country
    LEFT JOIN ex ON ex.asset_no=f.asset_no AND ex.country=f.country
  ),
  agg AS (
    SELECT asset_no,
      string_agg(DISTINCT country, ', ' ORDER BY country) AS countries,
      count(DISTINCT country)::int AS country_count,
      sum(tyres)::bigint AS tyres, sum(work_orders)::bigint AS work_orders,
      jsonb_agg(jsonb_build_object('country',country,'tyres',tyres,'work_orders',work_orders,'tyre_expense',tyre_expense)
                ORDER BY country) AS by_country
    FROM per GROUP BY asset_no
  )
  SELECT a.asset_no, a.countries, a.country_count, i.make, i.model, i.vehicle_type,
         a.tyres, a.work_orders, a.by_country
  FROM agg a LEFT JOIN ident i ON i.asset_no = a.asset_no
  WHERE p_search IS NULL OR btrim(p_search) = '' OR a.asset_no ILIKE '%'||btrim(p_search)||'%'
  ORDER BY a.country_count DESC, a.asset_no
  LIMIT greatest(coalesce(p_limit,1000), 1);
$$;

REVOKE ALL ON FUNCTION public.get_asset_master(text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_asset_master(text,integer) TO authenticated;

-- Reversible: DROP FUNCTION IF EXISTS public.get_asset_master(text,integer);
