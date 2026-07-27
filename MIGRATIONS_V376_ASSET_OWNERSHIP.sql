-- V376  Cross-country asset ownership vs cost-bearing country
--
-- WHY
-- The same asset number can appear in more than one country. Until now the app
-- could not tell WHICH country OWNS an asset from WHICH country BORE a cost, so
-- a mixer owned by KSA that runs a job in UAE looked identical to two unrelated
-- machines that happen to share a code. Management needs both views, and needs
-- them never double counted and never blended across currencies.
--
-- WHAT THE EVIDENCE SAYS (measured 2026-07-27 on the live org, 216,792 rows)
--   1,300 asset codes carry spend; 221 of them carry spend in 2 countries.
--   Of those 221, only 144 have no month in which two countries both billed the
--   code. 77 bill concurrently, and 57 do so in 2 or more months - one physical
--   machine cannot be in two countries at once, so those codes are two different
--   machines sharing a number (confirmed on identity: GN103 is a CATERPILLAR in
--   KSA and a Sany in UAE; BP041 is a KICE batch plant in KSA and a different
--   batch plant in Egypt). The asset numbering scheme is a PER COUNTRY sequence
--   per asset class (BP=batch plant, GN=generator, MP=mobile pump, TM=mixer), so
--   collisions are expected, not exceptional.
--
-- WHY OWNERSHIP IS DECIDED ON OPERATING HISTORY AND NOTHING ELSE
-- The two signals that look authoritative are both unusable here, and using
-- either would have silently handed KSA the entire contested population:
--   * finance evidence is absent. purchase_value, net_book_value,
--     fa_asset_number, operation_start_date, serial_no and chassis_no are NULL
--     on all 1,523 vehicle_fleet rows in all three countries.
--   * registration_no exists for 391 rows, ALL of them KSA (0 UAE, 0 Egypt), so
--     it can only ever vote KSA.
--   * vehicle_fleet.created_at is the date the derivation migration ran
--     (2026-07-08 = V351 KSA, 2026-07-23 = V348 UAE/Egypt), not asset age, so
--     "oldest register row" is a load-order artifact and always favours KSA.
-- Operating history in parts_consumption is the only signal that is symmetric
-- across the three countries and comes from the transactions themselves. Both
-- discarded signals are still RETURNED for the reviewer (registration_country,
-- identity_conflict) but they never decide.
--
-- THE RULE, in one sentence (this is the sentence the UI shows):
--   A country owns an asset when it is the only country operating it, or it runs
--   at least 90 percent of the asset's active months and cost lines, or it is the
--   country holding the asset after a clean handover; when two countries bill the
--   same code in the same month more than once, ownership is reported as unknown
--   rather than guessed.
--
-- Returns cost per bearing country in that country's OWN currency. Nothing in
-- this migration adds across currencies.

-- p_asset is the INDEXED single-asset fast path (exact match on the normalised
-- UPPER/TRIM asset code, V337) used by the asset detail page: it restricts the
-- scans themselves, so one asset costs ~10ms instead of the ~1.2s full sweep.
-- p_search is the fuzzy contains filter and is applied AFTER the aggregation.
-- When either narrows the set, the summary block describes THAT set, not the
-- whole fleet.
create or replace function public.get_asset_ownership(
  p_search     text    default null,
  p_limit      int     default 500,
  p_cross_only boolean default false,
  p_asset      text    default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  -- a country running at least this share of the asset's active months AND cost
  -- lines is the operator; the remainder is a stray or mis-keyed tail
  DOMINANT_SHARE          constant numeric := 0.90;
  -- one shared month is a plausible mid-month handover; two or more is
  -- concurrent operation, which one physical asset cannot do
  CONCURRENT_TOLERATED    constant int := 1;
  v_org    uuid := public.app_current_org();
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_asset  text := nullif(upper(btrim(coalesce(p_asset, ''))), '');
  v_limit  int  := least(greatest(coalesce(p_limit, 500), 1), 5000);
  result   jsonb;
begin
  if v_org is null or not public.app_is_active() then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  with foot as (
    -- one row per asset per country: the operating footprint that decides ownership
    select asset_code,
           country,
           count(*)::int                                              as rows_n,
           count(distinct date_trunc('month', event_date))::int       as months_n,
           min(event_date)                                            as first_date,
           max(event_date)                                            as last_date,
           sum(line_cost)                                             as cost,
           sum(tyre_cost)                                             as tyre_cost
      from public.parts_consumption
     where organisation_id = v_org
       and asset_code is not null
       and btrim(asset_code) <> ''
       and (v_asset is null or asset_code = v_asset)
     group by asset_code, country
  ),
  months as (
    select asset_code,
           date_trunc('month', event_date)::date as m,
           count(distinct country)               as nc
      from public.parts_consumption
     where organisation_id = v_org
       and asset_code is not null
       and btrim(asset_code) <> ''
       and event_date is not null
       and (v_asset is null or asset_code = v_asset)
     group by 1, 2
  ),
  conc as (
    select asset_code, count(*) filter (where nc > 1)::int as concurrent_months
      from months group by asset_code
  ),
  tot as (
    select asset_code,
           count(*)::int  as n_countries,
           sum(rows_n)    as rows_all,
           sum(months_n)  as months_all
      from foot group by asset_code
  ),
  -- the country with the largest footprint, and the country holding it last
  best as (
    select distinct on (asset_code)
           asset_code, country as best_country, rows_n as best_rows, months_n as best_months
      from foot order by asset_code, months_n desc, rows_n desc, country
  ),
  recent as (
    select distinct on (asset_code)
           asset_code, country as recent_country
      from foot order by asset_code, last_date desc, rows_n desc, country
  ),
  prior as (
    select distinct on (asset_code)
           f.asset_code, f.country as prior_country
      from foot f join recent r on r.asset_code = f.asset_code
     where f.country <> r.recent_country
     order by f.asset_code, f.last_date desc, f.rows_n desc, f.country
  ),
  -- context only: never decides ownership (see the header note)
  ident as (
    select asset_no,
           count(distinct upper(btrim(make)))         filter (where make         is not null and btrim(make) <> '')         as n_make,
           count(distinct upper(btrim(vehicle_type))) filter (where vehicle_type is not null and btrim(vehicle_type) <> '') as n_type
      from public.vehicle_fleet
     where organisation_id = v_org and asset_no is not null
     group by asset_no
  ),
  reg as (
    select distinct on (asset_no) asset_no, country as registration_country
      from public.vehicle_fleet
     where organisation_id = v_org and asset_no is not null
       and registration_no is not null and btrim(registration_no) <> ''
     order by asset_no, country
  ),
  decided as (
    select t.asset_code,
           t.n_countries,
           coalesce(c.concurrent_months, 0)                                   as concurrent_months,
           coalesce(b.best_months::numeric / nullif(t.months_all, 0), 0)      as month_share,
           coalesce(b.best_rows::numeric   / nullif(t.rows_all,   0), 0)      as row_share,
           b.best_country, r.recent_country, p.prior_country,
           coalesce(i.n_make, 0) > 1 or coalesce(i.n_type, 0) > 1             as identity_conflict,
           g.registration_country
      from tot t
      join best   b on b.asset_code = t.asset_code
      join recent r on r.asset_code = t.asset_code
      left join prior p on p.asset_code = t.asset_code
      left join conc  c on c.asset_code = t.asset_code
      left join ident i on i.asset_no   = t.asset_code
      left join reg   g on g.asset_no   = t.asset_code
  ),
  ruled as (
    -- the ladder: first match wins
    select d.*,
           case
             when d.n_countries = 1 then 'single_country'
             when d.month_share >= DOMINANT_SHARE and d.row_share >= DOMINANT_SHARE then 'dominant_operator'
             when d.concurrent_months > CONCURRENT_TOLERATED then 'contested_concurrent'
             when d.n_countries = 2 then 'sequential_transfer'
             else 'unknown'
           end as ownership_basis,
           case
             when d.n_countries = 1 then d.best_country
             when d.month_share >= DOMINANT_SHARE and d.row_share >= DOMINANT_SHARE then d.best_country
             when d.concurrent_months > CONCURRENT_TOLERATED then null
             when d.n_countries = 2 then d.recent_country
             else null
           end as owning_country
      from decided d
  ),
  final as (
    select r.*,
           case r.ownership_basis
             when 'single_country'     then 'high'
             when 'dominant_operator'  then 'medium'
             when 'sequential_transfer' then 'medium'
             else 'none'
           end as ownership_confidence
      from ruled r
  ),
  -- per-country money, split by whether the bearing country owns the asset
  money as (
    select f.country,
           public.currency_for_country(f.country)                                                as currency,
           round(sum(f.cost) filter (where n.owning_country is not null
                                       and n.owning_country = f.country), 2)                     as own_asset_cost,
           round(sum(f.cost) filter (where n.owning_country is not null
                                       and n.owning_country <> f.country), 2)                    as foreign_owned_cost,
           round(sum(f.cost) filter (where n.owning_country is null), 2)                         as contested_cost,
           round(sum(f.cost), 2)                                                                 as total_cost,
           count(*) filter (where n.owning_country is not null
                              and n.owning_country <> f.country)::int                            as foreign_owned_assets
      from foot f join final n on n.asset_code = f.asset_code
     group by f.country
  ),
  listed as (
    select n.*
      from final n
     where (v_search is null or n.asset_code ilike '%' || v_search || '%')
       and (not coalesce(p_cross_only, false) or n.n_countries > 1)
     order by n.n_countries desc, n.asset_code
     limit v_limit
  ),
  -- per-country detail for the listed page only, built in ONE grouped pass. A
  -- correlated subquery per asset re-scanned the foot CTE 500 times and cost
  -- ~2.6s; this is ~0.4s for the same payload.
  cty as (
    select f.asset_code,
           jsonb_agg(jsonb_build_object(
             'country', f.country,
             'currency', public.currency_for_country(f.country),
             'cost', round(f.cost, 2),
             'tyre_cost', round(f.tyre_cost, 2),
             'rows', f.rows_n,
             'months_active', f.months_n,
             'first_date', f.first_date,
             'last_date', f.last_date,
             'bears_cost_for_other_country',
               (l.owning_country is not null and l.owning_country <> f.country),
             'is_owner', (l.owning_country is not null and l.owning_country = f.country))
           order by f.cost desc) as js
      from foot f
      join listed l on l.asset_code = f.asset_code
     group by f.asset_code
  )
  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    -- the sentence the UI shows verbatim
    'rule', 'A country owns an asset when it is the only country operating it, '
         || 'or it runs at least 90 percent of the asset active months and cost lines, '
         || 'or it is the country holding the asset after a clean handover; when two '
         || 'countries bill the same code in the same month more than once, ownership '
         || 'is reported as unknown rather than guessed.',
    'basis_of_evidence', 'Operating history in the expense ledger. Finance fields '
         || '(purchase value, net book value, asset number) are empty for every asset, '
         || 'and registration exists only in KSA, so neither can decide ownership '
         || 'without favouring one country.',
    'thresholds', jsonb_build_object(
      'dominant_share', DOMINANT_SHARE,
      'concurrent_months_tolerated', CONCURRENT_TOLERATED),
    'summary', jsonb_build_object(
      'assets_total',        (select count(*) from final),
      'cross_country',       (select count(*) from final where n_countries > 1),
      'single_country',      (select count(*) from final where ownership_basis = 'single_country'),
      'dominant_operator',   (select count(*) from final where ownership_basis = 'dominant_operator'),
      'sequential_transfer', (select count(*) from final where ownership_basis = 'sequential_transfer'),
      'contested',           (select count(*) from final where ownership_basis = 'contested_concurrent'),
      'unknown',             (select count(*) from final where owning_country is null),
      'identity_conflicts',  (select count(*) from final where identity_conflict),
      -- per country, each in its OWN currency; never added together
      'by_country', (select coalesce(jsonb_agg(jsonb_build_object(
            'country', country, 'currency', currency,
            'own_asset_cost', own_asset_cost,
            'foreign_owned_cost', foreign_owned_cost,
            'contested_cost', contested_cost,
            'total_cost', total_cost,
            'foreign_owned_assets', foreign_owned_assets) order by country), '[]'::jsonb)
          from money)),
    'assets', (select coalesce(jsonb_agg(jsonb_build_object(
          'asset_no', l.asset_code,
          'owning_country', l.owning_country,
          'ownership_basis', l.ownership_basis,
          'ownership_confidence', l.ownership_confidence,
          'country_count', l.n_countries,
          'concurrent_months', l.concurrent_months,
          'transferred_from', case when l.ownership_basis = 'sequential_transfer'
                                   then l.prior_country else null end,
          'identity_conflict', l.identity_conflict,
          'registration_country', l.registration_country,
          'countries', coalesce(c.js, '[]'::jsonb))
        order by l.n_countries desc, l.asset_code), '[]'::jsonb)
      from listed l left join cty c on c.asset_code = l.asset_code)
  ) into result;

  return result;
end
$function$;

-- keep exactly ONE signature so a 3-arg call can never resolve to a stale
-- overload (the V263 lesson)
drop function if exists public.get_asset_ownership(text, int, boolean);

comment on function public.get_asset_ownership(text, int, boolean, text) is
  'Cross-country asset ownership vs cost-bearing country (V376). Decides the '
  'owning country from operating history in parts_consumption and returns cost '
  'per bearing country in that country own currency. Returns unknown rather '
  'than guessing when two countries bill the same code concurrently.';

revoke all     on function public.get_asset_ownership(text, int, boolean, text) from public, anon;
grant  execute on function public.get_asset_ownership(text, int, boolean, text) to authenticated;
