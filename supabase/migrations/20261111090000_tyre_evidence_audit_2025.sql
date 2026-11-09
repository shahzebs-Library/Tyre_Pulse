-- 20261111090000_tyre_evidence_audit_2025.sql
--
-- Tyre data accuracy from 1 January 2025 onward: READ-ONLY evidence classification.
--
-- WHAT IT DOES
--   * public.v_tyre_fitment_evidence (security_invoker): one row per tyre_records row with
--     its era (legacy < 2025-01-01, modern >= 2025-01-01, undated), the evidence flags behind
--     it and, for modern rows, ONE evidence class:
--       DUPLICATE          identical content (country, asset, wheel, serial, dates, meters) to an
--                          earlier-loaded row; only the copies are flagged, the first row is not
--       CONFLICTING        removal before fitment, future date, overlapping fitment of the same
--                          tyre (T18), two active tyres on one wheel, one real serial active on two
--                          vehicles, or a life above the vehicle-class cap (T7)
--       MISSING_EVIDENCE   no real serial (T6) AND no job card that exists in work_orders
--       PROVISIONAL        fitment odometer placeholder 1 (T7) or a purchase price that is an
--                          estimate (T17 ESTIMATED)
--       PARTIALLY_VERIFIED real but incomplete: weak serial, job card not found, no fitment
--                          reading, removed with no removal reading / no measurable life, or the
--                          tyre's purchase cost MISSING / DISPUTED
--       VERIFIED           none of the above
--     Legacy rows get LEGACY, undated rows UNDATED: the strict rules apply from 2025 only.
--   * public.get_tyre_evidence_audit(country, from, to): one jsonb with the baseline counts,
--     class + flag counts per country, the legacy-active review (with a PROPOSED action, never
--     applied), and the monthly reconciliation of recorded installations against the tyres the
--     ERP actually issued (expense grid quantity, T9).
--
-- WHAT IT DOES NOT DO
--   Writes nothing. No business row (tyre_records, parts_consumption, work_orders, ...) is
--   changed, created or deleted. Corrections stay proposals until the owner approves them.
--
-- SECURITY
--   Both objects are SECURITY INVOKER: the caller's RLS (org, country, site) decides what is
--   read. Execute/select granted to authenticated only; anon gets nothing.
--
-- ROLLBACK
--   drop function if exists public.get_tyre_evidence_audit(text, date, date);
--   drop view if exists public.v_tyre_fitment_evidence;

create or replace view public.v_tyre_fitment_evidence
with (security_invoker = on) as
with wo as (
  select distinct upper(btrim(work_order_no)) as n
  from public.work_orders
  where work_order_no is not null and btrim(work_order_no) <> ''
),
f as (
  select v.id, v.organisation_id, v.country, v.asset_no, v.site, v.brand, v.size, v.vehicle_type,
         v."position", v.serial_no, v.status, v.qty, v.fit_date, v.removal_date,
         v.km_at_fitment, v.km_at_removal, v.total_km, v.cost_per_tyre,
         v.strong, v.tyre_key, v.km, v.completed, v.active, v.fit_seq, v.is_overlap,
         t.job_card, t.created_at,
         public.tyre_life_km_cap(v.vehicle_type) as km_cap,
         lt.purchase_cost_status
  from public.v_tyre_lifetime_fitments v
  join public.tyre_records t on t.id = v.id
  left join public.v_tyre_lifetime lt on lt.tyre_key = v.tyre_key
),
g as (
  select f.*,
    case when f.fit_date is null then 'undated'
         when f.fit_date < date '2025-01-01' then 'legacy'
         else 'modern' end as era,
    (row_number() over (
       partition by f.country, upper(btrim(coalesce(f.asset_no, ''))), upper(btrim(coalesce(f."position", ''))),
                    upper(btrim(coalesce(f.serial_no, ''))), f.fit_date, f.km_at_fitment, f.km_at_removal, f.removal_date
       order by f.created_at, f.id) > 1) as is_duplicate,
    (f.active and count(*) filter (where f.active) over (
       partition by f.country, upper(btrim(coalesce(f.asset_no, ''))), upper(btrim(coalesce(f."position", '')))) > 1
       and coalesce(btrim(f."position"), '') <> '') as double_active_wheel,
    (f.strong and f.active
       and min(upper(btrim(f.asset_no))) filter (where f.active) over (partition by f.tyre_key)
        <> max(upper(btrim(f.asset_no))) filter (where f.active) over (partition by f.tyre_key)) as serial_active_two_vehicles,
    exists (select 1 from wo where wo.n = upper(btrim(f.job_card))) as job_card_found,
    ((f.removal_date is not null and f.fit_date is not null and f.removal_date < f.fit_date)
       or (f.km_at_removal is not null and f.km_at_fitment is not null and f.km_at_removal < f.km_at_fitment)) as reversed,
    (f.fit_date > current_date or f.removal_date > current_date) as future_date,
    (coalesce(f.total_km, f.km_at_removal - f.km_at_fitment) > f.km_cap) as over_life_cap
  from f
),
r as (
  select g.*,
    array_remove(array[
      case when g.is_duplicate then 'duplicate_copy' end,
      case when g.reversed then 'reversed_dates_or_km' end,
      case when g.future_date then 'future_date' end,
      case when g.is_overlap then 'overlapping_fitment' end,
      case when g.double_active_wheel then 'two_active_on_wheel' end,
      case when g.serial_active_two_vehicles then 'serial_active_on_two_vehicles' end,
      case when g.over_life_cap then 'life_above_class_cap' end,
      case when not g.strong then 'serial_not_verified' end,
      case when not g.job_card_found then 'job_card_not_found' end,
      case when g.km_at_fitment = 1 then 'fitment_km_placeholder' end,
      case when g.km_at_fitment is null then 'fitment_km_missing' end,
      case when not g.active and g.km_at_removal is null then 'removal_km_missing' end,
      case when g.completed and g.km is null then 'life_not_measurable' end,
      case when g.purchase_cost_status = 'ESTIMATED' then 'price_estimated' end,
      case when g.purchase_cost_status = 'MISSING' then 'price_missing' end,
      case when g.purchase_cost_status = 'DISPUTED' then 'price_disputed' end
    ], null) as reasons
  from g
)
select r.id, r.organisation_id, r.country, r.asset_no, r.site, r.brand, r.size, r.vehicle_type,
       r."position", r.serial_no, r.status, r.qty, r.fit_date, r.removal_date,
       r.km_at_fitment, r.km_at_removal, r.total_km, r.km, r.cost_per_tyre, r.job_card,
       r.strong, r.tyre_key, r.fit_seq, r.active, r.completed, r.purchase_cost_status, r.era,
       r.is_duplicate, r.reversed, r.future_date, r.is_overlap, r.double_active_wheel,
       r.serial_active_two_vehicles, r.over_life_cap, r.job_card_found, r.reasons,
       case
         when r.era = 'legacy' then 'LEGACY'
         when r.era = 'undated' then 'UNDATED'
         when r.is_duplicate then 'DUPLICATE'
         when r.reversed or r.future_date or r.is_overlap or r.double_active_wheel
              or r.serial_active_two_vehicles or coalesce(r.over_life_cap, false) then 'CONFLICTING'
         when not r.strong and not r.job_card_found then 'MISSING_EVIDENCE'
         when r.km_at_fitment = 1 or r.purchase_cost_status = 'ESTIMATED' then 'PROVISIONAL'
         when not r.strong or not r.job_card_found or r.km_at_fitment is null
              or (r.completed and r.km is null) or (not r.active and r.km_at_removal is null)
              or r.purchase_cost_status in ('MISSING', 'DISPUTED') then 'PARTIALLY_VERIFIED'
         else 'VERIFIED'
       end as evidence_class
from r;

comment on view public.v_tyre_fitment_evidence is
  'Read-only evidence class per tyre fitment (strict from 2025-01-01). See migration 20261111090000 and docs/tyre/AUDIT_2025_ONWARD.md.';

revoke all on public.v_tyre_fitment_evidence from public, anon;
grant select on public.v_tyre_fitment_evidence to authenticated, service_role;


create or replace function public.get_tyre_evidence_audit(
  p_country text default null,
  p_from date default date '2025-01-01',
  p_to date default null
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public
set plan_cache_mode = force_custom_plan
as $$
declare
  v_country text := nullif(btrim(coalesce(p_country, '')), '');
  v_from date := coalesce(p_from, date '2025-01-01');
  v_to date := least(coalesce(p_to, current_date), current_date);
  v_out jsonb;
begin
  if v_country = 'All' then v_country := null; end if;

  with e as (
    select * from public.v_tyre_fitment_evidence
    where v_country is null or country = v_country
  ),
  baseline as (
    select coalesce(jsonb_object_agg(country, b), '{}'::jsonb) j from (
      select country, jsonb_build_object(
        'legacy_fitments', count(*) filter (where era = 'legacy'),
        'legacy_active', count(*) filter (where era = 'legacy' and active),
        'modern_fitments', count(*) filter (where era = 'modern'),
        'undated_fitments', count(*) filter (where era = 'undated'),
        'modern_blank_serial', count(*) filter (where era = 'modern' and coalesce(btrim(serial_no), '') = ''),
        'modern_serial_not_verified', count(*) filter (where era = 'modern' and not strong),
        'modern_fitment_km_missing', count(*) filter (where era = 'modern' and km_at_fitment is null),
        'modern_removed_no_removal_km', count(*) filter (where era = 'modern' and not active and km_at_removal is null)
      ) b
      from e group by country
    ) x
  ),
  classes as (
    select coalesce(jsonb_object_agg(country, c), '{}'::jsonb) j from (
      select country, jsonb_object_agg(evidence_class, n) c from (
        select country, evidence_class, count(*) n from e
        where era = 'modern' and fit_date between v_from and v_to
        group by 1, 2
      ) y group by country
    ) x
  ),
  flags as (
    select coalesce(jsonb_object_agg(country, c), '{}'::jsonb) j from (
      select country, jsonb_object_agg(reason, n) c from (
        select country, reason, count(*) n
        from e, unnest(reasons) reason
        where era = 'modern' and fit_date between v_from and v_to
        group by 1, 2
      ) y group by country
    ) x
  ),
  legacy as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'country', l.country, 'asset_no', l.asset_no, 'position', l."position",
      'serial_no', l.serial_no, 'fit_date', l.fit_date, 'km_at_fitment', l.km_at_fitment,
      'cost_per_tyre', l.cost_per_tyre,
      'next_wheel_fit_date', nw.fit_date, 'next_wheel_serial', nw.serial_no,
      'serial_next_fit_date', ns.fit_date, 'serial_next_asset', ns.asset_no, 'serial_next_position', ns."position",
      'finding', case when ns.id is not null then 'serial_refitted_later'
                      when nw.id is not null then 'superseded_on_wheel'
                      else 'no_later_evidence' end,
      'proposed_action', case
        when ns.id is not null or nw.id is not null then 'close_fitment_on_or_before_next_fit_date'
        else 'keep_original_mark_current_status_unverified' end
    ) order by l.country, l.asset_no, l."position"), '[]'::jsonb) j
    from e l
    left join lateral (
      select n.id, n.fit_date, n.serial_no from e n
      where n.country = l.country and n.id <> l.id
        and upper(btrim(n.asset_no)) = upper(btrim(l.asset_no))
        and upper(btrim(coalesce(n."position", ''))) = upper(btrim(coalesce(l."position", '')))
        and n.fit_date > l.fit_date
      order by n.fit_date, n.id limit 1) nw on true
    left join lateral (
      select n.id, n.fit_date, n.asset_no, n."position" from e n
      where l.strong and n.tyre_key = l.tyre_key and n.id <> l.id and n.fit_date > l.fit_date
      order by n.fit_date, n.id limit 1) ns on true
    where l.era = 'legacy' and l.active
  ),
  fit_m as (
    select country, date_trunc('month', fit_date)::date mo,
      count(*) fitments,
      count(*) filter (where strong and fit_seq = 1) new_physical,
      count(*) filter (where strong and fit_seq > 1) refits,
      count(*) filter (where not strong) unidentified,
      count(*) filter (where evidence_class = 'DUPLICATE') duplicate_copies
    from e where era = 'modern' and fit_date between v_from and v_to
    group by 1, 2
  ),
  rem_m as (
    select country, date_trunc('month', removal_date)::date mo,
      count(*) removals,
      count(*) filter (where status ilike 'scrap%') scrapped
    from e where removal_date between v_from and v_to
    group by 1, 2
  ),
  grid_m as (
    select country, date_trunc('month', event_date)::date mo,
      sum(greatest(coalesce(public._to_num(qty::text), 1), 0)) issued_qty,
      sum(tyre_cost) tyre_cost,
      max(currency) currency
    from public.parts_consumption
    where tyre_cost > 0 and event_date between v_from and v_to
      and (v_country is null or country = v_country)
    group by 1, 2
  ),
  monthly as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'country', k.country, 'month', k.mo,
      'fitments', coalesce(fm.fitments, 0), 'new_physical', coalesce(fm.new_physical, 0),
      'refits', coalesce(fm.refits, 0), 'unidentified', coalesce(fm.unidentified, 0),
      'duplicate_copies', coalesce(fm.duplicate_copies, 0),
      'removals', coalesce(rm.removals, 0), 'scrapped', coalesce(rm.scrapped, 0),
      'grid_issued_qty', gm.issued_qty, 'grid_tyre_cost', round(gm.tyre_cost, 2), 'currency', gm.currency
    ) order by k.country, k.mo), '[]'::jsonb) j
    from (
      select country, mo from fit_m union select country, mo from rem_m union select country, mo from grid_m
    ) k
    left join fit_m fm on fm.country = k.country and fm.mo = k.mo
    left join rem_m rm on rm.country = k.country and rm.mo = k.mo
    left join grid_m gm on gm.country = k.country and gm.mo = k.mo
  )
  select jsonb_build_object(
    'ok', true,
    'from', v_from, 'to', v_to, 'country', v_country,
    'generated_at', now(),
    'baseline', (select j from baseline),
    'classes', (select j from classes),
    'flags', (select j from flags),
    'legacy_active', (select j from legacy),
    'monthly', (select j from monthly)
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.get_tyre_evidence_audit(text, date, date) is
  'Read-only Jan-2025-onward tyre data accuracy audit (classes, flags, legacy-active review, monthly reconciliation vs ERP issues). Writes nothing.';

revoke all on function public.get_tyre_evidence_audit(text, date, date) from public, anon;
grant execute on function public.get_tyre_evidence_audit(text, date, date) to authenticated, service_role;
