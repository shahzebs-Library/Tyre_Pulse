-- =============================================================================
-- Report PDF cache: generate once, store privately, reuse.
-- STATUS: AUTHORED, NOT APPLIED. Tested only on the local staging copy tp_pdf
--         (supabase/tests/staging/report_pdf_cache_tests.sh) and, for the pure
--         hashing functions, on PGlite (supabase/tests/report_pdf_cache_key.test.mjs).
--
-- WHAT IT ADDS (nothing existing is altered, no existing row is rewritten)
--   storage bucket  report-pdfs (private, application/pdf only, 25 MB per file)
--   public.report_pdf_files    one row per stored PDF revision (and per generation job)
--   public.report_pdf_events   append-only audit of generation and download events
--   pure functions  pdf_canonical_json, pdf_sha256_hex, pdf_cache_compose_key
--                   (SQL mirror of src/lib/pdfCache/cacheKey.js, pinned by
--                    src/test/fixtures/pdfCacheKeyCases.json)
--   RPCs            pdf_cache_lookup, pdf_cache_claim, pdf_cache_heartbeat,
--                   pdf_cache_complete, pdf_cache_fail, pdf_cache_regenerate,
--                   pdf_cache_record_download
--   storage.objects policies for the bucket (read / upload only through a row the
--                   caller is authorised for)
--
-- DESIGN NOTES
--   * The approved inspection PDF is drawn in the browser from the rendered page, so
--     rendering stays in the browser. This migration only stores the finished bytes.
--   * The cache key is computed HERE from the live source row. A client cannot claim
--     that an old file is current: it passes only the template version, the branding
--     revision and a revision of client-derived content.
--   * The inspection key never reads ERP links. The observation key does. So an ERP
--     confirmation makes a new observation revision and leaves the inspection PDF alone.
--   * Access = who may read the SOURCE record (same organisation, country and site
--     scope as public.inspections, active account). Checked inside every definer RPC
--     and again by RLS on the table and on storage.objects.
--   * A row that is `ready` can never have its bytes, hash, path or key changed
--     (trigger). An approved source makes the row `immutable`; "regenerate" creates a
--     NEW generation and keeps the old one as a previous version.
--   * Refusals use errcode PT409 / 42501, never 40001 (PostgREST retries 40001 forever).
--   * The server cannot read storage bytes from SQL, so pdf_cache_complete checks the
--     stored object's size and type against what the client reports and records the
--     sha256; the client verifies the sha256 again on every download.
--
-- VERIFY (inside a transaction that is rolled back; see the staging test for the full set)
--   begin;
--   \i supabase/pending_migrations/20261117090000_report_pdf_cache.sql
--   select count(*) from pg_policies where tablename in ('report_pdf_files','report_pdf_events');   -- 8 + reader policies
--   select has_function_privilege('anon','public.pdf_cache_lookup(text,uuid,text,text,text)','execute');  -- f
--   select public.pdf_sha256_hex('abc');   -- ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
--   rollback;
--
-- ROLLBACK (removal statements; only the objects this file created; run by hand)
--   Stored files, if any, must be removed through the Storage API first.
--   drop policy if exists report_pdfs_read on storage.objects;
--   drop policy if exists report_pdfs_upload on storage.objects;
--   drop policy if exists report_pdfs_reupload on storage.objects;
--   drop function if exists public.pdf_cache_record_download(uuid,text);
--   drop function if exists public.pdf_cache_regenerate(text,uuid,text,text,text,text,text,integer);
--   drop function if exists public.pdf_cache_fail(uuid,text,boolean,boolean);
--   drop function if exists public.pdf_cache_complete(uuid,text,bigint);
--   drop function if exists public.pdf_cache_heartbeat(uuid,integer);
--   drop function if exists public.pdf_cache_claim(text,uuid,text,text,text,text,integer,boolean);
--   drop function if exists public.pdf_cache_lookup(text,uuid,text,text,text);
--   drop function if exists public.pdf_cache_key_for(text,uuid,text,text,text);
--   drop function if exists public.pdf_cache_source(text,uuid);
--   drop function if exists public.pdf_cache_can_see(uuid,text,text);
--   drop function if exists public.pdf_cache_source_visible(text,uuid);
--   drop table if exists public.report_pdf_events;
--   drop table if exists public.report_pdf_files;
--   drop function if exists public.report_pdf_files_guard();
--   drop function if exists public.pdf_cache_compose_key(uuid,text,uuid,text,text,text,text,text);
--   drop function if exists public.pdf_sha256_hex(text);
--   drop function if exists public.pdf_canonical_json(jsonb);
--   delete from storage.buckets where id = 'report-pdfs';
-- This header is the only place the words drop / delete appear as statements; the
-- body below uses create or replace and "drop policy if exists" guards only for the
-- three storage policies it owns (needed so the file can be re-run).
-- =============================================================================

-- >>> PURE FUNCTIONS BEGIN (loaded on their own by the PGlite mirror test)

-- Canonical JSON text: object keys sorted bytewise, no whitespace, numbers without
-- trailing zeros. Mirrors canonicalJson() in src/lib/pdfCache/cacheKey.js.
create or replace function public.pdf_canonical_json(j jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  t text := jsonb_typeof(j);
  out text;
begin
  if j is null or t = 'null' then
    return 'null';
  elsif t = 'object' then
    select coalesce(string_agg(to_json(e.key)::text || ':' || public.pdf_canonical_json(e.value), ',' order by e.key collate "C"), '')
      into out from jsonb_each(j) e;
    return '{' || out || '}';
  elsif t = 'array' then
    select coalesce(string_agg(public.pdf_canonical_json(e.value), ',' order by e.ord), '')
      into out from jsonb_array_elements(j) with ordinality as e(value, ord);
    return '[' || out || ']';
  elsif t = 'number' then
    return trim_scale((j #>> '{}')::numeric)::text;
  elsif t = 'string' then
    return to_json(j #>> '{}')::text;
  else
    return j::text;   -- true / false
  end if;
end $$;

create or replace function public.pdf_sha256_hex(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$ select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex') $$;

-- The key. File names never take part. Mirrors composeCacheKey() in cacheKey.js.
create or replace function public.pdf_cache_compose_key(
  p_org uuid, p_type text, p_source uuid, p_source_hash text, p_evidence_rev text,
  p_template text, p_branding text, p_client_rev text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select public.pdf_sha256_hex(concat_ws('|', 'tp-pdf-v1',
    lower(p_org::text), coalesce(p_type, ''), lower(p_source::text), coalesce(p_source_hash, ''),
    coalesce(p_evidence_rev, ''), coalesce(p_template, ''), coalesce(p_branding, ''), coalesce(p_client_rev, '')))
$$;

-- <<< PURE FUNCTIONS END

revoke execute on function public.pdf_canonical_json(jsonb) from public;
revoke execute on function public.pdf_canonical_json(jsonb) from anon;
revoke execute on function public.pdf_sha256_hex(text) from public;
revoke execute on function public.pdf_sha256_hex(text) from anon;
revoke execute on function public.pdf_cache_compose_key(uuid,text,uuid,text,text,text,text,text) from public;
revoke execute on function public.pdf_cache_compose_key(uuid,text,uuid,text,text,text,text,text) from anon;
grant execute on function public.pdf_canonical_json(jsonb) to authenticated, service_role;
grant execute on function public.pdf_sha256_hex(text) to authenticated, service_role;
grant execute on function public.pdf_cache_compose_key(uuid,text,uuid,text,text,text,text,text) to authenticated, service_role;

-- ----------------------------------------------------------------------------- bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-pdfs', 'report-pdfs', false, 26214400, array['application/pdf'])
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------- tables
create table if not exists public.report_pdf_files (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null,
  country          text,
  site             text,
  report_type      text not null check (report_type in
                     ('tyre_inspection','tyre_observation','corrective_action','maintenance_job_card')),
  source_id        uuid not null,
  cache_key        text not null check (cache_key ~ '^[0-9a-f]{64}$'),
  source_hash      text not null,
  evidence_rev     text not null default '',
  template_version text not null check (length(template_version) between 1 and 60),
  branding_rev     text not null check (length(branding_rev) between 1 and 80),
  client_rev       text not null default '' check (length(client_rev) <= 80),
  generation       integer not null default 1 check (generation between 1 and 1000),
  storage_bucket   text not null default 'report-pdfs' check (storage_bucket = 'report-pdfs'),
  storage_path     text not null unique,
  file_name        text not null check (length(file_name) between 5 and 180),
  bytes            bigint check (bytes is null or (bytes > 0 and bytes <= 26214400)),
  sha256           text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  status           text not null default 'queued' check (status in
                     ('queued','processing','ready','failed','retry_scheduled')),
  lease_owner      uuid,
  lease_expires_at timestamptz,
  attempts         integer not null default 0 check (attempts between 0 and 50),
  max_attempts     integer not null default 5 check (max_attempts between 1 and 10),
  next_retry_at    timestamptz,
  last_error       text,
  source_approved  boolean not null default false,
  immutable        boolean not null default false,
  superseded_at    timestamptz,
  superseded_by    uuid references public.report_pdf_files(id),
  origin           text not null default 'user' check (origin in ('user','auto','bulk','regenerate')),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz,
  constraint report_pdf_files_ready_has_bytes check (status <> 'ready' or (bytes is not null and sha256 is not null))
);
-- one CURRENT row per organisation and key; superseded revisions are kept as history
create unique index if not exists report_pdf_files_current_key
  on public.report_pdf_files (organisation_id, cache_key) where superseded_at is null;
create index if not exists report_pdf_files_source
  on public.report_pdf_files (organisation_id, report_type, source_id, created_at desc);
create index if not exists report_pdf_files_open_jobs
  on public.report_pdf_files (status, next_retry_at) where status in ('queued','processing','retry_scheduled');

create table if not exists public.report_pdf_events (
  id              bigint generated always as identity primary key,
  organisation_id uuid not null,
  country         text,
  site            text,
  file_id         uuid references public.report_pdf_files(id),
  report_type     text not null,
  source_id       uuid not null,
  event           text not null check (event in
                    ('claimed','generated','failed','retry_scheduled','lease_recovered','superseded',
                     'regenerate_requested','downloaded','manual_retry','released')),
  actor           uuid,
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists report_pdf_events_file on public.report_pdf_events (file_id, created_at desc);
create index if not exists report_pdf_events_org_time on public.report_pdf_events (organisation_id, created_at desc);

-- A ready file is frozen. Only the supersede markers may change afterwards.
create or replace function public.report_pdf_files_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.immutable and coalesce(current_setting('pdf_cache.allow_purge', true), '') <> 'on' then
      raise exception 'An approved report revision cannot be removed.' using errcode = 'PT409';
    end if;
    return old;
  end if;
  new.updated_at := now();
  if old.status = 'ready' then
    if new.status is distinct from 'ready'
       or new.sha256 is distinct from old.sha256 or new.bytes is distinct from old.bytes
       or new.storage_path is distinct from old.storage_path or new.cache_key is distinct from old.cache_key
       or new.source_hash is distinct from old.source_hash or new.evidence_rev is distinct from old.evidence_rev
       or new.template_version is distinct from old.template_version or new.branding_rev is distinct from old.branding_rev
       or new.client_rev is distinct from old.client_rev or new.organisation_id is distinct from old.organisation_id
       or new.report_type is distinct from old.report_type or new.source_id is distinct from old.source_id
       or new.generation is distinct from old.generation or new.completed_at is distinct from old.completed_at
       or (old.immutable and not new.immutable) then
      raise exception 'A stored report revision cannot be changed.' using errcode = 'PT409';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.report_pdf_files_guard() from public;
revoke execute on function public.report_pdf_files_guard() from anon;
revoke execute on function public.report_pdf_files_guard() from authenticated;

create or replace trigger report_pdf_files_guard_trg
  before update or delete on public.report_pdf_files
  for each row execute function public.report_pdf_files_guard();

-- ----------------------------------------------------------------------------- access helpers

-- Same scope rules as public.inspections (organisation, country, site, active account).
create or replace function public.pdf_cache_can_see(p_org uuid, p_country text, p_site text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.app_is_active(), false)
     and not coalesce(anum_integration.is_reader(), false)
     and p_org is not null
     and (p_org = public.app_current_org() or coalesce(public.is_super_admin(), false))
     and (p_country is null or coalesce(public.is_super_admin(), false) or coalesce(public.app_sees_all_countries(), false)
          or lower(btrim(p_country)) = any (coalesce(public.app_country_scope(), '{}'::text[])))
     and (p_site is null or btrim(p_site) = '' or coalesce(public.app_sees_all_sites(), false)
          or upper(btrim(p_site)) = any (coalesce(public.app_site_scope(), '{}'::text[])))
$$;
revoke execute on function public.pdf_cache_can_see(uuid,text,text) from public;
revoke execute on function public.pdf_cache_can_see(uuid,text,text) from anon;
revoke execute on function public.pdf_cache_can_see(uuid,text,text) from authenticated;   -- takes an org id: definer RPCs only

-- RLS helper: can the CALLER still read the source record? SECURITY INVOKER on purpose,
-- so the source table's own row level security answers.
create or replace function public.pdf_cache_source_visible(p_type text, p_source uuid)
returns boolean
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if p_type in ('tyre_inspection','tyre_observation') then
    return exists (select 1 from public.inspections i where i.id = p_source);
  elsif p_type = 'corrective_action' then
    return exists (select 1 from public.corrective_actions a where a.id = p_source);
  elsif p_type = 'maintenance_job_card' then
    return exists (select 1 from public.work_orders w where w.id = p_source);
  end if;
  return false;
end $$;
revoke execute on function public.pdf_cache_source_visible(text,uuid) from public;
revoke execute on function public.pdf_cache_source_visible(text,uuid) from anon;
grant execute on function public.pdf_cache_source_visible(text,uuid) to authenticated, service_role;

-- The source record as the PDF sees it. INTERNAL: takes no caller scope, so it is not
-- executable by authenticated; only the definer RPCs below call it.
create or replace function public.pdf_cache_source(p_type text, p_source uuid)
returns table (found boolean, organisation_id uuid, country text, site text, approved boolean,
               source_hash text, evidence_rev text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set timezone = 'UTC'          -- timestamps are hashed as text: the hash must not depend on the session's time zone
as $$
declare
  v_ins public.inspections%rowtype;
  v_doc jsonb;
  v_evidence text := '';
  v_actions jsonb;
  v_erp jsonb := '[]'::jsonb;
  v_ai text := '';
begin
  if p_type in ('tyre_inspection','tyre_observation') then
    select * into v_ins from public.inspections i where i.id = p_source;
    if not found then
      return query select false, null::uuid, null::text, null::text, false, null::text, null::text; return;
    end if;

    -- photo evidence: every tp-storage reference with the stored object's revision
    select coalesce(string_agg(x.ref || '=' || coalesce(o.metadata->>'eTag',
             to_char(o.updated_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS'), 'missing'), '|' order by x.ref), '')
      into v_evidence
      from (select distinct r.ref from (
              select jsonb_path_query(coalesce(v_ins.tyre_conditions, '{}'::jsonb), '$.**.photo_url') #>> '{}' as ref
              union all
              select jsonb_path_query(coalesce(v_ins.tyre_conditions, '{}'::jsonb), '$.**.photo_uri') #>> '{}'
              union all
              select v_ins.photo_data) r
             where r.ref like 'tp-storage://%') x
      left join storage.objects o
        on o.bucket_id = split_part(substr(x.ref, 14), '/', 1)
       and o.name = substr(substr(x.ref, 14), strpos(substr(x.ref, 14), '/') + 1);

    if p_type = 'tyre_inspection' then
      -- every inspection field the approved report prints. NO ERP link state here.
      select jsonb_object_agg(k, to_jsonb(v_ins) -> k) into v_doc
        from unnest(array['id','asset_no','site','country','vehicle_type','inspection_type','title',
          'inspection_date','completed_date','scheduled_date','status','approval_status','approved_at',
          'approved_by','approver_email','approver_signature','inspector','inspector_signature','findings',
          'notes','attendees','severity','odometer_km','hour_meter','pressure_reading','tyre_conditions',
          'photo_data','created_by','document_no']) k;
      -- completed AI photo findings are printed in the report
      select coalesce(count(*)::text || ':' || coalesce(to_char(max(j.updated_at) at time zone 'UTC', 'YYYYMMDDHH24MISSUS'), ''), '')
        into v_ai from public.ai_tyre_inspection_jobs j
       where j.inspection_id = p_source and j.status = 'completed';
      v_evidence := v_evidence || '#ai:' || coalesce(v_ai, '');
    else
      select jsonb_object_agg(k, to_jsonb(v_ins) -> k) into v_doc
        from unnest(array['id','asset_no','site','country','vehicle_type','inspection_type','inspector',
          'inspection_date','completed_date','created_at','status','approval_status','tyre_conditions',
          'findings','notes']) k;
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'status', a.status, 'source_detail', a.source_detail)
                                order by a.id), '[]'::jsonb)
        into v_actions from public.corrective_actions a
       where a.source_type = 'inspection' and a.source_id = p_source;
      -- ERP confirmation evidence belongs to the OBSERVATION document only
      if to_regclass('public.observation_erp_links') is not null then
        execute $q$
          select coalesce(jsonb_agg(jsonb_build_object('action_id', l.action_id, 'source_job_card', l.source_job_card,
                   'reviewed_at', l.reviewed_at, 'reviewed_by', l.reviewed_by,
                   'snapshot_status', l.work_order_snapshot->>'status', 'decision_note', l.decision_note)
                   order by l.action_id), '[]'::jsonb)
            from public.observation_erp_links l
            join public.corrective_actions a on a.id = l.action_id
           where a.source_type = 'inspection' and a.source_id = $1 $q$
          into v_erp using p_source;
      end if;
      v_doc := jsonb_build_object('inspection', v_doc, 'actions', v_actions, 'erp', v_erp);
    end if;

    return query select true, v_ins.organisation_id, v_ins.country, v_ins.site,
      lower(coalesce(v_ins.approval_status, '')) = 'approved',
      public.pdf_sha256_hex(public.pdf_canonical_json(v_doc)), public.pdf_sha256_hex(v_evidence);
    return;

  elsif p_type = 'corrective_action' then
    return query
      select true, a.organisation_id, a.country, a.site, a.status in ('Closed','closed','Verified','verified'),
             public.pdf_sha256_hex(public.pdf_canonical_json(to_jsonb(a))), public.pdf_sha256_hex('')
        from public.corrective_actions a where a.id = p_source;
    if not found then
      return query select false, null::uuid, null::text, null::text, false, null::text, null::text;
    end if;
    return;

  elsif p_type = 'maintenance_job_card' then
    return query
      select true, w.organisation_id, w.country::text, w.site::text, w.status in ('Completed','Closed'),
             public.pdf_sha256_hex(public.pdf_canonical_json(to_jsonb(w))), public.pdf_sha256_hex('')
        from public.work_orders w where w.id = p_source;
    if not found then
      return query select false, null::uuid, null::text, null::text, false, null::text, null::text;
    end if;
    return;
  end if;

  return query select false, null::uuid, null::text, null::text, false, null::text, null::text;
end $$;
revoke execute on function public.pdf_cache_source(text,uuid) from public;
revoke execute on function public.pdf_cache_source(text,uuid) from anon;
revoke execute on function public.pdf_cache_source(text,uuid) from authenticated;

-- ----------------------------------------------------------------------------- RLS
alter table public.report_pdf_files enable row level security;
alter table public.report_pdf_events enable row level security;

drop policy if exists report_pdf_files_org on public.report_pdf_files;
create policy report_pdf_files_org on public.report_pdf_files as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
drop policy if exists report_pdf_files_country on public.report_pdf_files;
create policy report_pdf_files_country on public.report_pdf_files as restrictive for select to authenticated
  using (country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries())
         or lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[])));
drop policy if exists report_pdf_files_site on public.report_pdf_files;
create policy report_pdf_files_site on public.report_pdf_files as restrictive for select to authenticated
  using (site is null or btrim(site) = '' or (select public.app_sees_all_sites())
         or upper(btrim(site)) = any (coalesce((select public.app_site_scope()), '{}'::text[])));
drop policy if exists report_pdf_files_read on public.report_pdf_files;
create policy report_pdf_files_read on public.report_pdf_files for select to authenticated
  using ((select public.app_is_active()) and public.pdf_cache_source_visible(report_type, source_id));
-- no insert / update / delete policy: every write goes through the definer RPCs

drop policy if exists report_pdf_events_org on public.report_pdf_events;
create policy report_pdf_events_org on public.report_pdf_events as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
drop policy if exists report_pdf_events_country on public.report_pdf_events;
create policy report_pdf_events_country on public.report_pdf_events as restrictive for select to authenticated
  using (country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries())
         or lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[])));
drop policy if exists report_pdf_events_site on public.report_pdf_events;
create policy report_pdf_events_site on public.report_pdf_events as restrictive for select to authenticated
  using (site is null or btrim(site) = '' or (select public.app_sees_all_sites())
         or upper(btrim(site)) = any (coalesce((select public.app_site_scope()), '{}'::text[])));
drop policy if exists report_pdf_events_read on public.report_pdf_events;
create policy report_pdf_events_read on public.report_pdf_events for select to authenticated
  using ((select public.app_is_active()) and (select public.app_is_elevated()));

revoke all on public.report_pdf_files from anon;
revoke all on public.report_pdf_files from authenticated;
grant select on public.report_pdf_files to authenticated;
revoke all on public.report_pdf_events from anon;
revoke all on public.report_pdf_events from authenticated;
grant select on public.report_pdf_events to authenticated;

-- ----------------------------------------------------------------------------- storage policies
-- Read: only an object whose row the caller can read (RLS on report_pdf_files applies
-- inside the subquery), and only once it is ready, or while the caller is uploading it.
drop policy if exists report_pdfs_read on storage.objects;
create policy report_pdfs_read on storage.objects for select to authenticated
  using (bucket_id = 'report-pdfs' and exists (
    select 1 from public.report_pdf_files f
     where f.storage_path = objects.name
       and (f.status = 'ready' or (f.status = 'processing' and f.lease_owner = (select auth.uid())))));
-- Upload: only the path of a job the caller holds a live lease on.
drop policy if exists report_pdfs_upload on storage.objects;
create policy report_pdfs_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'report-pdfs' and exists (
    select 1 from public.report_pdf_files f
     where f.storage_path = objects.name and f.status = 'processing'
       and f.lease_owner = (select auth.uid()) and f.lease_expires_at > now()));
-- Re-upload after an interrupted attempt (same job, same path, still not ready).
drop policy if exists report_pdfs_reupload on storage.objects;
create policy report_pdfs_reupload on storage.objects for update to authenticated
  using (bucket_id = 'report-pdfs' and exists (
    select 1 from public.report_pdf_files f
     where f.storage_path = objects.name and f.status = 'processing'
       and f.lease_owner = (select auth.uid()) and f.lease_expires_at > now()))
  with check (bucket_id = 'report-pdfs' and exists (
    select 1 from public.report_pdf_files f
     where f.storage_path = objects.name and f.status = 'processing'
       and f.lease_owner = (select auth.uid()) and f.lease_expires_at > now()));
-- No removal policy: authenticated users can never remove a stored report.

-- ----------------------------------------------------------------------------- RPC internals

create or replace function public.pdf_cache_key_for(
  p_type text, p_source uuid, p_template text, p_branding text, p_client_rev text)
returns table (ok boolean, reason text, organisation_id uuid, country text, site text, approved boolean,
               source_hash text, evidence_rev text, cache_key text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare s record;
begin
  if auth.uid() is null then
    return query select false, 'not_signed_in', null::uuid, null::text, null::text, false, null::text, null::text, null::text; return;
  end if;
  if p_type is null or p_source is null
     or p_type not in ('tyre_inspection','tyre_observation','corrective_action','maintenance_job_card')
     or coalesce(length(p_template), 0) not between 1 and 60
     or coalesce(length(p_branding), 0) not between 1 and 80
     or length(coalesce(p_client_rev, '')) > 80 then
    return query select false, 'bad_request', null::uuid, null::text, null::text, false, null::text, null::text, null::text; return;
  end if;
  select * into s from public.pdf_cache_source(p_type, p_source);
  -- "not found" and "not allowed" answer the same, so the call is not an existence test
  if s is null or not coalesce(s.found, false)
     or not public.pdf_cache_can_see(s.organisation_id, s.country, s.site) then
    return query select false, 'not_available', null::uuid, null::text, null::text, false, null::text, null::text, null::text; return;
  end if;
  return query select true, null::text, s.organisation_id, s.country, s.site, s.approved, s.source_hash, s.evidence_rev,
    public.pdf_cache_compose_key(s.organisation_id, p_type, p_source, s.source_hash, s.evidence_rev,
                                 p_template, p_branding, coalesce(p_client_rev, ''));
end $$;
revoke execute on function public.pdf_cache_key_for(text,uuid,text,text,text) from public;
revoke execute on function public.pdf_cache_key_for(text,uuid,text,text,text) from anon;
revoke execute on function public.pdf_cache_key_for(text,uuid,text,text,text) from authenticated;

-- ----------------------------------------------------------------------------- lookup
create or replace function public.pdf_cache_lookup(
  p_type text, p_source uuid, p_template text, p_branding text, p_client_rev text default '')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  k record;
  f public.report_pdf_files%rowtype;
  prev public.report_pdf_files%rowtype;
  v_state text;
begin
  select * into k from public.pdf_cache_key_for(p_type, p_source, p_template, p_branding, p_client_rev);
  if not k.ok then return jsonb_build_object('ok', false, 'reason', k.reason); end if;

  select * into f from public.report_pdf_files r
   where r.organisation_id = k.organisation_id and r.cache_key = k.cache_key and r.superseded_at is null;
  if found then
    v_state := case
      when f.status = 'processing' and f.lease_expires_at <= now() then 'queued'   -- abandoned: anyone may take it
      else f.status end;
  else
    v_state := 'missing';
  end if;

  if v_state <> 'ready' then
    -- the newest stored revision of the same document, clearly NOT the current one
    select * into prev from public.report_pdf_files r
     where r.organisation_id = k.organisation_id and r.report_type = p_type and r.source_id = p_source
       and r.status = 'ready' and r.cache_key <> k.cache_key
     order by r.completed_at desc limit 1;
  end if;

  return jsonb_build_object('ok', true, 'state', v_state, 'cache_key', k.cache_key,
    'source_approved', k.approved,
    'file', case when f.id is null then null else jsonb_build_object(
      'id', f.id, 'status', f.status, 'bucket', f.storage_bucket, 'path', f.storage_path, 'file_name', f.file_name,
      'bytes', f.bytes, 'sha256', f.sha256, 'generation', f.generation, 'immutable', f.immutable,
      'completed_at', f.completed_at, 'attempts', f.attempts, 'max_attempts', f.max_attempts,
      'next_retry_at', f.next_retry_at, 'lease_expires_at', f.lease_expires_at,
      'mine', f.lease_owner = auth.uid(), 'last_error', f.last_error) end,
    'previous', case when prev.id is null then null else jsonb_build_object(
      'id', prev.id, 'bucket', prev.storage_bucket, 'path', prev.storage_path, 'file_name', prev.file_name,
      'bytes', prev.bytes, 'sha256', prev.sha256, 'completed_at', prev.completed_at,
      'immutable', prev.immutable, 'generation', prev.generation) end);
end $$;

-- ----------------------------------------------------------------------------- claim
-- One generator wins. Everyone else is told to wait. Idempotent for the winner.
create or replace function public.pdf_cache_claim(
  p_type text, p_source uuid, p_template text, p_branding text, p_client_rev text default '',
  p_file_name text default null, p_lease_seconds integer default 180, p_retry boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k record;
  f public.report_pdf_files%rowtype;
  v_lease interval := make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 180), 900)));
  v_name text := left(regexp_replace(coalesce(nullif(btrim(p_file_name), ''), 'Report.pdf'), '[\x00-\x1f/\\]', ' ', 'g'), 180);
  v_event text := 'claimed';
begin
  select * into k from public.pdf_cache_key_for(p_type, p_source, p_template, p_branding, p_client_rev);
  if not k.ok then return jsonb_build_object('ok', false, 'reason', k.reason); end if;
  if v_name !~* '\.pdf$' then v_name := left(v_name, 176) || '.pdf'; end if;

  -- serialise claims for this key: two simultaneous callers cannot both insert
  perform pg_advisory_xact_lock(hashtextextended(k.organisation_id::text || ':' || k.cache_key, 0));

  select * into f from public.report_pdf_files r
   where r.organisation_id = k.organisation_id and r.cache_key = k.cache_key and r.superseded_at is null
   for update;

  if not found then
    insert into public.report_pdf_files (organisation_id, country, site, report_type, source_id, cache_key,
        source_hash, evidence_rev, template_version, branding_rev, client_rev, generation, storage_path, file_name,
        status, lease_owner, lease_expires_at, source_approved, origin, created_by)
    values (k.organisation_id, k.country, k.site, p_type, p_source, k.cache_key,
        k.source_hash, k.evidence_rev, p_template, p_branding, coalesce(p_client_rev, ''), 1,
        k.organisation_id::text || '/' || p_type || '/' || p_source::text || '/' || k.cache_key || '.pdf', v_name,
        'processing', auth.uid(), now() + v_lease, k.approved, 'user', auth.uid())
    returning * into f;
  elsif f.status = 'ready' then
    return jsonb_build_object('ok', true, 'state', 'ready', 'cache_key', k.cache_key, 'file', jsonb_build_object(
      'id', f.id, 'bucket', f.storage_bucket, 'path', f.storage_path, 'file_name', f.file_name, 'bytes', f.bytes,
      'sha256', f.sha256, 'generation', f.generation, 'immutable', f.immutable, 'completed_at', f.completed_at));
  elsif f.status = 'processing' and f.lease_expires_at > now() and f.lease_owner is distinct from auth.uid() then
    return jsonb_build_object('ok', true, 'state', 'processing', 'cache_key', k.cache_key,
      'file_id', f.id, 'lease_expires_at', f.lease_expires_at);
  elsif f.status = 'processing' and f.lease_expires_at > now() then
    update public.report_pdf_files set lease_expires_at = now() + v_lease where id = f.id returning * into f;   -- same owner, again
  elsif f.status = 'processing' then
    -- the previous generator went away: count the lost attempt and take over, within bounds
    if f.attempts + 1 >= f.max_attempts then
      update public.report_pdf_files set status = 'failed', attempts = f.attempts + 1, lease_owner = null,
             lease_expires_at = null, last_error = 'Generation was interrupted too many times.' where id = f.id returning * into f;
      insert into public.report_pdf_events (organisation_id, country, site, file_id, report_type, source_id, event, actor, detail)
      values (f.organisation_id, f.country, f.site, f.id, f.report_type, f.source_id, 'failed', auth.uid(),
              jsonb_build_object('attempts', f.attempts, 'cause', 'lease_expired'));
      return jsonb_build_object('ok', true, 'state', 'failed', 'cache_key', k.cache_key, 'file_id', f.id,
        'attempts', f.attempts, 'max_attempts', f.max_attempts);
    end if;
    update public.report_pdf_files set attempts = f.attempts + 1, lease_owner = auth.uid(),
           lease_expires_at = now() + v_lease, last_error = 'Previous generation did not finish.' where id = f.id returning * into f;
    v_event := 'lease_recovered';
  elsif f.status = 'retry_scheduled' and f.next_retry_at > now() and not coalesce(p_retry, false) then
    return jsonb_build_object('ok', true, 'state', 'retry_scheduled', 'cache_key', k.cache_key, 'file_id', f.id,
      'next_retry_at', f.next_retry_at, 'attempts', f.attempts, 'max_attempts', f.max_attempts);
  elsif f.status = 'failed' and not coalesce(p_retry, false) then
    return jsonb_build_object('ok', true, 'state', 'failed', 'cache_key', k.cache_key, 'file_id', f.id,
      'attempts', f.attempts, 'max_attempts', f.max_attempts, 'last_error', f.last_error);
  else
    -- queued, retry due, or a person pressed Retry (which starts a fresh bounded series)
    if f.status = 'failed' or (f.status = 'retry_scheduled' and f.next_retry_at > now()) then v_event := 'manual_retry'; end if;
    update public.report_pdf_files set status = 'processing', lease_owner = auth.uid(), lease_expires_at = now() + v_lease,
           next_retry_at = null, attempts = case when f.status = 'failed' then 0 else f.attempts end
     where id = f.id returning * into f;
  end if;

  insert into public.report_pdf_events (organisation_id, country, site, file_id, report_type, source_id, event, actor, detail)
  values (f.organisation_id, f.country, f.site, f.id, f.report_type, f.source_id, v_event, auth.uid(),
          jsonb_build_object('attempts', f.attempts, 'generation', f.generation));

  return jsonb_build_object('ok', true, 'state', 'claimed', 'cache_key', k.cache_key, 'file_id', f.id,
    'bucket', f.storage_bucket, 'path', f.storage_path, 'file_name', f.file_name,
    'lease_expires_at', f.lease_expires_at, 'attempts', f.attempts, 'generation', f.generation);
end $$;

-- ----------------------------------------------------------------------------- heartbeat
create or replace function public.pdf_cache_heartbeat(p_file uuid, p_lease_seconds integer default 180)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare f public.report_pdf_files%rowtype;
begin
  update public.report_pdf_files r
     set lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 180), 900)))
   where r.id = p_file and r.status = 'processing' and r.lease_owner = auth.uid()
     and public.pdf_cache_can_see(r.organisation_id, r.country, r.site)
  returning * into f;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_your_job'); end if;
  return jsonb_build_object('ok', true, 'lease_expires_at', f.lease_expires_at);
end $$;

-- ----------------------------------------------------------------------------- complete
create or replace function public.pdf_cache_complete(p_file uuid, p_sha256 text, p_bytes bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  f public.report_pdf_files%rowtype;
  k record;
  o record;
  v_current boolean;
begin
  select * into f from public.report_pdf_files r where r.id = p_file for update;
  if not found or not public.pdf_cache_can_see(f.organisation_id, f.country, f.site) then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if f.status = 'ready' then
    -- a second "complete" can never replace stored bytes
    if f.sha256 = lower(coalesce(p_sha256, '')) and f.bytes = p_bytes then
      return jsonb_build_object('ok', true, 'state', 'ready', 'file_id', f.id, 'already', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'already_stored');
  end if;
  if f.status <> 'processing' or f.lease_owner is distinct from auth.uid() then
    return jsonb_build_object('ok', false, 'reason', 'not_your_job');
  end if;
  if coalesce(p_sha256, '') !~ '^[0-9a-fA-F]{64}$' or p_bytes is null or p_bytes <= 0 or p_bytes > 26214400 then
    return jsonb_build_object('ok', false, 'reason', 'bad_checksum');
  end if;

  -- the uploaded object must exist and match what the client says it sent
  select so.metadata into o from storage.objects so
   where so.bucket_id = f.storage_bucket and so.name = f.storage_path;
  if not found then return jsonb_build_object('ok', false, 'reason', 'file_missing'); end if;
  if (o.metadata ? 'size') and (o.metadata->>'size')::bigint <> p_bytes then
    return jsonb_build_object('ok', false, 'reason', 'size_mismatch');
  end if;
  if (o.metadata ? 'mimetype') and o.metadata->>'mimetype' <> 'application/pdf' then
    return jsonb_build_object('ok', false, 'reason', 'not_a_pdf');
  end if;

  -- is this still the current revision of the source?
  select * into k from public.pdf_cache_key_for(f.report_type, f.source_id, f.template_version, f.branding_rev, f.client_rev);
  v_current := coalesce(k.ok, false) and k.cache_key = f.cache_key;

  update public.report_pdf_files
     set status = 'ready', sha256 = lower(p_sha256), bytes = p_bytes, completed_at = now(),
         lease_owner = null, lease_expires_at = null, next_retry_at = null, last_error = null,
         source_approved = coalesce(k.approved, f.source_approved),
         immutable = v_current and coalesce(k.approved, false),
         superseded_at = case when v_current then null else now() end
   where id = f.id returning * into f;

  if v_current then
    with old as (
      update public.report_pdf_files r set superseded_at = now(), superseded_by = f.id
       where r.organisation_id = f.organisation_id and r.report_type = f.report_type and r.source_id = f.source_id
         and r.id <> f.id and r.superseded_at is null and r.status = 'ready'
      returning r.id, r.country, r.site)
    insert into public.report_pdf_events (organisation_id, country, site, file_id, report_type, source_id, event, actor, detail)
    select f.organisation_id, old.country, old.site, old.id, f.report_type, f.source_id, 'superseded', auth.uid(),
           jsonb_build_object('by', f.id) from old;
  end if;

  insert into public.report_pdf_events (organisation_id, country, site, file_id, report_type, source_id, event, actor, detail)
  values (f.organisation_id, f.country, f.site, f.id, f.report_type, f.source_id, 'generated', auth.uid(),
          jsonb_build_object('bytes', f.bytes, 'sha256', f.sha256, 'generation', f.generation,
                             'current', v_current, 'immutable', f.immutable, 'attempts', f.attempts));

  return jsonb_build_object('ok', true, 'state', 'ready', 'file_id', f.id, 'current', v_current, 'immutable', f.immutable);
end $$;

-- ----------------------------------------------------------------------------- fail
-- Bounded retries: 30 s, 1 min, 2 min, 4 min ... capped at 1 hour; then `failed`.
create or replace function public.pdf_cache_fail(
  p_file uuid, p_error text default null, p_retryable boolean default true, p_count_attempt boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  f public.report_pdf_files%rowtype;
  v_attempts integer;
  v_next timestamptz;
  v_status text;
begin
  select * into f from public.report_pdf_files r where r.id = p_file for update;
  if not found or f.status <> 'processing' or f.lease_owner is distinct from auth.uid()
     or not public.pdf_cache_can_see(f.organisation_id, f.country, f.site) then
    return jsonb_build_object('ok', false, 'reason', 'not_your_job');
  end if;
  v_attempts := f.attempts + case when coalesce(p_count_attempt, true) then 1 else 0 end;
  if not coalesce(p_count_attempt, true) then
    v_status := 'queued'; v_next := null;                       -- released, nothing went wrong server side
  elsif coalesce(p_retryable, true) and v_attempts < f.max_attempts then
    v_status := 'retry_scheduled';
    v_next := now() + least(interval '1 hour', interval '30 seconds' * power(2, greatest(v_attempts - 1, 0)));
  else
    v_status := 'failed'; v_next := null;
  end if;
  update public.report_pdf_files set status = v_status, attempts = v_attempts, next_retry_at = v_next,
         lease_owner = null, lease_expires_at = null, last_error = left(coalesce(p_error, 'Generation failed.'), 300)
   where id = f.id returning * into f;
  insert into public.report_pdf_events (organisation_id, country, site, file_id, report_type, source_id, event, actor, detail)
  values (f.organisation_id, f.country, f.site, f.id, f.report_type, f.source_id,
          case v_status when 'queued' then 'released' when 'failed' then 'failed' else 'retry_scheduled' end, auth.uid(),
          jsonb_build_object('attempts', f.attempts, 'next_retry_at', f.next_retry_at, 'error', f.last_error));
  return jsonb_build_object('ok', true, 'state', f.status, 'attempts', f.attempts, 'max_attempts', f.max_attempts,
    'next_retry_at', f.next_retry_at);
end $$;

-- ----------------------------------------------------------------------------- regenerate
-- Makes a NEW generation. The old file stays stored and listed as a previous version.
-- Managers may regenerate a working copy; an approved (immutable) revision needs an admin and a reason.
create or replace function public.pdf_cache_regenerate(
  p_type text, p_source uuid, p_template text, p_branding text, p_client_rev text default '',
  p_file_name text default null, p_reason text default null, p_lease_seconds integer default 180)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k record;
  f public.report_pdf_files%rowtype;
  n public.report_pdf_files%rowtype;
  v_gen integer;
  v_lease interval := make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 180), 900)));
  v_name text;
  v_had boolean;
begin
  select * into k from public.pdf_cache_key_for(p_type, p_source, p_template, p_branding, p_client_rev);
  if not k.ok then return jsonb_build_object('ok', false, 'reason', k.reason); end if;
  if not coalesce(public.app_is_elevated(), false) and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(k.organisation_id::text || ':' || k.cache_key, 0));
  select * into f from public.report_pdf_files r
   where r.organisation_id = k.organisation_id and r.cache_key = k.cache_key and r.superseded_at is null
   for update;
  v_had := found;

  if v_had and f.status = 'processing' and f.lease_expires_at > now() and f.lease_owner is distinct from auth.uid() then
    return jsonb_build_object('ok', true, 'state', 'processing', 'file_id', f.id, 'lease_expires_at', f.lease_expires_at);
  end if;
  if v_had and f.immutable then
    if not coalesce(public.app_is_org_admin(), false) and not coalesce(public.is_super_admin(), false) then
      return jsonb_build_object('ok', false, 'reason', 'approved_needs_admin');
    end if;
    if length(btrim(coalesce(p_reason, ''))) < 5 then
      return jsonb_build_object('ok', false, 'reason', 'reason_required');
    end if;
  end if;

  select coalesce(max(r.generation), 0) + 1 into v_gen from public.report_pdf_files r
   where r.organisation_id = k.organisation_id and r.cache_key = k.cache_key;
  v_name := left(regexp_replace(coalesce(nullif(btrim(p_file_name), ''), f.file_name, 'Report.pdf'), '[\x00-\x1f/\\]', ' ', 'g'), 180);
  if v_name !~* '\.pdf$' then v_name := left(v_name, 176) || '.pdf'; end if;

  if v_had then
    if f.status = 'ready' then
      update public.report_pdf_files set superseded_at = now() where id = f.id;       -- kept, not removed
    else
      -- an unfinished job for this key: close it so the new generation is the only current row
      update public.report_pdf_files set status = 'failed', superseded_at = now(), lease_owner = null,
             lease_expires_at = null, next_retry_at = null, last_error = 'Replaced by a regenerate request.' where id = f.id;
    end if;
  end if;

  insert into public.report_pdf_files (organisation_id, country, site, report_type, source_id, cache_key,
      source_hash, evidence_rev, template_version, branding_rev, client_rev, generation, storage_path, file_name,
      status, lease_owner, lease_expires_at, source_approved, origin, created_by)
  values (k.organisation_id, k.country, k.site, p_type, p_source, k.cache_key,
      k.source_hash, k.evidence_rev, p_template, p_branding, coalesce(p_client_rev, ''), v_gen,
      k.organisation_id::text || '/' || p_type || '/' || p_source::text || '/' || k.cache_key
        || case when v_gen > 1 then '.g' || v_gen::text else '' end || '.pdf', v_name,
      'processing', auth.uid(), now() + v_lease, k.approved, 'regenerate', auth.uid())
  returning * into n;

  if v_had and f.status = 'ready' then
    update public.report_pdf_files set superseded_by = n.id where id = f.id;
  end if;

  insert into public.report_pdf_events (organisation_id, country, site, file_id, report_type, source_id, event, actor, detail)
  values (n.organisation_id, n.country, n.site, n.id, n.report_type, n.source_id, 'regenerate_requested', auth.uid(),
          jsonb_build_object('generation', n.generation, 'replaces', f.id, 'was_immutable', coalesce(f.immutable, false),
                             'reason', left(coalesce(p_reason, ''), 300)));

  return jsonb_build_object('ok', true, 'state', 'claimed', 'cache_key', k.cache_key, 'file_id', n.id,
    'bucket', n.storage_bucket, 'path', n.storage_path, 'file_name', n.file_name,
    'lease_expires_at', n.lease_expires_at, 'attempts', n.attempts, 'generation', n.generation);
end $$;

-- ----------------------------------------------------------------------------- download audit
create or replace function public.pdf_cache_record_download(p_file uuid, p_via text default 'single')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare f public.report_pdf_files%rowtype;
begin
  select * into f from public.report_pdf_files r where r.id = p_file and r.status = 'ready';
  if not found or not public.pdf_cache_can_see(f.organisation_id, f.country, f.site)
     or not public.pdf_cache_source_visible(f.report_type, f.source_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  insert into public.report_pdf_events (organisation_id, country, site, file_id, report_type, source_id, event, actor, detail)
  values (f.organisation_id, f.country, f.site, f.id, f.report_type, f.source_id, 'downloaded', auth.uid(),
          jsonb_build_object('via', left(coalesce(p_via, 'single'), 20), 'generation', f.generation,
                             'current', f.superseded_at is null));
  return jsonb_build_object('ok', true);
end $$;

-- grants: revoke from PUBLIC, then anon, then grant the callers
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.pdf_cache_lookup(text,uuid,text,text,text)',
    'public.pdf_cache_claim(text,uuid,text,text,text,text,integer,boolean)',
    'public.pdf_cache_heartbeat(uuid,integer)',
    'public.pdf_cache_complete(uuid,text,bigint)',
    'public.pdf_cache_fail(uuid,text,boolean,boolean)',
    'public.pdf_cache_regenerate(text,uuid,text,text,text,text,text,integer)',
    'public.pdf_cache_record_download(uuid,text)'] loop
    execute format('revoke execute on function %s from public', fn);
    execute format('revoke execute on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

comment on table public.report_pdf_files is
  'One row per stored report PDF revision. Bytes live in the private bucket report-pdfs. Written only by the pdf_cache_* functions.';
comment on table public.report_pdf_events is
  'Append-only audit of PDF generation and download events. Written only by the pdf_cache_* functions.';

-- RETENTION (rule only, nothing is removed by this file):
--   keep every immutable (approved) revision for the life of the source record;
--   superseded working revisions and failed jobs may be purged after 90 days by a
--   service-role job that removes the storage object first, then the row, with
--   set_config('pdf_cache.allow_purge','on',true). That job is NOT part of this draft.

select anum_integration.apply_reader_policies();
