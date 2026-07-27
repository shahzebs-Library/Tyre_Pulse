-- V375 - Data Trust Centre: the raw inputs behind every KPI confidence score.
--
-- WHY THIS EXISTS
-- The app prints KPI numbers with no indication of how much of the underlying
-- data actually supports them. A manager cannot tell SAR 40.6M of tyre and parts
-- spend built on identified items from the same figure where half the money was
-- bucketed by a fallback rule. This function gathers, in ONE call, the raw counts
-- that the pure engine `src/lib/dataTrust.js` turns into a 0-100 confidence per
-- KPI domain. No scoring happens here on purpose: the thresholds are product
-- policy and belong in one testable JS file, not duplicated in SQL.
--
-- CURRENCY RULE (this system has broken it four separate times)
-- Every money figure is returned PER COUNTRY and never summed. KSA reports SAR,
-- UAE AED, Egypt EGP. A "share of spend" ratio is only meaningful inside one
-- country, so the payload is an array of per-country blocks and the caller is
-- given no cross-country money total to misuse.
--
-- WINDOWED vs REGISTER-STATE
-- Expense measures are windowed (default: trailing 365 days) because trust in a
-- KPI is trust in the period it covers. Tyre and fleet measures are all-time,
-- because those tables are a register whose completeness is a standing property,
-- not a property of a date range.
--
-- Conventions copied verbatim from get_cost_cpk_overview (V374): SECURITY
-- DEFINER, pinned search_path, self-gating on app_current_org() + app_is_active(),
-- jsonb return with {ok:false,reason:'unauthorized'} rather than an exception.

create or replace function public.get_data_trust_overview(
  p_country text default null,
  p_from    date default null,
  p_to      date default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_org  uuid := public.app_current_org();
  v_to   date := coalesce(p_to, current_date);
  v_from date := coalesce(p_from, coalesce(p_to, current_date) - 364);
  result jsonb;
begin
  if v_org is null or not public.app_is_active() then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  with scope as (
    -- one block per country that actually carries expense data in this org
    select distinct country
      from public.parts_consumption
     where organisation_id = v_org
       and coalesce(btrim(country), '') <> ''
       and (p_country is null or country = p_country)
  ),

  -- Windowed expense measures. `spend_default` is the headline provenance
  -- number: money whose cost bucket was decided by the fallback because nothing
  -- (reviewed master, ERP code range, description) identified the item.
  exp_win as (
    select p.country,
           count(*)::bigint                                            as lines,
           coalesce(sum(p.line_cost), 0)                               as spend,
           count(*) filter (
             where coalesce(p.classified_by, 'default') in ('default', 'unknown')
           )::bigint                                                   as lines_default,
           coalesce(sum(p.line_cost) filter (
             where coalesce(p.classified_by, 'default') in ('default', 'unknown')
           ), 0)                                                       as spend_default,
           count(*) filter (where coalesce(btrim(p.currency), '') = '')::bigint
                                                                       as lines_no_currency,
           count(*) filter (where coalesce(btrim(p.item_code), '') = '')::bigint
                                                                       as lines_no_item
      from public.parts_consumption p
     where p.organisation_id = v_org
       and (p_country is null or p.country = p_country)
       and p.event_date between v_from and v_to
     group by p.country
  ),

  -- All-time expense measures. `lines_no_date` and `lines_no_uid` MUST be
  -- counted outside the window: a row with no event_date can never appear
  -- inside a date filter, so measuring dating completeness on a windowed set
  -- would always report a perfect 100%.
  exp_all as (
    select p.country,
           count(*)::bigint                                            as lines_total,
           count(*) filter (where p.event_date is null)::bigint        as lines_no_date,
           count(*) filter (where p.import_uid is null)::bigint        as lines_no_uid,
           max(p.event_date)                                           as last_event_date
      from public.parts_consumption p
     where p.organisation_id = v_org
       and (p_country is null or p.country = p_country)
     group by p.country
  ),

  -- Spend whose item code carries a HUMAN-REVIEWED material_master row. An
  -- unreviewed master row is deliberately not counted: it was derived from the
  -- same patterns the classifier already used, so treating it as evidence would
  -- dress a guess as a decision.
  rev as (
    select p.country, coalesce(sum(p.line_cost), 0) as spend_reviewed
      from public.parts_consumption p
      join public.material_master m
        on m.organisation_id = p.organisation_id
       and m.country         = p.country
       and m.item_code       = p.item_code
       and m.reviewed
     where p.organisation_id = v_org
       and (p_country is null or p.country = p_country)
       and p.event_date between v_from and v_to
     group by p.country
  ),

  fleet_assets as (
    select country, upper(btrim(asset_no)) as a
      from public.vehicle_fleet
     where organisation_id = v_org
       and coalesce(btrim(asset_no), '') <> ''
  ),

  -- Can each riyal of spend be attributed to an asset the fleet register knows?
  -- Spend on an unknown asset cannot be rolled into any per-asset or per-type
  -- cost figure, so this is the ceiling on those KPIs.
  link as (
    select p.country,
           coalesce(sum(p.line_cost) filter (where f.a is not null), 0) as spend_linked,
           count(distinct upper(btrim(p.asset_code)))::bigint           as assets,
           count(distinct upper(btrim(p.asset_code)))
             filter (where f.a is not null)::bigint                     as assets_linked
      from public.parts_consumption p
      left join fleet_assets f
        on f.country = p.country
       and f.a       = upper(btrim(p.asset_code))
     where p.organisation_id = v_org
       and (p_country is null or p.country = p_country)
       and p.event_date between v_from and v_to
       and coalesce(btrim(p.asset_code), '') <> ''
     group by p.country
  ),

  -- The cost-per-km denominator. odometer_logs is empty, so distance is
  -- inferred from the km stamped on tyre fitment and removal; this counts the
  -- assets for which that inference produces a usable span.
  km as (
    select k.country, count(*)::bigint as assets_measured
      from public.fleet_km_by_asset(v_org, p_country, v_from, v_to) k
     group by k.country
  ),

  -- Tyre register state (all-time).
  tyres as (
    select t.country,
           count(*)::bigint                                                as rows_total,
           count(*) filter (where coalesce(btrim(t.brand), '') = '')::bigint
                                                                           as no_brand,
           count(*) filter (where t.cost_per_tyre is null or t.cost_per_tyre <= 0)::bigint
                                                                           as no_unit_cost,
           count(*) filter (where t.fitment_date is null)::bigint          as no_fitment_date,
           count(*) filter (
             where t.km_at_fitment > 0 and t.km_at_removal > 0
           )::bigint                                                       as km_span_both,
           count(*) filter (
             where t.fitment_date > current_date or t.removal_date > current_date
           )::bigint                                                       as future_dated,
           count(*) filter (
             where t.fitment_date is not null and t.removal_date is not null
               and t.removal_date < t.fitment_date
           )::bigint                                                       as removal_before_fitment,
           count(*) filter (
             where t.km_at_fitment > 0 and t.km_at_removal > 0
               and t.km_at_removal < t.km_at_fitment
           )::bigint                                                       as km_backwards
      from public.tyre_records t
     where t.organisation_id = v_org
       and (p_country is null or t.country = p_country)
     group by t.country
  ),

  -- Fleet register state (all-time).
  flt as (
    select v.country,
           count(*)::bigint                                                as rows_total,
           count(*) filter (where coalesce(btrim(v.vehicle_type), '') = '')::bigint
                                                                           as no_vehicle_type,
           count(*) filter (where coalesce(btrim(v.make), '') = '')::bigint
                                                                           as no_make
      from public.vehicle_fleet v
     where v.organisation_id = v_org
       and (p_country is null or v.country = p_country)
     group by v.country
  ),

  -- Direct meter sources. Both tables are currently empty; reporting the count
  -- honestly is what lets the UI say "distance is inferred, not measured"
  -- instead of implying a meter feed exists.
  meters as (
    select s.country,
           (select count(*) from public.odometer_logs o
             where o.organisation_id = v_org and o.country = s.country)::bigint    as odometer_rows,
           (select count(*) from public.engine_hours_logs e
             where e.organisation_id = v_org and e.country = s.country)::bigint    as engine_hours_rows
      from scope s
  )

  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'window', jsonb_build_object('from', v_from, 'to', v_to),
    'country', p_country,
    'countries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'country',  s.country,
          'currency', public.currency_for_country(s.country),
          'measures', jsonb_build_object(
            -- expense, windowed
            'expense_lines',              coalesce(w.lines, 0),
            'expense_spend',              round(coalesce(w.spend, 0), 2),
            'expense_lines_default',      coalesce(w.lines_default, 0),
            'expense_spend_default',      round(coalesce(w.spend_default, 0), 2),
            'expense_lines_no_currency',  coalesce(w.lines_no_currency, 0),
            'expense_lines_no_item',      coalesce(w.lines_no_item, 0),
            'expense_spend_reviewed',     round(coalesce(r.spend_reviewed, 0), 2),
            -- expense, all time
            'expense_lines_total',        coalesce(a.lines_total, 0),
            'expense_lines_no_date',      coalesce(a.lines_no_date, 0),
            'expense_lines_no_uid',       coalesce(a.lines_no_uid, 0),
            'expense_last_event_date',    a.last_event_date,
            'expense_days_since',         case when a.last_event_date is null then null
                                               else greatest(0, current_date - a.last_event_date) end,
            -- attribution
            'expense_spend_linked',       round(coalesce(l.spend_linked, 0), 2),
            'expense_assets',             coalesce(l.assets, 0),
            'expense_assets_linked',      coalesce(l.assets_linked, 0),
            -- distance
            'km_assets_measured',         coalesce(k.assets_measured, 0),
            'odometer_rows',              coalesce(mt.odometer_rows, 0),
            'engine_hours_rows',          coalesce(mt.engine_hours_rows, 0),
            -- tyre register
            'tyre_rows',                  coalesce(ty.rows_total, 0),
            'tyre_no_brand',              coalesce(ty.no_brand, 0),
            'tyre_no_unit_cost',          coalesce(ty.no_unit_cost, 0),
            'tyre_no_fitment_date',       coalesce(ty.no_fitment_date, 0),
            'tyre_km_span_both',          coalesce(ty.km_span_both, 0),
            'tyre_future_dated',          coalesce(ty.future_dated, 0),
            'tyre_removal_before_fitment', coalesce(ty.removal_before_fitment, 0),
            'tyre_km_backwards',          coalesce(ty.km_backwards, 0),
            -- fleet register
            'fleet_rows',                 coalesce(f.rows_total, 0),
            'fleet_no_vehicle_type',      coalesce(f.no_vehicle_type, 0),
            'fleet_no_make',              coalesce(f.no_make, 0)
          )
        ) order by s.country
      )
      from scope s
      left join exp_win w  on w.country  = s.country
      left join exp_all a  on a.country  = s.country
      left join rev     r  on r.country  = s.country
      left join link    l  on l.country  = s.country
      left join km      k  on k.country  = s.country
      left join tyres   ty on ty.country = s.country
      left join flt     f  on f.country  = s.country
      left join meters  mt on mt.country = s.country
    ), '[]'::jsonb)
  ) into result;

  return result;
end
$function$;

comment on function public.get_data_trust_overview(text, date, date) is
  'Data Trust Centre raw inputs, one block per country. Returns counts only; '
  '0-100 confidence scoring lives in src/lib/dataTrust.js. Money is never '
  'summed across countries because each reports in its own currency.';

revoke all     on function public.get_data_trust_overview(text, date, date) from public;
revoke all     on function public.get_data_trust_overview(text, date, date) from anon;
grant  execute on function public.get_data_trust_overview(text, date, date) to authenticated;
