-- =============================================================================
-- Report PDF cache: bulk download limit (server side) and retention of superseded copies.
-- STATUS: AUTHORED, NOT APPLIED. Depends on 20261117090000_report_pdf_cache.sql.
-- Does not depend on 20261117091000 (auto-queue) and nothing else depends on it.
-- Tested only on the local staging copy (supabase/tests/staging/report_pdf_cache_tests.sh)
-- and against a locally built Supabase Storage API (e2e/pdf-storage).
--
-- OWNER DECISIONS IMPLEMENTED HERE (2026-11-15)
--   * Bulk download limit is configurable, starting at 50: per company in
--     report_pdf_settings.bulk_limit, else system_config pdf_bulk_limit, else 50.
--     pdf_cache_bulk_request ENFORCES it and answers only for records the caller is
--     authorised to see (organisation, country, site, active account). A Tyre Man gets
--     exactly the reports of his own scope; the rest are counted as refused, not named.
--   * Superseded copies are kept for a configurable time, never less than 90 days.
--     Approved revisions are NEVER purged: the table constraint and the trigger in
--     file 1 refuse it, and this job never selects them.
--
-- HOW A PURGE HAPPENS (no paid service, no service key)
--   1. pdf_cache_retention_run() (pg_cron, daily) only MARKS working copies whose time
--      is up: purge_due_at. It removes nothing. SQL cannot remove a storage object.
--   2. An administrator's browser, in the background, removes the marked objects through
--      the Storage API. The storage policy below allows that for marked, non-approved
--      objects of the administrator's own company only.
--   3. pdf_cache_purge_confirm() records the purge after checking the object is gone.
--      The row stays as the audit record (who generated it, sha256, when it was purged).
--   If no administrator opens the app, marked files simply stay stored. Nothing is lost.
--
-- WHAT IT ADDS
--   public.report_pdf_bulk_requests        append-only log of bulk download requests
--   public.pdf_cache_bulk_request(type, ids)   limit + authorised subset
--   public.pdf_cache_retention_run(n)      marks due working copies (cron / service only)
--   public.pdf_cache_purge_list(n)         marked files of the caller's company (administrator)
--   public.pdf_cache_purge_confirm(id)     record a purge after the object is gone
--   storage.objects policy report_pdfs_purge (removal of marked, non-approved objects)
--   pg_cron job report-pdf-retention (only when pg_cron is installed)
--
-- VERIFY (rolled back)
--   begin;
--   \i supabase/pending_migrations/20261117093000_report_pdf_retention_bulk.sql
--   select has_function_privilege('authenticated','public.pdf_cache_retention_run(integer)','execute');  -- f
--   select has_function_privilege('anon','public.pdf_cache_bulk_request(text,uuid[])','execute');        -- f
--   select public.pdf_cache_retention_run(10);   -- {"ok":true,"marked":0,...} on a fresh database
--   rollback;
--
-- ROLLBACK (by hand; the only place removal statements appear as statements)
--   select cron.unschedule('report-pdf-retention');
--   drop policy if exists report_pdfs_purge on storage.objects;
--   drop function if exists public.pdf_cache_purge_confirm(uuid);
--   drop function if exists public.pdf_cache_purge_list(integer);
--   drop function if exists public.pdf_cache_retention_run(integer);
--   drop function if exists public.pdf_cache_bulk_request(text,uuid[]);
--   drop function if exists public.pdf_cache_source_scope(text,uuid);
--   drop table if exists public.report_pdf_bulk_requests;
--   Stopping only the schedule (first line) is enough to stop any new marking.
-- =============================================================================

-- ----------------------------------------------------------------------------- bulk requests
create table if not exists public.report_pdf_bulk_requests (
  id              bigint generated always as identity primary key,
  organisation_id uuid not null,
  actor           uuid,
  report_type     text not null,
  requested       integer not null,
  allowed         integer not null,
  bulk_limit      integer not null,
  outcome         text not null check (outcome in ('accepted','over_limit')),
  created_at      timestamptz not null default now()
);
create index if not exists report_pdf_bulk_requests_org on public.report_pdf_bulk_requests (organisation_id, created_at desc);
alter table public.report_pdf_bulk_requests enable row level security;
drop policy if exists report_pdf_bulk_requests_org on public.report_pdf_bulk_requests;
create policy report_pdf_bulk_requests_org on public.report_pdf_bulk_requests as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
drop policy if exists report_pdf_bulk_requests_read on public.report_pdf_bulk_requests;
create policy report_pdf_bulk_requests_read on public.report_pdf_bulk_requests for select to authenticated
  using ((select public.app_is_active()) and (select public.app_is_elevated()));
revoke all on public.report_pdf_bulk_requests from anon;
revoke all on public.report_pdf_bulk_requests from authenticated;
grant select on public.report_pdf_bulk_requests to authenticated;

-- INTERNAL: organisation, country and site of a source record, without hashing it.
create or replace function public.pdf_cache_source_scope(p_type text, p_source uuid)
returns table (organisation_id uuid, country text, site text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_type in ('tyre_inspection','tyre_observation') then
    return query select i.organisation_id, i.country::text, i.site::text from public.inspections i where i.id = p_source;
  elsif p_type = 'corrective_action' then
    return query select a.organisation_id, a.country::text, a.site::text from public.corrective_actions a where a.id = p_source;
  elsif p_type = 'maintenance_job_card' then
    return query select w.organisation_id, w.country::text, w.site::text from public.work_orders w where w.id = p_source;
  end if;
end $$;
revoke execute on function public.pdf_cache_source_scope(text,uuid) from public;
revoke execute on function public.pdf_cache_source_scope(text,uuid) from anon;
revoke execute on function public.pdf_cache_source_scope(text,uuid) from authenticated;

-- Ask before a bulk download. Refuses a request above the company's limit, and returns
-- only the ids the caller is authorised to see. Ids outside the caller's scope and ids
-- that do not exist are counted together as "refused" so the call is not an existence test.
create or replace function public.pdf_cache_bulk_request(p_type text, p_sources uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid := public.app_current_org();
  v_limit integer;
  v_ids uuid[];
  v_allowed uuid[];
  v_n integer;
begin
  if auth.uid() is null or v_org is null or not coalesce(public.app_is_active(), false)
     or coalesce(anum_integration.is_reader(), false) then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if p_type is null or p_type not in ('tyre_inspection','tyre_observation','corrective_action','maintenance_job_card') then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  select e.bulk_limit into v_limit from public.pdf_cache_effective_settings(v_org) e;
  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_ids from unnest(coalesce(p_sources, '{}'::uuid[])) x where x is not null;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then return jsonb_build_object('ok', false, 'reason', 'bad_request'); end if;
  if v_n > v_limit then
    insert into public.report_pdf_bulk_requests (organisation_id, actor, report_type, requested, allowed, bulk_limit, outcome)
    values (v_org, auth.uid(), p_type, v_n, 0, v_limit, 'over_limit');
    return jsonb_build_object('ok', false, 'reason', 'over_limit', 'limit', v_limit, 'requested', v_n);
  end if;
  select coalesce(array_agg(x order by x), '{}'::uuid[]) into v_allowed
    from unnest(v_ids) x
   where exists (select 1 from public.pdf_cache_source_scope(p_type, x) s
                  where public.pdf_cache_can_see(s.organisation_id, s.country, s.site));
  insert into public.report_pdf_bulk_requests (organisation_id, actor, report_type, requested, allowed, bulk_limit, outcome)
  values (v_org, auth.uid(), p_type, v_n, coalesce(array_length(v_allowed, 1), 0), v_limit, 'accepted');
  return jsonb_build_object('ok', true, 'limit', v_limit, 'requested', v_n,
    'allowed', to_jsonb(v_allowed), 'refused', v_n - coalesce(array_length(v_allowed, 1), 0));
end $$;

-- ----------------------------------------------------------------------------- retention
-- Marks working copies whose retention time is up. Removes nothing. Never selects an
-- approved revision (immutable or made from an approved source), or a current copy.
create or replace function public.pdf_cache_retention_run(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_marked integer := 0;
  v_companies integer := 0;
  o record;
  n integer;
begin
  -- cron and the service role only: a signed-in person can never start it
  if auth.uid() is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  for o in select distinct f.organisation_id from public.report_pdf_files f
            where f.purge_due_at is null and f.purged_at is null and not f.immutable and not f.source_approved
              and (f.superseded_at is not null or f.status = 'failed')
  loop
    with due as (
      select f.id from public.report_pdf_files f,
             lateral public.pdf_cache_effective_settings(o.organisation_id) e
       where f.organisation_id = o.organisation_id
         and f.purge_due_at is null and f.purged_at is null
         and not f.immutable and not f.source_approved
         and ((f.status = 'ready' and f.superseded_at is not null
               and f.superseded_at < now() - make_interval(days => greatest(90, e.retention_days)))
           or (f.status = 'failed'
               and f.updated_at < now() - make_interval(days => greatest(90, e.retention_days))))
       order by coalesce(f.superseded_at, f.updated_at)
       limit greatest(1, least(coalesce(p_limit, 500), 5000))
       for update of f skip locked),
    upd as (
      update public.report_pdf_files f set purge_due_at = now() from due where f.id = due.id
      returning f.id, f.organisation_id, f.country, f.site, f.report_type, f.source_id, f.generation, f.superseded_at)
    , ev as (
      insert into public.report_pdf_events (organisation_id, country, site, file_id, report_type, source_id, event, actor, detail)
      select u.organisation_id, u.country, u.site, u.id, u.report_type, u.source_id, 'purge_due', null,
             jsonb_build_object('generation', u.generation, 'superseded_at', u.superseded_at) from upd u
      returning 1)
    select count(*) into n from ev;
    if n > 0 then v_marked := v_marked + n; v_companies := v_companies + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'marked', v_marked, 'companies', v_companies);
end $$;

-- Marked files of the caller's own company. Administrator only.
create or replace function public.pdf_cache_purge_list(p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_org uuid := public.app_current_org();
begin
  if auth.uid() is null or v_org is null or not coalesce(public.app_is_active(), false)
     or not coalesce(public.app_is_org_admin(), false) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'bucket', f.storage_bucket, 'path', f.storage_path) order by f.purge_due_at)
      from (select * from public.report_pdf_files r
             where r.organisation_id = v_org and r.purge_due_at is not null and r.purged_at is null
               and not r.immutable and not r.source_approved
             order by r.purge_due_at limit greatest(1, least(coalesce(p_limit, 20), 100))) f), '[]'::jsonb);
end $$;

-- Record a purge. Only after the stored object is really gone.
create or replace function public.pdf_cache_purge_confirm(p_file uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare f public.report_pdf_files%rowtype;
begin
  if auth.uid() is null or not coalesce(public.app_is_active(), false) or not coalesce(public.app_is_org_admin(), false) then
    return jsonb_build_object('ok', false, 'reason', 'admin_only');
  end if;
  select * into f from public.report_pdf_files r where r.id = p_file for update;
  if not found or (f.organisation_id is distinct from public.app_current_org() and not coalesce(public.is_super_admin(), false)) then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if f.immutable or f.source_approved then return jsonb_build_object('ok', false, 'reason', 'approved_never_purged'); end if;
  if f.purged_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  if f.purge_due_at is null then return jsonb_build_object('ok', false, 'reason', 'not_due'); end if;
  if exists (select 1 from storage.objects so where so.bucket_id = f.storage_bucket and so.name = f.storage_path) then
    return jsonb_build_object('ok', false, 'reason', 'object_still_present');
  end if;
  update public.report_pdf_files set purged_at = now() where id = f.id;
  insert into public.report_pdf_events (organisation_id, country, site, file_id, report_type, source_id, event, actor, detail)
  values (f.organisation_id, f.country, f.site, f.id, f.report_type, f.source_id, 'purged', auth.uid(),
          jsonb_build_object('generation', f.generation, 'sha256', f.sha256, 'bytes', f.bytes, 'purge_due_at', f.purge_due_at));
  return jsonb_build_object('ok', true);
end $$;

-- Removal of a stored object: only one that retention marked, never an approved one,
-- only by an administrator of the same company.
drop policy if exists report_pdfs_purge on storage.objects;
create policy report_pdfs_purge on storage.objects for delete to authenticated
  using (bucket_id = 'report-pdfs' and (select public.app_is_org_admin()) and exists (
    select 1 from public.report_pdf_files f
     where f.storage_path = objects.name and f.purge_due_at is not null and f.purged_at is null
       and not f.immutable and not f.source_approved
       and (f.organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))));

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.pdf_cache_bulk_request(text,uuid[])',
    'public.pdf_cache_purge_list(integer)',
    'public.pdf_cache_purge_confirm(uuid)'] loop
    execute format('revoke execute on function %s from public', fn);
    execute format('revoke execute on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
  revoke execute on function public.pdf_cache_retention_run(integer) from public;
  revoke execute on function public.pdf_cache_retention_run(integer) from anon;
  revoke execute on function public.pdf_cache_retention_run(integer) from authenticated;
  grant execute on function public.pdf_cache_retention_run(integer) to service_role;
end $$;

-- Daily, 01:23 UTC. Only where pg_cron exists (it does in production; not on PGlite).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('report-pdf-retention', '23 1 * * *', 'select public.pdf_cache_retention_run(500)');
  end if;
end $$;

comment on table public.report_pdf_bulk_requests is
  'Append-only log of bulk PDF download requests (who, how many asked, how many allowed, the limit in force).';

select anum_integration.apply_reader_policies();
