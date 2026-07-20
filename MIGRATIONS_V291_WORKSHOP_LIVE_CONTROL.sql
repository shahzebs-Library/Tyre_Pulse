-- V291: Workshop Live Control foundation (applied live via Supabase MCP).
-- Core append-only technician activity log + job tasks + assignments + attendance,
-- so productive / blocked / unassigned time is computed from real events with
-- backend timestamps. Org + country + site RLS; technicians write their OWN
-- events, elevated roles (app_is_elevated) manage. See src/lib/workshopLive.js
-- for the pure engine that consumes these tables. Next free migration V292.
--
-- Tables: wo_tasks, wo_assignments, tech_activity_events, workshop_attendance
-- work_orders += est_minutes, assigned_owner_id, qc_status, vor, vor_since
--
-- (Full statement text lives in the Supabase migration history under the name
-- v291_workshop_live_control; this file is the repo-tracked copy.)

create table if not exists public.wo_tasks (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country text, site text,
  job_id uuid not null references public.work_orders(id) on delete cascade,
  seq int not null default 1,
  title text not null,
  skill text,
  est_minutes numeric,
  status text not null default 'pending' check (status in ('pending','in_progress','blocked','done','qc')),
  assignee_user_id uuid references public.profiles(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wo_assignments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country text, site text,
  job_id uuid not null references public.work_orders(id) on delete cascade,
  task_id uuid references public.wo_tasks(id) on delete set null,
  user_id uuid not null references public.profiles(id),
  role text not null default 'primary' check (role in ('primary','helper')),
  active boolean not null default true,
  assigned_by uuid default auth.uid(),
  assigned_at timestamptz not null default now(),
  released_at timestamptz
);

create table if not exists public.tech_activity_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country text, site text,
  user_id uuid not null references public.profiles(id),
  job_id uuid references public.work_orders(id) on delete set null,
  task_id uuid references public.wo_tasks(id) on delete set null,
  asset_no text,
  event_type text not null check (event_type in (
    'check_in','check_out','start_job','pause_job','resume_job','complete_task',
    'request_parts','request_assistance','waiting_approval','waiting_vehicle',
    'waiting_tools','start_break','end_break','training','report_problem')),
  reason_code text, note text, device text,
  gps_lat numeric, gps_lng numeric,
  foreman_confirmed boolean not null default false, confirmed_by uuid,
  at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table if not exists public.workshop_attendance (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country text, site text,
  user_id uuid not null references public.profiles(id),
  shift_id uuid references public.shifts(id) on delete set null,
  check_in timestamptz, check_out timestamptz, source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.work_orders
  add column if not exists est_minutes numeric,
  add column if not exists assigned_owner_id uuid references public.profiles(id),
  add column if not exists qc_status text,
  add column if not exists vor boolean not null default false,
  add column if not exists vor_since timestamptz;

-- RLS: org (restrictive all) + country/site (restrictive select) + member select
-- + elevated write, applied to all four tables; tech_activity_events adds
-- own-visibility + self-insert; workshop_attendance adds self check-in. See the
-- applied migration for the exact policy set.
