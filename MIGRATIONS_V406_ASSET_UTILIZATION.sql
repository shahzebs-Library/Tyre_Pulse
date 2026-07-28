-- V406: Fleet Utilization telematics table (applied live via Supabase MCP)
-- Clean, org+country scoped surface sourced from the country telematics uploads
-- (ksa_kms / uae_kms). Populated once from those raw tables; RLS mirrors odometer_logs.
-- Undo: drop table public.asset_utilization cascade;

create table if not exists public.asset_utilization (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country text,
  asset_no text not null,
  make text,
  model text,
  captured_at date,
  working_seconds numeric,
  driving_seconds numeric,
  idle_seconds numeric,
  idle_pct numeric,
  distance_km numeric,
  max_speed numeric,
  utilization_pct numeric,
  odo_end numeric,
  linked_to_fleet boolean default false,
  source text default 'telematics',
  created_at timestamptz default now(),
  unique (organisation_id, country, asset_no, captured_at)
);
create index if not exists asset_utilization_org_country_idx on public.asset_utilization (organisation_id, country);
create index if not exists asset_utilization_asset_idx on public.asset_utilization (organisation_id, asset_no);

alter table public.asset_utilization enable row level security;
create policy asset_utilization_read on public.asset_utilization for select using (auth.uid() is not null);
create policy asset_utilization_insert on public.asset_utilization for insert with check (auth.uid() is not null);
create policy asset_utilization_update on public.asset_utilization for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy asset_utilization_delete on public.asset_utilization for delete using (auth.uid() is not null);
create policy asset_utilization_org_isolation on public.asset_utilization as restrictive for all
  using (not (organisation_id is distinct from (select public.app_current_org())))
  with check (not (organisation_id is distinct from (select public.app_current_org())));
create policy asset_utilization_country_isolation on public.asset_utilization as restrictive for select
  using (country is null or (select public.app_is_org_admin()) or (select public.app_sees_all_countries())
         or lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[])));
grant select, insert, update, delete on public.asset_utilization to authenticated;

-- Populate from KSA telematics (interval columns -> seconds) and UAE telematics (text -> parsed).
insert into public.asset_utilization
  (organisation_id, country, asset_no, make, model, captured_at,
   working_seconds, driving_seconds, idle_seconds, idle_pct, distance_km, max_speed, utilization_pct, odo_end,
   linked_to_fleet, source)
select '00000000-0000-0000-0000-000000000001'::uuid, 'KSA',
   upper(btrim(k."Asset name")), nullif(btrim(k."Make"),''), nullif(btrim(k."Model"),''),
   coalesce(k.created_at::date, current_date),
   extract(epoch from k."Working hours"), extract(epoch from k."Pure driving"), extract(epoch from k."Idling"),
   k."Idling %", k."Distance", k."Max speed", k."Utilization",
   case when k."Odo value end" ~ '^[0-9]+(\.[0-9]+)?$' then (k."Odo value end")::numeric end,
   exists (select 1 from vehicle_fleet f where btrim(f.asset_no)=upper(btrim(k."Asset name")) and f.country='KSA'),
   'telematics'
from ksa_kms k where nullif(btrim(k."Asset name"),'') is not null
on conflict (organisation_id, country, asset_no, captured_at) do nothing;

insert into public.asset_utilization
  (organisation_id, country, asset_no, make, model, captured_at,
   working_seconds, driving_seconds, idle_seconds, idle_pct, distance_km, max_speed, utilization_pct, odo_end,
   linked_to_fleet, source)
select '00000000-0000-0000-0000-000000000001'::uuid, 'UAE',
   upper(btrim(u."Asset name")), nullif(btrim(u."Make"),''), nullif(btrim(u."Model"),''),
   coalesce(u.created_at::date, current_date),
   case when btrim(u."Working hours") ~ '^\d+:\d{2}:\d{2}$' then extract(epoch from (u."Working hours")::interval) end,
   case when btrim(u."Pure driving") ~ '^\d+:\d{2}:\d{2}$' then extract(epoch from (u."Pure driving")::interval) end,
   case when btrim(u."Idling") ~ '^\d+:\d{2}:\d{2}$' then extract(epoch from (u."Idling")::interval) end,
   case when btrim(u."Idling %") ~ '^[0-9]+(\.[0-9]+)?$' then (u."Idling %")::numeric end,
   case when btrim(u."Distance") ~ '^[0-9]+(\.[0-9]+)?$' then (u."Distance")::numeric end,
   case when btrim(u."Max speed") ~ '^[0-9]+(\.[0-9]+)?$' then (u."Max speed")::numeric end,
   case when btrim(u."Utilization") ~ '^[0-9]+(\.[0-9]+)?$' then (u."Utilization")::numeric end,
   case when btrim(u."Odo value end") ~ '^[0-9]+(\.[0-9]+)?$' then (u."Odo value end")::numeric end,
   exists (select 1 from vehicle_fleet f where btrim(f.asset_no)=upper(btrim(u."Asset name")) and f.country='UAE'),
   'telematics'
from uae_kms u where nullif(btrim(u."Asset name"),'') is not null
on conflict (organisation_id, country, asset_no, captured_at) do nothing;
