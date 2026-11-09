-- =====================================================================
-- 20261110113000  Tyre data reconciliation: every outstanding tyre problem
--                 as a reviewable exception (Phase 4b). ADDITIVE ONLY.
-- =====================================================================
-- Nothing in this migration changes business data. It adds:
--   1. tyre_exception_refs      reference snapshot of the record sets the owner
--                               has PROTECTED (the 20 unclear tyre changes:
--                               6 KSA + 14 UAE ambiguous / chained old-new pairs
--                               from 20261109120000/130000, and K507B403860) and
--                               of old/new pairs already handled by the
--                               2026-11-09 serial fix (read from the _bak
--                               backups once, so normal users never need _bak).
--   2. tyre_exception_reviews   one review per exception (open / accepted /
--                               rejected / deferred, note, who, when).
--   3. tyre_exception_review_events  append-only history of every review change.
--   4. _tyre_exception_rows(country, kind)  INVOKER: the full list of exceptions the
--                               caller can see (RLS of tyre_records,
--                               parts_consumption and v_tyre_lifetime applies).
--   5. get_tyre_exceptions_v2(country, kind, status, limit, offset)  counts per
--                               kind and country + one page of rows with the
--                               review status joined. Adds the rotation closer
--                               candidates from tyre_close_rotations(TRUE) -
--                               ALWAYS the dry run; for a user who may not run
--                               the closer the kind is reported "not available".
--   6. set_tyre_exception_review(key, kind, country, status, note)  DEFINER:
--                               writes ONLY the review tables, re-checks org,
--                               country and elevated role, refuses protected
--                               exceptions. Never touches business data.
--
-- The existing get_tyre_exceptions(country) is NOT changed (production result
-- preserved); v2 is a new, versioned function.
--
-- Exception key (stable across reruns): kind|... built from record ids or the
-- (country, serial) a group is about, never from a position in a list.
--   invalid_serial, missing_readings, missing_site, invalid_reading,
--   conflicting_dates, overlapping_fitment, price_incorrect   kind|<tyre_records.id>
--   duplicate_active, price_assigned_twice, price_missing      kind|<COUNTRY>|<SERIAL>
--   uncertain_previous_tyre                                    kind|<old id>|<new id>
--   rotation_not_closed                                        kind|<COUNTRY>|<ASSET>|<SERIAL>|<FROM POS>
--   unlinked_repair_retread                                    kind|<parts_consumption.id>
--   duplicate_expense                                          kind|<smallest id>|<n>
-- MIRROR: src/lib/tyreExceptionsV2.js exceptionKey() - change both.
--
-- STATUS: WRITTEN, NOT APPLIED. Dry run 2026-11-10 (whole file + checks in one
-- aborted transaction): 11,209 exceptions (KSA 6,695 / UAE 4,030 / Egypt 484),
-- protected 20 pairs + K507B403860 listed and refused for review, KSA Manager
-- sees KSA only, Tyre Man refused, tyre_records / parts_consumption /
-- tyre_replacement_log unchanged. Full read ~4.8 s, one kind ~0.5 s.
-- Details and per-kind counts: docs/tyre/EXCEPTIONS.md.
--
-- ROLLBACK:
--   drop function if exists public.set_tyre_exception_review(text, text, text, text, text);
--   drop function if exists public.get_tyre_exceptions_v2(text, text, text, integer, integer);
--   drop function if exists public._tyre_exception_rows(text, text);
--   drop table if exists public.tyre_exception_review_events;
--   drop table if exists public.tyre_exception_reviews;
--   drop table if exists public.tyre_exception_refs;
-- =====================================================================

-- 1. Reference snapshot --------------------------------------------------
create table if not exists public.tyre_exception_refs (
  id bigserial primary key,
  organisation_id uuid,
  country text,
  ref_kind text not null check (ref_kind in ('protected', 'fix_handled')),
  exception_key text not null,
  record_ids uuid[] not null default '{}',
  reason text not null,
  created_at timestamptz not null default now(),
  unique (ref_kind, exception_key)
);
alter table public.tyre_exception_refs enable row level security;
revoke all on public.tyre_exception_refs from public, anon;
grant select on public.tyre_exception_refs to authenticated;
create policy tyre_exception_refs_org_isolation on public.tyre_exception_refs as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
create policy tyre_exception_refs_country_isolation on public.tyre_exception_refs as restrictive for select to authenticated
  using (country is null or public.app_can_see_country(country));
create policy tyre_exception_refs_read on public.tyre_exception_refs for select to authenticated
  using ((select public.app_is_active()));

-- Old/new pair signature of the 20261109120000/130000 serial fix: same serial,
-- vehicle and wheel; the old row's removal date and km equal the new row's
-- fitment date and km. Pairs that touch a row of the fix backups were handled;
-- of the rest, a pair whose rows sit in more than one pair (chained/ambiguous)
-- is one of the 20 protected unclear changes. Measured 2026-11-10: KSA 6,
-- UAE 14, Egypt 0 = 20.
do $seed$
begin
  if to_regclass('_bak.ksa_old_tyre_fix_20261109') is null or to_regclass('_bak.ue_old_tyre_fix_20261109') is null then
    raise notice 'fix backups not present; tyre_exception_refs left empty';
    return;
  end if;
  with p as (
    select o.organisation_id, o.country, o.id as old_id, n.id as new_id
    from public.tyre_records o
    join public.tyre_records n
      on coalesce(n.organisation_id::text, '') = coalesce(o.organisation_id::text, '') and coalesce(n.country, '') = coalesce(o.country, '')
     and upper(btrim(n.serial_no)) = upper(btrim(o.serial_no)) and n.asset_no = o.asset_no
     and upper(btrim(coalesce(n.tyre_position, n.position, ''))) = upper(btrim(coalesce(o.tyre_position, o.position, '')))
     and o.removal_date = n.issue_date and o.km_at_removal = n.km_at_fitment and o.id <> n.id
    where o.serial_no is not null and btrim(o.serial_no) <> ''
  ), b as (
    select old_row as r from _bak.ksa_old_tyre_fix_20261109 union select new_row from _bak.ksa_old_tyre_fix_20261109
    union select old_row from _bak.ue_old_tyre_fix_20261109 union select new_row from _bak.ue_old_tyre_fix_20261109
  ), q as (
    select p.*,
      (p.old_id in (select new_id from p) or p.new_id in (select old_id from p)) as chained,
      ((select count(*) from p p2 where p2.old_id = p.old_id) > 1 or (select count(*) from p p2 where p2.new_id = p.new_id) > 1) as multi,
      (p.old_id in (select r from b) or p.new_id in (select r from b)) as in_fix
    from p
  )
  insert into public.tyre_exception_refs (organisation_id, country, ref_kind, exception_key, record_ids, reason)
  select organisation_id, country,
         case when in_fix then 'fix_handled' else 'protected' end,
         'uncertain_previous_tyre|' || old_id || '|' || new_id,
         array[old_id, new_id],
         case when in_fix then 'Pair touched by the 2026-11-09 serial fix (backup rows)'
              else 'One of the 20 unclear tyre changes (ambiguous / chained old-new pair). Owner authorisation needed.' end
  from q where in_fix or chained or multi
  on conflict (ref_kind, exception_key) do nothing;

  insert into public.tyre_exception_refs (organisation_id, country, ref_kind, exception_key, record_ids, reason)
  select t.organisation_id, t.country, 'protected', 'price_assigned_twice|' || upper(btrim(t.country)) || '|K507B403860',
         array_agg(t.id order by t.id),
         'K507B403860 priced on two fitments in one batch on one day; rule T2 cannot decide. Owner authorisation needed.'
  from public.tyre_records t
  where upper(btrim(t.serial_no)) = 'K507B403860'
  group by t.organisation_id, t.country
  on conflict (ref_kind, exception_key) do nothing;
end $seed$;

-- 2. Reviews + history ------------------------------------------------------
create table if not exists public.tyre_exception_reviews (
  id bigserial primary key,
  organisation_id uuid not null default public.app_current_org(),
  country text,
  exception_key text not null,
  kind text not null,
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected', 'deferred')),
  note text check (note is null or length(note) <= 2000),
  reviewed_by uuid,
  reviewed_by_name text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organisation_id, exception_key)
);
create index if not exists tyre_exception_reviews_kind_idx on public.tyre_exception_reviews (organisation_id, kind, status);
alter table public.tyre_exception_reviews enable row level security;
revoke all on public.tyre_exception_reviews from public, anon;
grant select on public.tyre_exception_reviews to authenticated;
create policy tyre_exception_reviews_org_isolation on public.tyre_exception_reviews as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
create policy tyre_exception_reviews_country_isolation on public.tyre_exception_reviews as restrictive for select to authenticated
  using (country is null or public.app_can_see_country(country));
create policy tyre_exception_reviews_read on public.tyre_exception_reviews for select to authenticated
  using ((select public.app_is_active()));

create table if not exists public.tyre_exception_review_events (
  id bigserial primary key,
  organisation_id uuid not null,
  country text,
  exception_key text not null,
  kind text not null,
  old_status text,
  new_status text not null,
  note text,
  actor uuid,
  actor_name text,
  at timestamptz not null default now()
);
create index if not exists tyre_exception_review_events_key_idx on public.tyre_exception_review_events (organisation_id, exception_key, at desc);
alter table public.tyre_exception_review_events enable row level security;
revoke all on public.tyre_exception_review_events from public, anon;
grant select on public.tyre_exception_review_events to authenticated;
create policy tyre_exception_review_events_org_isolation on public.tyre_exception_review_events as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
create policy tyre_exception_review_events_country_isolation on public.tyre_exception_review_events as restrictive for select to authenticated
  using (country is null or public.app_can_see_country(country));
create policy tyre_exception_review_events_read on public.tyre_exception_review_events for select to authenticated
  using ((select public.app_is_active()));

-- 4. The exception list (INVOKER) -------------------------------------------
create or replace function public._tyre_exception_rows(p_country text default null, p_kind text default null)
returns table (
  exception_key text, kind text, country text, record_ids uuid[], serial text, asset text, tyre_position text,
  reason text, proposed text, impact_km numeric, impact_cost numeric, detail jsonb
)
language sql stable security invoker set search_path = public
set plan_cache_mode = force_custom_plan as $f$
with t as (
  select r.id, r.organisation_id, r.country, r.asset_no, upper(regexp_replace(coalesce(r.asset_no, ''), '\s+', '', 'g')) as asset,
         upper(btrim(coalesce(r.tyre_position, r.position, ''))) as pos, r.serial_no, upper(btrim(r.serial_no)) as serial,
         public.tyre_serial_is_strong(r.serial_no) as strong, public.tyre_status_is_active(r.status) as active,
         r.status, r.site, r.size, r.vehicle_type, coalesce(r.issue_date, r.fitment_date) as fit_date, r.removal_date,
         r.km_at_fitment, r.km_at_removal, r.total_km, r.hrs_at_fitment, r.hrs_at_removal, r.cost_per_tyre, r.created_at
  from public.tyre_records r
  where (p_country is null or r.country = p_country)
),
-- invalid physical serial on an active fitment (blank, placeholder or not a real serial, T6),
-- or a real serial with a remark typed into the same cell
invalid_serial as (
  select 'invalid_serial|' || t.id, 'invalid_serial', t.country, array[t.id], t.serial_no, t.asset_no, t.pos,
    case when t.serial is null or t.serial = '' then 'Active fitment with no serial'
         when t.strong then 'A remark is typed into the serial cell'
         else 'Active fitment whose serial is not a real tyre serial (rule T6)' end,
    case when t.strong then 'Move the remark to notes and keep only the serial'
         else 'Read the serial from the tyre sidewall and correct this record' end,
    null::numeric, nullif(t.cost_per_tyre, 0),
    jsonb_build_object('status', t.status, 'fitted', t.fit_date)
  from t where t.active and (not t.strong or t.serial ~ '[\s(]') and (p_kind is null or p_kind = 'invalid_serial')
),
-- one real serial active on more than one row (other vehicle, or same day on one vehicle).
-- Same vehicle on different dates is a rotation and comes from the rotation closer instead.
dup as (
  select t.country, t.serial, array_agg(t.id order by t.fit_date nulls first, t.id) ids,
         count(distinct t.asset) assets, count(distinct t.fit_date) dates, max(t.serial_no) serial_no,
         jsonb_agg(jsonb_build_object('id', t.id, 'asset', t.asset_no, 'position', t.pos, 'fitted', t.fit_date) order by t.fit_date nulls first) rows
  from t where t.active and t.strong and (p_kind is null or p_kind = 'duplicate_active')
  group by t.country, t.serial having count(*) > 1
),
duplicate_active as (
  select 'duplicate_active|' || upper(btrim(coalesce(d.country, ''))) || '|' || d.serial, 'duplicate_active', d.country, d.ids,
    d.serial_no, (select string_agg(distinct x->>'asset', ' / ') from jsonb_array_elements(d.rows) x), null::text,
    case when d.assets > 1 then 'One tyre is active on ' || d.assets || ' vehicles at once'
         else 'One tyre is active on two wheels of one vehicle on the same day' end,
    'Check the vehicles and close the fitment the tyre is no longer on (one tyre, one wheel, rule T3/T5)',
    null::numeric, null::numeric, jsonb_build_object('rows', d.rows)
  from dup d where d.assets > 1 or d.dates <= 1
),
-- fitment or removal readings missing
missing_readings as (
  select 'missing_readings|' || t.id, 'missing_readings', t.country, array[t.id], t.serial_no, t.asset_no, t.pos,
    case when t.km_at_fitment is null and t.hrs_at_fitment is null and (t.removal_date is not null and t.km_at_removal is null and t.hrs_at_removal is null)
           then 'No odometer or hour reading at fitment or at removal'
         when t.km_at_fitment is null and t.hrs_at_fitment is null then 'No odometer or hour reading at fitment'
         else 'Removed, but no odometer or hour reading at removal' end,
    'Take the reading from the job card of that day and enter it',
    null::numeric, null::numeric, jsonb_build_object('fitted', t.fit_date, 'removed', t.removal_date, 'total_km', t.total_km)
  from t
  where (p_kind is null or p_kind = 'missing_readings') and coalesce(t.total_km, 0) <= 0
    and ((t.km_at_fitment is null and t.hrs_at_fitment is null)
      or (t.removal_date is not null and t.km_at_removal is null and t.hrs_at_removal is null))
),
-- invalid km / hour readings: placeholder fitment 1, life over class cap, regression
invalid_reading as (
  select 'invalid_reading|' || t.id, 'invalid_reading', t.country, array[t.id], t.serial_no, t.asset_no, t.pos,
    case when t.km_at_fitment = 1 then 'Fitment odometer is the placeholder 1, so km is unknown (rule T7)'
         when t.km_at_removal > 0 and t.km_at_fitment > 1 and t.km_at_removal < t.km_at_fitment then 'Odometer at removal is below the odometer at fitment'
         when t.hrs_at_removal > 0 and t.hrs_at_fitment > 0 and t.hrs_at_removal < t.hrs_at_fitment then 'Hour meter at removal is below the hour meter at fitment'
         else 'Tyre life above the class limit of ' || public.tyre_life_km_cap(t.vehicle_type) || ' km (rule T7)' end,
    case when t.km_at_fitment = 1 then 'Enter the real odometer at fitment from the job card'
         when t.km_at_removal > 0 and t.km_at_fitment > 1 and t.km_at_removal < t.km_at_fitment then 'Check whether the two readings were swapped or the meter was replaced'
         when t.hrs_at_removal > 0 and t.hrs_at_fitment > 0 and t.hrs_at_removal < t.hrs_at_fitment then 'Check whether the two readings were swapped or the meter was replaced'
         else 'Check the fitment and removal odometer; the km stays unknown until corrected' end,
    case when t.km_at_removal > 0 and t.km_at_fitment > 1 and t.km_at_removal > t.km_at_fitment then t.km_at_removal - t.km_at_fitment
         when coalesce(t.total_km, 0) > 0 then t.total_km end,
    null::numeric,
    jsonb_build_object('km_at_fitment', t.km_at_fitment, 'km_at_removal', t.km_at_removal, 'total_km', t.total_km,
      'hrs_at_fitment', t.hrs_at_fitment, 'hrs_at_removal', t.hrs_at_removal, 'vehicle_type', t.vehicle_type)
  from t
  where (p_kind is null or p_kind = 'invalid_reading') and (t.km_at_fitment = 1
     or (t.km_at_removal > 0 and t.km_at_fitment > 1 and t.km_at_removal < t.km_at_fitment)
     or (t.hrs_at_removal > 0 and t.hrs_at_fitment > 0 and t.hrs_at_removal < t.hrs_at_fitment)
     or (public.tyre_km_life(t.km_at_fitment, t.km_at_removal, t.total_km, t.vehicle_type) is null
         and (case when t.km_at_fitment > 1 and t.km_at_removal > t.km_at_fitment then t.km_at_removal - t.km_at_fitment
                   when coalesce(t.km_at_fitment, 0) <> 1 and t.total_km > 0 then t.total_km end) > public.tyre_life_km_cap(t.vehicle_type)))
),
-- odometer reset: a fitment on a vehicle reads lower than an earlier fitment on that vehicle
reset as (
  select x.* from (
    select t.*, max(t.km_at_fitment) filter (where t.km_at_fitment > 1)
             over (partition by t.organisation_id, t.country, t.asset order by t.fit_date, t.id rows between unbounded preceding and 1 preceding) as prev_max
    from t where t.fit_date is not null and (p_kind is null or p_kind = 'invalid_reading')
  ) x where x.km_at_fitment > 1 and x.prev_max is not null and x.km_at_fitment < x.prev_max - 1000
),
meter_reset as (
  select 'invalid_reading|reset|' || r.id, 'invalid_reading', r.country, array[r.id], r.serial_no, r.asset_no, r.pos,
    'Odometer at fitment (' || r.km_at_fitment || ') is below an earlier fitment on this vehicle (' || r.prev_max || '): meter reset or typing error',
    'Confirm whether the vehicle meter was replaced; if not, correct the reading',
    null::numeric, null::numeric, jsonb_build_object('km_at_fitment', r.km_at_fitment, 'earlier_max_km', r.prev_max, 'fitted', r.fit_date)
  from reset r
),
-- missing historical site
missing_site as (
  select 'missing_site|' || t.id, 'missing_site', t.country, array[t.id], t.serial_no, t.asset_no, t.pos,
    'Fitment has no site, so it cannot be counted in any site report',
    'Use the vehicle''s registered site on the fitment date (proposal only)',
    null::numeric, nullif(t.cost_per_tyre, 0), jsonb_build_object('vehicle_site_now', fl.site, 'fitted', t.fit_date)
  from t
  left join (
    select distinct on (f.country, upper(regexp_replace(coalesce(f.asset_no, ''), '\s+', '', 'g')))
           f.country, upper(regexp_replace(coalesce(f.asset_no, ''), '\s+', '', 'g')) as asset, f.site
    from public.vehicle_fleet f
    where (p_kind is null or p_kind = 'missing_site') and nullif(btrim(f.site), '') is not null
    order by f.country, upper(regexp_replace(coalesce(f.asset_no, ''), '\s+', '', 'g')), f.updated_at desc nulls last
  ) fl on coalesce(fl.country, '') = coalesce(t.country, '') and fl.asset = t.asset
  where (p_kind is null or p_kind = 'missing_site') and (t.site is null or btrim(t.site) = '')
),
-- conflicting dates: reversed, future, or the wheel's next fitment before this removal
nxt as (
  select t.*, lead(t.fit_date) over (partition by t.organisation_id, t.country, t.asset, t.pos order by t.fit_date nulls first, t.id) next_fit,
              lead(t.id) over (partition by t.organisation_id, t.country, t.asset, t.pos order by t.fit_date nulls first, t.id) next_id
  from t where t.pos <> '' and t.asset <> '' and (p_kind is null or p_kind = 'conflicting_dates')
),
conflicting_dates as (
  select 'conflicting_dates|' || n.id, 'conflicting_dates', n.country,
    case when n.next_id is not null and n.removal_date > n.next_fit then array[n.id, n.next_id] else array[n.id] end,
    n.serial_no, n.asset_no, n.pos,
    case when n.removal_date < n.fit_date then 'Removal date is before the fitment date'
         when n.fit_date > current_date then 'Fitment date is in the future'
         when n.removal_date > current_date then 'Removal date is in the future'
         else 'Removed on ' || n.removal_date || ' but the next tyre on this wheel was fitted on ' || n.next_fit end,
    case when n.removal_date < n.fit_date then 'Check the job card; the two dates are probably swapped (rule T12)'
         when n.fit_date > current_date or n.removal_date > current_date then 'Correct the date from the job card'
         else 'Set the removal date to the next fitment date if the job card agrees' end,
    null::numeric, null::numeric, jsonb_build_object('fitted', n.fit_date, 'removed', n.removal_date, 'next_fitted', n.next_fit)
  from nxt n
  where n.removal_date < n.fit_date or n.fit_date > current_date or n.removal_date > current_date
     or (n.next_fit is not null and n.removal_date is not null and n.removal_date > n.next_fit)
),
-- overlapping fitments (rule T18): km already excluded from lifetime
overlapping_fitment as (
  select 'overlapping_fitment|' || o.id, 'overlapping_fitment', o.country, array[o.id], o.serial_no, o.asset_no, o.position,
    'Fitment starts on ' || o.fit_date || ' before an earlier fitment of the same tyre ended (rule T18)',
    'Close the earlier fitment, or remove the duplicate row if the meters are identical',
    public.tyre_km_life(o.km_at_fitment, o.km_at_removal, o.total_km, o.vehicle_type), null::numeric,
    jsonb_build_object('fitted', o.fit_date, 'earlier_fitment_ends', case when o.prev_end = 'infinity'::date then null else o.prev_end end,
      'earlier_still_open', o.prev_end = 'infinity'::date)
  from public.v_tyre_lifetime_fitments o
  where (p_kind is null or p_kind = 'overlapping_fitment') and o.is_overlap and (p_country is null or o.country = p_country)
),
-- prices: missing on a physical tyre; assigned to more than one fitment; far from the usual price
-- MATERIALIZED on purpose: a country predicate pushed into v_tyre_lifetime's
-- window/aggregate plan made it ~6x slower (measured 8.5 s vs 1.3 s).
lifetime_missing as materialized (
  select l.country, l.serial_no, l.latest_id, l.asset_no, l.km_known, l.fitments, l.first_fit_date, l.size
  from public.v_tyre_lifetime l
  where l.strong and l.purchase_cost_status = 'MISSING'
),
price_missing as (
  select 'price_missing|' || upper(btrim(coalesce(l.country, ''))) || '|' || upper(btrim(l.serial_no)), 'price_missing', l.country,
    array[l.latest_id], l.serial_no, l.asset_no, null::text,
    'Physical tyre has no purchase price on any fitment',
    'Find the purchase on the expense grid by job card and record it (never estimate without saying so)',
    l.km_known, null::numeric, jsonb_build_object('fitments', l.fitments, 'first_fitted', l.first_fit_date, 'size', l.size)
  from lifetime_missing l
  where (p_kind is null or p_kind = 'price_missing') and (p_country is null or l.country = p_country)
),
priced as (
  select t.country, t.serial, max(t.serial_no) serial_no, array_agg(t.id order by t.created_at, t.id) ids,
         sum(t.cost_per_tyre) total, (array_agg(t.cost_per_tyre order by t.fit_date nulls last, t.created_at))[1] first_cost,
         jsonb_agg(jsonb_build_object('id', t.id, 'asset', t.asset_no, 'fitted', t.fit_date, 'cost', t.cost_per_tyre, 'uploaded', t.created_at)
                   order by t.created_at) rows
  from t where t.strong and coalesce(t.cost_per_tyre, 0) > 0 and (p_kind is null or p_kind = 'price_assigned_twice')
  group by t.country, t.serial having count(*) > 1
),
price_assigned_twice as (
  select 'price_assigned_twice|' || upper(btrim(coalesce(p.country, ''))) || '|' || p.serial, 'price_assigned_twice', p.country, p.ids,
    p.serial_no, (select string_agg(distinct x->>'asset', ' / ') from jsonb_array_elements(p.rows) x), null::text,
    'One physical tyre carries ' || jsonb_array_length(p.rows) || ' purchase prices (rule T1)',
    'Keep the price on the latest uploaded row (rule T2) unless the job cards show two real purchases',
    null::numeric, p.total - p.first_cost, jsonb_build_object('rows', p.rows)
  from priced p
),
size_price as (
  select t.country, upper(regexp_replace(coalesce(t.size, ''), '\s+', '', 'g')) sz,
         percentile_cont(0.5) within group (order by t.cost_per_tyre)::numeric med, count(*) n
  from t where coalesce(t.cost_per_tyre, 0) > 0 and coalesce(t.size, '') <> '' and (p_kind is null or p_kind = 'price_incorrect')
  group by 1, 2 having count(*) >= 5
),
price_incorrect as (
  select 'price_incorrect|' || t.id, 'price_incorrect', t.country, array[t.id], t.serial_no, t.asset_no, t.pos,
    'Price ' || t.cost_per_tyre || ' is more than 3 times away from the usual ' || round(s.med, 2) || ' for size ' || t.size,
    'Check the invoice; correct the price if it was typed wrong or is a line total',
    null::numeric, round(t.cost_per_tyre - s.med, 2), jsonb_build_object('price', t.cost_per_tyre, 'usual_price', round(s.med, 2), 'size', t.size, 'samples', s.n)
  from t join size_price s on coalesce(s.country, '') = coalesce(t.country, '') and s.sz = upper(regexp_replace(coalesce(t.size, ''), '\s+', '', 'g'))
  where t.cost_per_tyre > 0 and (t.cost_per_tyre > s.med * 3 or t.cost_per_tyre < s.med / 3)
),
-- uncertain previous tyre identification (old/new pair signature not handled by the fix)
pairs as (
  select o.country, o.id old_id, n.id new_id, o.serial_no, o.asset_no, o.pos, o.removal_date, o.km_at_removal, o.cost_per_tyre oc, n.cost_per_tyre nc
  from t o join t n
    on coalesce(n.organisation_id::text, '') = coalesce(o.organisation_id::text, '') and coalesce(n.country, '') = coalesce(o.country, '')
   and n.serial = o.serial and n.asset_no = o.asset_no and n.pos = o.pos
   and o.removal_date = n.fit_date and o.km_at_removal = n.km_at_fitment and o.id <> n.id
  where o.serial is not null and o.serial <> '' and (p_kind is null or p_kind = 'uncertain_previous_tyre')
),
-- read once: the refs table's RLS is evaluated per row, never per exception.
fix_handled as materialized (
  select r.exception_key from public.tyre_exception_refs r
  where r.ref_kind = 'fix_handled' and (p_kind is null or p_kind = 'uncertain_previous_tyre')
),
uncertain_previous_tyre as (
  select 'uncertain_previous_tyre|' || p.old_id || '|' || p.new_id, 'uncertain_previous_tyre', p.country, array[p.old_id, p.new_id],
    p.serial_no, p.asset_no, p.pos,
    'The same serial is recorded both as the tyre removed and the tyre fitted on ' || p.removal_date || ' at ' || p.km_at_removal || ' km',
    'Read the old serial from the job card; put it on the removed row and keep the price on the tyre that was bought',
    null::numeric, coalesce(nullif(p.oc, 0), nullif(p.nc, 0)),
    jsonb_build_object('removed_row', p.old_id, 'fitted_row', p.new_id, 'removed_row_price', p.oc, 'fitted_row_price', p.nc)
  from pairs p
  left join fix_handled fh on fh.exception_key = 'uncertain_previous_tyre|' || p.old_id || '|' || p.new_id
  where fh.exception_key is null
),
-- unlinked repair / retread cost lines on the expense grid (carry no serial)
unlinked_repair_retread as (
  select 'unlinked_repair_retread|' || e.id, 'unlinked_repair_retread', e.country, array[e.id], null::text, e.asset_code, null::text,
    'Tyre repair or retread line with no tyre serial, so it is not in any tyre''s lifetime cost',
    'Link it to the tyre named on job card ' || coalesce(e.work_order_no, '(none)') || ' if the job card names one',
    null::numeric, e.tyre_cost, jsonb_build_object('job_card', e.work_order_no, 'item', e.item_description, 'date', e.event_date, 'currency', e.currency)
  from public.parts_consumption e
  where (p_kind is null or p_kind = 'unlinked_repair_retread') and coalesce(e.tyre_cost, 0) > 0 and e.item_description ~* '(repair|retread|re-tread|resol|vulcan)'
    and (p_country is null or e.country = p_country)
),
-- duplicate expense events (rule T11: exact content match, same source line)
dup_exp as (
  select e.country, array_agg(e.id order by e.created_at, e.id) ids, count(*) n, max(e.line_cost) lc,
         max(e.work_order_no) wo, max(e.item_description) item, max(e.asset_code) asset, max(e.event_date) d, max(e.currency) cur
  from public.parts_consumption e
  where (p_kind is null or p_kind = 'duplicate_expense') and (p_country is null or e.country = p_country) and coalesce(e.tyre_cost, 0) > 0
  group by e.organisation_id, e.country, e.issue_number, e.work_order_no, e.item_code, e.item_description, e.qty, e.value_amount,
           e.txn_date, e.store_code, e.cost_center, e.asset_code
  having count(*) > 1 and count(distinct e.source_row) <= 1
),
duplicate_expense as (
  select 'duplicate_expense|' || d.ids[1] || '|' || d.n, 'duplicate_expense', d.country, d.ids, null::text, d.asset, null::text,
    'The same tyre expense line is recorded ' || d.n || ' times (rule T11)',
    'Keep one line and archive the copies in Duplicate Control',
    null::numeric, round((d.n - 1) * d.lc, 2), jsonb_build_object('job_card', d.wo, 'item', d.item, 'date', d.d, 'currency', d.cur)
  from dup_exp d
)
select * from invalid_serial
union all select * from duplicate_active
union all select * from missing_readings
union all select * from invalid_reading
union all select * from meter_reset
union all select * from missing_site
union all select * from conflicting_dates
union all select * from overlapping_fitment
union all select * from price_missing
union all select * from price_assigned_twice
union all select * from price_incorrect
union all select * from uncertain_previous_tyre
union all select * from unlinked_repair_retread
union all select * from duplicate_expense
$f$;
revoke all on function public._tyre_exception_rows(text, text) from public, anon;
grant execute on function public._tyre_exception_rows(text, text) to authenticated;

-- 5. Counts + one page (INVOKER) ---------------------------------------------
create or replace function public.get_tyre_exceptions_v2(
  p_country text default null, p_kind text default null, p_status text default null,
  p_limit integer default 100, p_offset integer default 0)
returns jsonb
language plpgsql stable security invoker set search_path = public
set plan_cache_mode = force_custom_plan as $f$
declare
  v_rot jsonb; v_rot_ok boolean := false;
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 1000);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_out jsonb;
begin
  if p_status is not null and p_status not in ('open', 'accepted', 'rejected', 'deferred') then
    raise exception 'Unknown review status' using errcode = '22023';
  end if;
  -- rotation closer: DRY RUN ONLY (p_dry_run => true is hard-coded here).
  if p_kind is null or p_kind = 'rotation_not_closed' then
    begin
      v_rot := public.tyre_close_rotations(true, p_country);
      v_rot_ok := true;
    exception when others then
      v_rot := null; v_rot_ok := false;
    end;
  end if;

  with ex as (
    select * from public._tyre_exception_rows(p_country, case when p_kind = 'rotation_not_closed' then '__none__' else p_kind end)
    union all
    select 'rotation_not_closed|' || upper(btrim(coalesce(x->>'country', ''))) || '|' || upper(regexp_replace(coalesce(x->>'asset', ''), '\s+', '', 'g'))
             || '|' || upper(btrim(coalesce(x->>'serial', ''))) || '|' || coalesce(x->>'from_position', ''),
      'rotation_not_closed', x->>'country', '{}'::uuid[], x->>'serial', x->>'asset', x->>'from_position',
      'Tyre moved to ' || coalesce(x->>'to_position', '?') || ' on ' || coalesce(x->>'rotated_on', '?') || ' but is still open on ' || coalesce(x->>'from_position', '?'),
      'Rotation closer would close the earlier position (dry run only; a person runs it)',
      null::numeric, null::numeric, x
    from jsonb_array_elements(case when v_rot_ok then coalesce(v_rot->'rows', '[]'::jsonb) else '[]'::jsonb end) x
  ),
  -- Small lookups read ONCE (their RLS runs per row of the lookup, not per exception;
  -- per-exception subqueries took the full call from ~8 s to ~47 s).
  prot as materialized (
    select r.exception_key, r.record_ids from public.tyre_exception_refs r where r.ref_kind = 'protected'
  ), prot_ids as materialized (
    select distinct u.id from prot, unnest(prot.record_ids) as u(id)
  ), rv as materialized (
    select v.exception_key, v.status, v.note, v.reviewed_by_name, v.reviewed_at from public.tyre_exception_reviews v
  ), cur as materialized (
    select x.country, public.currency_for_country(x.country) as currency from (select distinct ex.country from ex) x
  ), j as (
    select ex.*, coalesce(rv.status, 'open') as status, rv.note, rv.reviewed_by_name, rv.reviewed_at,
           (pk.exception_key is not null
             or (ex.kind in ('uncertain_previous_tyre', 'price_assigned_twice')
                 and exists (select 1 from unnest(ex.record_ids) as e(id) join prot_ids pi on pi.id = e.id))) as protected,
           cur.currency
    from ex
    left join rv on rv.exception_key = ex.exception_key
    left join prot pk on pk.exception_key = ex.exception_key
    left join cur on cur.country is not distinct from ex.country
  ), f as (
    select * from j where (p_kind is null or j.kind = p_kind) and (p_status is null or j.status = p_status)
  )
  select jsonb_build_object(
    'counts', (select coalesce(jsonb_agg(c order by c.kind, c.country), '[]'::jsonb) from (
        select kind, country, count(*) as n,
               count(*) filter (where status = 'open') as open, count(*) filter (where status = 'accepted') as accepted,
               count(*) filter (where status = 'rejected') as rejected, count(*) filter (where status = 'deferred') as deferred,
               count(*) filter (where protected) as protected
        from j group by kind, country) c),
    'total', (select count(*) from f),
    'rotation_available', v_rot_ok or (p_kind is not null and p_kind <> 'rotation_not_closed'),
    'rows', (select coalesce(jsonb_agg(to_jsonb(p) order by p.kind, p.country, p.exception_key), '[]'::jsonb) from (
        select * from f order by f.kind, f.country, f.exception_key limit v_limit offset v_offset) p),
    'limit', v_limit, 'offset', v_offset)
  into v_out;
  return v_out;
end;
$f$;
revoke all on function public.get_tyre_exceptions_v2(text, text, text, integer, integer) from public, anon;
grant execute on function public.get_tyre_exceptions_v2(text, text, text, integer, integer) to authenticated;

-- 6. Review writer (DEFINER: writes ONLY the two review tables) -------------
create or replace function public.set_tyre_exception_review(
  p_key text, p_kind text, p_country text, p_status text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $f$
declare
  v_org uuid := public.app_current_org();
  v_uid uuid := auth.uid();
  v_name text;
  v_old text;
begin
  if v_uid is null or not (public.is_super_admin() or (v_org is not null and public.app_is_elevated())) then
    raise exception 'You do not have permission to review tyre exceptions' using errcode = '42501';
  end if;
  if v_org is null then
    raise exception 'Your account has no organisation' using errcode = '42501';
  end if;
  if p_status not in ('open', 'accepted', 'rejected', 'deferred') then
    raise exception 'Unknown review status' using errcode = '22023';
  end if;
  if p_kind not in ('invalid_serial', 'duplicate_active', 'missing_readings', 'invalid_reading', 'missing_site', 'conflicting_dates',
                    'overlapping_fitment', 'price_missing', 'price_assigned_twice', 'price_incorrect', 'uncertain_previous_tyre',
                    'rotation_not_closed', 'unlinked_repair_retread', 'duplicate_expense') then
    raise exception 'Unknown exception kind' using errcode = '22023';
  end if;
  if p_key is null or split_part(p_key, '|', 1) <> p_kind or length(p_key) > 400 then
    raise exception 'Exception key does not match its kind' using errcode = '22023';
  end if;
  if p_country is not null and not public.app_can_see_country(p_country) then
    raise exception 'Country not in your scope' using errcode = '42501';
  end if;
  if length(coalesce(p_note, '')) > 2000 then
    raise exception 'Note is too long' using errcode = '22023';
  end if;
  if exists (select 1 from public.tyre_exception_refs r where r.ref_kind = 'protected' and r.exception_key = p_key)
     or (p_kind = 'price_assigned_twice' and upper(p_key) like '%|K507B403860') then
    raise exception 'This exception is protected and stays open until the owner authorises a change' using errcode = '42501';
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), p.email) into v_name from public.profiles p where p.id = v_uid;
  select status into v_old from public.tyre_exception_reviews where organisation_id = v_org and exception_key = p_key;

  insert into public.tyre_exception_reviews (organisation_id, country, exception_key, kind, status, note, reviewed_by, reviewed_by_name, reviewed_at)
  values (v_org, p_country, p_key, p_kind, p_status, nullif(btrim(p_note), ''), v_uid, v_name, now())
  on conflict (organisation_id, exception_key) do update
    set status = excluded.status, note = excluded.note, reviewed_by = excluded.reviewed_by,
        reviewed_by_name = excluded.reviewed_by_name, reviewed_at = excluded.reviewed_at;

  insert into public.tyre_exception_review_events (organisation_id, country, exception_key, kind, old_status, new_status, note, actor, actor_name)
  values (v_org, p_country, p_key, p_kind, coalesce(v_old, 'open'), p_status, nullif(btrim(p_note), ''), v_uid, v_name);

  return jsonb_build_object('ok', true, 'key', p_key, 'status', p_status, 'previous', coalesce(v_old, 'open'));
end;
$f$;
revoke all on function public.set_tyre_exception_review(text, text, text, text, text) from public, anon;
grant execute on function public.set_tyre_exception_review(text, text, text, text, text) to authenticated;
