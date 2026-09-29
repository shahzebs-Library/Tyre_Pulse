-- QR label print history: one row per print run / PDF / Excel export / queue add
-- made on the QR Labels page. Codes only, never the QR image.
create table if not exists public.qr_print_jobs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid default public.app_current_org(),
  country text,
  batch_no text not null,
  label_type text not null check (label_type in ('tyre','vehicle','equipment','custom','mixed')),
  action text not null check (action in ('generated','printed','pdf','excel','queued')),
  items integer not null default 0 check (items >= 0),
  labels integer not null default 0 check (labels >= 0),
  label_size text,
  codes jsonb not null default '[]'::jsonb,
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists qr_print_jobs_org_idx on public.qr_print_jobs (organisation_id, country, created_at desc);

alter table public.qr_print_jobs enable row level security;
revoke all on public.qr_print_jobs from anon;

create policy qr_print_jobs_org_isolation on public.qr_print_jobs as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));
create policy qr_print_jobs_country_isolation on public.qr_print_jobs as restrictive for all to authenticated
  using ((country is null) or (select public.is_super_admin()) or (select public.app_sees_all_countries())
    or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))))
  with check ((country is null) or (select public.is_super_admin()) or (select public.app_sees_all_countries())
    or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))));
create policy qr_print_jobs_select on public.qr_print_jobs for select to authenticated using ((select public.is_approved_and_unlocked()));
create policy qr_print_jobs_insert on public.qr_print_jobs for insert to authenticated
  with check ((select public.is_approved_and_unlocked()) and created_by = auth.uid());
create policy qr_print_jobs_update on public.qr_print_jobs for update to authenticated
  using ((select public.is_approved_and_unlocked())) with check ((select public.is_approved_and_unlocked()));
create policy qr_print_jobs_delete on public.qr_print_jobs for delete to authenticated using ((select public.app_is_elevated()));
