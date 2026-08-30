-- V610 - Durable, tenant-scoped ERP connector reliability ledger.
-- Not applied by this change. Apply after review, then deploy supabase/functions/erp-sync.
-- Secrets never belong in these tables: credential_ref is only a Deno secret name.

create table if not exists public.erp_connections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  system text not null check (system in ('sap','oracle','odoo','dynamics','sage','custom')),
  base_url text not null check (base_url ~ '^https://'),
  auth_type text not null check (auth_type in ('api_key','bearer','basic','oauth2')),
  credential_ref text not null check (credential_ref ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  entities text[] not null check (
    cardinality(entities) > 0 and entities <@ array['tyre','fleet','stock','workorder','supplier']::text[]
  ),
  frequency text not null check (frequency in ('manual','hourly','daily','weekly')),
  enabled boolean not null default false,
  owner_user_id uuid references auth.users(id),
  next_run_at timestamptz,
  last_success_at timestamptz,
  last_reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, name)
);

create table if not exists public.erp_sync_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.erp_connections(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('scheduled','manual','replay')),
  idempotency_key text not null,
  status text not null default 'queued' check (status in ('queued','running','succeeded','partial','failed','cancelled')),
  attempt integer not null default 0 check (attempt between 0 and 5),
  source_count bigint not null default 0,
  staged_count bigint not null default 0,
  rejected_count bigint not null default 0,
  duplicate_count bigint not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  heartbeat_at timestamptz,
  error_code text,
  error_summary text check (char_length(error_summary) <= 500),
  requested_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (connection_id, idempotency_key)
);

create table if not exists public.erp_sync_items (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.erp_sync_runs(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  entity text not null,
  source_id text not null,
  source_version text not null default '',
  idempotency_key text not null,
  payload_fingerprint text not null,
  status text not null default 'staged' check (status in ('staged','validated','rejected','duplicate','committed')),
  staging_record_id uuid,
  validation_errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (organisation_id, idempotency_key)
);

create table if not exists public.erp_sync_dead_letters (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.erp_sync_runs(id) on delete cascade,
  connection_id uuid not null references public.erp_connections(id) on delete cascade,
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  entity text,
  source_id text,
  attempt integer not null check (attempt between 1 and 5),
  error_code text,
  error_summary text not null check (char_length(error_summary) <= 500),
  replay_status text not null default 'pending' check (replay_status in ('pending','queued','resolved','discarded')),
  replayed_run_id uuid references public.erp_sync_runs(id),
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists erp_connections_due_idx on public.erp_connections (next_run_at) where enabled;
create index if not exists erp_runs_connection_created_idx on public.erp_sync_runs (connection_id, created_at desc);
create index if not exists erp_runs_active_idx on public.erp_sync_runs (status, heartbeat_at) where status in ('queued','running');
create index if not exists erp_dead_letters_pending_idx on public.erp_sync_dead_letters (connection_id, last_failed_at) where replay_status = 'pending';

alter table public.erp_connections enable row level security;
alter table public.erp_sync_runs enable row level security;
alter table public.erp_sync_items enable row level security;
alter table public.erp_sync_dead_letters enable row level security;

-- Operators can observe their tenant. Writes are service-role only so clients cannot
-- forge success, reconciliation, retry, or dead-letter evidence.
drop policy if exists erp_connections_read on public.erp_connections;
drop policy if exists erp_runs_read on public.erp_sync_runs;
drop policy if exists erp_items_read on public.erp_sync_items;
drop policy if exists erp_dead_letters_read on public.erp_sync_dead_letters;
create policy erp_connections_read on public.erp_connections for select to authenticated
  using (public.app_is_active() and organisation_id = public.app_current_org());
create policy erp_runs_read on public.erp_sync_runs for select to authenticated
  using (public.app_is_active() and organisation_id = public.app_current_org());
create policy erp_items_read on public.erp_sync_items for select to authenticated
  using (public.app_is_active() and organisation_id = public.app_current_org());
create policy erp_dead_letters_read on public.erp_sync_dead_letters for select to authenticated
  using (public.app_is_active() and organisation_id = public.app_current_org());

revoke all on public.erp_connections, public.erp_sync_runs, public.erp_sync_items, public.erp_sync_dead_letters from anon;
grant select on public.erp_connections, public.erp_sync_runs, public.erp_sync_items, public.erp_sync_dead_letters to authenticated;

comment on column public.erp_connections.credential_ref is
  'Name of a server-side Edge Function secret. Never store the secret value here.';
comment on table public.erp_sync_dead_letters is
  'Terminal/exhausted ERP failures. Replay changes state but preserves the original failure evidence.';
