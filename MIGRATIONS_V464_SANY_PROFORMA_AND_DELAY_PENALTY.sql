-- V464: SANY proforma-invoice fields + standalone KSA repair-delay penalty ledger.
-- STATUS: APPLIED LIVE on project jhssdmeruxtrlqnwfksc (org Company A) 2026-08-03. Verified.
--
-- WHY:
--  1) The customer's SANY service-contract PROFORMA invoice (USD, per-machine service
--     charges, one net-of-deductions total) is a NEW format. It is parsed in
--     src/lib/import/parsePdf.js (parseSanyProformaPdf) and stored in sany_invoices
--     with amount = GROSS converted to SAR (the Cost/M3 figure, per customer choice),
--     plus gross/net/fx/deductions for the record. get_cost_per_m3 is UNCHANGED (it
--     already sums sany_invoices.amount where doc_type <> 'detail'; 'proforma' counts).
--  2) A vehicle sent to a SANY workshop whose repair ran over 5 days is charged
--     43 SAR per hour of total repair downtime, which the company DEDUCTS from the
--     SANY invoice. This is a SEPARATE figure - it NEVER feeds Cost/M3. The new
--     sany_delay_penalties ledger + get_sany_delay_candidates RPC support it.
--
-- REVERSIBLE: drop the table + function + the 4 added columns (see footer).

-- 1. SANY invoice proforma columns (all nullable; existing rows untouched).
alter table public.sany_invoices add column if not exists gross_amount numeric;
alter table public.sany_invoices add column if not exists net_amount numeric;
alter table public.sany_invoices add column if not exists fx_rate numeric;
alter table public.sany_invoices add column if not exists deductions jsonb not null default '[]'::jsonb;

-- 2. Standalone KSA delay-penalty ledger.
create table if not exists public.sany_delay_penalties (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country text not null default 'KSA',
  region text,
  site text,
  asset_no text,
  work_order_no text,
  period_date date,
  repair_start timestamptz,
  repair_end timestamptz,
  downtime_hours numeric not null default 0,
  rate_per_hour numeric not null default 43,
  penalty_amount numeric generated always as (round(coalesce(downtime_hours, 0) * coalesce(rate_per_hour, 43), 2)) stored,
  currency text not null default 'SAR',
  sany_invoice_no text,
  status text not null default 'draft' check (status in ('draft', 'deducted', 'waived')),
  source text default 'manual',
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sany_delay_penalties_org_country_period_idx
  on public.sany_delay_penalties (organisation_id, country, period_date);
create index if not exists sany_delay_penalties_asset_idx on public.sany_delay_penalties (asset_no);
create index if not exists sany_delay_penalties_invoice_idx on public.sany_delay_penalties (sany_invoice_no);

alter table public.sany_delay_penalties enable row level security;

drop policy if exists sany_delay_penalties_org_isolation on public.sany_delay_penalties;
create policy sany_delay_penalties_org_isolation on public.sany_delay_penalties
  as restrictive for all using (organisation_id = (select public.app_current_org()));

drop policy if exists sany_delay_penalties_country_isolation on public.sany_delay_penalties;
create policy sany_delay_penalties_country_isolation on public.sany_delay_penalties
  as restrictive for select using (public.app_can_see_country(country));

drop policy if exists sany_delay_penalties_select on public.sany_delay_penalties;
create policy sany_delay_penalties_select on public.sany_delay_penalties
  as permissive for select using (public.app_can_see_site(site));

drop policy if exists sany_delay_penalties_write on public.sany_delay_penalties;
create policy sany_delay_penalties_write on public.sany_delay_penalties
  as permissive for all using (public.app_is_elevated()) with check (public.app_is_elevated());

revoke all on public.sany_delay_penalties from anon;
grant select, insert, update, delete on public.sany_delay_penalties to authenticated;

drop trigger if exists set_updated_at_sany_delay_penalties on public.sany_delay_penalties;
create trigger set_updated_at_sany_delay_penalties
  before update on public.sany_delay_penalties
  for each row execute function public.set_updated_at();

-- 3. Job-card candidates: repairs whose downtime (production_out -> production_in)
-- exceeded p_min_days. DEFINER + org/country scoped; penalty_est = hours x 43.
create or replace function public.get_sany_delay_candidates(
  p_country text default 'KSA',
  p_from date default null,
  p_to date default null,
  p_min_days numeric default 5
) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_org uuid := public.app_current_org();
  v_from date := coalesce(p_from, (date_trunc('month', now()) - interval '11 months')::date);
  v_to date := coalesce(p_to, (date_trunc('month', now()) + interval '1 month - 1 day')::date);
  v_min_hours numeric := coalesce(p_min_days, 5) * 24;
  v_rows jsonb;
begin
  if v_org is null then return jsonb_build_object('ok', false, 'reason', 'no_org'); end if;
  if p_country is not null and not public.app_can_see_country(p_country) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  with cand as (
    select wo.asset_no, wo.site, wo.work_order_no, wo.work_type, wo.work_location,
      wo.production_out_at, wo.production_in_at,
      round(extract(epoch from (wo.production_in_at - wo.production_out_at)) / 3600.0, 1) as downtime_hours,
      wo.breakdown_hours,
      round(coalesce(extract(epoch from (wo.production_in_at - wo.production_out_at)) / 3600.0, 0) * 43, 2) as penalty_est
    from public.work_orders wo
    where wo.organisation_id = v_org
      and (p_country is null or wo.country = p_country)
      and wo.production_out_at is not null and wo.production_in_at is not null
      and wo.production_in_at > wo.production_out_at
      and wo.production_out_at::date between v_from and v_to
      and extract(epoch from (wo.production_in_at - wo.production_out_at)) / 3600.0 > v_min_hours
    order by downtime_hours desc
    limit 500
  )
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_rows from cand c;

  return jsonb_build_object('ok', true, 'country', p_country, 'from', v_from, 'to', v_to,
    'min_days', coalesce(p_min_days, 5), 'rate_per_hour', 43, 'candidates', v_rows);
end;
$function$;

revoke execute on function public.get_sany_delay_candidates(text, date, date, numeric) from public;
grant execute on function public.get_sany_delay_candidates(text, date, date, numeric) to authenticated;

-- ROLLBACK:
--   drop function if exists public.get_sany_delay_candidates(text, date, date, numeric);
--   drop table if exists public.sany_delay_penalties;
--   alter table public.sany_invoices drop column if exists gross_amount, drop column if exists net_amount,
--     drop column if exists fx_rate, drop column if exists deductions;
