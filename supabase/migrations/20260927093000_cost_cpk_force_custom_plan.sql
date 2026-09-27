-- 20260927093000_cost_cpk_force_custom_plan
--
-- PURPOSE
--   get_cost_cpk_overview (Expenses & CPK page, 116 calls, mean 3.8 s) and its
--   _cost_* helpers are plpgsql/SECURITY DEFINER bodies whose predicates read
--   `(p_country is null or country = p_country)` / `(p_site is null or ...)`.
--   plpgsql caches each statement's plan per connection and, after five
--   executions, switches to a GENERIC plan when it looks no worse on paper.
--   A generic plan cannot use p_country to narrow the index scan, so on a
--   long-lived PostgREST connection every call after the fifth reads every
--   country's rows. Measured in one session, same arguments:
--     _cost_cpk: calls 1-5 = 135-162 ms, calls 6-8 = 369-385 ms (generic).
--     get_cost_cpk_overview: 1,798 ms -> 2,191-2,595 ms after the switch;
--     1,678-1,709 ms with custom plans forced.
--   Forcing custom plans for these functions keeps the argument-specific
--   (index-using) plan. Configuration only: no body changes, output is
--   byte-identical (md5 of the payload minus generated_at identical across
--   all 11 runs, KSA-only Manager).
--
-- VERIFY
--   select proname, proconfig from pg_proc where proname in
--     ('get_cost_cpk_overview','_cost_cpk','_cost_totals','_cost_dim');
--   -> each carries plan_cache_mode=force_custom_plan beside search_path.
--
-- ROLLBACK
--   alter function <each> reset plan_cache_mode;

alter function public.get_cost_cpk_overview(text,text,date,date) set plan_cache_mode = force_custom_plan;
alter function public._cost_cpk(uuid,text,text,date,date,numeric) set plan_cache_mode = force_custom_plan;
alter function public._cost_totals(uuid,text,text,date,date)     set plan_cache_mode = force_custom_plan;
alter function public._cost_dim(uuid,text,text,date,date,date,date,text) set plan_cache_mode = force_custom_plan;
