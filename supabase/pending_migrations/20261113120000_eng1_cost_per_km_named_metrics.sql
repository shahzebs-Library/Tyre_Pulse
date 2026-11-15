-- ENG-1: one name per cost-per-distance metric. Stop dividing spares and oil by tyre km.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the LIVE definitions of
--         public.get_fleet_cpk(text,date,date,text) and
--         public.get_cost_cpk_overview(text,text,date,date), read with
--         pg_get_functiondef (SELECT only). Nothing here has been run against
--         production. Every anchor below was counted on the live text on
--         2026-11-12 and occurs exactly once. A DB-authorised session applies
--         this, runs VERIFY, then flips this header to "APPLIED LIVE <date>".
--
-- WHY. Two screens printed a "cost per km" for the same country and year that
-- differed 12.6 times (KSA, 2025-11-01 to 2026-10-31: 0.0235 against 0.296 SAR).
-- The arithmetic of each was right. They were different measurements with one
-- name. Measured read-only on 2026-11-12, twelve months to 2026-10-31:
--
--   metric (name in src/lib/cpkMetrics.js)          KSA SAR    UAE AED    Egypt EGP
--   tyre spend ratio (get_fleet_cpk km.cpk_tyre)     0.0168     0.0536     1.1087
--   "total cost per km" on tyre km (km.cpk_total)    0.0235     0.1135     3.7754   <- not a measurement
--   Tyre CPK lifetime, retired tyres                 0.028661   0.015972   0.402182
--   tyre cost per vehicle km                         0.1907     0.1827     4.8969
--   maintenance cost per vehicle km                  0.1054     0.2351     9.4966
--   operating cost per vehicle km (parts, materials) 0.2961     0.4178     14.3936 (Egypt: 19.8% coverage, not comparable)
--
-- get_fleet_cpk km side divides by TYRE km: the whole lifetime km of the tyres
-- taken off (or issued) in the period (KSA 146,144,345 tyre km against 16,165,110
-- vehicle km, about nine wheels per vehicle). Dividing tyre spend by it is a
-- ratio worth showing under its own name. Dividing spares and oil by it is not a
-- measurement at all, and that is the 0.0235.
--
-- WHAT THIS CHANGES.
--  1. get_fleet_cpk: on km rows `cpk_total` becomes null. The old value moves to
--     `legacy_total_per_tyre_km` (kept for one release, for traceability only).
--     Every row gains `rate_metric`; the fleet km object gains `metric` and
--     `km_basis`. Hour rows are unchanged (cost per machine engine hour is valid).
--     `cpk_tyre` is unchanged everywhere.
--  2. get_cost_cpk_overview: each window of `cpk` gains `spend_matched_tyre`,
--     `spend_matched_maintenance`, `cpk_tyre`, `cpk_maintenance`, `metric`,
--     `km_basis`. Existing keys and values are unchanged. This is what lets the
--     Expenses and CPK page show tyre and maintenance cost per VEHICLE km.
--  3. metric_registry: `fleet_cpk` is renamed to what it is, and the vehicle km
--     metrics are registered. Registry text only.
--
-- WEB ALREADY HANDLES BOTH STATES. src/lib/cpkMetrics.js sanitizeFleetCpk nulls
-- km cpk_total client side today, and costCpk.cpkView reads the new keys when
-- present and shows N/A when absent. Applying this changes no number on screen
-- except: the tyre and maintenance split on Expenses and CPK appears.
--
-- RISK TO THE CURRENT COMPANY: low. (1) removes a figure the web no longer shows;
-- any other reader of get_fleet_cpk().km.cpk_total sees null. Known reader: the
-- ai-orchestrator fleet CPK tool (supabase/functions). Until this is applied
-- that tool can still quote the km total; after, it has only the named ratio.
-- No reference to get_fleet_cpk was found in the Flutter or Expo sources.
-- (2) is additive. (3) is text. No table data is touched.
--
-- VERIFY (as a signed-in Manager, read only):
--   select j->'fleet'->0->'km' from (select public.get_fleet_cpk('KSA','2025-11-01','2026-10-31') j) x;
--     expect cpk_tyre 0.0168, cpk_total null, legacy_total_per_tyre_km 0.0235,
--     metric 'tyre_spend_ratio'; hours.cpk_total still 4.9701.
--   select o->'cpk'->'current' from (select public.get_cost_cpk_overview('KSA',null,'2025-11-01','2026-10-31') o) x;
--     expect cpk 0.296 (unchanged), cpk_tyre 0.191, cpk_maintenance 0.105,
--     spend_matched 4785691 = spend_matched_tyre 3082290 + spend_matched_maintenance 1703401.
--   UAE: cpk 0.418, cpk_tyre 0.183, cpk_maintenance 0.235.
--
-- ROLLBACK: both previous definitions are saved by this script in
--   _bak.fn_defs_eng_20261113 (fn, def). Re-run the saved `def` text for each
--   function to restore it. The registry rows can be set back from the same
--   table (key 'metric_registry.fleet_cpk').
-- ---------------------------------------------------------------------------

create schema if not exists _bak;
create table if not exists _bak.fn_defs_eng_20261113 (
  fn text not null, captured_at timestamptz not null default now(), def text not null);

-- Replace an anchor that must occur exactly once. Anything else aborts the script.
create or replace function pg_temp.eng_replace_once(p_src text, p_anchor text, p_new text, p_what text)
returns text language plpgsql as $f$
declare n int := (length(p_src) - length(replace(p_src, p_anchor, ''))) / length(p_anchor);
begin
  if n <> 1 then
    raise exception 'ENG guard: anchor for % found % times, expected 1. Live definition has changed; re-author the draft.', p_what, n;
  end if;
  return replace(p_src, p_anchor, p_new);
end $f$;

do $eng$
declare
  v_def text;
begin
  -- ── 1. get_fleet_cpk ──────────────────────────────────────────────────────
  v_def := pg_get_functiondef('public.get_fleet_cpk(text,date,date,text)'::regprocedure);
  insert into _bak.fn_defs_eng_20261113 (fn, def) values ('get_fleet_cpk(text,date,date,text)', v_def);

  v_def := pg_temp.eng_replace_once(v_def,
    $a$'cpk_total', case when denom > 0 then round(total_cost / denom, 4) else null end$a$,
    $b$'cpk_total', case when unit = 'engine_hours' and denom > 0 then round(total_cost / denom, 4) else null end,
          'legacy_total_per_tyre_km', case when unit = 'km' and denom > 0 then round(total_cost / denom, 4) else null end,
          'rate_metric', case when unit = 'engine_hours' then 'operating_cost_per_engine_hour' else 'tyre_spend_ratio' end$b$,
    'get_fleet_cpk per_vehicle cpk_total');

  v_def := pg_temp.eng_replace_once(v_def,
    $a$'cpk_total', case when g.denom_sum > 0 then round(g.matched_total / g.denom_sum, 4) else null end$a$,
    $b$'cpk_total', case when g.unit = 'engine_hours' and g.denom_sum > 0 then round(g.matched_total / g.denom_sum, 4) else null end,
          'legacy_total_per_tyre_km', case when g.unit = 'km' and g.denom_sum > 0 then round(g.matched_total / g.denom_sum, 4) else null end,
          'rate_metric', case when g.unit = 'engine_hours' then 'operating_cost_per_engine_hour' else 'tyre_spend_ratio' end$b$,
    'get_fleet_cpk by_type cpk_total');

  v_def := pg_temp.eng_replace_once(v_def,
    $a$'cpk_total', case when fa.km_sum > 0 then round(fa.km_total_matched / fa.km_sum, 4) else null end$a$,
    $b$'cpk_total', null,
            'legacy_total_per_tyre_km', case when fa.km_sum > 0 then round(fa.km_total_matched / fa.km_sum, 4) else null end,
            'metric', 'tyre_spend_ratio',
            'km_basis', 'lifetime tyre km of tyres removed or issued in the period'$b$,
    'get_fleet_cpk fleet km cpk_total');

  execute v_def;

  -- ── 2. get_cost_cpk_overview ──────────────────────────────────────────────
  v_def := pg_get_functiondef('public.get_cost_cpk_overview(text,text,date,date)'::regprocedure);
  if position('c_matched_tyre' in v_def) > 0 then
    raise exception 'ENG guard: get_cost_cpk_overview already carries the tyre and maintenance split. Nothing to do.';
  end if;
  insert into _bak.fn_defs_eng_20261113 (fn, def) values ('get_cost_cpk_overview(text,text,date,date)', v_def);

  -- tyre spend on the measured assets, one aggregate per window, beside *_matched
  v_def := pg_temp.eng_replace_once(v_def,
    $a$where k = 'current'))),0) c_matched,$a$,
    $b$where k = 'current'))),0) c_matched,
      coalesce(round(sum(tyre_cost)  filter (where event_date between v_from and v_to
          and ac in (select asset_no from kmr where k = 'current'))),0) c_matched_tyre,$b$,
    'overview c_matched');
  v_def := pg_temp.eng_replace_once(v_def,
    $a$where k = 'previous'))),0) p_matched,$a$,
    $b$where k = 'previous'))),0) p_matched,
      coalesce(round(sum(tyre_cost)  filter (where event_date between v_pf and v_pt
          and ac in (select asset_no from kmr where k = 'previous'))),0) p_matched_tyre,$b$,
    'overview p_matched');
  v_def := pg_temp.eng_replace_once(v_def,
    $a$where k = 'last_year'))),0) l_matched$a$,
    $b$where k = 'last_year'))),0) l_matched,
      coalesce(round(sum(tyre_cost)  filter (where event_date between v_lf and v_lt
          and ac in (select asset_no from kmr where k = 'last_year'))),0) l_matched_tyre$b$,
    'overview l_matched');

  -- carry it through the three window rows (a UNION: all three must change together)
  v_def := pg_temp.eng_replace_once(v_def,
    $a$c_assets assets, c_matched matched from agg$a$,
    $b$c_assets assets, c_matched matched, c_matched_tyre matched_tyre from agg$b$, 'overview win current');
  v_def := pg_temp.eng_replace_once(v_def,
    $a$p_assets, p_matched from agg$a$, $b$p_assets, p_matched, p_matched_tyre from agg$b$, 'overview win previous');
  v_def := pg_temp.eng_replace_once(v_def,
    $a$l_assets, l_matched from agg$a$, $b$l_assets, l_matched, l_matched_tyre from agg$b$, 'overview win last_year');

  -- the named split, beside the unchanged total
  v_def := pg_temp.eng_replace_once(v_def,
    $a$'cpk', case when m.km > 0 then round(w.matched / m.km, 3) end,$a$,
    $b$'cpk', case when m.km > 0 then round(w.matched / m.km, 3) end,
        'metric', 'operating_cost_per_vehicle_km',
        'km_basis', 'vehicle odometer span in the period',
        'spend_matched_tyre', w.matched_tyre,
        'spend_matched_maintenance', w.matched - w.matched_tyre,
        -- null, never zero: same rule as cpk
        'cpk_tyre', case when m.km > 0 then round(w.matched_tyre / m.km, 3) end,
        'cpk_maintenance', case when m.km > 0 then round((w.matched - w.matched_tyre) / m.km, 3) end,$b$,
    'overview cpk object');

  execute v_def;
end $eng$;

-- ── 3. metric registry: names that say what is measured ─────────────────────
insert into _bak.fn_defs_eng_20261113 (fn, def)
select 'metric_registry.fleet_cpk', to_jsonb(m)::text from public.metric_registry m where metric_id = 'fleet_cpk';

update public.metric_registry
   set name = 'Tyre spend ratio (period spend over lifetime tyre km)',
       description = 'Tyre spend booked in the period, on assets that have tyre km, divided by the whole lifetime km of the tyres taken off (or fitted and not yet removed) in the period. Not a tyre CPK and not a cost per vehicle km. Hour-measured plant is reported separately per engine hour.',
       unit = 'currency per tyre km (per country)',
       transformations = 'numerator: expense grid tyre bucket dated in the period; denominator: sum(tyre_km_life) of tyres whose removal or issue date is in the period',
       updated_at = now()
 where metric_id = 'fleet_cpk';

insert into public.metric_versions (metric_id, version, formula, formula_ref, numerator, denominator, rounding, effective_from, owner, change_note)
select 'fleet_cpk', 2,
       'tyre spend ratio = period tyre spend of matched assets / lifetime tyre km of tyres removed or issued in the period',
       'get_fleet_cpk; src/lib/cpkMetrics.js tyre_spend_ratio',
       'expense grid tyre bucket, dated in the period, assets with tyre km',
       'sum(tyre_km_life) of tyres whose removal or issue date is in the period',
       rounding, current_date, owner,
       'ENG-1: renamed from Fleet Cost Per Km. The km total (tyres + spares + oil over tyre km) is withheld.'
  from public.metric_versions where metric_id = 'fleet_cpk' and version = 1
on conflict (metric_id, version) do nothing;

insert into public.metric_registry (metric_id, name, description, business_owner, source_module, source_table, source_columns,
  date_field, date_logic, unit, currency_handling, null_handling, duplicate_handling, joins, transformations, refresh_sla,
  lineage_domain, quality_domain, calc_ref, dashboards)
select v.metric_id, v.name, v.description, m.business_owner, v.source_module, v.source_table, v.source_columns,
  v.date_field, v.date_logic, v.unit, m.currency_handling, v.null_handling, v.duplicate_handling, v.joins, v.transformations, m.refresh_sla,
  m.lineage_domain, m.quality_domain, v.calc_ref, v.dashboards
from public.metric_registry m,
(values
  ('tyre_cpk_lifetime', 'Tyre CPK (lifetime)',
   'Purchase price of each physical tyre, counted once, divided by the validated km that tyre ran over all of its fitments. Weighted: total price over total km of tyres that have both. Final figures use tyres no longer fitted.',
   'CPK Intelligence', 'tyre_records', array['cost_per_tyre','km_at_fitment','km_at_removal','total_km','serial_no'],
   'coalesce(last_removal_date,last_fit_date)', 'Tyre retired in the period', 'currency per tyre km (per country)',
   'Tyres with no price or no validated km are outside the figure; coverage is reported', 'One price per physical tyre; overlapping fitments add no km',
   'v_tyre_lifetime', 'sum(purchase cost) / sum(validated lifetime km) over measurable tyres', 'get_tyre_lifetime_cpk',
   array['CPK Intelligence','Engineering KPI']),
  ('operating_cost_per_vehicle_km', 'Operating cost per vehicle km (parts and materials)',
   'Tyres, spare parts and oil in the period on assets with a measured distance, divided by the km those vehicles drove in the period. Labour, fuel and depreciation are not included.',
   'Expenses and CPK', 'parts_consumption', array['line_cost','asset_code','event_date'],
   'event_date', 'Spend dated in the period', 'currency per vehicle km (per country)',
   'Null when no asset has a measured distance; coverage of spend is reported', 'Expense duplicate rule T11',
   'fleet_km_by_asset by asset', 'sum(line_cost of measured assets) / sum(odometer span)', 'get_cost_cpk_overview',
   array['Expenses and CPK']),
  ('tyre_cost_per_vehicle_km', 'Tyre cost per vehicle km',
   'Tyre spend in the period on assets with a measured distance, divided by the km those vehicles drove in the period.',
   'Expenses and CPK', 'parts_consumption', array['tyre_cost','asset_code','event_date'],
   'event_date', 'Spend dated in the period', 'currency per vehicle km (per country)',
   'Null when no asset has a measured distance', 'Expense duplicate rule T11',
   'fleet_km_by_asset by asset', 'sum(tyre_cost of measured assets) / sum(odometer span)', 'get_cost_cpk_overview',
   array['Expenses and CPK']),
  ('maintenance_cost_per_vehicle_km', 'Maintenance cost per vehicle km',
   'Spare parts and oil spend in the period on assets with a measured distance, divided by the km those vehicles drove in the period. Parts and materials only.',
   'Expenses and CPK', 'parts_consumption', array['spare_cost','oil_cost','asset_code','event_date'],
   'event_date', 'Spend dated in the period', 'currency per vehicle km (per country)',
   'Null when no asset has a measured distance', 'Expense duplicate rule T11',
   'fleet_km_by_asset by asset', 'sum(spare_cost + oil_cost of measured assets) / sum(odometer span)', 'get_cost_cpk_overview',
   array['Expenses and CPK'])
) as v(metric_id, name, description, source_module, source_table, source_columns, date_field, date_logic, unit,
       null_handling, duplicate_handling, joins, transformations, calc_ref, dashboards)
where m.metric_id = 'fleet_cpk'
on conflict (metric_id) do nothing;
