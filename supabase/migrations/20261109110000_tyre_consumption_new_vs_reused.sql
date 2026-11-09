-- =====================================================================
-- 20261109110000  Tyre consumption: new tyres vs refits vs transfers, tyre
-- quantity, Sun-Sat weeks. ADDITIVE: every existing key of
-- get_tyre_consumption keeps its meaning, so no screen breaks.
-- =====================================================================
-- Before: every tyre_records row in the window counted as one tyre consumed, so
-- a tyre removed and refitted (same or another vehicle) was counted as a new
-- tyre used each time, and qty was ignored. Now each fitment is classified:
--   new          first fitment of a real serial (a tyre consumed)
--   refit_same   the same tyre refitted on the SAME vehicle (not consumption)
--   transferred  the same tyre fitted on ANOTHER vehicle (not consumption)
--   unidentified the serial is a batch code / size / placeholder, so it cannot
--                be told apart; counted as a fitment, reported separately
-- The period date stays the fitment date (issue_date), never the upload date.
-- Week = Sunday to Saturday (KSA working week).
-- Requires 20261109100000 (public.tyre_serial_is_strong).
-- Rollback: create or replace from _bak.fn_defs_20261109c.
-- =====================================================================
begin;

create schema if not exists _bak;
create table if not exists _bak.fn_defs_20261109c (fn text primary key, def text not null, saved_at timestamptz not null default now());
insert into _bak.fn_defs_20261109c (fn, def)
values ('get_tyre_consumption', pg_get_functiondef('public.get_tyre_consumption(text,date,date)'::regprocedure))
on conflict (fn) do nothing;

-- Serial lookups for the previous-fitment check.
create index if not exists tyre_records_org_country_serial_idx
  on public.tyre_records (organisation_id, country, (upper(btrim(serial_no))));

do $do$
declare
  v_def text;
  a1 text := E'      coalesce(nullif(btrim(f.vehicle_type), ''''), nullif(btrim(t.vehicle_type), '''')) as vehicle_type\n    from public.tyre_records t';
  r1 text := E'      coalesce(nullif(btrim(f.vehicle_type), ''''), nullif(btrim(t.vehicle_type), '''')) as vehicle_type,\n'
    || E'      greatest(coalesce(t.qty, 1), 1) as tyres,\n'
    || E'      case when not public.tyre_serial_is_strong(t.serial_no) then ''unidentified''\n'
    || E'           when pv.asset_no is null then ''new''\n'
    || E'           when pv.asset_no = upper(regexp_replace(coalesce(t.asset_no, ''''), ''\\s+'', '''', ''g'')) then ''refit_same''\n'
    || E'           else ''transferred'' end as kind\n'
    || E'    from public.tyre_records t';
  a2 text := E'    ) f on true\n    where t.organisation_id = v_org';
  r2 text := E'    ) f on true\n'
    || E'    left join lateral (\n'
    || E'      select upper(regexp_replace(coalesce(e.asset_no, ''''), ''\\s+'', '''', ''g'')) as asset_no\n'
    || E'      from public.tyre_records e\n'
    || E'      where public.tyre_serial_is_strong(t.serial_no)\n'
    || E'        and e.organisation_id = t.organisation_id\n'
    || E'        and e.country is not distinct from t.country\n'
    || E'        and upper(btrim(e.serial_no)) = upper(btrim(t.serial_no))\n'
    || E'        and e.id <> t.id\n'
    || E'        and (coalesce(e.issue_date, e.fitment_date) < t.issue_date\n'
    || E'             or (coalesce(e.issue_date, e.fitment_date) = t.issue_date and (e.created_at, e.id) < (t.created_at, t.id)))\n'
    || E'      order by coalesce(e.issue_date, e.fitment_date) desc, e.created_at desc, e.id desc\n'
    || E'      limit 1\n'
    || E'    ) pv on true\n'
    || E'    where t.organisation_id = v_org';
  a3 text := E'  site_rows as (';
  r3 text := E'  kind_rows as (\n'
    || E'    select kind, count(*)::int as fitments, sum(tyres)::int as tyres from fitments group by kind\n'
    || E'  ),\n'
    || E'  weeks as (\n'
    || E'    select (issue_date - extract(dow from issue_date)::int) as wk,\n'
    || E'           count(*)::int as fitments,\n'
    || E'           (sum(tyres) filter (where kind = ''new''))::int as new_tyres,\n'
    || E'           (sum(tyres) filter (where kind in (''refit_same'', ''transferred'')))::int as reused,\n'
    || E'           (sum(tyres) filter (where kind = ''unidentified''))::int as unidentified\n'
    || E'    from fitments group by 1\n'
    || E'  ),\n'
    || E'  month_kinds as (\n'
    || E'    select to_char(date_trunc(''month'', issue_date), ''YYYY-MM'') as m,\n'
    || E'           (sum(tyres) filter (where kind = ''new''))::int as new_tyres,\n'
    || E'           (sum(tyres) filter (where kind in (''refit_same'', ''transferred'')))::int as reused,\n'
    || E'           (sum(tyres) filter (where kind = ''unidentified''))::int as unidentified\n'
    || E'    from fitments group by 1\n'
    || E'  ),\n'
    || E'  site_rows as (';
  a4 text := E'\n  ) into v_result;';
  r4 text := E',\n'
    || E'    ''tyres'', (select coalesce(sum(tyres), 0)::int from fitments),\n'
    || E'    ''new_tyres'', (select coalesce(sum(tyres) filter (where kind = ''new''), 0)::int from fitments),\n'
    || E'    ''by_kind'', coalesce((select jsonb_object_agg(kind, jsonb_build_object(''fitments'', fitments, ''tyres'', tyres)) from kind_rows), ''{}''::jsonb),\n'
    || E'    ''by_week'', coalesce((select jsonb_agg(jsonb_build_object(''week_start'', wk, ''week_end'', wk + 6,\n'
    || E'        ''fitments'', fitments, ''new_tyres'', coalesce(new_tyres, 0), ''reused'', coalesce(reused, 0),\n'
    || E'        ''unidentified'', coalesce(unidentified, 0)) order by wk) from weeks), ''[]''::jsonb),\n'
    || E'    ''by_month_kind'', coalesce((select jsonb_agg(jsonb_build_object(''m'', m, ''new_tyres'', coalesce(new_tyres, 0),\n'
    || E'        ''reused'', coalesce(reused, 0), ''unidentified'', coalesce(unidentified, 0)) order by m) from month_kinds), ''[]''::jsonb)\n'
    || E'  ) into v_result;';
begin
  select pg_get_functiondef('public.get_tyre_consumption(text,date,date)'::regprocedure) into v_def;
  if position('kind_rows' in v_def) > 0 then return; end if;  -- already applied
  if (length(v_def) - length(replace(v_def, a1, ''))) / length(a1) <> 1 then raise exception 'consumption: select anchor'; end if;
  if (length(v_def) - length(replace(v_def, a2, ''))) / length(a2) <> 1 then raise exception 'consumption: lateral anchor'; end if;
  if (length(v_def) - length(replace(v_def, a3, ''))) / length(a3) <> 1 then raise exception 'consumption: cte anchor'; end if;
  if (length(v_def) - length(replace(v_def, a4, ''))) / length(a4) <> 1 then raise exception 'consumption: output anchor'; end if;
  v_def := replace(v_def, a1, r1);
  v_def := replace(v_def, a2, r2);
  v_def := replace(v_def, a3, r3);
  v_def := replace(v_def, a4, r4);
  execute v_def;
end $do$;

commit;
