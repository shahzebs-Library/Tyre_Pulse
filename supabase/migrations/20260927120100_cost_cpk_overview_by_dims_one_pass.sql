-- 20260927120100_cost_cpk_overview_by_dims_one_pass
--
-- WHAT
--   get_cost_cpk_overview's five breakdowns (by_site, by_cost_center,
--   by_asset_type, by_asset, by_item) no longer call _cost_dim five times
--   (five further scoped reads of parts_consumption). They are aggregated
--   from the already-scoped materialized `pc` CTE, whose projection gains the
--   five dimension columns (site, cost_center, asset_type, asset_code,
--   item_description). The per-dimension SQL is byte-for-byte _cost_dim's
--   dynamic query (same label expression, same FILTER windows, same rounding,
--   same ORDER BY ... LIMIT 25 including the label tiebreak added by
--   20260927120000), only the FROM changes from parts_consumption+predicates
--   to pc.
--
-- WHY IT IS EQUIVALENT
--   pc carries the identical org / country / site predicates _cost_dim used
--   (both carried byte-for-byte from the same source), and its date range
--   [v_lo, v_hi] contains both _cost_dim windows (v_pf..v_pt and v_from..v_to),
--   which the per-dimension WHERE re-applies. The previous attempt
--   (20260927100000) failed equivalence ONLY on tie order; 20260927120000
--   made both sides deterministic first.
--
-- EQUIVALENCE (enforced before apply, probe copy public._probe_cpk_new vs the
-- live function, interleaved calls, set local role authenticated +
-- request.jwt.claims): payload minus generated_at compared as text for 6 real
-- users (super admin, KSA Manager, 3-country Tire Planning Engineer, UAE PMV
-- Manager, Egypt Tyre Data Collector, KSA Tyre Man) x 16 parameter sets
-- (all/KSA/UAE/Egypt, site NHC, site DIRIYAH, KSA+NHC, 1-day, 1-month,
-- 6-month, 1-year, 2020..2026, reversed range, Aug-2026 all countries and
-- Egypt, forbidden-country for scoped users): 96/96 byte-identical
-- (78 ok payloads, 18 forbidden refusals).
--
-- MEASURED (avg of ok calls, same session, alternating old/new):
--   per user   KSA Manager 1,117 -> 887 ms; super admin 856 -> 818;
--              3-country 1,116 -> 958; KSA Tyre Man 1,072 -> 864;
--              UAE PMV 1,019 -> 738; Egypt TDC 861 -> 564
--   per param  default all countries 1,600 -> 1,230; default KSA 1,194 -> 917;
--              2020..2026 2,162 -> 1,757; site NHC 826 -> 546.
--   STATED COST: very short windows got slightly slower (1-day 572 -> 648,
--   reversed 582 -> 663, KSA Aug 656 -> 676) because pc always spans at least
--   36 months for the monthly strip and is now wider. The page opens on the
--   12-month default, which is ~23% faster.
--
-- Guards, SECURITY DEFINER, search_path=public and
-- plan_cache_mode=force_custom_plan are unchanged (CREATE OR REPLACE from the
-- live text by anchored replace() with abort guards). _cost_dim is kept (no
-- longer called here; still used by other callers if any).
--
-- VERIFY
--   select pg_get_functiondef('public.get_cost_cpk_overview(text,text,date,date)'::regprocedure)
--     like '%_cost_dim(%';                                            -- false
--   select has_function_privilege('anon',
--     'public.get_cost_cpk_overview(text,text,date,date)','EXECUTE');  -- false
--
-- ROLLBACK
--   Re-apply the body from 20260927100000_cost_cpk_overview_single_scan.sql
--   (it calls _cost_dim for the five by_* keys).

do $mig$
declare
  d text := pg_get_functiondef('public.get_cost_cpk_overview(text,text,date,date)'::regprocedure);
  a1 text := E'upper(btrim(asset_code)) ac, classified_by\n';
  r1 text := E'upper(btrim(asset_code)) ac, classified_by,\n           site, cost_center, asset_type, asset_code, item_description\n';
  a2 text := '';
  r2 text := '';
  dims text[] := array['by_site','by_cost_center','by_asset_type','by_asset','by_item'];
  cols text[] := array['site','cost_center','asset_type','asset_code','item_description'];
  pads text[] := array['         ','  ','   ','        ','         '];
  i int;
  n int;
begin
  for i in 1..5 loop
    a2 := a2 || format(E'    %L,%spublic._cost_dim(v_org, p_country, p_site, v_from, v_to, v_pf, v_pt, %L),\n',
                       dims[i], pads[i], cols[i]);
    -- identical SQL to _cost_dim's dynamic query, read from the already
    -- scoped pc CTE (same org/country/site predicates, wider date range)
    r2 := r2 || format(E'    %L, (select coalesce(jsonb_agg(x order by x.spend desc, x.prev_spend desc, x.label), ''[]''::jsonb) from (\n'
      || E'        select coalesce(nullif(btrim(%I::text),''''),''Unspecified'') label,\n'
      || E'               coalesce(round(sum(line_cost) filter (where event_date between v_from and v_to)),0) spend,\n'
      || E'               coalesce(round(sum(line_cost) filter (where event_date between v_pf and v_pt)),0) prev_spend,\n'
      || E'               count(*) filter (where event_date between v_from and v_to) lines\n'
      || E'          from pc\n'
      || E'         where (event_date between v_from and v_to or event_date between v_pf and v_pt)\n'
      || E'         group by 1\n'
      || E'         order by 2 desc, 3 desc, 1\n'
      || E'         limit 25) x),\n', dims[i], cols[i]);
  end loop;
  n := (length(d) - length(replace(d, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'anchor pc-projection found % times', n; end if;
  n := (length(d) - length(replace(d, a2, ''))) / length(a2);
  if n <> 1 then raise exception 'anchor by_* block found % times', n; end if;
  if position('_cost_dim(' in replace(d, a2, '')) > 0 then raise exception 'stray _cost_dim call'; end if;
  d := replace(d, a1, r1);
  d := replace(d, a2, r2);
  execute d;
end $mig$;
