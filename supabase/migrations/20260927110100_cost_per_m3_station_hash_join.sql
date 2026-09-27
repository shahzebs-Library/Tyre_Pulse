-- 20260927110100_cost_per_m3_station_hash_join
--
-- WHAT: get_cost_per_m3 - the production_station_map join in the prod CTE now goes
--       through a MATERIALIZED CTE `station_of` (country, upper(btrim(station)), region),
--       instead of joining the base table on an expression. Everything else, every guard
--       (org, app_can_see_country refusal, the InitPlan country-scope predicate) is byte
--       identical: the body is taken from the LIVE pg_get_functiondef and changed by two
--       anchored replace() calls that each ABORT unless the anchor occurs exactly once.
--
-- WHY: after 20260927110000 gave production_logs an index ordered by country, the planner
--      chose a Merge Left Join on psm.country and evaluated upper(btrim(station)) as a
--      join FILTER against every map row: 5,532,441 rows removed by join filter, 8.1 s for
--      the all-countries 2025-2026 view (was ~2.3 s before the index, which is how this was
--      found). A 27-row materialized CTE is hashed like region_of already is.
--      Measured (super admin, get_cost_per_m3(null,'2025-01-01','2026-09-27')):
--        before index 2.3-3.1 s  | index only 7.7-8.2 s | index + this ~0.6-1.0 s.
--      KSA YTD (KSA-only Manager): 1.6-4.5 s -> ~0.4-0.7 s.
--      Semantics: the org predicate moves from the ON clause of a LEFT JOIN into the CTE,
--      which is equivalent for a condition on the nullable side; duplicate map rows are NOT
--      collapsed (no GROUP BY), so row multiplication is unchanged. Output md5 (full jsonb)
--      identical before/after for 7 parameter sets across the KSA-only Manager and the
--      super admin (see handback report).
--
-- VERIFY: select md5(get_cost_per_m3(null,'2025-01-01','2026-09-27')::text);
--
-- ROLLBACK: re-run the same DO block with the two replace() pairs swapped.

do $mig$
declare d text := pg_get_functiondef('public.get_cost_per_m3(text,date,date)'::regprocedure);
  a1 text := $a$  region_of as (select country, k, min(region) as region from sreg group by country, k),
$a$;
  b1 text := $a$  region_of as (select country, k, min(region) as region from sreg group by country, k),
  station_of as materialized (
    select country, upper(btrim(station)) as k, region
    from public.production_station_map where organisation_id = v_org
  ),
$a$;
  a2 text := $a$    left join public.production_station_map psm
           on psm.organisation_id = v_org and psm.country = pl.country
          and upper(btrim(psm.station)) = upper(btrim(pl.station))
$a$;
  b2 text := $a$    left join station_of psm
           on psm.country = pl.country and psm.k = upper(btrim(pl.station))
$a$;
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 then raise exception 'anchor a1 not found exactly once'; end if;
  if (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then raise exception 'anchor a2 not found exactly once'; end if;
  d := replace(replace(d, a1, b1), a2, b2);
  execute d;
end $mig$;
