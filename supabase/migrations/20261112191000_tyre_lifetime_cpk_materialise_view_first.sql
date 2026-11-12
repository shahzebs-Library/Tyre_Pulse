-- get_tyre_lifetime_cpk: read v_tyre_lifetime once, then filter (PERF-4)
-- STATUS: APPLIED LIVE 2026-11-12 (schema_migrations 20261112080415).
--
-- MEASURED BEFORE (KSA-only Manager, RLS on): get_tyre_lifetime_cpk('KSA','2026-01-01','2026-12-31',null)
--   7,700 ms, 26,052 shared buffers. The authenticated role's statement_timeout is 8 s.
--   `select * from v_tyre_lifetime where country = 'KSA'` alone took 10,833 ms: the country test
--   becomes a HAVING on the grouped tyre set, the planner then expects a handful of tyres and picks
--   nested loops against the price-backfill log (15,752,221 rows discarded by the join filter) and
--   against the per-tyre aggregate (7,821 loops).
-- MEASURED AFTER: the view read without a filter plans hash/merge joins: 1,224 ms / 8,196 buffers
--   for the view, and 1,307-1,400 ms / 17,887-21,720 buffers for the whole RPC (super admin, UAE:
--   4,142 ms -> 1,535 ms).
--
-- WHAT CHANGED: a `base as materialized (select * from public.v_tyre_lifetime)` CTE is added and
-- `t` reads from it. RLS still decides which tyres the view returns, so the row set is the same.
-- Language, SECURITY INVOKER, search_path, plan_cache_mode and grants are untouched.
--
-- OUTPUT PROVEN IDENTICAL (md5 of the jsonb, before vs after in one transaction): 3 parameter sets
-- as the KSA Manager, 3 as a super admin (UAE, all countries, Egypt). 6 of 6 equal.
--
-- ROLLBACK: the same block with the two replace() calls reversed
--   ('from base l' -> 'from public.v_tyre_lifetime l', and the base CTE text removed).

do $$ declare d text; n1 int; n2 int; begin
  select pg_get_functiondef('public.get_tyre_lifetime_cpk(text,date,date,text)'::regprocedure) into d;
  n1 := (length(d) - length(replace(d, E'AS $function$\nwith t as (', ''))) / length(E'AS $function$\nwith t as (');
  n2 := (length(d) - length(replace(d, 'from public.v_tyre_lifetime l', ''))) / length('from public.v_tyre_lifetime l');
  if n1 <> 1 or n2 <> 1 then raise exception 'anchor mismatch % %', n1, n2; end if;
  d := replace(d, E'AS $function$\nwith t as (', E'AS $function$\nwith base as materialized (\n  select * from public.v_tyre_lifetime\n),\nt as (');
  d := replace(d, 'from public.v_tyre_lifetime l', 'from base l');
  execute d;
end $$;
