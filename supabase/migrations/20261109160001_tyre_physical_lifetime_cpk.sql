-- 20261109160000 - Physical tyre lifetime and lifetime CPK in the database (Phase 1).
--
-- PURELY ADDITIVE. Creates two views and one read RPC; replaces nothing, so every
-- existing RPC (get_fleet_cpk, get_brand_size_cpk, report_tyre_summary ...) keeps
-- its current production answer until the new figures are verified and the
-- callers are repointed in a later, separately approved change.
--
-- One definition of a physical tyre, MIRRORING src/lib/tyreLifetime.js
-- toLifetimeTyres() - change both together (pinned by src/test/tyreLifetimePhase1.test.js):
--   * key       = country + upper(serial) for a REAL serial (tyre_serial_is_strong, rule T6);
--                 any other row is its own tyre, quantity honoured.
--   * order     = coalesce(issue_date, fitment_date) nulls first, then id.
--   * km        = sum of tyre_km_life() (rule T7: placeholder 1 / over-cap = unknown,
--                 factory 0 = real) over fitments that do NOT overlap an earlier
--                 fitment of the same tyre (a fitment starting before the previous one
--                 ended - an unclosed rotation or a double entry - is excluded and
--                 flagged, so the same kilometres are never counted twice).
--   * coverage  = complete | partial (a completed fitment with no measurable km, or an
--                 overlap was excluded) | none. A partial total is never shown as complete.
--   * purchase  = the FIRST priced fitment's cost_per_tyre (rule T1), counted ONCE.
--   * status    = ACTUAL (purchase price or own job card line), ESTIMATED (comparable
--                 backfill), CONFIRMED_ZERO (warranty backfill at 0), DISPUTED (a real
--                 serial priced on more than one fitment - T2 left for a person, e.g.
--                 K507B403860; the first price is still used, nothing is rewritten),
--                 MISSING.
--   * full cost = purchase + linked repairs + linked retreads - issued warranty credit.
--                 Linked = by real serial (tyre_service_events.tyre_serial,
--                 retread_jobs.casing_serial / tyre_record_id, warranty_claims.serial_number).
--                 Repair lines in the expense grid carry no serial and are NOT attributed;
--                 they are reported as unlinked.
--   * provisional = the tyre is still active or its km coverage is not complete.
--
-- ROLLBACK (nothing else depends on these objects):
--   drop function if exists public.get_tyre_lifetime_cpk(text, date, date, text);
--   drop view if exists public.v_tyre_lifetime;
--   drop view if exists public.v_tyre_lifetime_fitments;

create or replace view public.v_tyre_lifetime_fitments with (security_invoker = on) as
with f as (
  select t.id, t.organisation_id, t.country, t.asset_no, t.site, t.brand, t.size, t.vehicle_type,
         coalesce(t.tyre_position, t.position) as position, t.serial_no, t.status, t.qty,
         coalesce(t.issue_date, t.fitment_date) as fit_date, t.removal_date,
         t.km_at_fitment, t.km_at_removal, t.total_km, t.cost_per_tyre,
         public.tyre_serial_is_strong(t.serial_no) as strong,
         case when public.tyre_serial_is_strong(t.serial_no)
              then upper(btrim(coalesce(t.country, ''))) || '|' || upper(btrim(t.serial_no))
              else 'row:' || t.id::text end as tyre_key,
         public.tyre_km_life(t.km_at_fitment, t.km_at_removal, t.total_km, t.vehicle_type) as km,
         (t.removal_date is not null or t.km_at_removal is not null) as completed,
         public.tyre_status_is_active(t.status) as active
  from public.tyre_records t
), o as (
  select f.*,
         row_number() over w as fit_seq,
         -- latest end of any EARLIER fitment of this tyre; an open fitment never ends.
         max(case when removal_date is not null then removal_date
                  when not completed and active then 'infinity'::date end)
           over (w rows between unbounded preceding and 1 preceding) as prev_end
  from f
  window w as (partition by tyre_key order by fit_date nulls first, id)
)
select o.*, (o.fit_date is not null and o.prev_end is not null and o.fit_date < o.prev_end) as is_overlap
from o;

create or replace view public.v_tyre_lifetime with (security_invoker = on) as
with fl as (select * from public.v_tyre_lifetime_fitments),
dup_price as (
  select tyre_key from fl
  where strong and coalesce(cost_per_tyre, 0) > 0
  group by tyre_key having count(*) > 1
),
bl as (
  select distinct on (l.tyre_id, l.new_cost) l.tyre_id, l.new_cost, l.source
  from public.tyre_price_backfill_log l
  order by l.tyre_id, l.new_cost, l.created_at desc
),
wz as (
  select distinct fl.tyre_key
  from public.tyre_price_backfill_log l join fl on fl.id = l.tyre_id
  where l.source = 'warranty' and coalesce(l.new_cost, 0) = 0
),
svc as (
  select upper(btrim(coalesce(country, ''))) || '|' || upper(btrim(tyre_serial)) as tyre_key,
         sum(cost) filter (where event_type ilike '%repair%') as repair,
         sum(cost) filter (where event_type ilike '%retread%') as retread
  from public.tyre_service_events
  where coalesce(cost, 0) > 0 and public.tyre_serial_is_strong(tyre_serial)
  group by 1
),
rj as (
  select coalesce(case when public.tyre_serial_is_strong(j.casing_serial)
                       then upper(btrim(coalesce(j.country, ''))) || '|' || upper(btrim(j.casing_serial)) end,
                  fr.tyre_key) as tyre_key,
         sum(j.cost) as retread
  from public.retread_jobs j
  left join fl fr on fr.id = j.tyre_record_id
  where coalesce(j.cost, 0) > 0 and j.returned_at is not null
  group by 1
),
wc as (
  select upper(btrim(coalesce(country, ''))) || '|' || upper(btrim(serial_number)) as tyre_key,
         sum(credit_amount) as recovery
  from public.warranty_claims
  where coalesce(credit_amount, 0) > 0 and credit_date is not null
    and claim_status in ('Credit Issued', 'Closed') and public.tyre_serial_is_strong(serial_number)
  group by 1
),
agg as (
  select fl.tyre_key,
         bool_or(fl.strong) as strong,
         min(fl.country) as country,
         min(fl.organisation_id::text)::uuid as organisation_id,
         count(*) as fitments,
         count(distinct upper(btrim(fl.asset_no))) filter (where fl.asset_no is not null) as vehicles,
         min(fl.fit_date) as first_fit_date,
         max(fl.fit_date) as last_fit_date,
         max(fl.removal_date) as last_removal_date,
         bool_or(fl.active) as is_active,
         (array_agg(fl.id order by fl.fit_seq desc))[1] as latest_id,
         (array_agg(fl.asset_no order by fl.fit_seq desc))[1] as asset_no,
         (array_agg(fl.site order by fl.fit_seq desc))[1] as site,
         (array_agg(fl.brand order by fl.fit_seq desc))[1] as brand,
         (array_agg(fl.size order by fl.fit_seq desc))[1] as size,
         (array_agg(fl.vehicle_type order by fl.fit_seq desc))[1] as vehicle_type,
         (array_agg(fl.serial_no order by fl.fit_seq desc))[1] as serial_no,
         (array_agg(fl.status order by fl.fit_seq desc))[1] as status,
         (array_agg(fl.qty order by fl.fit_seq desc))[1] as last_qty,
         (array_agg(fl.id order by fl.fit_seq) filter (where coalesce(fl.cost_per_tyre, 0) > 0))[1] as priced_id,
         (array_agg(fl.cost_per_tyre order by fl.fit_seq) filter (where coalesce(fl.cost_per_tyre, 0) > 0))[1] as purchase_cost,
         sum(fl.km) filter (where fl.km > 0 and not fl.is_overlap) as km_known,
         count(*) filter (where fl.completed and coalesce(fl.km, 0) <= 0) as km_unknown_fitments,
         count(*) filter (where fl.is_overlap) as overlapping_fitments
  from fl
  group by fl.tyre_key
)
select a.tyre_key, a.strong, a.organisation_id, a.country, a.serial_no, a.latest_id, a.priced_id,
       a.asset_no, a.site, a.brand, a.size, a.vehicle_type, a.status, a.is_active,
       a.fitments, a.vehicles, a.first_fit_date, a.last_fit_date, a.last_removal_date,
       case when a.strong then 1 else greatest(1, coalesce(a.last_qty, 1)) end as qty,
       a.km_known, a.km_unknown_fitments, a.overlapping_fitments,
       case when a.km_known is null then 'none'
            when a.km_unknown_fitments > 0 or a.overlapping_fitments > 0 then 'partial'
            else 'complete' end as km_coverage,
       a.purchase_cost,
       case when dp.tyre_key is not null then 'DISPUTED'
            when a.purchase_cost > 0 and bl.source = 'comparable' then 'ESTIMATED'
            when a.purchase_cost > 0 then 'ACTUAL'
            when wz.tyre_key is not null then 'CONFIRMED_ZERO'
            else 'MISSING' end as purchase_cost_status,
       coalesce(s.repair, 0) as repair_cost,
       coalesce(r.retread, s.retread, 0) as retread_cost,
       coalesce(w.recovery, 0) as recovery,
       case when a.purchase_cost > 0
            then a.purchase_cost + coalesce(s.repair, 0) + coalesce(r.retread, s.retread, 0) - coalesce(w.recovery, 0) end as full_cost,
       (a.is_active or a.km_known is null or a.km_unknown_fitments > 0 or a.overlapping_fitments > 0) as provisional
from agg a
left join dup_price dp on dp.tyre_key = a.tyre_key
left join svc s on s.tyre_key = a.tyre_key
left join rj r on r.tyre_key = a.tyre_key
left join wc w on w.tyre_key = a.tyre_key
left join bl on bl.tyre_id = a.priced_id and bl.new_cost = a.purchase_cost
left join wz on wz.tyre_key = a.tyre_key;

grant select on public.v_tyre_lifetime_fitments to authenticated;
grant select on public.v_tyre_lifetime to authenticated;
revoke all on public.v_tyre_lifetime_fitments from anon;
revoke all on public.v_tyre_lifetime from anon;

-- Lifetime CPK per country (own currency, never blended - T10), WEIGHTED (T8):
-- total cost of measurable tyres / their total km. A tyre is FINAL in the window when
-- it is no longer active and its last fitment ended in the window; an ACTIVE tyre is
-- PROVISIONAL (life so far) when it was fitted on or before the window end.
-- Site = the site of the tyre's latest fitment (historical attribution is Phase 3).
create or replace function public.get_tyre_lifetime_cpk(
  p_country text default null, p_from date default null, p_to date default null, p_site text default null)
returns jsonb language sql stable security invoker set search_path = public
set plan_cache_mode = force_custom_plan as $f$
with t as (
  select l.*,
         case when not l.is_active
                   and (p_from is null or coalesce(l.last_removal_date, l.last_fit_date) >= p_from)
                   and (p_to is null or coalesce(l.last_removal_date, l.last_fit_date) <= p_to) then 'final'
              when l.is_active and (p_to is null or l.first_fit_date is null or l.first_fit_date <= p_to) then 'provisional'
         end as bucket,
         (coalesce(l.purchase_cost, 0) > 0 and coalesce(l.km_known, 0) > 0) as measurable
  from public.v_tyre_lifetime l
  where (p_country is null or l.country = p_country)
    and (p_site is null or upper(btrim(l.site)) = upper(btrim(p_site)))
),
b as (select * from t where bucket is not null),
stats as (
  select country, bucket,
         count(*) as tyres, sum(qty) as physical_tyres,
         count(*) filter (where measurable) as measurable,
         sum(purchase_cost * qty) filter (where measurable) as purchase_cost,
         sum(full_cost * qty) filter (where measurable) as full_cost,
         sum(km_known * qty) filter (where measurable) as km,
         sum(repair_cost) as repair_cost, sum(retread_cost) as retread_cost, sum(recovery) as recovery,
         jsonb_build_object(
           'complete', count(*) filter (where km_coverage = 'complete'),
           'partial',  count(*) filter (where km_coverage = 'partial'),
           'none',     count(*) filter (where km_coverage = 'none')) as km_coverage,
         jsonb_build_object(
           'ACTUAL', count(*) filter (where purchase_cost_status = 'ACTUAL'),
           'ESTIMATED', count(*) filter (where purchase_cost_status = 'ESTIMATED'),
           'CONFIRMED_ZERO', count(*) filter (where purchase_cost_status = 'CONFIRMED_ZERO'),
           'DISPUTED', count(*) filter (where purchase_cost_status = 'DISPUTED'),
           'MISSING', count(*) filter (where purchase_cost_status = 'MISSING')) as cost_status,
         sum(purchase_cost * qty) filter (where measurable and purchase_cost_status = 'ESTIMATED') as estimated_cost_in_cpk,
         count(*) filter (where fitments > 1) as refitted_tyres,
         count(*) filter (where overlapping_fitments > 0) as tyres_with_overlap
  from b group by country, bucket
),
grp as (
  select country, dim, key,
         count(*) as tyres,
         sum(km_known * qty) as km,
         case when sum(km_known * qty) > 0 then round(sum(purchase_cost * qty) / sum(km_known * qty), 6) end as cpk_purchase,
         case when sum(km_known * qty) > 0 then round(sum(full_cost * qty) / sum(km_known * qty), 6) end as cpk_full
  from (
    select country, 'brand' as dim, coalesce(nullif(upper(btrim(brand)), ''), '(none)') as key, qty, km_known, purchase_cost, full_cost from b where bucket = 'final' and measurable
    union all
    select country, 'size', coalesce(nullif(upper(regexp_replace(size, '\s+', '', 'g')), ''), '(none)'), qty, km_known, purchase_cost, full_cost from b where bucket = 'final' and measurable
    union all
    select country, 'vehicle_type', coalesce(nullif(upper(btrim(vehicle_type)), ''), '(none)'), qty, km_known, purchase_cost, full_cost from b where bucket = 'final' and measurable
  ) x group by country, dim, key
),
unlinked as (
  select country, count(*) as lines, round(sum(tyre_cost), 2) as amount
  from public.parts_consumption
  where coalesce(tyre_cost, 0) > 0 and item_description ~* '(repair|retread|re-tread|resol|vulcan)'
    and (p_country is null or country = p_country)
    and (p_from is null or event_date >= p_from) and (p_to is null or event_date <= p_to)
  group by country
)
select jsonb_build_object(
  'definition', jsonb_build_object(
    'kpi', 'physical_tyre_lifetime_cpk',
    'purchase_cpk', 'first verified purchase price of each physical tyre / validated cumulative km of all its fitments',
    'full_cpk', '(purchase + linked repairs + linked retreads - issued warranty credit) / validated cumulative km',
    'weighting', 'total cost / total km over measurable tyres (T8); never an average of ratios',
    'final', 'tyre no longer active, last fitment ended in the window',
    'provisional', 'tyre still active: life so far, not final',
    'site', 'site of the latest fitment (not historical attribution)'),
  'countries', coalesce((
    select jsonb_agg(jsonb_build_object(
      'country', c.country,
      'final', (select to_jsonb(s) - 'country' - 'bucket'
                       || jsonb_build_object(
                          'cpk_purchase', case when s.km > 0 then round(s.purchase_cost / s.km, 6) end,
                          'cpk_full', case when s.km > 0 then round(s.full_cost / s.km, 6) end)
                from stats s where s.country is not distinct from c.country and s.bucket = 'final'),
      'provisional', (select to_jsonb(s) - 'country' - 'bucket'
                       || jsonb_build_object(
                          'cpk_purchase', case when s.km > 0 then round(s.purchase_cost / s.km, 6) end,
                          'cpk_full', case when s.km > 0 then round(s.full_cost / s.km, 6) end)
                from stats s where s.country is not distinct from c.country and s.bucket = 'provisional'),
      'by_brand', (select coalesce(jsonb_agg(to_jsonb(g) - 'country' - 'dim' order by g.km desc nulls last), '[]'::jsonb)
                   from grp g where g.country is not distinct from c.country and g.dim = 'brand'),
      'by_size', (select coalesce(jsonb_agg(to_jsonb(g) - 'country' - 'dim' order by g.km desc nulls last), '[]'::jsonb)
                  from grp g where g.country is not distinct from c.country and g.dim = 'size'),
      'by_vehicle_type', (select coalesce(jsonb_agg(to_jsonb(g) - 'country' - 'dim' order by g.km desc nulls last), '[]'::jsonb)
                          from grp g where g.country is not distinct from c.country and g.dim = 'vehicle_type'),
      'unlinked_repair_lines', (select jsonb_build_object('lines', u.lines, 'amount', u.amount)
                                from unlinked u where u.country is not distinct from c.country))
      order by c.country)
    from (select distinct country from b) c), '[]'::jsonb));
$f$;
revoke all on function public.get_tyre_lifetime_cpk(text, date, date, text) from public, anon;
grant execute on function public.get_tyre_lifetime_cpk(text, date, date, text) to authenticated;
