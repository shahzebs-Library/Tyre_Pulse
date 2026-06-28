-- MIGRATIONS_V39.sql
-- Upload approval queue + per-country trend RPC.
-- Applied on Supabase as `pending_uploads_and_country_trends`.
--
-- pending_uploads: non-admin uploads are staged here (parsed, ready-to-insert
-- rows held as jsonb) for an admin to approve before the rows go live in their
-- target table. RLS: submitters insert/see their own; Admins/Managers see all;
-- only Admins approve/reject (update) or delete.
--
-- report_country_trends(p_from, p_to): per-country monthly counts & cost for the
-- Country Comparison trend charts (monthly line + year-over-year bars).

create table if not exists public.pending_uploads (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null,
  uploaded_by   uuid references public.profiles(id) on delete set null,
  uploader_name text,
  country       text,
  upload_type   text not null default 'tyres',
  target_table  text not null default 'tyre_records',
  file_name     text,
  row_count     int  not null default 0,
  rows          jsonb not null default '[]'::jsonb,
  status        text not null default 'pending',
  reviewed_by   uuid references public.profiles(id) on delete set null,
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_pending_uploads_status on public.pending_uploads(status, created_at desc);

alter table public.pending_uploads enable row level security;

drop policy if exists pending_uploads_insert on public.pending_uploads;
create policy pending_uploads_insert on public.pending_uploads
  for insert to authenticated with check (uploaded_by = auth.uid());

drop policy if exists pending_uploads_select on public.pending_uploads;
create policy pending_uploads_select on public.pending_uploads
  for select to authenticated
  using (uploaded_by = auth.uid() or get_my_role() = any(array['Admin','Manager']));

drop policy if exists pending_uploads_update on public.pending_uploads;
create policy pending_uploads_update on public.pending_uploads
  for update to authenticated
  using (get_my_role() = 'Admin') with check (get_my_role() = 'Admin');

drop policy if exists pending_uploads_delete on public.pending_uploads;
create policy pending_uploads_delete on public.pending_uploads
  for delete to authenticated using (get_my_role() = 'Admin');

do $$ begin
  alter publication supabase_realtime add table public.pending_uploads;
exception when duplicate_object then null; end $$;

create or replace function public.report_country_trends(p_from date default null, p_to date default null)
returns table(country text, month date, cnt bigint, cost numeric)
language sql stable security definer set search_path to 'public' as $$
  select coalesce(r.country,'KSA') as country,
         date_trunc('month', r.issue_date)::date as month,
         count(*) as cnt,
         coalesce(sum(coalesce(r.cost_per_tyre,0) * coalesce(r.qty,1)),0)::numeric as cost
  from public.tyre_records r
  where r.issue_date is not null
    and (p_from is null or r.issue_date >= p_from)
    and (p_to   is null or r.issue_date <= p_to)
  group by 1, 2
  order by 2, 1;
$$;
grant execute on function public.report_country_trends(date,date) to authenticated;
