-- 20260927091000_daily_job_cards_narrow
--
-- PURPOSE
--   get_daily_job_cards (Dashboard "Daily job cards" panel, every Dashboard
--   load) began with `with wo as (select * from work_orders where <org + scope>)`
--   and then derived every figure from three subsets of it: cards opened on
--   the day, cards completed on the day, and cards still out of production.
--   The CTE is referenced many times so Postgres materialised ALL of a
--   country's job cards with every column (KSA 60k rows of a 182 MB table) on
--   every call: ~480 ms warm, and 13 s cold (it ran into the 8 s authenticated
--   statement_timeout, 57014 in the postgres log 2026-09-27 05:10 UTC).
--
--   1. `wo` is narrowed to exactly those three groups. Every output (kpis,
--      still_out_list, today_list, by_type, by_site) is computed only over rows
--      in one of them, so no figure changes.
--   2. Two indexes make the narrowed read an index lookup:
--      (organisation_id, completed_at) and a partial index on still-out cards
--      (790 rows, 48 kB). opened_at is already served by
--      work_orders_org_opened_cov_idx.
--   3. DETERMINISTIC TIES (a stated behaviour change). today_list is ordered by
--      opened_at and cut at 25, but ERP job cards carry a midnight opened_at,
--      so e.g. 134 KSA cards on 2026-09-20 tie and the 25 shown were whichever
--      the plan happened to produce - different plans already returned
--      different cards. Ties now break on work_order_no (desc for today,
--      asc for still out) and label for by_type/by_site.
--
--   Applied by anchored replacement of the LIVE pg_get_functiondef text; every
--   anchor must occur exactly the expected number of times or the migration
--   aborts. SECURITY DEFINER, search_path, grants and the org/country/site
--   guards are untouched.
--
-- VERIFY (done live, rolled back, impersonating real users)
--   Old body + the same tie-breakers vs new body, md5 of the whole payload:
--   super admin 20/20 identical (KSA/UAE/Egypt/All x 5 dates incl. 2026-09-20,
--   2025-11-03, 2024-03-10); KSA-only Manager 9/9 identical.
--   Warm, same txn, warm-up discarded: KSA 477 -> 5.9 ms, All 524 -> 4.4 ms.
--
-- ROLLBACK
--   Re-apply the previous body (supabase/migrations history, V381c
--   get_daily_job_cards) or reverse the replacements below; drop the two
--   indexes if wanted: drop index if exists work_orders_org_completed_idx,
--   work_orders_still_out_idx;

create index if not exists work_orders_org_completed_idx
  on public.work_orders (organisation_id, completed_at);
create index if not exists work_orders_still_out_idx
  on public.work_orders (organisation_id, production_out_at)
  where production_out_at is not null and production_in_at is null;

do $do$
declare
  d text := pg_get_functiondef('public.get_daily_job_cards(text,date)'::regprocedure);
  pairs text[][] := array[
    array[E'order by opened_at desc nulls last\n         limit 25', E'order by opened_at desc nulls last, work_order_no desc\n         limit 25', '1'],
    array['jsonb_agg(x order by x.opened_at desc)', 'jsonb_agg(x order by x.opened_at desc, x.work_order_no desc)', '1'],
    array[E'order by production_out_at asc\n         limit 25', E'order by production_out_at asc, work_order_no asc\n         limit 25', '1'],
    array['jsonb_agg(x order by x.hours_out desc)', 'jsonb_agg(x order by x.hours_out desc, x.work_order_no asc)', '1'],
    array['jsonb_agg(x order by x.n desc)', 'jsonb_agg(x order by x.n desc, x.label)', '2']
  ];
  anchor text := E'\n  ), today as (';
  ins text := E'\n       -- Only the rows any output below can use: opened or completed on the\n       -- day, or still out of production. Every figure is computed over these\n       -- three groups, so narrowing here changes no number; it stops the CTE\n       -- materialising every job card the country has ever had.\n       and ((opened_at >= v_day and opened_at < v_day + 1)\n         or (completed_at >= v_day and completed_at < v_day + 1)\n         or (production_out_at is not null and production_in_at is null))';
  i int; n int;
begin
  for i in 1..array_length(pairs,1) loop
    n := (length(d) - length(replace(d, pairs[i][1], ''))) / length(pairs[i][1]);
    if n <> pairs[i][3]::int then raise exception 'anchor % found % times', i, n; end if;
    d := replace(d, pairs[i][1], pairs[i][2]);
  end loop;
  n := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'wo anchor found % times', n; end if;
  d := replace(d, anchor, ins || anchor);
  execute d;
end $do$;
