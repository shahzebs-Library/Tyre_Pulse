-- =====================================================================================
-- V593 - get_tyre_cost_by_asset NEEDED A UNIQUE SORT KEY BEFORE IT COULD BE PAGED
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc as
--         `v593_tyre_cost_by_asset_stable_order`.
-- =====================================================================================
--
-- WHY NOW. The clients page this RPC (PostgREST caps a SET-RETURNING function at
-- 1,000 rows exactly as it caps a table read), and offset paging is only sound when
-- the ORDER BY is deterministic. This function ordered by `sum(tyre_cost) DESC`
-- ALONE, which is not unique, so rows inside a tie have no defined order between one
-- request and the next: a tie straddling a page boundary can return the same asset
-- twice and drop another entirely.
--
-- MEASURED, so this is a real defect and not a theoretical one. Of 875 asset rows,
-- **93 sit in a tie group and the LARGEST TIE GROUP IS 49 ASSETS.** A 49-row tie is
-- far wider than any page boundary is narrow.
--
-- WHY IT MATTERS MORE THAN A SHORT LIST. This is a MONEY map - asset_code -> tyre
-- cost - consumed by `governedCost.js` and `costSummary.js`. A dropped row here is
-- not a truncated list a user can notice; it is an asset silently reporting no tyre
-- spend, which is the same class of quiet wrongness as the 1,000-row cap itself.
--
-- THE FIX IS ONE TOKEN. `asset_code` is the GROUP BY key, so it is unique in the
-- result BY CONSTRUCTION. Appending it makes the order total without changing which
-- rows come back or their ranking by cost - only the order WITHIN an exact-tie group
-- changes, from arbitrary to alphabetical.
--
-- NOTHING WAS RETYPED. The body was read from the LIVE `pg_get_functiondef` and
-- changed only in the ORDER BY, so every security guard (org, country, site scoping)
-- is byte-identical, and CREATE OR REPLACE preserves SECURITY DEFINER, the pinned
-- search_path and the existing grants.
--
-- VERIFIED LIVE by impersonating the real approved KSA-only Manager: 688 rows, 688
-- DISTINCT assets, total 11,573,077, and two consecutive calls now agree on the
-- order of every single row (0 differences). Before this, two calls were free to
-- disagree inside any of those 93 tied rows.
--
-- NOTE ON SCALE: the result is 688 rows for that user today, so the cap is not being
-- hit yet on this path. That is exactly why it was worth fixing now rather than after
-- the fleet grows into it - the client already pages, so the ordering has to be sound
-- before the second page ever exists.
--
-- ROLLBACK: re-apply this body with the trailing `, asset_code` removed from the
-- ORDER BY.
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.get_tyre_cost_by_asset(p_country text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(asset_code text, tyre_cost numeric, lines bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT asset_code,
         round(sum(tyre_cost))::numeric AS tyre_cost,
         count(*)::bigint AS lines
  FROM public.parts_consumption
  WHERE organisation_id = public.app_current_org() and ((site)::text is null or btrim((site)::text) = '' or (select public.is_super_admin()) or (select public.app_sees_all_sites()) or upper(btrim((site)::text)) = any(coalesce((select public.app_site_scope()), '{}'::text[])))
    AND public.app_is_active()
    AND cost_category = 'tyre'
    AND (p_country IS NULL OR country = p_country) and (p_country is null or p_country = 'All' or public.app_can_see_country(p_country)) and (country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries()) or lower(btrim(country)) = any(coalesce((select public.app_country_scope()), '{}'::text[])))
    AND (p_from IS NULL OR event_date >= p_from)
    AND (p_to   IS NULL OR event_date <= p_to)
    AND asset_code IS NOT NULL
  GROUP BY asset_code
  HAVING round(sum(tyre_cost)) <> 0
  ORDER BY sum(tyre_cost) DESC, asset_code;
$function$;
