-- Owner decision 2026-09-29: rotation schedules and tyre specifications get real columns.
--
-- PART A. tyre_rotations: rotation type, positions, technician, attachments, completion.
--   Before this, the web form packed type/positions/technician into `notes` as one header line
--   ("Rotation: X | From: a, b | To: c, d | Technician: name"). The backfill below lifts any such
--   line into the new columns and strips it from notes. Table held 0 rows when this was written.
--
-- PART B. tyre_spec_catalog: a real brand/pattern/size catalogue with approval status, plus an
--   append-only approval history. This is SEPARATE from tyre_specifications, which stays what it
--   always was: fitment RULES per vehicle type + position (approved sizes/brands, min ratings).
--   Images and documents are storage refs in the existing org-scoped `tyre-photos` bucket.
--
-- Security: same shape as tyre_rotations / tyre_specifications (RESTRICTIVE org + country
-- isolation, approved-user insert/update, elevated delete). Only Admin/Manager/Director (or a
-- super admin) may change approval_status; a trigger enforces it and logs every change.
--
-- Rollback:
--   drop table if exists public.tyre_spec_catalog_events; drop table if exists public.tyre_spec_catalog;
--   drop function if exists public.tyre_spec_catalog_guard();
--   alter table public.tyre_rotations drop column if exists rotation_type, drop column if exists from_positions,
--     drop column if exists to_positions, drop column if exists technician_id, drop column if exists technician_name,
--     drop column if exists attachments, drop column if exists completed_at, drop column if exists completed_km;

-- ── PART A ──────────────────────────────────────────────────────────────────────────────────
alter table public.tyre_rotations
  add column if not exists rotation_type   text,
  add column if not exists from_positions  text[] not null default '{}',
  add column if not exists to_positions    text[] not null default '{}',
  add column if not exists technician_id   uuid references public.profiles(id) on delete set null,
  add column if not exists technician_name text,
  add column if not exists attachments     jsonb  not null default '[]'::jsonb,
  add column if not exists completed_at    timestamptz,
  add column if not exists completed_km    numeric;

alter table public.tyre_rotations drop constraint if exists tyre_rotations_rotation_type_chk;
alter table public.tyre_rotations add constraint tyre_rotations_rotation_type_chk
  check (rotation_type is null or rotation_type in ('standard','cross','side_to_side','x_pattern','custom'));
alter table public.tyre_rotations drop constraint if exists tyre_rotations_attachments_chk;
alter table public.tyre_rotations add constraint tyre_rotations_attachments_chk
  check (jsonb_typeof(attachments) = 'array');

create index if not exists tyre_rotations_technician_idx on public.tyre_rotations (technician_id);

-- Backfill from the interim notes header line, if any row carries one.
with parsed as (
  select id,
         split_part(notes, E'\n', 1) as head,
         nullif(btrim(substr(notes, length(split_part(notes, E'\n', 1)) + 2)), '') as rest
    from public.tyre_rotations
   where notes like 'Rotation:%'
)
update public.tyre_rotations r set
  rotation_type = case lower(btrim(substring(p.head from 'Rotation:\s*([^|]+)')))
                    when 'standard' then 'standard' when 'cross' then 'cross'
                    when 'side to side' then 'side_to_side' when 'x pattern' then 'x_pattern'
                    when 'custom' then 'custom' else null end,
  from_positions  = coalesce(string_to_array(regexp_replace(btrim(substring(p.head from 'From:\s*([^|]+)')), '\s*,\s*', ',', 'g'), ','), '{}'),
  to_positions    = coalesce(string_to_array(regexp_replace(btrim(substring(p.head from 'To:\s*([^|]+)')), '\s*,\s*', ',', 'g'), ','), '{}'),
  technician_name = nullif(btrim(substring(p.head from 'Technician:\s*([^|]+)')), ''),
  notes           = p.rest
from parsed p where r.id = p.id;

-- ── PART B ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.tyre_spec_catalog (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid default public.app_current_org(),
  country             text,
  brand               text not null,
  pattern             text not null,
  size                text not null,              -- canonical e.g. 295/80R22.5
  width_mm            numeric,
  aspect_ratio        numeric,
  rim_in              numeric,
  tyre_type           text,                       -- steer/drive/trailer/off_road/other
  load_index_single   integer,
  load_index_dual     integer,
  speed_rating        text,
  ply_rating          text,
  tube_type           text,                       -- tubeless/tube
  application         text,
  description         text,
  tread_depth_new_mm  numeric,
  tread_depth_min_mm  numeric,
  overall_diameter_mm numeric,
  section_width_mm    numeric,
  recommended_rim     text,
  max_load_single_kg  numeric,
  max_load_dual_kg    numeric,
  inflation_single_kpa numeric,
  inflation_dual_kpa  numeric,
  weight_kg           numeric,
  suitable_for        text[] not null default '{}',
  images              jsonb not null default '[]'::jsonb,
  documents           jsonb not null default '[]'::jsonb,
  approval_status     text not null default 'pending',
  approved_by         uuid references public.profiles(id) on delete set null,
  approved_at         timestamptz,
  approval_note       text,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint tyre_spec_catalog_status_chk check (approval_status in ('approved','pending','not_approved')),
  constraint tyre_spec_catalog_type_chk check (tyre_type is null or tyre_type in ('steer','drive','trailer','off_road','other')),
  constraint tyre_spec_catalog_tube_chk check (tube_type is null or tube_type in ('tubeless','tube')),
  constraint tyre_spec_catalog_images_chk check (jsonb_typeof(images) = 'array' and jsonb_typeof(documents) = 'array'),
  constraint tyre_spec_catalog_positive_chk check (
    coalesce(load_index_single,0) >= 0 and coalesce(load_index_dual,0) >= 0
    and coalesce(tread_depth_new_mm,0) >= 0 and coalesce(tread_depth_min_mm,0) >= 0
    and coalesce(weight_kg,0) >= 0)
);

create unique index if not exists tyre_spec_catalog_uniq
  on public.tyre_spec_catalog (organisation_id, coalesce(country,''), upper(btrim(brand)), upper(btrim(pattern)), upper(regexp_replace(size,'\s','','g')));
create index if not exists tyre_spec_catalog_org_country_idx on public.tyre_spec_catalog (organisation_id, country);
create index if not exists tyre_spec_catalog_status_idx on public.tyre_spec_catalog (organisation_id, approval_status);

create table if not exists public.tyre_spec_catalog_events (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid,
  spec_id         uuid not null references public.tyre_spec_catalog(id) on delete cascade,
  action          text not null,                  -- created / status_changed / edited
  from_status     text,
  to_status       text,
  note            text,
  actor_id        uuid,
  actor_name      text,
  at              timestamptz not null default now()
);
create index if not exists tyre_spec_catalog_events_spec_idx on public.tyre_spec_catalog_events (spec_id, at desc);

-- Guard + history: only elevated users (or super admin) may set/alter approval; stamp approver; log.
create or replace function public.tyre_spec_catalog_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_elevated boolean := coalesce(public.is_super_admin(), false) or coalesce(public.app_is_elevated(), false);
  v_name text;
begin
  new.updated_at := now();
  new.size := upper(regexp_replace(new.size, '\s', '', 'g'));
  select full_name into v_name from public.profiles where id = auth.uid();

  if tg_op = 'INSERT' then
    if new.approval_status <> 'pending' and not v_elevated then
      raise exception 'Only a manager can approve a specification' using errcode = '42501';
    end if;
    if new.approval_status <> 'pending' then
      new.approved_by := auth.uid(); new.approved_at := now();
    else
      new.approved_by := null; new.approved_at := null;
    end if;
  elsif new.approval_status is distinct from old.approval_status then
    if not v_elevated then
      raise exception 'Only a manager can change approval status' using errcode = '42501';
    end if;
    new.approved_by := case when new.approval_status = 'pending' then null else auth.uid() end;
    new.approved_at := case when new.approval_status = 'pending' then null else now() end;
  else
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  end if;
  return new;
end $$;

create or replace function public.tyre_spec_catalog_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select full_name into v_name from public.profiles where id = auth.uid();
  if tg_op = 'INSERT' then
    insert into public.tyre_spec_catalog_events (organisation_id, spec_id, action, to_status, note, actor_id, actor_name)
    values (new.organisation_id, new.id, 'created', new.approval_status, new.approval_note, auth.uid(), v_name);
  elsif new.approval_status is distinct from old.approval_status then
    insert into public.tyre_spec_catalog_events (organisation_id, spec_id, action, from_status, to_status, note, actor_id, actor_name)
    values (new.organisation_id, new.id, 'status_changed', old.approval_status, new.approval_status, new.approval_note, auth.uid(), v_name);
  else
    insert into public.tyre_spec_catalog_events (organisation_id, spec_id, action, to_status, actor_id, actor_name)
    values (new.organisation_id, new.id, 'edited', new.approval_status, auth.uid(), v_name);
  end if;
  return null;
end $$;

drop trigger if exists trg_tyre_spec_catalog_guard on public.tyre_spec_catalog;
create trigger trg_tyre_spec_catalog_guard before insert or update on public.tyre_spec_catalog
  for each row execute function public.tyre_spec_catalog_guard();
drop trigger if exists trg_tyre_spec_catalog_log on public.tyre_spec_catalog;
create trigger trg_tyre_spec_catalog_log after insert or update on public.tyre_spec_catalog
  for each row execute function public.tyre_spec_catalog_log();

revoke all on function public.tyre_spec_catalog_guard() from public, anon, authenticated;
revoke all on function public.tyre_spec_catalog_log() from public, anon, authenticated;

-- RLS: catalogue
alter table public.tyre_spec_catalog enable row level security;
revoke all on public.tyre_spec_catalog from anon;
grant select, insert, update, delete on public.tyre_spec_catalog to authenticated;

create policy tyre_spec_catalog_org_isolation on public.tyre_spec_catalog as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));
create policy tyre_spec_catalog_country_write on public.tyre_spec_catalog as restrictive for all to authenticated
  using ((country is null) or (select public.is_super_admin()) or (select public.app_sees_all_countries())
         or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))))
  with check ((country is null) or (select public.is_super_admin()) or (select public.app_sees_all_countries())
         or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))));
create policy tyre_spec_catalog_read on public.tyre_spec_catalog for select to authenticated
  using ((select public.app_is_active()));
create policy tyre_spec_catalog_insert on public.tyre_spec_catalog for insert to authenticated
  with check ((select public.is_approved_and_unlocked()));
create policy tyre_spec_catalog_update on public.tyre_spec_catalog for update to authenticated
  using ((select public.is_approved_and_unlocked())) with check ((select public.is_approved_and_unlocked()));
create policy tyre_spec_catalog_delete on public.tyre_spec_catalog for delete to authenticated
  using ((select public.app_is_elevated()) or (select public.is_super_admin()));

-- RLS: history (read-only to users; written by the definer trigger)
alter table public.tyre_spec_catalog_events enable row level security;
revoke all on public.tyre_spec_catalog_events from anon;
revoke insert, update, delete on public.tyre_spec_catalog_events from authenticated;
grant select on public.tyre_spec_catalog_events to authenticated;
create policy tyre_spec_catalog_events_read on public.tyre_spec_catalog_events for select to authenticated
  using (((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
         and (select public.app_is_active()));
