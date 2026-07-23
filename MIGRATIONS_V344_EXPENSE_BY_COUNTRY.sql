-- V344: per-country expense totals so the "All countries" view shows each country
-- in its OWN currency (KSA=SAR, UAE=AED, Egypt=EGP) side by side, never blending
-- different currencies into one meaningless sum. Org-scoped, honors an optional date range.
create or replace function public.get_expense_by_country(p_from date default null, p_to date default null)
returns table(country text, tyre numeric, spare numeric, oil numeric, total numeric, lines bigint)
language sql stable security definer set search_path = public as $$
  select country,
    round(sum(coalesce(tyre_cost,0))),
    round(sum(coalesce(spare_cost,0))),
    round(sum(coalesce(oil_cost,0))),
    round(sum(coalesce(line_cost,0))),
    count(*)
  from public.parts_consumption
  where organisation_id = public.app_current_org()
    and country is not null and btrim(country) <> ''
    and (p_from is null or event_date >= p_from)
    and (p_to is null or event_date <= p_to)
  group by country
  order by country
$$;
revoke all on function public.get_expense_by_country(date,date) from anon;
grant execute on function public.get_expense_by_country(date,date) to authenticated;
