-- 20261110110000 - Tyre consumption v2: QTD / YTD / previous-year, event counts,
-- breakdowns, and PHYSICAL tyres consumed beside installation events (Phase 4a).
--
-- PURELY ADDITIVE. Creates ONE new read RPC, get_tyre_consumption_v2. The existing
-- get_tyre_consumption (20261109110000) is NOT touched and keeps its production
-- answer; the web screen reads both and labels which figure comes from which.
--
-- Definitions (mirrored in src/lib/tyreConsumptionPeriods.js - change both):
--   * The physical tyre is the Phase 1 key from v_tyre_lifetime_fitments.tyre_key
--     (country + upper(serial) for a REAL serial, rule T6; otherwise the row itself).
--   * Every date is a BUSINESS date: fitment = coalesce(issue_date, fitment_date),
--     removal = removal_date, retread = retread_jobs.returned_at / tyre_service_events.event_date,
--     warranty = warranty_claims.removal_date / the fitment priced at 0 by warranty.
--     created_at (the upload day) is never used to place an event in a period.
--   * Each fitment of a real serial is classified against the PREVIOUS fitment of the
--     same physical tyre (order: fit_date nulls first, id - the Phase 1 order):
--       new              first fitment of the tyre (a tyre consumed)
--       duplicate_entry  same vehicle, same wheel, same fitment date as the previous
--                        row: the same fitment entered twice (e.g. a repeated import).
--                        Not consumption, not a rotation, not an installation.
--       rotation         same vehicle, different wheel
--       reinstalled      same vehicle, same wheel, later date (refitted after removal)
--       transferred      another vehicle
--       unidentified     the serial is not a real serial (batch code, size, blank). A second
--                        unidentified row with the same vehicle, wheel, date and serial text
--                        is a duplicate_entry (one wheel cannot hold two tyres on one day).
--   * Installation events = every fitment row except duplicate_entry, quantity honoured.
--   * Physical tyres consumed = real-serial tyres whose FIRST fitment falls in the period
--     (one per tyre) + unidentified rows de-duplicated on
--     (country, vehicle, wheel, fitment date, serial text) taking the largest quantity.
--     A repeated import of the same file therefore adds no consumption.
--   * Removed = removal events by removal_date; scrapped = distinct tyres whose row is
--     status Scrapped with removal_date in the period (an undated scrap is reported
--     separately, never placed in a period).
--   * Periods are anchored on the period END (p_to): QTD = start of its quarter, YTD =
--     1 January of its year; previous-year windows shift both ends back one calendar
--     year (29 February becomes 28 February).
--
-- Supplier: tyre_records.supplier is empty on every row (11,410 / 11,410 on 2026-11-09),
-- so the supplier breakdown honestly reads "Not recorded" until the field is filled.
--
-- SECURITY INVOKER: row-level security on tyre_records, vehicle_fleet, retread_jobs,
-- tyre_service_events, warranty_claims and tyre_price_backfill_log decides what the
-- caller sees (org, country, site); a named country the caller cannot see is refused.
--
-- ROLLBACK (nothing depends on it):
--   drop function if exists public.get_tyre_consumption_v2(text, date, date, text);

create or replace function public.get_tyre_consumption_v2(
  p_country text default null, p_from date default null, p_to date default null, p_site text default null)
returns jsonb language plpgsql stable security invoker set search_path = public
set plan_cache_mode = force_custom_plan
-- The org/country filter sits ABOVE the view's window function, so the planner
-- estimates a handful of rows and picks nested loops into the fleet register:
-- measured 10 s for KSA (8,346 rows x 1,031 fleet rows). Hash joins: well under 2 s.
set enable_nestloop = off as $f$
declare
  v_country text := nullif(btrim(coalesce(p_country, '')), '');
  v_site text := nullif(upper(btrim(coalesce(p_site, ''))), '');
  v_to date;
  v_from date;
  v_qtd date;
  v_ytd date;
  v_base date;
  v_result jsonb;
  v_org uuid := public.app_current_org();
begin
  -- Scoped to the caller's own organisation like v1 (a super admin's RLS would
  -- otherwise blend another tenant's rows in: 4 KSA rows of a second org, measured).
  if v_org is null then return jsonb_build_object('ok', false, 'reason', 'no_org'); end if;
  if v_country = 'All' then v_country := null; end if;
  if v_country is not null and public.app_can_see_country(v_country) is false then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  v_to := least(coalesce(p_to, current_date), current_date);
  v_from := coalesce(p_from, v_to - 89);
  if v_from > v_to then
    return jsonb_build_object('ok', false, 'reason', 'empty_period');
  end if;
  v_qtd := date_trunc('quarter', v_to)::date;
  v_ytd := date_trunc('year', v_to)::date;
  v_base := (least(v_from, v_ytd) - interval '1 year')::date;

  with periods(name, f, t) as (
    values ('selected',      v_from, v_to),
           ('selected_prev', (v_from - interval '1 year')::date, (v_to - interval '1 year')::date),
           ('qtd',           v_qtd, v_to),
           ('qtd_prev',      (v_qtd - interval '1 year')::date, (v_to - interval '1 year')::date),
           ('ytd',           v_ytd, v_to),
           ('ytd_prev',      (v_ytd - interval '1 year')::date, (v_to - interval '1 year')::date)
  ),
  -- The fleet register read ONCE and hash-joined: a per-row lateral lookup cost
  -- 1.5 ms x 8,364 KSA fitments = 12 s (measured). Same preference as v1: a row in
  -- the tyre's own country first, then a country-less register row.
  fleet as materialized (
    select distinct on (v.organisation_id, upper(btrim(v.asset_no)), v.country)
           v.organisation_id, upper(btrim(v.asset_no)) as asset, v.country, v.site, v.vehicle_type
    from public.vehicle_fleet v
    where v.asset_no is not null and v.organisation_id = v_org
    order by v.organisation_id, upper(btrim(v.asset_no)), v.country, v.id
  ),
  fl as (
    select l.id, l.country, l.tyre_key, l.strong, l.fit_date, l.removal_date, l.status,
           upper(regexp_replace(coalesce(l.asset_no, ''), '\s+', '', 'g')) as asset,
           upper(btrim(coalesce(l.position, ''))) as wheel,
           upper(btrim(coalesce(l.serial_no, ''))) as serial,
           greatest(coalesce(l.qty, 1), 1)::int as tyres,
           nullif(upper(btrim(coalesce(l.brand, ''))), '') as brand,
           nullif(upper(regexp_replace(coalesce(l.size, ''), '\s+', '', 'g')), '') as size,
           coalesce(nullif(btrim(coalesce(fc.vehicle_type, fn.vehicle_type)), ''), nullif(btrim(l.vehicle_type), '')) as vehicle_type,
           coalesce(nullif(upper(btrim(coalesce(fc.site, fn.site))), ''), nullif(upper(btrim(l.site)), '')) as site,
           nullif(btrim(tr.supplier), '') as supplier,
           lag(upper(regexp_replace(coalesce(l.asset_no, ''), '\s+', '', 'g'))) over w as prev_asset,
           lag(upper(btrim(coalesce(l.position, '')))) over w as prev_wheel,
           lag(l.fit_date) over w as prev_date,
           row_number() over w as seq
    from public.v_tyre_lifetime_fitments l
    join public.tyre_records tr on tr.id = l.id
    left join fleet fc on fc.organisation_id = l.organisation_id
      and fc.asset = upper(btrim(coalesce(l.asset_no, ''))) and fc.country = l.country
    left join fleet fn on fn.organisation_id = l.organisation_id
      and fn.asset = upper(btrim(coalesce(l.asset_no, ''))) and fn.country is null
    where l.organisation_id = v_org
      and (v_country is null or l.country = v_country)
    window w as (partition by l.tyre_key order by l.fit_date nulls first, l.id)
  ),
  wk as (
    select fl.*,
           case when not strong then coalesce(country, '') || '|' || asset || '|' || wheel || '|' || coalesce(fit_date::text, '') || '|' || serial end as weak_key
    from fl
    where (v_site is null or fl.site = v_site)
      and (fl.fit_date >= v_base or fl.removal_date >= v_base)
  ),
  ev as (
    select wk.*,
           case when not strong and row_number() over (partition by weak_key order by id) > 1 then 'duplicate_entry'
                when not strong then 'unidentified'
                when seq = 1 then 'new'
                when prev_asset = asset and prev_wheel = wheel and prev_date is not distinct from fit_date then 'duplicate_entry'
                when prev_asset = asset and prev_wheel <> wheel then 'rotation'
                when prev_asset = asset then 'reinstalled'
                else 'transferred' end as kind
    from wk
  ),
  weak as (   -- one physical row per repeated unidentified fitment, largest quantity
    select weak_key, fit_date, max(tyres) as tyres from ev where weak_key is not null group by 1, 2
  ),
  rj as (
    select returned_at as d from public.retread_jobs
    where returned_at is not null and organisation_id = v_org and (v_country is null or country = v_country)
      and (v_site is null or upper(btrim(site)) = v_site)
    union all
    select event_date from public.tyre_service_events
    where event_type ilike '%retread%' and event_date is not null and organisation_id = v_org
      and (v_country is null or country = v_country) and (v_site is null or upper(btrim(site)) = v_site)
  ),
  wr as (
    select removal_date as d from public.warranty_claims
    where removal_date is not null and organisation_id = v_org and coalesce(claim_status, '') not ilike 'reject%'
      and (v_country is null or country = v_country) and (v_site is null or upper(btrim(site)) = v_site)
    union all
    select ev.fit_date from public.tyre_price_backfill_log b join ev on ev.id = b.tyre_id
    where b.source = 'warranty' and coalesce(b.new_cost, 0) = 0
  ),
  summ as (
    select p.name, p.f, p.t,
      coalesce(sum(e.tyres) filter (where e.fit_date between p.f and p.t and e.kind <> 'duplicate_entry'), 0) as installations,
      count(*) filter (where e.fit_date between p.f and p.t and e.kind <> 'duplicate_entry') as installation_rows,
      count(*) filter (where e.fit_date between p.f and p.t and e.kind = 'new') as new_fitments,
      coalesce(sum(e.tyres) filter (where e.fit_date between p.f and p.t and e.kind in ('rotation', 'reinstalled', 'transferred')), 0) as reused,
      count(*) filter (where e.fit_date between p.f and p.t and e.kind = 'rotation') as rotations,
      count(*) filter (where e.fit_date between p.f and p.t and e.kind = 'reinstalled') as reinstalled,
      count(*) filter (where e.fit_date between p.f and p.t and e.kind = 'transferred') as transfers,
      count(*) filter (where e.fit_date between p.f and p.t and e.kind = 'duplicate_entry') as duplicate_entries,
      coalesce(sum(e.tyres) filter (where e.fit_date between p.f and p.t and e.kind = 'unidentified'), 0) as unidentified_rows_tyres,
      count(*) filter (where e.removal_date between p.f and p.t) as removal_events,
      count(distinct coalesce(e.weak_key, e.tyre_key)) filter (where e.removal_date between p.f and p.t) as removed_tyres,
      count(distinct coalesce(e.weak_key, e.tyre_key)) filter (where e.removal_date between p.f and p.t and e.status ilike 'scrap%') as scrapped
    from periods p cross join ev e
    group by p.name, p.f, p.t
  ),
  summ2 as (
    select s.*,
      (select coalesce(sum(w.tyres), 0) from weak w where w.fit_date between s.f and s.t) as unidentified_physical,
      (select count(*) from rj where rj.d between s.f and s.t) as retreaded,
      (select count(*) from wr where wr.d between s.f and s.t) as warranty_replacements
    from summ s
  ),
  dims as (
    select d.dim, coalesce(d.k, 'Not recorded') as k, (d.k is not null) as resolved,
      coalesce(sum(e.tyres) filter (where e.fit_date between v_from and v_to and e.kind <> 'duplicate_entry'), 0) as installations,
      count(*) filter (where e.fit_date between v_from and v_to and e.kind = 'new') as physical_new,
      coalesce(sum(e.tyres) filter (where e.fit_date between v_from and v_to and e.kind in ('rotation', 'reinstalled', 'transferred')), 0) as reused,
      count(distinct coalesce(e.weak_key, e.tyre_key)) filter (where e.removal_date between v_from and v_to) as removed_tyres
    from ev e
    cross join lateral (values ('site', e.site), ('brand', e.brand), ('size', e.size),
                               ('supplier', e.supplier), ('vehicle_type', e.vehicle_type)) d(dim, k)
    where (e.fit_date between v_from and v_to) or (e.removal_date between v_from and v_to)
    group by d.dim, coalesce(d.k, 'Not recorded'), (d.k is not null)
  )
  select jsonb_build_object(
    'ok', true, 'version', 2, 'country', v_country, 'site', v_site,
    'from', v_from, 'to', v_to,
    'periods', (select jsonb_object_agg(name, jsonb_build_object(
        'from', f, 'to', t,
        'installations', installations, 'installation_rows', installation_rows,
        'physical_consumed', new_fitments + unidentified_physical,
        'physical_new', new_fitments, 'physical_unidentified', unidentified_physical,
        'new_fitments', new_fitments, 'reused', reused, 'rotations', rotations,
        'reinstalled', reinstalled, 'transfers', transfers,
        'duplicate_entries', duplicate_entries,
        'unidentified_installations', unidentified_rows_tyres,
        'removal_events', removal_events, 'removed', removed_tyres, 'scrapped', scrapped,
        'retreaded', retreaded, 'warranty_replacements', warranty_replacements)) from summ2),
    'breakdowns', coalesce((select jsonb_object_agg(dim, rows) from (
        select dim, jsonb_agg(jsonb_build_object('k', k, 'resolved', resolved,
          'installations', installations, 'physical_new', physical_new,
          'reused', reused, 'removed', removed_tyres) order by installations desc, k) as rows
        from dims group by dim) x), '{}'::jsonb),
    'undated_fitments', (select count(*) from fl where fl.fit_date is null
                         and (v_site is null or fl.site = v_site)),
    'undated_scrapped', (select count(distinct tyre_key) from fl where fl.status ilike 'scrap%'
                         and fl.removal_date is null and (v_site is null or fl.site = v_site)),
    'supplier_recorded', (select count(*) from fl where fl.supplier is not null)
  ) into v_result;
  return v_result;
end $f$;

revoke all on function public.get_tyre_consumption_v2(text, date, date, text) from public, anon;
grant execute on function public.get_tyre_consumption_v2(text, date, date, text) to authenticated;
