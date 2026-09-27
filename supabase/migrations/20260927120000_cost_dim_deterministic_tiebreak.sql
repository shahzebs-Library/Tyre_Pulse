-- 20260927120000_cost_dim_deterministic_tiebreak
--
-- WHAT
--   public._cost_dim (the five by_* breakdowns of get_cost_cpk_overview:
--   site / cost_center / asset_type / asset_code / item_description) ordered
--   by (spend desc, prev_spend desc) with LIMIT 25 and NO unique tiebreak.
--   `label` (the GROUP BY key, therefore unique within the result) is now the
--   final ORDER BY key, both in the inner ORDER BY ... LIMIT 25 and in the
--   outer jsonb_agg(... order by ...).
--
-- WHY
--   Rows tied on rounded spend (and prev_spend) came back in plan-dependent
--   order, and which tied row became the 25th was arbitrary. That made the
--   output non-reproducible, and blocked proving any rewrite of the caller
--   equivalent (20260927100000 had to refuse its one-pass by_* version for
--   exactly this reason).
--
-- BEFORE / AFTER
--   Only the ORDER of exact ties changes. No figure changes. At the LIMIT 25
--   boundary, when the 25th and 26th rows are tied, the row kept is now the
--   alphabetically first label instead of an arbitrary one (see the report
--   measurements).
--
-- APPLIED BY anchored replace() on the LIVE pg_get_functiondef text with
-- abort guards (each anchor must occur exactly once). SECURITY DEFINER,
-- search_path=public and plan_cache_mode=force_custom_plan are preserved by
-- CREATE OR REPLACE from the live text.
--
-- VERIFY
--   select pg_get_functiondef('public._cost_dim(uuid,text,text,date,date,date,date,text)'::regprocedure)
--     like '%order by x.spend desc, x.prev_spend desc, x.label%';        -- true
--   select pg_get_functiondef('public._cost_dim(uuid,text,text,date,date,date,date,text)'::regprocedure)
--     like '%order by 2 desc, 3 desc, 1%';                                -- true
--   select has_function_privilege('authenticated','public._cost_dim(uuid,text,text,date,date,date,date,text)','EXECUTE'); -- false
--
-- ROLLBACK
--   Reverse the two replacements below (remove ', x.label' and ', 1').

do $mig$
declare
  d text := pg_get_functiondef('public._cost_dim(uuid,text,text,date,date,date,date,text)'::regprocedure);
  a1 text := 'jsonb_agg(x order by x.spend desc, x.prev_spend desc)';
  a2 text := E'order by 2 desc, 3 desc\n';
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 then
    raise exception 'anchor 1 not found exactly once'; end if;
  if (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then
    raise exception 'anchor 2 not found exactly once'; end if;
  d := replace(d, a1, 'jsonb_agg(x order by x.spend desc, x.prev_spend desc, x.label)');
  d := replace(d, a2, E'order by 2 desc, 3 desc, 1\n');
  execute d;
end $mig$;
