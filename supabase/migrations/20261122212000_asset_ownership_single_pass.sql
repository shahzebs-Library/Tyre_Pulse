-- get_asset_ownership: read the expense ledger once instead of twice.
--
-- The function built `foot` (per asset and country) and `months` (per asset and
-- month) with two separate full scans of parts_consumption, each with a
-- count(distinct ...) sort. On Data Reconciliation it regularly hit the 8 s
-- statement limit. Both are now derived from ONE grouped pass (asset, country,
-- month), materialised.
--
-- Proven equal before applying: for the full list, the cross-country list and a
-- single asset (TM514), the jsonb result (minus generated_at) was identical to
-- the old function. Time 1,276 ms -> 530 ms on the same data.
--
-- Applied by anchored replacement of the live definition so nothing else in the
-- body changes; aborts if the anchors are not found.
-- Rollback: re-create from the previous definition (git history / pg backups).

do $x$
declare d text; s int; e int; newpart text;
begin
  d := pg_get_functiondef('public.get_asset_ownership(text,integer,boolean,text)'::regprocedure);
  s := position('  with foot as (' in d);
  e := position('  conc as (' in d);
  if s = 0 or e = 0 or e < s then
    raise exception 'get_asset_ownership: expected anchors not found, nothing changed';
  end if;
  newpart := $n$  with base as materialized (
    -- ONE pass over the ledger: one row per asset, country and month.
    select asset_code,
           country,
           date_trunc('month', event_date)::date as m,
           count(*)::int     as rows_n,
           sum(line_cost)    as cost,
           sum(tyre_cost)    as tyre_cost,
           min(event_date)   as first_date,
           max(event_date)   as last_date
      from public.parts_consumption
     where organisation_id = v_org
       and asset_code is not null
       and btrim(asset_code) <> ''
       and (v_asset is null or asset_code = v_asset)
     group by 1, 2, 3
  ),
  foot as materialized (
    select asset_code, country,
           sum(rows_n)::int   as rows_n,
           count(m)::int      as months_n,
           min(first_date)    as first_date,
           max(last_date)     as last_date,
           sum(cost)          as cost,
           sum(tyre_cost)     as tyre_cost
      from base
     group by asset_code, country
  ),
  months as (
    select asset_code, m, count(*) as nc
      from base
     where m is not null
     group by 1, 2
  ),
$n$;
  execute substr(d, 1, s - 1) || newpart || substr(d, e);
end $x$;
