-- Additive AI tyre evidence and authoritative physical measurement model.
-- Not activated by this migration: background processing requires a separately deployed worker.
create table if not exists public.ai_tyre_inspection_jobs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  tyre_position text not null,
  photo_ref text not null,
  photo_sha256 text not null,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','review_required')),
  attempts integer not null default 0 check (attempts >= 0),
  analysis jsonb,
  model_version text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id,inspection_id,tyre_position,photo_sha256)
);
create index if not exists ai_tyre_jobs_pending_idx on public.ai_tyre_inspection_jobs(status,created_at);
alter table public.ai_tyre_inspection_jobs enable row level security;
-- No client access by default; a privileged backend must validate tenant ownership before any operation.
revoke all on public.ai_tyre_inspection_jobs from anon, authenticated;

create table if not exists public.ai_tyre_depth_measurements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  tyre_position text not null,
  tyre_serial text,
  original_mm numeric(6,2),
  minimum_mm numeric(6,2),
  inner_mm numeric(6,2),
  center_mm numeric(6,2),
  outer_mm numeric(6,2),
  source text not null check (source in ('manual_gauge','digital_gauge','calibrated_device')),
  odometer_km numeric(12,1),
  measured_at timestamptz not null,
  recorded_by uuid,
  created_at timestamptz not null default now(),
  check(original_mm is null or original_mm > 0),
  check(minimum_mm is null or minimum_mm >= 0),
  check(inner_mm is null or inner_mm >= 0),
  check(center_mm is null or center_mm >= 0),
  check(outer_mm is null or outer_mm >= 0)
);
create index if not exists ai_tyre_depth_inspection_idx on public.ai_tyre_depth_measurements(organisation_id,inspection_id,tyre_position,measured_at desc);
alter table public.ai_tyre_depth_measurements enable row level security;
revoke all on public.ai_tyre_depth_measurements from anon, authenticated;
