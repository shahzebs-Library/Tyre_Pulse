-- get_schedule_adherence: read the fleet once instead of once per plan (PERF-4)
-- STATUS: APPLIED LIVE 2026-11-12 (schema_migrations 20261112080643).
--
-- MEASURED BEFORE (KSA-only Manager, RLS on):
--   default window (+/- 30 days)       22,759 shared buffers
--   2026-01-01..2026-12-31 (245 plans) 219,487 shared buffers
--   77,696 of the year figure was vehicle_fleet read sequentially once per plan (317 pages x 245):
--   the function runs as the caller and upper()/btrim() are not leakproof, so under RLS that
--   comparison can never be an index condition. The other 142,002 is inspection_plan_best_match().
-- MEASURED AFTER: 14,746 and 142,051 shared buffers (-35%).
--
-- WHAT CHANGED: a `fleet as materialized` CTE reads vehicle_fleet once (RLS applied once, as the
-- caller) with the normalised key precomputed; the per-plan lateral reads that CTE. Same rows,
-- same tiebreak (country match first, then id).
--
-- OUTPUT PROVEN IDENTICAL (md5 over every returned row): 2 parameter sets as the KSA Manager and
-- 2 as a super admin. 4 of 4 equal.
--
-- NOT CHANGED, on purpose: inspection_plan_best_match() is the ONE plan-matching rule (the
-- reconcile triggers call it too). Folding it into this query would create a second copy of the
-- rule. Removing its per-plan cost needs a stored normalised asset key on inspections and
-- inspection_schedules - a schema decision for the owner.
--
-- ROLLBACK: the same block with the two replace() calls reversed.

do $$ declare d text; a1 text := E'  plans as (\n'; a2 text := E'    from public.vehicle_fleet f\n    where upper(btrim(f.asset_no)) = upper(btrim(p.asset_no))'; n1 int; n2 int; begin
  select pg_get_functiondef('public.get_schedule_adherence(text,date,date)'::regprocedure) into d;
  n1 := (length(d) - length(replace(d, a1, ''))) / length(a1);
  n2 := (length(d) - length(replace(d, a2, ''))) / length(a2);
  if n1 <> 1 or n2 <> 1 then raise exception 'anchor mismatch % %', n1, n2; end if;
  d := replace(d, a1, E'  fleet as materialized (\n    select v.id, v.country, v.site, v.vehicle_type, upper(btrim(v.asset_no)) as asset_key\n    from public.vehicle_fleet v\n  ),\n' || a1);
  d := replace(d, a2, E'    from fleet f\n    where f.asset_key = upper(btrim(p.asset_no))');
  execute d;
end $$;
