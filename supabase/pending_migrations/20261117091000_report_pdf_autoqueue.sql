-- =============================================================================
-- Report PDF auto-queue: remember that an inspection needs its PDF prepared.
-- STATUS: AUTHORED, NOT APPLIED. Depends on 20261117090000_report_pdf_cache.sql.
-- Tested only on the local staging copy tp_pdf.
--
-- WHY A QUEUE AND NOT A SERVER RENDER. The approved inspection PDF is drawn in a
-- browser from the rendered page. The database cannot draw it. So when an inspection
-- is completed or approved (on web, phone or by import) a trigger only RECORDS that a
-- PDF is wanted. The next authorised person whose browser opens the inspections page
-- picks the request up, generates the file in the background and stores it. Fully
-- unattended generation needs a headless renderer (see docs/pdf/PDF_ARCHITECTURE_AUDIT.md).
--
-- WHAT IT ADDS
--   public.report_pdf_queue             one open request per organisation, type and source
--   trigger report_pdf_autoqueue_trg    AFTER INSERT OR UPDATE on public.inspections
--                                       (reads the row, never changes it, never raises)
--   public.pdf_cache_pending(type, n)   open requests the caller may serve
--   create or replace of pdf_cache_complete is NOT needed: requests are closed lazily
--   by pdf_cache_pending / pdf_cache_queue_done.
--
-- The trigger does NOT modify public.inspections and cannot block a save: every
-- statement in it is inside an exception handler.
--
-- VERIFY (rolled back)
--   begin;
--   update public.inspections set approval_status = 'approved' where id = '<a pending synthetic row>';
--   select count(*) from public.report_pdf_queue;   -- 1
--   rollback;
--
-- ROLLBACK (by hand)
--   drop trigger if exists report_pdf_autoqueue_trg on public.inspections;
--   drop function if exists public.report_pdf_autoqueue();
--   drop function if exists public.pdf_cache_pending(text,integer);
--   drop function if exists public.pdf_cache_queue_done(text,uuid);
--   drop table if exists public.report_pdf_queue;
-- =============================================================================

create table if not exists public.report_pdf_queue (
  id              bigint generated always as identity primary key,
  organisation_id uuid not null,
  country         text,
  site            text,
  report_type     text not null check (report_type in ('tyre_inspection','tyre_observation')),
  source_id       uuid not null,
  reason          text not null check (reason in ('completed','approved','changed')),
  requested_at    timestamptz not null default now(),
  done_at         timestamptz
);
create unique index if not exists report_pdf_queue_open
  on public.report_pdf_queue (organisation_id, report_type, source_id) where done_at is null;
create index if not exists report_pdf_queue_scan
  on public.report_pdf_queue (organisation_id, report_type, requested_at) where done_at is null;

alter table public.report_pdf_queue enable row level security;
drop policy if exists report_pdf_queue_org on public.report_pdf_queue;
create policy report_pdf_queue_org on public.report_pdf_queue as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
drop policy if exists report_pdf_queue_country on public.report_pdf_queue;
create policy report_pdf_queue_country on public.report_pdf_queue as restrictive for select to authenticated
  using (country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries())
         or lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[])));
drop policy if exists report_pdf_queue_site on public.report_pdf_queue;
create policy report_pdf_queue_site on public.report_pdf_queue as restrictive for select to authenticated
  using (site is null or btrim(site) = '' or (select public.app_sees_all_sites())
         or upper(btrim(site)) = any (coalesce((select public.app_site_scope()), '{}'::text[])));
drop policy if exists report_pdf_queue_read on public.report_pdf_queue;
create policy report_pdf_queue_read on public.report_pdf_queue for select to authenticated
  using ((select public.app_is_active()));
revoke all on public.report_pdf_queue from anon;
revoke all on public.report_pdf_queue from authenticated;
grant select on public.report_pdf_queue to authenticated;

create or replace function public.report_pdf_autoqueue()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
begin
  begin
    if lower(coalesce(new.approval_status, '')) = 'approved'
       and (tg_op = 'INSERT' or lower(coalesce(old.approval_status, '')) <> 'approved') then
      v_reason := 'approved';
    elsif coalesce(new.status, '') in ('Done', 'Completed')
       and (tg_op = 'INSERT' or coalesce(old.status, '') not in ('Done', 'Completed')) then
      v_reason := 'completed';
    end if;
    if v_reason is not null and new.organisation_id is not null then
      insert into public.report_pdf_queue (organisation_id, country, site, report_type, source_id, reason)
      values (new.organisation_id, new.country, new.site, 'tyre_inspection', new.id, v_reason)
      on conflict (organisation_id, report_type, source_id) where done_at is null
      do update set reason = excluded.reason, requested_at = now();
    end if;
  exception when others then
    null;   -- a PDF request must never stop an inspection from saving
  end;
  return null;
end $$;
revoke execute on function public.report_pdf_autoqueue() from public;
revoke execute on function public.report_pdf_autoqueue() from anon;
revoke execute on function public.report_pdf_autoqueue() from authenticated;

-- Plain AFTER INSERT OR UPDATE (not UPDATE OF): the status columns are also set by
-- BEFORE triggers, and a column changed by a BEFORE trigger is not in the statement's list.
create or replace trigger report_pdf_autoqueue_trg
  after insert or update on public.inspections
  for each row execute function public.report_pdf_autoqueue();

-- Open requests the caller may serve, oldest first. A request whose current PDF is
-- already stored, being generated, backing off or failed is skipped.
create or replace function public.pdf_cache_pending(p_type text default 'tyre_inspection', p_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('source_id', q.source_id, 'reason', q.reason, 'requested_at', q.requested_at)
                            order by q.requested_at), '[]'::jsonb)
    into v
    from (
      select q.source_id, q.reason, q.requested_at
        from public.report_pdf_queue q
       where q.done_at is null and q.report_type = p_type
         and public.pdf_cache_can_see(q.organisation_id, q.country, q.site)
         and not exists (
           select 1 from public.report_pdf_files f
            where f.organisation_id = q.organisation_id and f.report_type = q.report_type
              and f.source_id = q.source_id and f.superseded_at is null
              and f.created_at >= q.requested_at - interval '1 minute'
              and (f.status in ('ready', 'failed', 'retry_scheduled')
                   or (f.status = 'processing' and f.lease_expires_at > now())))
       order by q.requested_at
       limit greatest(1, least(coalesce(p_limit, 5), 20))) q;
  return v;
end $$;

-- Close the request once the caller has stored (or found) the current PDF.
create or replace function public.pdf_cache_queue_done(p_type text, p_source uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  update public.report_pdf_queue q set done_at = now()
   where q.done_at is null and q.report_type = p_type and q.source_id = p_source
     and public.pdf_cache_can_see(q.organisation_id, q.country, q.site)
     and exists (select 1 from public.report_pdf_files f
                  where f.organisation_id = q.organisation_id and f.report_type = q.report_type
                    and f.source_id = q.source_id and f.status = 'ready' and f.superseded_at is null);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'closed', n);
end $$;

revoke execute on function public.pdf_cache_pending(text,integer) from public;
revoke execute on function public.pdf_cache_pending(text,integer) from anon;
grant execute on function public.pdf_cache_pending(text,integer) to authenticated, service_role;
revoke execute on function public.pdf_cache_queue_done(text,uuid) from public;
revoke execute on function public.pdf_cache_queue_done(text,uuid) from anon;
grant execute on function public.pdf_cache_queue_done(text,uuid) to authenticated, service_role;

select anum_integration.apply_reader_policies();
