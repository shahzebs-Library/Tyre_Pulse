-- Fleet Renewal: planned year + currency on renewal plans, and one server-side
-- read of the per-asset signals the renewal score needs (repair cost per
-- currency, downtime, accidents, latest hour meter). SECURITY INVOKER, so the
-- caller's org/country/site RLS applies; nothing is blended across currencies.
alter table public.fleet_renewal_plans add column if not exists planned_year integer;
alter table public.fleet_renewal_plans add column if not exists currency text;
alter table public.fleet_renewal_plans drop constraint if exists fleet_renewal_plans_planned_year_check;
alter table public.fleet_renewal_plans add constraint fleet_renewal_plans_planned_year_check
  check (planned_year is null or planned_year between 2000 and 2100);

update public.fleet_renewal_plans
   set planned_year = coalesce(planned_year, extract(year from target_replace_date)::int),
       currency = coalesce(currency, case country when 'KSA' then 'SAR' when 'UAE' then 'AED' when 'Egypt' then 'EGP' end)
 where planned_year is null or currency is null;

create or replace function public.get_fleet_renewal_signals(p_country text default null)
returns table (
  asset_key text, country text,
  repair_cost_12m jsonb, repair_cost_all jsonb,
  downtime_hours_12m numeric, job_cards_12m integer,
  accidents_all integer, accidents_12m integer,
  last_hours numeric, last_hours_at date
)
language sql stable security invoker set search_path = public as $$
  with scope as (select nullif(nullif(btrim(p_country), ''), 'All') as c),
  pc as (
    select upper(regexp_replace(p.asset_code, '\s', '', 'g')) k, p.country,
           p.currency, sum(p.line_cost) total,
           sum(p.line_cost) filter (where p.event_date >= current_date - 365) last12
      from parts_consumption p, scope s
     where p.asset_code is not null and btrim(p.asset_code) <> '' and p.currency is not null
       and (s.c is null or p.country = s.c)
     group by 1, 2, 3
  ),
  pcj as (
    select k, country,
           jsonb_object_agg(currency, round(total, 2)) filter (where total is not null) all_j,
           jsonb_object_agg(currency, round(last12, 2)) filter (where last12 is not null and last12 <> 0) m12_j
      from pc group by 1, 2
  ),
  wo as (
    select upper(regexp_replace(w.asset_no, '\s', '', 'g')) k, w.country,
           count(*)::int jc,
           sum(extract(epoch from (w.production_in_at - w.production_out_at)) / 3600)
             filter (where w.production_in_at >= w.production_out_at
                       and w.production_in_at - w.production_out_at < interval '365 days') dt
      from work_orders w, scope s
     where w.asset_no is not null and w.opened_at >= now() - interval '365 days'
       and (s.c is null or w.country = s.c)
     group by 1, 2
  ),
  ac as (
    select upper(regexp_replace(a.asset_no, '\s', '', 'g')) k, a.country,
           count(*)::int n_all,
           count(*) filter (where a.incident_date >= current_date - 365)::int n12
      from accidents a, scope s
     where a.asset_no is not null and (s.c is null or a.country = s.c)
     group by 1, 2
  ),
  eh as (
    select distinct on (1, 2) upper(regexp_replace(e.asset_no, '\s', '', 'g')) k, e.country,
           e.engine_hours h, e.reading_date d
      from engine_hours_logs e, scope s
     where e.asset_no is not null and e.engine_hours is not null
       and (s.c is null or e.country = s.c)
     order by 1, 2, e.reading_date desc, e.id desc
  ),
  keys as (
    select k, country from pcj union select k, country from wo
    union select k, country from ac union select k, country from eh
  )
  select keys.k, keys.country,
         coalesce(pcj.m12_j, '{}'::jsonb), coalesce(pcj.all_j, '{}'::jsonb),
         round(wo.dt::numeric, 1), coalesce(wo.jc, 0),
         coalesce(ac.n_all, 0), coalesce(ac.n12, 0),
         eh.h, eh.d
    from keys
    left join pcj on pcj.k = keys.k and pcj.country is not distinct from keys.country
    left join wo on wo.k = keys.k and wo.country is not distinct from keys.country
    left join ac on ac.k = keys.k and ac.country is not distinct from keys.country
    left join eh on eh.k = keys.k and eh.country is not distinct from keys.country
   order by keys.k, keys.country nulls first
$$;

revoke all on function public.get_fleet_renewal_signals(text) from public;
revoke all on function public.get_fleet_renewal_signals(text) from anon;
grant execute on function public.get_fleet_renewal_signals(text) to authenticated, service_role;
