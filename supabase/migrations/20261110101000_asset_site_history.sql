-- 20261110101000 - Historical site attribution (Phase 3). READ-ONLY, PURELY ADDITIVE.
--
-- vehicle_fleet.site is the CURRENT site only. This view rebuilds where an asset
-- belonged OVER TIME from the evidence that carries a date, so a report CAN opt in
-- to "the site at the time". Nothing is rewritten: no stored allocation, report or
-- expense line moves. Reports keep using their current site until a person decides.
--
-- MIRROR of src/lib/assetSiteHistory.js buildSiteHistory() / siteAtDate() - change
-- both together (pinned by src/test/assetSiteHistory.test.js).
--
-- Evidence (measured live 2026-11-09, see docs/tyre/SITE_ATTRIBUTION.md):
--   * work_orders.site = the site the asset BELONGS to on the job card (work_location
--     is where the work happened). 96,554 cards, all but one with a site. This is the
--     only dated source with full coverage, so it is the primary evidence.
--   * vehicle_fleet.site = the register today. Used for the open-ended last period
--     and for assets with no job card.
--   * NOT used, with reasons: tyre_records.site (blank on a third of rows, store
--     vocabulary); audit_log_v2 vehicle_fleet site changes (578, all bulk register
--     corrections between 27 Jul and 13 Aug 2026 - the date we learned, not the date
--     the asset moved); production_logs (a delivery plant per load, 3.2 sites per
--     truck, only 281 of 632 trucks match the register); asset_breakdowns (30 rows).
--
-- Method: per asset, the majority job-card site of each calendar month; consecutive
-- months with the same site form one period. valid_from = first job card of the
-- period, valid_to = the day before the next period starts (open for the last one).
-- confidence:
--   confirmed   = 3+ job cards over 2+ months, every month 80%+ that site, no tie
--   provisional = anything thinner, a tie, or a period that disagrees with the register
-- When the latest job-card period disagrees with the register, it is closed at its
-- last job card and a 'register_current' period (provisional) starts the next day.
-- An asset with no job card gets one 'register_current_only' period (provisional).
--
-- ROLLBACK:
--   drop function if exists public.asset_site_at(text, text, date);
--   drop view if exists public.v_asset_site_history;

create or replace view public.v_asset_site_history with (security_invoker = on) as
with wo as not materialized (
  select w.organisation_id, w.country, upper(btrim(w.asset_no)) as asset_no,
         upper(btrim(w.site)) as site, w.opened_at::date as d
  from public.work_orders w
  where nullif(btrim(w.asset_no), '') is not null
    and nullif(btrim(w.site), '') is not null
    -- a country typed as the site ('UAE' on 5,855 cards, 'KSA' on 34) is a placeholder, not a site
    and upper(btrim(w.site)) not in ('KSA', 'UAE', 'EGYPT', 'SAUDI ARABIA')
    and w.opened_at >= '2000-01-01' and w.opened_at::date <= current_date
),
m as (
  select organisation_id, country, asset_no, date_trunc('month', d)::date as mon, site,
         count(*) as n, min(d) as first_d, max(d) as last_d
  from wo group by 1, 2, 3, 4, 5
),
mm as (
  select m.*,
         sum(n) over (partition by organisation_id, country, asset_no, mon) as month_n,
         row_number() over (partition by organisation_id, country, asset_no, mon
                            order by n desc, last_d desc, site) as rk,
         lead(n) over (partition by organisation_id, country, asset_no, mon
                       order by n desc, last_d desc, site) as next_n
  from m
),
top as (
  select organisation_id, country, asset_no, mon, site, n, month_n, first_d, last_d,
         n::numeric / month_n as share, (next_n is not null and next_n = n) as tie
  from mm where rk = 1
),
grp as (
  select t.*,
         sum(case when t.site is distinct from t.prev_site then 1 else 0 end)
           over (partition by organisation_id, country, asset_no order by mon) as run_no
  from (select top.*, lag(site) over (partition by organisation_id, country, asset_no order by mon) as prev_site
        from top) t
),
runs as (
  select organisation_id, country, asset_no, run_no, min(site) as site,
         min(first_d) as valid_from, max(last_d) as last_evidence,
         count(*) as months, sum(n) as job_cards, min(share) as min_share, bool_or(tie) as any_tie
  from grp group by 1, 2, 3, 4
),
runs2 as not materialized (
  select r.*,
         lead(r.valid_from) over (partition by r.organisation_id, r.country, r.asset_no order by r.run_no) as next_from,
         max(r.run_no) over (partition by r.organisation_id, r.country, r.asset_no) as last_run,
         upper(btrim(f.site)) as register_site
  from runs r
  left join public.vehicle_fleet f
    on f.organisation_id = r.organisation_id and f.country = r.country
   and upper(btrim(f.asset_no)) = r.asset_no
),
wo_periods as (
  select organisation_id, country, asset_no, site, valid_from,
         case when next_from is not null then next_from - 1
              when register_site is not null and register_site is distinct from site then last_evidence
         end as valid_to,
         'job_cards'::text as evidence,
         case when job_cards >= 3 and months >= 2 and min_share >= 0.8 and not any_tie
                   and not (run_no = last_run and register_site is not null and register_site is distinct from site)
              then 'confirmed' else 'provisional' end as confidence,
         job_cards::int as job_cards, months::int as months, round(min_share, 2) as min_month_share,
         last_evidence, register_site
  from runs2
),
reg_after as (
  select organisation_id, country, asset_no, register_site as site, last_evidence + 1 as valid_from,
         null::date as valid_to, 'register_current'::text as evidence, 'provisional'::text as confidence,
         0, 0, null::numeric, null::date, register_site
  from runs2
  where run_no = last_run and register_site is not null and register_site is distinct from site
),
reg_only as (
  select f.organisation_id, f.country, upper(btrim(f.asset_no)), upper(btrim(f.site)), null::date, null::date,
         'register_current_only'::text, 'provisional'::text, 0, 0, null::numeric, null::date, upper(btrim(f.site))
  from public.vehicle_fleet f
  where nullif(btrim(f.site), '') is not null and nullif(btrim(f.asset_no), '') is not null
    and not exists (select 1 from wo where wo.organisation_id = f.organisation_id and wo.country = f.country
                    and wo.asset_no = upper(btrim(f.asset_no)))
)
select * from wo_periods
union all select * from reg_after
union all select * from reg_only;

grant select on public.v_asset_site_history to authenticated;
revoke all on public.v_asset_site_history from anon;

-- The site an asset belonged to on a date: { site, provisional, evidence }.
-- Before the first period the earliest period's site is returned as provisional
-- ('before_first_evidence'). No evidence at all = no row (the caller shows N/A).
create or replace function public.asset_site_at(p_asset text, p_country text, p_date date)
returns table(site text, provisional boolean, evidence text)
language sql stable security invoker set search_path = public
set plan_cache_mode = force_custom_plan as $f$
  with h as materialized (
    select v.site, v.confidence, v.evidence, v.valid_from, v.valid_to
    from public.v_asset_site_history v
    where v.asset_no = upper(btrim(p_asset)) and (p_country is null or v.country = p_country)
  )
  select x.site, x.provisional, x.evidence from (
    select h.site, h.confidence <> 'confirmed' as provisional, h.evidence, 1 as pri, h.valid_from
    from h
    where (h.valid_from is null or h.valid_from <= p_date) and (h.valid_to is null or p_date <= h.valid_to)
    union all
    select h.site, true, 'before_first_evidence', 2, h.valid_from
    from h where h.valid_from > p_date
  ) x
  order by x.pri, case when x.pri = 1 then x.valid_from end desc nulls last, x.valid_from
  limit 1
$f$;
revoke all on function public.asset_site_at(text, text, date) from public, anon;
grant execute on function public.asset_site_at(text, text, date) to authenticated;
