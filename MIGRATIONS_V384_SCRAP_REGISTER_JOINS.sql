-- V384. The scrapped register pulls in the rest of the record.
--
-- Measured on the live scrapped set (19 rows) before writing any of this:
--   job_card present                     19/19   and every one matches a work order
--   asset_no found in vehicle_fleet      19/19
--   cost_per_tyre on the tyre record      8/19
--   tyre cost via the grid by job card    3/19
--   a tyre_disposals row                  0/19
--
-- So the job card and the vehicle are fully linkable and were simply not being
-- read, while cost is mostly unknown and must say so rather than show 0.
create or replace function public.list_scrapped_tyres(
  p_search  text default null,
  p_country text default null,
  p_limit   int  default 500)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v_org uuid := public.app_current_org();
  v_q   text := nullif(btrim(coalesce(p_search, '')), '');
  v_lim int  := least(greatest(coalesce(p_limit, 500), 1), 2000);
  result jsonb;
begin
  if v_org is null or not public.app_is_active() then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  with marked as (
    select m.serial, m.reason, m.created_at as scrapped_at, m.created_by,
           coalesce(m.country, '') as mark_country
      from public.tyre_status_marks m
     where m.mark_type = 'scrap'
       and m.organisation_id = v_org
  ), rec as (
    -- one row per serial: the most recent fitment carries the live detail
    select distinct on (t.serial_no)
           t.id, t.serial_no, t.asset_no, t.tyre_position, t.brand, t.size, t.site,
           t.country, t.cost_per_tyre, t.issue_date, t.removal_date, t.status,
           t.removal_reason, t.job_card, t.total_km, t.km_at_fitment, t.km_at_removal,
           t.tread_depth
      from public.tyre_records t
     where t.organisation_id = v_org
       and nullif(btrim(coalesce(t.serial_no, '')), '') is not null
     order by t.serial_no, t.issue_date desc nulls last, t.created_at desc nulls last
  ), joined as (
    select coalesce(m.serial, r.serial_no) as serial,
           r.id as tyre_record_id,
           r.asset_no, r.tyre_position, r.brand, r.size, r.site,
           coalesce(nullif(m.mark_country, ''), r.country) as country,
           r.cost_per_tyre, r.issue_date, r.removal_date, r.removal_reason,
           r.job_card, r.tread_depth,
           -- distance run on this tyre: the stored total when the import gave
           -- one, else the two odometer readings. NULL, never 0, when unknown -
           -- zero km would read as a tyre that never turned a wheel.
           coalesce(r.total_km,
                    case when r.km_at_removal is not null and r.km_at_fitment is not null
                          and r.km_at_removal >= r.km_at_fitment
                         then r.km_at_removal - r.km_at_fitment end) as km_run,
           coalesce(m.reason, r.removal_reason) as reason,
           m.scrapped_at, m.created_by,
           (m.serial is not null) as marked
      from marked m
      full outer join rec r on r.serial_no = m.serial
     where m.serial is not null
        or coalesce(r.status, '') = 'Scrapped'
  ), enriched as (
    select j.*,
           coalesce(nullif(btrim(p.full_name), ''), p.username, p.email) as scrapped_by_name,
           -- THE JOB CARD. Present on every scrapped tyre and matching a real
           -- work order on every one, so the register can show what the tyre
           -- came off and why the vehicle was in the workshop.
           w.status      as job_card_status,
           w.work_type   as job_card_type,
           left(coalesce(nullif(btrim(w.description), ''), nullif(btrim(w.notes), '')), 120) as job_card_complaint,
           w.opened_at::date as job_card_opened,
           v.vehicle_type, v.make, v.model,
           d.status as disposal_status
      from joined j
      left join public.profiles p on p.id = j.created_by
      left join public.work_orders w
        on w.organisation_id = v_org and w.work_order_no = j.job_card
      -- Country-scoped, and ONE row. vehicle_fleet is unique per
      -- (org, country, asset_no), so the same asset number exists in more than
      -- one country and an unscoped join silently DUPLICATES the tyre.
      left join lateral (
        select f.vehicle_type, f.make, f.model
          from public.vehicle_fleet f
         where f.organisation_id = v_org
           and f.asset_no = j.asset_no
           and (j.country is null or f.country is null or f.country = j.country)
         order by (f.country = j.country) desc nulls last
         limit 1
      ) v on true
      left join public.tyre_disposals d on d.tyre_record_id = j.tyre_record_id
  ), visible as (
    select * from enriched
     where (p_country is null or country = p_country)
       and (v_q is null
            or serial   ilike '%' || v_q || '%'
            or coalesce(asset_no, '')         ilike '%' || v_q || '%'
            or coalesce(brand, '')            ilike '%' || v_q || '%'
            or coalesce(reason, '')           ilike '%' || v_q || '%'
            or coalesce(job_card, '')         ilike '%' || v_q || '%'
            or coalesce(scrapped_by_name, '') ilike '%' || v_q || '%')
  )
  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'total',              (select count(*) from visible),
    'marked_total',       (select count(*) from visible where marked),
    'unattributed_total', (select count(*) from visible where not marked),
    -- how complete the linked record actually is, published rather than implied
    'linked', jsonb_build_object(
      'with_job_card', (select count(*) from visible where job_card is not null),
      'with_cost',     (select count(*) from visible where cost_per_tyre is not null),
      'with_km',       (select count(*) from visible where km_run is not null),
      'with_disposal', (select count(*) from visible where disposal_status is not null)),
    'search',  v_q,
    'country', p_country,
    'truncated', (select count(*) from visible) > v_lim,
    'rows', (select coalesce(jsonb_agg(to_jsonb(x) order by x.scrapped_at desc nulls last, x.serial), '[]'::jsonb)
               from (select * from visible
                      order by scrapped_at desc nulls last, serial
                      limit v_lim) x)
  ) into result;

  return result;
end $fn$;

revoke all on function public.list_scrapped_tyres(text, text, int) from public, anon;
grant execute on function public.list_scrapped_tyres(text, text, int) to authenticated;
