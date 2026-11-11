-- 20261110142000_fleet_tyre_km_rule_t7.sql
-- Loop 4 / finding F-E-01 (+ F-E-04 server half): repoint the fleet CPK km
-- denominator onto the owner's T7 km rule.
--
-- WHAT / WHY
--   public.fleet_tyre_km_by_asset returned sum(total_km) per asset (raw ERP
--   odometer), so get_fleet_cpk and get_cpk_drivers divided tyre and total cost
--   by distance that includes placeholder-fitment rows (fitment odometer "1" =
--   the machine odometer, not the tyre's life) and above-class-cap reading
--   errors. Measured KSA last-365 denominator was 478.6M km vs 161.6M km by the
--   T7 rule (2.96x), so fleet CPK read ~1/3 of the truth. V453 (CPK km = sum of
--   tyre total_km) predates the T7 km rule (20261104110000); this repoints it.
--
--   The km now = sum(public.tyre_km_life(fit, rem, total, CLASS)) where CLASS is
--   the tyre row's own vehicle_type, falling back to the fleet register's type
--   (F-E-04): tyre_records.vehicle_type is blank on 3,796 of 5,341 KSA removed
--   rows, all of which have a fleet type. tyre_km_life returns NULL for a
--   placeholder (fit=1), an over-class-cap life, and anything unmeasurable, and
--   SQL sum() ignores NULL, so only real distance within the class cap is
--   counted. The row set is filtered to tyre_km_life(...) > 0, replacing the old
--   total_km > 0.
--
--   The SIGNATURE is unchanged: get_fleet_cpk and get_cpk_drivers read km_run by
--   name and inherit the corrected figure with no edit (owner gate D: there is
--   no separate raw-km column exposed by those RPCs to preserve; the raw total
--   stays available by probe, see CPK_REPOINT_2026-11.md). This is a pure
--   CREATE OR REPLACE (no DROP, no consumer change).
--
-- MIRROR: this reuses the existing mirror public.tyre_km_life <-> src/lib/tyreKm.js.
-- No new maths is introduced; only the aggregation input changes.
--
-- PRE-FLIGHT (database-migration-safety)
--   Data loss      : none (function body only; no table write).
--   Rename/removal : none (identical RETURNS TABLE(country,asset_no,km_run)).
--   Type change    : none.
--   CHECK/locks/FK : none.
--   Triggers       : none fired (read-only function).
--   RLS/grants     : unchanged (SECURITY DEFINER, search_path=public, existing grants kept).
--   PostgREST      : no RAISE; returns rows.
--   Duration       : instant (DDL on one function).
--   Perf           : vehicle_fleet is ~1,600 rows, asset_no is canonical in both
--                    tables (verified 0 non-canonical), so the lateral resolves
--                    via a small index probe. The LEAD runs EXPLAIN (ANALYZE,
--                    BUFFERS) as a real KSA Manager before/after; if the lateral
--                    exceeds 2x, pre-aggregate the fleet type into a CTE.
--
-- VERIFY (run as super admin, SEPARATE call from apply):
--   -- 1) the per-asset km now equals the T7 rule sum, KSA last-365 ~ 161.6M:
--   select sum(km_run) as rule_km
--     from public.fleet_tyre_km_by_asset(
--            '00000000-0000-0000-0000-000000000001','KSA', current_date-365, current_date);
--      -- expect ~161,624,551 (was raw 478,592,287 on 2026-11-10 data)
--   -- 2) no asset km_run exceeds its possible distance (every fitment capped):
--   with k as (select * from public.fleet_tyre_km_by_asset(
--                '00000000-0000-0000-0000-000000000001', null, current_date-365, current_date))
--   select count(*) as assets, max(km_run) as max_km from k;
--      -- max_km must be plausible (no 200M+ single asset)
--   -- 3) acceptance identity: RPC km == sum(tyre_km_life(...)) for the same rows
--   --    is true by construction (the body IS that sum).
--
-- ROLLBACK (restore the pre-repoint body):
--   CREATE OR REPLACE FUNCTION public.fleet_tyre_km_by_asset(p_org uuid, p_country text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
--    RETURNS TABLE(country text, asset_no text, km_run numeric)
--    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
--   AS $rollback$
--     select t.country, upper(btrim(t.asset_no)) as asset_no, sum(t.total_km)::numeric as km_run
--       from public.tyre_records t
--      where t.organisation_id = p_org
--        and (p_country is null or t.country = p_country)
--        and t.total_km is not null and t.total_km > 0
--        and coalesce(btrim(t.asset_no), '') <> ''
--        and coalesce(t.removal_date, t.issue_date) between coalesce(p_from, current_date - 365)
--                                                       and coalesce(p_to, current_date)
--      group by 1, 2
--   $rollback$;

CREATE OR REPLACE FUNCTION public.fleet_tyre_km_by_asset(p_org uuid, p_country text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(country text, asset_no text, km_run numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- km_run = the T7 km rule summed per asset (placeholder / over-cap excluded),
  -- using the tyre row's own class, else the fleet register's class (F-E-04).
  select t.country,
         upper(btrim(t.asset_no)) as asset_no,
         sum(public.tyre_km_life(
               t.km_at_fitment, t.km_at_removal, t.total_km,
               coalesce(nullif(btrim(t.vehicle_type), ''), f.vehicle_type)
         ))::numeric as km_run
    from public.tyre_records t
    -- fleet-type fallback: prefer the asset's row in the tyre's own country,
    -- else any country; asset_no is canonical (upper/trimmed) in both tables.
    left join lateral (
      select vf.vehicle_type
        from public.vehicle_fleet vf
       where vf.organisation_id = t.organisation_id
         and vf.asset_no = t.asset_no
       order by (vf.country = t.country) desc
       limit 1
    ) f on true
   where t.organisation_id = p_org
     and (p_country is null or t.country = p_country)
     and coalesce(btrim(t.asset_no), '') <> ''
     and public.tyre_km_life(
           t.km_at_fitment, t.km_at_removal, t.total_km,
           coalesce(nullif(btrim(t.vehicle_type), ''), f.vehicle_type)
         ) > 0
     and coalesce(t.removal_date, t.issue_date) between coalesce(p_from, current_date - 365)
                                                    and coalesce(p_to, current_date)
   group by 1, 2
$function$;
