-- 20261109170000 - Keep the ESTIMATED status of a price that a correction moved.
--
-- Found while verifying 20261109160000: the PR #470 old-tyre fix (20261109120000 /
-- 130000) moved a fitment's price onto the real new tyre's row. 11 of those prices
-- (SAR 9,766, all KSA) were comparable-price ESTIMATES (tyre_price_backfill_log
-- source 'comparable'), but the log is keyed on the ORIGINAL row id, so on the new
-- row they read as ACTUAL. A purchase status must follow the money, not the row.
--
-- ADDITIVE: a new provenance table recording the source of every price that fix
-- moved (applied live: 428 rows = 417 own_jobcard + 11 comparable, SAR+AED 1,582,011.70,
-- derived from the fix's backup tables; no tyre_records row is touched) and v_tyre_lifetime re-created with the same
-- columns, now also reading the provenance. Nothing else changes.
--
-- VERIFIED after apply: KSA ESTIMATED tyres 1,885 -> 1,896; tyre_records fingerprint unchanged.
-- ROLLBACK: re-create v_tyre_lifetime from migration 20261109160000, then
--   drop table if exists public.tyre_price_provenance;

create table if not exists public.tyre_price_provenance (
  tyre_id uuid primary key, -- no FK on purpose: never blocks or cascades a tyre_records change
  organisation_id uuid not null,
  country text,
  source text not null check (source in ('comparable', 'own_jobcard', 'warranty')),
  amount numeric not null,
  origin_tyre_id uuid,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.tyre_price_provenance enable row level security;
create policy tyre_price_provenance_org on public.tyre_price_provenance
  as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
create policy tyre_price_provenance_read on public.tyre_price_provenance
  for select to authenticated using ((select public.app_is_active()));
revoke all on public.tyre_price_provenance from anon;
grant select on public.tyre_price_provenance to authenticated;

insert into public.tyre_price_provenance (tyre_id, organisation_id, country, source, amount, origin_tyre_id, reason)
select distinct on (t.id) t.id, t.organisation_id, t.country, l.source, t.cost_per_tyre, b.old_row,
       'price moved to the real new tyre by 20261109120000/130000'
from (select old_row, new_row, old_cost_before from _bak.ksa_old_tyre_fix_20261109
      union all select old_row, new_row, old_cost_before from _bak.ue_old_tyre_fix_20261109) b
join public.tyre_price_backfill_log l on l.tyre_id = b.old_row and l.new_cost = b.old_cost_before
join public.tyre_records t on t.id = b.new_row and t.cost_per_tyre = l.new_cost
order by t.id, l.created_at desc
on conflict (tyre_id) do nothing;

-- v_tyre_lifetime: same columns; ESTIMATED also when the price's provenance says so.
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
pv as (
  select tyre_id, source from public.tyre_price_provenance
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
            when a.purchase_cost > 0 and (bl.source = 'comparable' or pv.source = 'comparable') then 'ESTIMATED'
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
left join pv on pv.tyre_id = a.priced_id
left join wz on wz.tyre_key = a.tyre_key;

grant select on public.v_tyre_lifetime to authenticated;
revoke all on public.v_tyre_lifetime from anon;
