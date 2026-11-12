-- Local stand-ins for what a hosted Supabase project provides out of the box.
-- LOCAL POSTGRES ONLY. Never run this file against a hosted Supabase project: there the real
-- auth, storage, cron, net and vault schemas already exist.
-- Every object here is a STUB. The list is repeated in supabase/staging/README.md.

-- ---------------------------------------------------------------- roles
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated','service_role','authenticator','supabase_admin',
                           'supabase_auth_admin','supabase_storage_admin','dashboard_user'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I', r);
    end if;
  end loop;
end $$;
alter role anon nologin noinherit;
alter role authenticated nologin noinherit;
alter role service_role nologin noinherit bypassrls;
alter role authenticator login noinherit;
alter role supabase_admin superuser bypassrls;
alter role postgres bypassrls;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

-- ---------------------------------------------------------------- schemas
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists cron;
create schema if not exists net;
create schema if not exists vault;
create schema if not exists _bak;
grant usage on schema extensions to public;
grant usage on schema auth, storage to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter database :DBNAME set search_path = "$user", public, extensions;
set search_path = "$user", public, extensions;

-- ---------------------------------------------------------------- real extensions available on PG16
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists vector with schema public;   -- apt package postgresql-16-pgvector

-- ---------------------------------------------------------------- STUB: pg_stat_statements (needs preload)
create table if not exists extensions.pg_stat_statements (
  userid oid, dbid oid, queryid bigint, query text, calls bigint, total_exec_time double precision,
  mean_exec_time double precision, rows bigint, shared_blks_hit bigint, shared_blks_read bigint,
  stats_since timestamptz);
create table if not exists extensions.pg_stat_statements_info (dealloc bigint, stats_reset timestamptz);
create or replace function extensions.pg_stat_statements_reset() returns void language sql as 'select';

-- ---------------------------------------------------------------- STUB: auth (GoTrue)
create table if not exists auth.users (
  instance_id uuid default '00000000-0000-0000-0000-000000000000',
  id uuid primary key default gen_random_uuid(),
  aud text default 'authenticated',
  role text default 'authenticated',
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token text default '',
  recovery_token text default '',
  email_change_token_new text default '',
  email_change text default '',
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  is_super_admin boolean,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  phone text,
  phone_confirmed_at timestamptz,
  banned_until timestamptz,
  deleted_at timestamptz,
  is_sso_user boolean not null default false,
  is_anonymous boolean not null default false
);
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  email text generated always as (lower(identity_data->>'email')) stored,
  unique (provider_id, provider)
);
create table if not exists auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  factor_id uuid, aal text, not_after timestamptz, refreshed_at timestamp, user_agent text, ip inet, tag text);
create table if not exists auth.refresh_tokens (
  id bigserial primary key, token text, user_id text, revoked boolean, parent text, session_id uuid,
  created_at timestamptz default now(), updated_at timestamptz default now(), instance_id uuid);
create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friendly_name text, factor_type text, status text, created_at timestamptz default now(),
  updated_at timestamptz default now(), secret text, phone text, last_challenged_at timestamptz);
create table if not exists auth.audit_log_entries (
  instance_id uuid, id uuid primary key default gen_random_uuid(), payload json,
  created_at timestamptz default now(), ip_address varchar(64) default '');
create table if not exists auth.sso_providers (
  id uuid primary key default gen_random_uuid(), resource_id text, created_at timestamptz, updated_at timestamptz, disabled boolean);
create table if not exists auth.sso_domains (
  id uuid primary key default gen_random_uuid(), sso_provider_id uuid references auth.sso_providers(id) on delete cascade,
  domain text, created_at timestamptz, updated_at timestamptz);

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
create or replace function auth.email() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.email', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'))::text
$$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on all tables in schema auth to service_role;

-- ---------------------------------------------------------------- STUB: storage
create table if not exists storage.buckets (
  id text primary key, name text not null unique, owner uuid, created_at timestamptz default now(),
  updated_at timestamptz default now(), public boolean default false, avif_autodetection boolean default false,
  file_size_limit bigint, allowed_mime_types text[], owner_id text);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(), metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text, owner_id text, user_metadata jsonb,
  unique (bucket_id, name));
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1 : greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$$;
create or replace function storage.filename(name text) returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;
create or replace function storage.extension(name text) returns text language sql immutable as $$
  select reverse(split_part(reverse(storage.filename(name)), '.', 1))
$$;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
grant execute on all functions in schema storage to anon, authenticated, service_role;

-- ---------------------------------------------------------------- STUB: pg_cron (records, never runs)
create table if not exists cron.job (
  jobid bigserial primary key, schedule text not null, command text not null, nodename text default 'localhost',
  nodeport int default 5432, database text default current_database(), username text default current_user,
  active boolean default true, jobname text unique);
create table if not exists cron.job_run_details (
  jobid bigint, runid bigserial primary key, job_pid int, database text, username text, command text,
  status text, return_message text, start_time timestamptz, end_time timestamptz);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint
language plpgsql as $$
declare v bigint;
begin
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid into v;
  return v;
end $$;
create or replace function cron.unschedule(job_name text) returns boolean language plpgsql as $$
begin delete from cron.job where jobname = job_name; return found; end $$;
create or replace function cron.unschedule(job_id bigint) returns boolean language plpgsql as $$
begin delete from cron.job where jobid = job_id; return found; end $$;
create or replace function cron.alter_job(job_id bigint, schedule text default null, command text default null,
  database text default null, username text default null, active boolean default null) returns void
language plpgsql as $$
begin
  update cron.job j set schedule = coalesce(alter_job.schedule, j.schedule),
    command = coalesce(alter_job.command, j.command), active = coalesce(alter_job.active, j.active)
  where j.jobid = job_id;
end $$;

-- ---------------------------------------------------------------- STUB: pg_net (records, never sends)
create table if not exists net._stub_requests (
  id bigserial primary key, url text, body jsonb, params jsonb, headers jsonb, created timestamptz default now());
create table if not exists net._http_response (
  id bigint, status_code int, content_type text, headers jsonb, content text, timed_out boolean,
  error_msg text, created timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds int default 5000)
returns bigint language plpgsql security definer as $$
declare v bigint;
begin
  insert into net._stub_requests (url, body, params, headers) values (url, body, params, headers - 'Authorization' - 'apikey')
  returning id into v;
  return v;
end $$;
grant usage on schema net to anon, authenticated, service_role;
grant execute on all functions in schema net to anon, authenticated, service_role;

-- ---------------------------------------------------------------- STUB: vault (always empty)
create table if not exists vault.decrypted_secrets (
  id uuid, name text, description text, secret text, decrypted_secret text, key_id uuid, nonce bytea,
  created_at timestamptz, updated_at timestamptz);

-- ---------------------------------------------------------------- STUB: realtime publication
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ---------------------------------------------------------------- STUB: one _bak table a function names
create table if not exists _bak.cron_run_details_20261011 (like cron.job_run_details);
