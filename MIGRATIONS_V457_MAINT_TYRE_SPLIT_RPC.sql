-- V457 - server-side Tyres-vs-Maintenance monthly split (get_maint_tyre_split)
-- STATUS: APPLIED LIVE (project jhssdmeruxtrlqnwfksc) + verified.
--
-- WHY: loadCostSplit (src/lib/api/costSummary.js) feeds Dashboard, Analytics,
-- Board Overview, Executive, Cost Center, PM and Engineering KPI. Its site-scoped
-- and grid-empty path pulled tyre_records + pm_service_records + work_orders WHOLE
-- into the browser (work_orders is a millions-of-rows table) and summed per month
-- in JS. This RPC does that aggregation server-side; the client keeps the raw-row
-- pulls only as a fallback when the RPC is absent.
--
-- MATH (mirrors the JS exactly):
--   tyre = sum(cost_per_tyre * (qty when >0 else 1)) by issue_date UTC month
--   maintenance = sum(pm_service_records.total_cost) by service_date month
--               + sum(work_orders labour+parts+lubricant+outside_repair)
--                 by coalesce(completed_at, created_at) UTC month
-- Scope = app_current_org() + optional country + optional site, window [from,to].
-- SECURITY DEFINER STABLE, search_path public, anon revoked (mirrors
-- get_parts_expense_snapshot).
--
-- REVERSIBLE: drop function public.get_maint_tyre_split(text,text,date,date);

create or replace function public.get_maint_tyre_split(
  p_country text default null,
  p_site text default null,
  p_from date default null,
  p_to date default null
) returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_org uuid := public.app_current_org();
  v_from date := coalesce(p_from, (date_trunc('month', now()) - interval '11 month')::date);
  v_to date := coalesce(p_to, (date_trunc('month', now()) + interval '1 month - 1 day')::date);
  v_monthly jsonb;
  v_tyre numeric;
  v_maint numeric;
begin
  if v_org is null or not public.app_is_active() then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  with tyre as (
    select to_char(date_trunc('month', t.issue_date), 'YYYY-MM') as m,
           sum(coalesce(t.cost_per_tyre,0) * (case when coalesce(t.qty,0) = 0 then 1 else t.qty end)) as amt
      from public.tyre_records t
     where t.organisation_id = v_org
       and (p_country is null or t.country = p_country)
       and (p_site is null or t.site = p_site)
       and t.issue_date between v_from and v_to
     group by 1
  ),
  pm as (
    select to_char(date_trunc('month', s.service_date), 'YYYY-MM') as m,
           sum(coalesce(s.total_cost,0)) as amt
      from public.pm_service_records s
     where s.organisation_id = v_org
       and (p_country is null or s.country = p_country)
       and (p_site is null or s.site = p_site)
       and s.service_date between v_from and v_to
     group by 1
  ),
  wo as (
    select to_char(date_trunc('month', timezone('UTC', coalesce(w.completed_at, w.created_at))), 'YYYY-MM') as m,
           sum(coalesce(w.labour_cost,0) + coalesce(w.parts_cost,0)
             + coalesce(w.lubricant_cost,0) + coalesce(w.outside_repair_cost,0)) as amt
      from public.work_orders w
     where w.organisation_id = v_org
       and (p_country is null or w.country = p_country)
       and (p_site is null or w.site = p_site)
       and (timezone('UTC', coalesce(w.completed_at, w.created_at)))::date between v_from and v_to
     group by 1
  ),
  months as (select m from tyre union select m from pm union select m from wo),
  rows as (
    select mo.m, coalesce(t.amt, 0) as tyre, coalesce(p.amt, 0) + coalesce(w.amt, 0) as maintenance
      from months mo
      left join tyre t on t.m = mo.m
      left join pm p on p.m = mo.m
      left join wo w on w.m = mo.m
     where mo.m is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object('m', r.m, 'tyre', round(r.tyre,2), 'maintenance', round(r.maintenance,2)) order by r.m), '[]'::jsonb),
         coalesce(sum(r.tyre), 0), coalesce(sum(r.maintenance), 0)
    into v_monthly, v_tyre, v_maint
    from rows r;

  return jsonb_build_object('ok', true, 'from', v_from, 'to', v_to,
    'monthly', v_monthly,
    'total', jsonb_build_object('tyre', round(v_tyre,2), 'maintenance', round(v_maint,2)));
end;
$$;

revoke all on function public.get_maint_tyre_split(text,text,date,date) from anon;
grant execute on function public.get_maint_tyre_split(text,text,date,date) to authenticated;
