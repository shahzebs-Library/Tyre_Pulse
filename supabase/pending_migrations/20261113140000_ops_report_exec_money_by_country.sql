-- OPS-1 (MODC-05): per-country money for the scheduled executive e-mail.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the LIVE definition of
--         public.report_exec_digest(uuid, integer) and the live columns of
--         parts_consumption, work_orders, accidents, vehicle_fleet and
--         country_currency. Not applied to any database. Tested on PGlite only
--         (supabase/tests/ops_report_exec_money.test.mjs).
--         NOTE FOR WHOEVER APPLIES IT: the rollback note below contains the word "drop", so the
--         Supabase MCP destructive-statement gate may ask a human to confirm. Nothing here
--         removes data or objects.
--
-- ROOT CAUSE
--   report_exec_digest() sums tyre_records.cost_per_tyre * qty over EVERY
--   country of the organisation and returns one number. The edge function
--   send-scheduled-reports then printed that number with ONE label read from
--   system_config.default_currency (SAR). For a company working in SAR, AED and
--   EGP the e-mail showed three currencies added together and called it SAR.
--   The screens use a different source: the expense grid
--   (parts_consumption.tyre_cost), per country, each in its own currency.
--   Measured on 2026-11-12 (read only): expense grid tyre cost KSA 12,367,362
--   SAR, UAE 4,006,505 AED, Egypt 16,517,335 EGP; the e-mail's source
--   (tyre record prices) gives 4,270,910 + 425,868 + 5,949,557 = 10,646,335
--   printed as "SAR 10,646,335".
--
-- WHAT THIS ADDS (additive only)
--   public.report_exec_money_by_country(p_org uuid, p_days integer default 30)
--   returns jsonb:
--     { basis: 'expense_grid', period_days, win_from, win_to,
--       countries: [ { country, currency,
--                      tyre_spend_all, tyre_spend_cur, tyre_spend_prev,
--                      tyre_spend_12m, expense_lines, first_date, last_date,
--                      wo_cost, accident_cost, monthly_budget,
--                      monthly_trend: [{label,value,count}],   -- last 6 months
--                      top_sites:  [{label,value,count}],      -- top 5
--                      top_assets: [{label,value,count}] } ] } -- top 5
--   One element per (country, currency). There is NO total across elements, by
--   design. The currency of an expense line is the line's own currency column,
--   else the country's currency from country_currency. Work order cost,
--   accident cost and tyre budget have no currency column, so they take the
--   currency of their row's country.
--   The window anchors on the newest expense date that is not in the future
--   (same idea as report_exec_digest, which anchors on the newest tyre record),
--   so an organisation whose data stopped last month still gets a real window.
--
--   Nothing existing is changed. report_exec_digest() stays as it is and keeps
--   supplying the COUNTS. The edge function (repo source, not deployed) calls
--   the new function for money and falls back to a per-country list from the
--   old digest when this function is absent, so the two can ship in any order.
--
-- SECURITY
--   SECURITY DEFINER and takes an organisation id, so it must never be callable
--   by a signed-in user (the V378 rule). EXECUTE is revoked from PUBLIC, anon
--   and authenticated and granted to service_role only, exactly like
--   report_exec_digest. A NULL p_org returns an empty country list (there is no
--   cross-organisation mode).
--
-- RISK TO THE CURRENT COMPANY: none from applying this file (one new function,
--   no table change, no row touched, nothing calls it until the edge function
--   is redeployed). After the edge function IS redeployed the executive e-mail
--   figures change on purpose: per country, from the expense grid. Only one
--   executive schedule exists today and it is inactive.
--
-- VERIFY (read only, after applying)
--   select jsonb_pretty(public.report_exec_money_by_country(
--            '00000000-0000-0000-0000-000000000001'::uuid, 30));
--   -- expect one element per country, currencies SAR / AED / EGP, and
--   -- tyre_spend_all equal to, per country:
--   select country, round(sum(tyre_cost)) from public.parts_consumption
--    where organisation_id = '00000000-0000-0000-0000-000000000001' group by 1;
--   select has_function_privilege('anon', 'public.report_exec_money_by_country(uuid,integer)', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.report_exec_money_by_country(uuid,integer)', 'EXECUTE');
--   -- expect f, f
--
-- ROLLBACK
--   drop function if exists public.report_exec_money_by_country(uuid, integer);
--   (The edge function then falls back to the legacy per-country list by itself.)

create or replace function public.report_exec_money_by_country(p_org uuid, p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with params as (
  select greatest(1, least(coalesce(p_days, 30), 366)) as n
),
-- Tyre cost lines of the expense grid for this organisation only.
g as (
  select coalesce(nullif(btrim(pc.country), ''), '') as country,
         coalesce(nullif(upper(btrim(pc.currency)), ''), public.currency_for_country(pc.country), '') as currency,
         pc.event_date,
         pc.tyre_cost,
         nullif(btrim(pc.site), '') as site,
         nullif(btrim(pc.asset_code), '') as asset_code
    from public.parts_consumption pc
   where pc.organisation_id = p_org
     and coalesce(pc.tyre_cost, 0) <> 0
),
anchor as (
  select least(coalesce(max(event_date), current_date), current_date) + 1 as a from g
),
d as (
  select a - n as c_from, a as c_to, a - 2 * n as p_from, a - n as p_to,
         a - 365 as y_from,
         (date_trunc('month', (a - 1)::timestamp) - interval '5 months')::date as m_from
    from anchor, params
),
g_tot as (
  select g.country, g.currency,
         sum(g.tyre_cost) as spend_all,
         coalesce(sum(g.tyre_cost) filter (where g.event_date >= d.c_from and g.event_date < d.c_to), 0) as spend_cur,
         coalesce(sum(g.tyre_cost) filter (where g.event_date >= d.p_from and g.event_date < d.p_to), 0) as spend_prev,
         coalesce(sum(g.tyre_cost) filter (where g.event_date >= d.y_from and g.event_date < d.c_to), 0) as spend_12m,
         count(*) as lines,
         min(g.event_date) as first_date,
         max(g.event_date) as last_date
    from g, d
   group by g.country, g.currency
),
g_trend as (
  select country, currency,
         jsonb_agg(jsonb_build_object('label', ym, 'value', round(spend), 'count', cnt) order by ym) as v
    from (select g.country, g.currency, to_char(date_trunc('month', g.event_date::timestamp), 'YYYY-MM') as ym,
                 sum(g.tyre_cost) as spend, count(*) as cnt
            from g, d
           where g.event_date >= d.m_from and g.event_date < d.c_to
           group by 1, 2, 3) x
   group by country, currency
),
g_sites as (
  select country, currency,
         jsonb_agg(jsonb_build_object('label', site, 'value', round(spend), 'count', cnt) order by spend desc) as v
    from (select g.country, g.currency, coalesce(g.site, '(unknown)') as site,
                 sum(g.tyre_cost) as spend, count(*) as cnt,
                 row_number() over (partition by g.country, g.currency order by sum(g.tyre_cost) desc) as rn
            from g group by 1, 2, 3) x
   where rn <= 5
   group by country, currency
),
g_assets as (
  select country, currency,
         jsonb_agg(jsonb_build_object('label', asset, 'value', round(spend), 'count', cnt) order by spend desc) as v
    from (select g.country, g.currency, coalesce(g.asset_code, '(unassigned)') as asset,
                 sum(g.tyre_cost) as spend, count(*) as cnt,
                 row_number() over (partition by g.country, g.currency order by sum(g.tyre_cost) desc) as rn
            from g group by 1, 2, 3) x
   where rn <= 5
   group by country, currency
),
wo as (
  select coalesce(nullif(btrim(w.country::text), ''), '') as country,
         coalesce(public.currency_for_country(w.country::text), '') as currency,
         sum(w.total_cost) as cost
    from public.work_orders w
   where w.organisation_id = p_org and coalesce(w.total_cost, 0) <> 0
   group by 1, 2
),
acc as (
  select coalesce(nullif(btrim(a.country), ''), '') as country,
         coalesce(public.currency_for_country(a.country), '') as currency,
         sum(coalesce(a.repair_cost, a.estimated_damage_cost, 0)) as cost
    from public.accidents a
   where a.organisation_id = p_org and coalesce(a.repair_cost, a.estimated_damage_cost, 0) <> 0
   group by 1, 2
),
fleet as (
  select coalesce(nullif(btrim(v.country), ''), '') as country,
         coalesce(public.currency_for_country(v.country), '') as currency,
         sum(v.monthly_tyre_budget) as monthly_budget
    from public.vehicle_fleet v
   where v.organisation_id = p_org and coalesce(v.monthly_tyre_budget, 0) <> 0
   group by 1, 2
),
keys as (
  select country, currency from g_tot
  union select country, currency from wo
  union select country, currency from acc
  union select country, currency from fleet
)
select jsonb_build_object(
  'basis', 'expense_grid',
  'period_days', (select n from params),
  'win_from', (select c_from from d),
  'win_to', (select c_to from d),
  'countries', coalesce((
    select jsonb_agg(jsonb_build_object(
             'country', nullif(k.country, ''),
             'currency', nullif(k.currency, ''),
             'tyre_spend_all', round(coalesce(t.spend_all, 0)),
             'tyre_spend_cur', round(coalesce(t.spend_cur, 0)),
             'tyre_spend_prev', round(coalesce(t.spend_prev, 0)),
             'tyre_spend_12m', round(coalesce(t.spend_12m, 0)),
             'expense_lines', coalesce(t.lines, 0),
             'first_date', t.first_date,
             'last_date', t.last_date,
             'wo_cost', round(coalesce(w.cost, 0)),
             'accident_cost', round(coalesce(a.cost, 0)),
             'monthly_budget', f.monthly_budget,
             'monthly_trend', coalesce(tr.v, '[]'::jsonb),
             'top_sites', coalesce(s.v, '[]'::jsonb),
             'top_assets', coalesce(av.v, '[]'::jsonb)
           ) order by k.country, k.currency)
      from keys k
      left join g_tot t    on t.country = k.country and t.currency = k.currency
      left join g_trend tr on tr.country = k.country and tr.currency = k.currency
      left join g_sites s  on s.country = k.country and s.currency = k.currency
      left join g_assets av on av.country = k.country and av.currency = k.currency
      left join wo w       on w.country = k.country and w.currency = k.currency
      left join acc a      on a.country = k.country and a.currency = k.currency
      left join fleet f    on f.country = k.country and f.currency = k.currency
  ), '[]'::jsonb)
);
$$;

comment on function public.report_exec_money_by_country(uuid, integer) is
  'Per-country money for the scheduled executive e-mail (expense grid tyre cost, work order cost, accident cost, tyre budget), one element per country and currency, never a total across currencies. Service role only.';

revoke all on function public.report_exec_money_by_country(uuid, integer) from public;
revoke all on function public.report_exec_money_by_country(uuid, integer) from anon;
revoke all on function public.report_exec_money_by_country(uuid, integer) from authenticated;
grant execute on function public.report_exec_money_by_country(uuid, integer) to service_role;
