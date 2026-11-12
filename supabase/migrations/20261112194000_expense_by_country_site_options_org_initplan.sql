-- get_expense_by_country + reference_site_options: resolve the org once per query (PERF-4)
-- STATUS: APPLIED LIVE 2026-11-12 (schema_migrations 20261112080717).
--
-- MEASURED BEFORE (KSA-only Manager):
--   get_expense_by_country(null,null)            155,391 shared buffers (table is 10,624 pages)
--   get_expense_by_country('2026-01-01','2026-12-31') 155,388
--   reference_site_options('KSA')                48,324
--   `organisation_id = public.app_current_org()` was the only indexable predicate, so the planner
--   walked parts_consumption_org_asset_idx over all 218k rows of every country and filtered.
-- MEASURED AFTER:
--   get_expense_by_country                       10,669 shared buffers (one sequential pass), both forms
--   reference_site_options                       43,606 from this change alone; 911 after the
--                                                plain VACUUM of the same day (index-only scans).
--
-- WHAT CHANGED: the bare call becomes `(select public.app_current_org())` - 1 place in
-- get_expense_by_country, 8 in reference_site_options. Nothing else in either body moves;
-- SECURITY DEFINER, search_path, plan_cache_mode and grants are kept by CREATE OR REPLACE.
--
-- OUTPUT PROVEN IDENTICAL (md5): 2 parameter sets per function as the KSA Manager, 2 per function
-- as a super admin. 8 of 8 equal.
--
-- ROLLBACK: the same block with the replace() arguments swapped.

do $$ declare d text; a text := 'organisation_id = public.app_current_org()'; n int; begin
  select pg_get_functiondef('public.reference_site_options(text)'::regprocedure) into d;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 8 then raise exception 'anchor mismatch reference_site_options %', n; end if;
  execute replace(d, a, 'organisation_id = (select public.app_current_org())');
  select pg_get_functiondef('public.get_expense_by_country(date,date)'::regprocedure) into d;
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'anchor mismatch get_expense_by_country %', n; end if;
  execute replace(d, a, 'organisation_id = (select public.app_current_org())');
end $$;
