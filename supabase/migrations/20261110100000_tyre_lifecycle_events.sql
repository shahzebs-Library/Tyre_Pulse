-- 20261110100000 - Tyre lifecycle events (Phase 3). READ-ONLY, PURELY ADDITIVE.
--
-- One chronological event history per PHYSICAL tyre, derived from what is already
-- stored. Nothing is written; no existing view, RPC or figure changes.
--
-- MIRROR of src/lib/tyreLifecycleEvents.js buildLifecycleEvents() - change both
-- together (pinned by src/test/tyreLifecycleEvents.test.js).
--
-- Physical tyre = the tyre_key of public.v_tyre_lifetime_fitments (Phase 1,
-- 20261109160000): country|upper(serial) for a real serial, else the row itself.
--
-- Event types:
--   FIT                 first fitment of the tyre (is_purchase when the tyre carries a
--                       price on any of its fitment rows).
--   REFIT_SAME_VEHICLE  later fitment, same vehicle, same position.
--   ROTATION            later fitment, same vehicle, other position (or a rotation
--                       recorded in tyre_service_events).
--   TRANSFER            later fitment on another vehicle.
--   REMOVAL             a fitment that ended (removal date or removal km recorded).
--   RETURN_TO_STORE     removed and fitted again only after a gap of one day or
--                       more: the tyre was off a vehicle in between. Inferred from the
--                       refit; dated the removal day.
--   RETREAD             retread_jobs (returned or sent) or a retread service event.
--   WARRANTY_REPLACEMENT an approved / credited warranty claim (not rejected).
--   SCRAP               a tyre_status_marks scrap mark, or a Scrapped fitment row
--                       for a tyre that carries no mark.
--   DISPOSAL            tyre_disposals with a disposed_on date.
--   AMBIGUOUS           a later fitment whose movement cannot be told apart. The
--                       reason is stated and NOTHING is resolved:
--                         same_day_double_entry      same fitment date as the previous one
--                         earlier_fitment_still_open the previous fitment is still active
--                                                    (an unclosed rotation)
--                         overlaps_earlier_fitment   starts before the previous one ended
--                         no_fitment_date            the fitment has no date
--                         vehicle_not_recorded       either fitment has no vehicle
--                         position_not_recorded      same vehicle, a position is missing
-- A ROTATION, TRANSFER or REFIT is never a purchase: is_purchase is true only on the
-- FIT event of a tyre that is priced anywhere (rule T1: one tyre, one price). When the
-- price sits on a later fitment row (245 tyres live at build) the FIT says so in detail;
-- the later row stays a movement.
--
-- Measured live at build (dry run, 2026-11-09): see docs/tyre/LIFECYCLE_EVENTS.md.
--
-- ROLLBACK:
--   drop function if exists public.get_tyre_lifecycle_event_counts(text);
--   drop function if exists public.get_tyre_lifecycle_events(text, text);
--   drop view if exists public.v_tyre_lifecycle_events;

create or replace view public.v_tyre_lifecycle_events with (security_invoker = on) as
with fl as (
  select f.*,
         lag(f.asset_no)     over w as prev_asset_no,
         lag(f.position)     over w as prev_position,
         lag(f.fit_date)     over w as prev_fit_date,
         lag(f.removal_date) over w as prev_removal_date,
         lag(f.completed)    over w as prev_completed,
         lag(f.active)       over w as prev_active,
         lead(f.fit_date)    over w as next_fit_date,
         lead(f.id)          over w as next_id,
         first_value(f.id) over (partition by f.tyre_key
                                 order by (coalesce(f.cost_per_tyre, 0) > 0) desc, f.fit_seq) as first_priced_id,
         bool_or(coalesce(f.cost_per_tyre, 0) > 0) over (partition by f.tyre_key) as tyre_priced
  from public.v_tyre_lifetime_fitments f
  window w as (partition by f.tyre_key order by f.fit_date nulls first, f.id)
),
fit_ev as (
  select fl.*,
         case
           when fl.fit_seq = 1 then null
           when fl.fit_date is not null and fl.fit_date = fl.prev_fit_date then 'same_day_double_entry'
           when fl.is_overlap and fl.prev_end = 'infinity'::date then 'earlier_fitment_still_open'
           when fl.is_overlap then 'overlaps_earlier_fitment'
           when fl.fit_date is null then 'no_fitment_date'
           when nullif(btrim(coalesce(fl.asset_no, '')), '') is null
             or nullif(btrim(coalesce(fl.prev_asset_no, '')), '') is null then 'vehicle_not_recorded'
           when upper(btrim(fl.asset_no)) = upper(btrim(fl.prev_asset_no))
            and (nullif(btrim(coalesce(fl.position, '')), '') is null
              or nullif(btrim(coalesce(fl.prev_position, '')), '') is null) then 'position_not_recorded'
         end as amb
  from fl
),
ev as (
  -- 1. Fitments: FIT / REFIT_SAME_VEHICLE / ROTATION / TRANSFER / AMBIGUOUS.
  select e.tyre_key, e.organisation_id, e.country, e.serial_no,
         e.fit_date as event_date, e.fit_seq * 10 as ord,
         case when e.fit_seq = 1 then 'FIT'
              when e.amb is not null then 'AMBIGUOUS'
              when upper(btrim(e.asset_no)) <> upper(btrim(e.prev_asset_no)) then 'TRANSFER'
              when upper(btrim(e.position)) = upper(btrim(e.prev_position)) then 'REFIT_SAME_VEHICLE'
              else 'ROTATION' end as event_type,
         e.amb as ambiguous_reason,
         e.asset_no, e.position,
         case when e.fit_seq > 1 then e.prev_asset_no end as from_asset_no,
         case when e.fit_seq > 1 then e.prev_position end as from_position,
         e.km_at_fitment as odometer_km, null::numeric as km,
         (e.fit_seq = 1 and e.tyre_priced) as is_purchase,
         e.id as fitment_id, 'tyre_records'::text as source_table, e.id::text as source_id,
         case when e.fit_seq = 1 and e.tyre_priced and e.id <> e.first_priced_id
                then 'purchase price is recorded on a later fitment row (' || e.first_priced_id || ')'
              when e.fit_seq > 1 and e.prev_removal_date is null and not e.prev_completed and not e.prev_active
                then 'previous fitment has no removal date' end as detail
  from fit_ev e
  union all
  -- 2. Removals: every fitment that ended. km = that fitment's km by the shared rule (T7).
  select fl.tyre_key, fl.organisation_id, fl.country, fl.serial_no,
         fl.removal_date, fl.fit_seq * 10 + 1, 'REMOVAL', null,
         fl.asset_no, fl.position, null, null,
         fl.km_at_removal, case when fl.km > 0 then fl.km end,
         false, fl.id, 'tyre_records', fl.id::text,
         concat_ws('; ',
           case when fl.is_overlap then 'km not counted in life: overlaps an earlier fitment' end,
           case when rl.id is not null then 'closed by system reconcile (' || rl.source || ', log ' || rl.id || ')' end)
  from fl
  left join lateral (
    select l.id, l.source from public.tyre_replacement_log l
    where l.tyre_id = fl.id and l.undone_at is null
    order by l.id desc limit 1
  ) rl on true
  where fl.completed
  union all
  -- 3. Return to store: removed, refitted only after a gap.
  select fl.tyre_key, fl.organisation_id, fl.country, fl.serial_no,
         fl.removal_date, fl.fit_seq * 10 + 2, 'RETURN_TO_STORE', null,
         null, null, fl.asset_no, fl.position,
         null, null, false, fl.id, 'tyre_records', fl.id::text,
         'inferred: off a vehicle ' || (fl.next_fit_date - fl.removal_date) || ' day(s) before refit'
  from fl
  where fl.removal_date is not null and fl.next_fit_date is not null and fl.next_fit_date > fl.removal_date
  union all
  -- 4. Scrap marks (720 live, every one carries its country).
  select upper(btrim(coalesce(m.country, ''))) || '|' || upper(btrim(m.serial)),
         m.organisation_id, m.country, m.serial,
         m.created_at::date, 1000000, 'SCRAP', null,
         null, null, null, null, null, null, false, null,
         'tyre_status_marks', m.id::text, nullif(btrim(coalesce(m.reason, '')), '')
  from public.tyre_status_marks m
  where m.mark_type = 'scrap' and public.tyre_serial_is_strong(m.serial)
  union all
  -- 5. A Scrapped fitment row for a tyre that has no scrap mark.
  select fl.tyre_key, fl.organisation_id, fl.country, fl.serial_no,
         fl.removal_date, fl.fit_seq * 10 + 3, 'SCRAP', null,
         fl.asset_no, fl.position, null, null, null, null, false, fl.id,
         'tyre_records', fl.id::text, 'status Scrapped, no scrap mark'
  from fl
  where fl.status ilike '%scrap%'
    and not exists (
      select 1 from public.tyre_status_marks m
      where m.mark_type = 'scrap' and public.tyre_serial_is_strong(m.serial)
        and upper(btrim(coalesce(m.country, ''))) || '|' || upper(btrim(m.serial)) = fl.tyre_key)
  union all
  -- 6. Retreads (jobs, then service events).
  select coalesce(case when public.tyre_serial_is_strong(j.casing_serial)
                       then upper(btrim(coalesce(j.country, ''))) || '|' || upper(btrim(j.casing_serial)) end,
                  fr.tyre_key),
         j.organisation_id, j.country, coalesce(j.casing_serial, fr.serial_no),
         coalesce(j.returned_at, j.sent_at), 2000000, 'RETREAD', null,
         j.last_asset_no, null, null, null, null, null, false, j.tyre_record_id,
         'retread_jobs', j.id::text, concat_ws(', ', j.vendor_name, j.status)
  from public.retread_jobs j
  left join fl fr on fr.id = j.tyre_record_id
  where coalesce(j.returned_at, j.sent_at) is not null
    and (public.tyre_serial_is_strong(j.casing_serial) or fr.tyre_key is not null)
  union all
  select upper(btrim(coalesce(s.country, ''))) || '|' || upper(btrim(s.tyre_serial)),
         s.organisation_id, s.country, s.tyre_serial, s.event_date,
         case when s.event_type ilike '%retread%' then 2000000 else 1500000 end,
         case when s.event_type ilike '%retread%' then 'RETREAD' else 'ROTATION' end, null,
         s.asset_no, s.position, null, null, s.odometer_km, null, false, null,
         'tyre_service_events', s.id::text, nullif(btrim(coalesce(s.notes, '')), '')
  from public.tyre_service_events s
  where public.tyre_serial_is_strong(s.tyre_serial)
    and (s.event_type ilike '%retread%' or s.event_type ilike '%rotat%')
  union all
  -- 7. Warranty replacement: an approved or credited claim.
  select upper(btrim(coalesce(w.country, ''))) || '|' || upper(btrim(w.serial_number)),
         w.organisation_id, w.country, w.serial_number,
         coalesce(w.decision_date, w.credit_date, w.removal_date), 3000000, 'WARRANTY_REPLACEMENT', null,
         w.asset_no, null, null, null, w.km_at_removal, w.km_run, false, null,
         'warranty_claims', w.id::text, concat_ws(', ', w.claim_no, w.claim_status)
  from public.warranty_claims w
  where public.tyre_serial_is_strong(w.serial_number)
    and w.claim_status in ('Approved', 'Credit Issued', 'Closed')
    and w.rejection_reason is null
  union all
  -- 8. Disposal.
  select fr.tyre_key, d.organisation_id, fr.country, fr.serial_no,
         d.disposed_on, 4000000, 'DISPOSAL', null,
         null, null, null, null, null, null, false, d.tyre_record_id,
         'tyre_disposals', d.tyre_record_id::text, concat_ws(', ', d.disposal_method, d.disposal_vendor)
  from public.tyre_disposals d
  join fl fr on fr.id = d.tyre_record_id
  where d.disposed_on is not null
)
select ev.tyre_key, ev.organisation_id, ev.country, ev.serial_no,
       row_number() over (partition by ev.tyre_key
                          order by ev.event_date nulls first, ev.ord, ev.source_table, ev.source_id) as event_seq,
       ev.event_date, ev.event_type, ev.ambiguous_reason,
       ev.asset_no, ev.position, ev.from_asset_no, ev.from_position,
       ev.odometer_km, ev.km, ev.is_purchase, ev.fitment_id,
       ev.source_table, ev.source_id, nullif(ev.detail, '') as detail
from ev;

grant select on public.v_tyre_lifecycle_events to authenticated;
revoke all on public.v_tyre_lifecycle_events from anon;

-- One tyre's history by serial (case and padding insensitive), optional country.
create or replace function public.get_tyre_lifecycle_events(p_serial text, p_country text default null)
returns setof public.v_tyre_lifecycle_events
language sql stable security invoker set search_path = public
set plan_cache_mode = force_custom_plan as $f$
  select e.* from public.v_tyre_lifecycle_events e
  where upper(btrim(e.serial_no)) = upper(btrim(p_serial))
    and (p_country is null or e.country = p_country)
  order by e.tyre_key, e.event_seq
$f$;
revoke all on function public.get_tyre_lifecycle_events(text, text) from public, anon;
grant execute on function public.get_tyre_lifecycle_events(text, text) to authenticated;

-- Counts per country and event type (and per ambiguity reason).
create or replace function public.get_tyre_lifecycle_event_counts(p_country text default null)
returns jsonb
language sql stable security invoker set search_path = public
set plan_cache_mode = force_custom_plan as $f$
  with e as (
    select country, event_type, ambiguous_reason from public.v_tyre_lifecycle_events
    where p_country is null or country = p_country
  ), by_type as (
    select country, event_type, count(*) n from e group by 1, 2
  ), by_reason as (
    select country, ambiguous_reason, count(*) n from e where event_type = 'AMBIGUOUS' group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'country', c.country,
           'by_type', (select jsonb_object_agg(t.event_type, t.n) from by_type t where t.country is not distinct from c.country),
           'ambiguous', coalesce((select jsonb_object_agg(r.ambiguous_reason, r.n) from by_reason r where r.country is not distinct from c.country), '{}'::jsonb)
         ) order by c.country), '[]'::jsonb)
  from (select distinct country from e) c
$f$;
revoke all on function public.get_tyre_lifecycle_event_counts(text) from public, anon;
grant execute on function public.get_tyre_lifecycle_event_counts(text) to authenticated;
