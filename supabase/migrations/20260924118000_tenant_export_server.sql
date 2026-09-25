-- =============================================================================
-- 20260924118000_tenant_export_server.sql
-- Tenant Data Export, SERVER path: a full, untruncated dump of one organisation
-- written by the `tenant-export` edge function into a private Storage bucket.
--
-- STATUS: APPLIED LIVE 2026-09-25 via Supabase MCP (project jhssdmeruxtrlqnwfksc) as two
--         migrations: tenant_export_server + tenant_export_server_ndjson.
--
-- WHY: the browser export (20260924114000) pages every row into the tab and has
-- a ceiling, so the four biggest tables (parts_consumption, work_order_line_items,
-- work_orders, production_logs) come out truncated. The server path pages the
-- same 37-table safelist (_tenant_export_tables(), unchanged, the ONE list) with
-- keyset paging on id and writes gzip NDJSON part files to
--   tenant-exports/<org_id>/<job_id>/<table>/part-0001.ndjson.gz
-- plus <org_id>/<job_id>/manifest.json. Nothing is held in the browser.
--
-- WHAT IT ADDS
--   * tenant_export_jobs: mode (browser|server), progress jsonb, files jsonb,
--     error, started_at, updated_at, token_hash. Status gains 'running'.
--     token_hash is sha256 of a per-job continuation token the edge function
--     uses to chain its own time-boxed invocations (it is never the token).
--   * Storage bucket `tenant-exports`: PRIVATE, 50 MB per object, super-admin
--     SELECT policy only. Writes happen with the service role inside the edge
--     function; there is no client INSERT/UPDATE/DELETE policy.
--   * admin_tenant_export_server_start(p_org, p_reason, p_tables)
--       creates the running job + console_sessions audit 'tenant_export_server'.
--       Refuses a second running server job for the same org (unless the first
--       has not moved for 30 minutes, which is treated as stalled and failed).
--   * admin_tenant_export_download_log(p_job)
--       super admin only; audits 'tenant_export_download' and returns the file
--       list the edge function then signs (short expiry). A signed URL is never
--       minted without this audit row.
--   All: SECURITY DEFINER, search_path=public, 42501 for non super admins,
--   EXECUTE revoked from PUBLIC then anon, granted to authenticated.
--
-- VERIFIED LIVE 2026-09-25:
--   * RPCs as the real super admin (rolled back): start -> {job_id, tables:[sites,work_orders]}
--     + 1 console_sessions 'tenant_export_server'; second start for the same org 55P03;
--     a non-safelisted table 22023; download_log on a running job 55P03; a non super
--     admin 42501 and SELECT 0 rows. anon EXECUTE false on both; authenticated cannot
--     read token_hash; bucket public=false, 50 MB.
--   * Storage policy: super admin sees the objects, an approved non super admin sees 0.
--   * Edge fn `tenant-export` (v2): no JWT 401, invalid JWT 401, bad continuation
--     token 401, download without JWT 401.
--   * Real worker runs (job rows inserted directly, tagged 'System verification ...'):
--     sites/budgets/sany_invoices 67/12/4 rows = manifest counts, status completed,
--     3 parts + manifest.json. work_orders: v1 (rows parsed in Deno) hit the edge
--     "CPU Time exceeded" after 40,000 rows and stalled; v2 (NDJSON built in Postgres)
--     RESUMED that same job from its saved cursor, chained 3 more slices (~9 s each)
--     and finished 93,727 of 93,727 rows, status completed.
--
-- VERIFY (rolled back):
--   begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub','d2d43a5f-0906-4f7a-9577-e36d89164914','role','authenticated')::text, true);
--   set local role authenticated;
--   select public.admin_tenant_export_server_start('00000000-0000-0000-0000-000000000001','verify server export', array['sites']);
--     -> {job_id, tables:["sites"]}; 1 console_sessions row action tenant_export_server
--   select public.admin_tenant_export_server_start('00000000-0000-0000-0000-000000000001','verify again', null); -> 55P03 (already running)
--   select public.admin_tenant_export_server_start('00000000-0000-0000-0000-000000000001','verify', array['profiles']); -> 22023
--   rollback;
--   select public, file_size_limit from storage.buckets where id='tenant-exports';  -- false, 52428800
--   select has_function_privilege('anon','public.admin_tenant_export_server_start(uuid,text,text[])','EXECUTE'); -- false
--   -- a non super admin: both RPCs raise 42501.
--
-- ROLLBACK:
--   drop function if exists public._tenant_export_ndjson(uuid,text,uuid,int);
--   drop function if exists public.admin_tenant_export_download_log(uuid);
--   drop function if exists public.admin_tenant_export_server_start(uuid,text,text[]);
--   drop policy if exists tenant_exports_super_select on storage.objects;
--   -- empty the bucket first (Storage API), then:
--   delete from storage.buckets where id = 'tenant-exports';
--   alter table public.tenant_export_jobs drop constraint tenant_export_jobs_status_check;
--   alter table public.tenant_export_jobs add constraint tenant_export_jobs_status_check
--     check (status in ('completed','partial','failed'));   -- after deleting 'running' rows
--   alter table public.tenant_export_jobs drop column if exists mode, drop column if exists progress,
--     drop column if exists files, drop column if exists error, drop column if exists started_at,
--     drop column if exists updated_at, drop column if exists token_hash;
-- =============================================================================

alter table public.tenant_export_jobs
  add column if not exists mode        text not null default 'browser',
  add column if not exists progress    jsonb not null default '{}'::jsonb,
  add column if not exists files       jsonb not null default '[]'::jsonb,
  add column if not exists error       text,
  add column if not exists started_at  timestamptz,
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists token_hash  text;

alter table public.tenant_export_jobs drop constraint if exists tenant_export_jobs_mode_check;
alter table public.tenant_export_jobs add constraint tenant_export_jobs_mode_check
  check (mode in ('browser','server'));

alter table public.tenant_export_jobs drop constraint if exists tenant_export_jobs_status_check;
alter table public.tenant_export_jobs add constraint tenant_export_jobs_status_check
  check (status in ('running','completed','partial','failed'));

create index if not exists tenant_export_jobs_running_idx
  on public.tenant_export_jobs (org_id) where status = 'running';

-- The token hash is internal plumbing; super admins read the job, not the hash.
revoke select on public.tenant_export_jobs from authenticated;
grant select (id, org_id, requested_by, reason, tables, status, row_counts, created_at, completed_at,
              mode, progress, files, error, started_at, updated_at)
  on public.tenant_export_jobs to authenticated;

-- ---------------------------------------------------------------------------
-- Private bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('tenant-exports', 'tenant-exports', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists tenant_exports_super_select on storage.objects;
create policy tenant_exports_super_select on storage.objects
  for select to authenticated
  using (bucket_id = 'tenant-exports' and (select public.is_super_admin()));

-- ---------------------------------------------------------------------------
-- Start a server job
-- ---------------------------------------------------------------------------
create or replace function public.admin_tenant_export_server_start(
  p_org uuid, p_reason text, p_tables text[] default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_safe    text[] := public._tenant_export_tables();
  v_tables  text[];
  v_bad     text[];
  v_id      uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can export tenant data' using errcode = '42501';
  end if;
  if p_org is null or not exists (select 1 from public.organisations where id = p_org) then
    raise exception 'Organisation not found' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'A reason of at least 5 characters is required' using errcode = '22023';
  end if;

  if p_tables is null or cardinality(p_tables) = 0 then
    v_tables := v_safe;
  else
    select array_agg(t) into v_bad from unnest(p_tables) t where not (t = any (v_safe));
    if v_bad is not null then
      raise exception 'That table cannot be exported' using errcode = '22023';
    end if;
    -- keep the safelist's own order, drop duplicates
    select array_agg(s order by ord) into v_tables
      from unnest(v_safe) with ordinality as u(s, ord)
     where s = any (p_tables);
  end if;

  -- A job that has not moved for 30 minutes is stalled: fail it honestly.
  update public.tenant_export_jobs
     set status = 'failed', error = coalesce(error, 'Stalled: no progress for 30 minutes'),
         completed_at = now(), updated_at = now()
   where org_id = p_org and mode = 'server' and status = 'running'
     and updated_at < now() - interval '30 minutes';

  if exists (select 1 from public.tenant_export_jobs
              where org_id = p_org and mode = 'server' and status = 'running') then
    raise exception 'A server export for this organisation is already running' using errcode = '55P03';
  end if;

  insert into public.tenant_export_jobs
    (org_id, requested_by, reason, tables, status, mode, row_counts, progress, started_at, updated_at)
  values
    (p_org, v_uid, btrim(p_reason), to_jsonb(v_tables), 'running', 'server', '{}'::jsonb,
     jsonb_build_object('idx', 0, 'after', null, 'part', 0, 'table_rows', 0, 'errors', '{}'::jsonb,
                        'expected', '{}'::jsonb, 'invocations', 0),
     now(), now())
  returning id into v_id;

  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (v_uid, 'tenant_export_server', p_org, 'organisation',
          jsonb_build_object('job_id', v_id, 'reason', btrim(p_reason), 'tables', to_jsonb(v_tables)));

  return jsonb_build_object('job_id', v_id, 'tables', to_jsonb(v_tables));
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit a download (the edge function signs only what this returns)
-- ---------------------------------------------------------------------------
create or replace function public.admin_tenant_export_download_log(p_job uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_job public.tenant_export_jobs%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can download tenant data' using errcode = '42501';
  end if;
  select * into v_job from public.tenant_export_jobs where id = p_job;
  if not found or v_job.mode <> 'server' then
    raise exception 'Export job not found' using errcode = 'P0002';
  end if;
  if v_job.status = 'running' then
    raise exception 'That export is still running' using errcode = '55P03';
  end if;
  if jsonb_array_length(coalesce(v_job.files, '[]'::jsonb)) = 0 then
    raise exception 'That export produced no files' using errcode = '22023';
  end if;

  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (v_uid, 'tenant_export_download', v_job.org_id, 'organisation',
          jsonb_build_object('job_id', v_job.id, 'files', jsonb_array_length(v_job.files),
                             'status', v_job.status));

  return jsonb_build_object('job_id', v_job.id, 'org_id', v_job.org_id, 'status', v_job.status,
                            'files', v_job.files);
end;
$$;

grant execute on function public.admin_tenant_export_server_start(uuid,text,text[]) to authenticated;
grant execute on function public.admin_tenant_export_download_log(uuid) to authenticated;
revoke execute on function public.admin_tenant_export_server_start(uuid,text,text[]) from public;
revoke execute on function public.admin_tenant_export_download_log(uuid) from public;
revoke execute on function public.admin_tenant_export_server_start(uuid,text,text[]) from anon;
revoke execute on function public.admin_tenant_export_download_log(uuid) from anon;

-- ---------------------------------------------------------------------------
-- Server-side NDJSON page (service_role ONLY). Postgres builds the NDJSON text
-- so the edge function does no per-row JSON parse/stringify: the first live run
-- that parsed rows in Deno hit the edge runtime's CPU-time limit after 40,000
-- work_orders rows. Not granted to authenticated: it has no super-admin gate of
-- its own and is reachable only with the service role inside `tenant-export`.
-- (applied as migration tenant_export_server_ndjson)
-- ---------------------------------------------------------------------------
create or replace function public._tenant_export_ndjson(
  p_org uuid, p_table text, p_after uuid default null, p_limit int default 5000
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 5000), 1), 10000);
  v_body text; v_n int; v_last uuid;
begin
  if p_org is null or p_table is null or not (p_table = any (public._tenant_export_tables())) then
    raise exception 'That table cannot be exported' using errcode = '22023';
  end if;
  execute format(
    'select coalesce(string_agg(to_jsonb(x)::text, E''\n'' order by x.id), ''''), count(*)::int, '
    || '(array_agg(x.id order by x.id desc))[1] '
    || 'from (select * from public.%I t where t.organisation_id = $1 '
    || 'and ($2::uuid is null or t.id > $2) order by t.id limit $3) x', p_table)
  into v_body, v_n, v_last using p_org, p_after, v_limit;
  return jsonb_build_object('body', v_body, 'n', v_n, 'last', v_last, 'done', v_n < v_limit);
end;
$$;
revoke all on function public._tenant_export_ndjson(uuid,text,uuid,int) from public;
revoke all on function public._tenant_export_ndjson(uuid,text,uuid,int) from anon;
revoke all on function public._tenant_export_ndjson(uuid,text,uuid,int) from authenticated;
grant execute on function public._tenant_export_ndjson(uuid,text,uuid,int) to service_role;
