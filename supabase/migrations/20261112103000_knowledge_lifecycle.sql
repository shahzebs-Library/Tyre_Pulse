-- ============================================================================
-- 20261112103000_knowledge_lifecycle
-- STATUS: AUTHORED, NOT APPLIED. Apply only on the owner's go-ahead.
--
-- WHAT: the company knowledge base (SOPs, manuals, pressure guidance, removal
-- criteria, RCA procedures, warranty rules, procurement procedures) gets a
-- controlled-document lifecycle, and retrieval returns ONLY approved, in-date
-- documents, always with document id + title + version (+ page) for citation.
--
--   knowledge_documents (one table, unchanged pipeline):
--     * a DOCUMENT is a row with chunk_of IS NULL. It carries the lifecycle.
--     * a CHUNK is a row with chunk_of = <document id> (V98). It carries text,
--       page_from/page_to and its own embedding. Chunks INHERIT the parent's
--       lifecycle at retrieval time; their own status column is ignored.
--     * embed-worker (V98 cron) keeps embedding every row whose embedding is
--       NULL. Approval does not need re-embedding: the status filter is applied
--       at query time, so approving / withdrawing is instant.
--
--   Lifecycle states: draft / approved / superseded / expired / withdrawn.
--     draft      -> approved | withdrawn
--     approved   -> superseded | expired | withdrawn
--     expired    -> withdrawn
--     superseded, withdrawn = terminal.
--   Approval: Admin / Manager / Director / super admin ONLY, and never by the
--   person who uploaded the document (four eyes). approved_by / approved_at are
--   stamped server-side from auth.uid() and cannot be written by a client.
--   Approving a document whose supersedes_id points at an approved document
--   marks that older document 'superseded' in the same transaction.
--   "In date" = (effective_from IS NULL OR effective_from <= current_date)
--           AND (expires_at IS NULL OR expires_at > current_date).
--   review_due is advisory (UI warning); it does NOT stop retrieval.
--
--   match_knowledge_documents: same 5 arguments, same org guard as V548,
--   new return columns (document_id, version, status, page_from, page_to,
--   chunk_index, effective_from, review_due). Return type changes, so the
--   function is DROPPED and recreated (CREATE OR REPLACE cannot change it).
--   Callers: src/lib/ragService.js (reads id/title/content/doc_type, still
--   present) and supabase/functions/ai-orchestrator (updated in the same change).
--
-- No new table is created, so anum_integration.apply_reader_policies() is not
-- required; it is still called at the end (idempotent) so the reader policy
-- set stays complete if this migration is ever extended with a table.
--
-- PRE-FLIGHT (database-migration-safety), measured 2026-11-10 read-only:
--   knowledge_documents = 0 rows, so the default 'draft' and the backfill touch
--   nothing live. New columns are all nullable or defaulted (no rewrite of data
--   that exists). Locks: ALTER TABLE ADD COLUMN on an empty table = instant.
--   Triggers already on the table: knowledge_documents_set_updated_at,
--   trg_audit_row, trg_ev_knowledge_document_added - none read the new columns.
--   Live policies: select USING true (org/country RESTRICTIVE still bound it),
--   write = Admin/Manager. The approval RPCs are SECURITY DEFINER so a Director
--   (who cannot write the table directly) can approve; the trigger enforces the
--   same rule on BOTH paths.
--   DEPLOY ORDER: apply this migration BEFORE deploying the updated embed-worker
--   and ai-orchestrator (both now read chunk_count / the new return columns).
--
-- VERIFY (run after apply, inside a rolled-back txn, impersonating real users):
--   1. select pg_get_function_result('public.match_knowledge_documents(vector,int,text,text,uuid)'::regprocedure);
--      -> includes document_id, version, status, page_from
--   2. As uploader U (Manager): insert a document (status defaults 'draft'),
--      then update status='approved'                         -> ERROR (four eyes)
--   3. As Tyre Man: select public.kb_approve_document(<id>)   -> ERROR 42501
--   4. As another Manager: select public.kb_approve_document(<id>) -> approved,
--      approved_by = that manager, approved_at set
--   5. match_knowledge_documents with a draft-only corpus      -> 0 rows
--   6. Set expires_at = current_date on an approved doc        -> excluded
--   7. Approve doc B with supersedes_id = A                    -> A.status = 'superseded'
--   8. has_function_privilege('anon','public.kb_approve_document(uuid)','EXECUTE') -> false
--
-- ROLLBACK:
--   drop trigger if exists trg_kb_lifecycle_guard on public.knowledge_documents;
--   drop trigger if exists trg_kb_supersede_after on public.knowledge_documents;
--   drop function if exists public.kb_lifecycle_guard();
--   drop function if exists public.kb_supersede_after();
--   drop function if exists public.kb_approve_document(uuid);
--   drop function if exists public.kb_withdraw_document(uuid, text);
--   drop function if exists public.kb_mark_expired();
--   drop function if exists public.kb_is_approver();
--   drop function if exists public.match_knowledge_documents(vector,int,text,text,uuid);
--   -- then re-create the V548 body (copied verbatim in MIGRATIONS_V548_LEAK_SWEEP.sql
--   -- section 4) and: grant execute on that function to authenticated, service_role;
--   alter table public.knowledge_documents
--     drop constraint if exists knowledge_documents_status_chk,
--     drop column if exists status, drop column if exists version,
--     drop column if exists effective_from, drop column if exists review_due,
--     drop column if exists expires_at, drop column if exists approved_by,
--     drop column if exists approved_at, drop column if exists supersedes_id,
--     drop column if exists withdrawn_at, drop column if exists withdrawn_by,
--     drop column if exists withdrawn_reason, drop column if exists page_from,
--     drop column if exists page_to, drop column if exists chunk_count,
--     drop column if exists source_filename, drop column if exists source_mime,
--     drop column if exists document_ref;
-- ============================================================================

begin;

-------------------------------------------------------------------- 1. columns
alter table public.knowledge_documents
  add column if not exists status           text not null default 'draft',
  add column if not exists version          integer not null default 1,
  add column if not exists document_ref     text,
  add column if not exists effective_from   date,
  add column if not exists review_due       date,
  add column if not exists expires_at       date,
  add column if not exists approved_by      uuid references auth.users(id) on delete set null,
  add column if not exists approved_at      timestamptz,
  add column if not exists supersedes_id    uuid references public.knowledge_documents(id) on delete set null,
  add column if not exists withdrawn_by     uuid references auth.users(id) on delete set null,
  add column if not exists withdrawn_at     timestamptz,
  add column if not exists withdrawn_reason text,
  add column if not exists page_from        integer,
  add column if not exists page_to          integer,
  add column if not exists chunk_count      integer not null default 0,
  add column if not exists source_filename  text,
  add column if not exists source_mime      text;

alter table public.knowledge_documents
  drop constraint if exists knowledge_documents_status_chk;
alter table public.knowledge_documents
  add constraint knowledge_documents_status_chk
  check (status in ('draft','approved','superseded','expired','withdrawn'));

alter table public.knowledge_documents
  drop constraint if exists knowledge_documents_version_chk;
alter table public.knowledge_documents
  add constraint knowledge_documents_version_chk check (version >= 1);

alter table public.knowledge_documents
  drop constraint if exists knowledge_documents_dates_chk;
alter table public.knowledge_documents
  add constraint knowledge_documents_dates_chk
  check (expires_at is null or effective_from is null or expires_at > effective_from);

alter table public.knowledge_documents
  drop constraint if exists knowledge_documents_pages_chk;
alter table public.knowledge_documents
  add constraint knowledge_documents_pages_chk
  check (page_from is null or (page_from >= 1 and (page_to is null or page_to >= page_from)));

comment on column public.knowledge_documents.status is
  'Document lifecycle (parent rows only): draft/approved/superseded/expired/withdrawn. Chunks inherit the parent status at retrieval.';
comment on column public.knowledge_documents.chunk_count is
  'Parent rows: number of chunk rows. > 0 means the parent is a container and is not itself retrieved or embedded.';
comment on column public.knowledge_documents.review_due is
  'Advisory periodic review date. Past due raises a UI warning; retrieval is governed by status + effective_from/expires_at.';

create index if not exists idx_knowledge_documents_status
  on public.knowledge_documents (organisation_id, status) where chunk_of is null;
create index if not exists idx_knowledge_documents_supersedes
  on public.knowledge_documents (supersedes_id) where supersedes_id is not null;

-------------------------------------------------- 2. approver predicate (one place)
create or replace function public.kb_is_approver()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(public.is_super_admin(), false)
      or coalesce(lower(public.get_my_role()) in ('admin','manager','director'), false);
$$;
revoke all on function public.kb_is_approver() from public, anon;
grant execute on function public.kb_is_approver() to authenticated, service_role;

------------------------------------------------------ 3. lifecycle guard (both paths)
create or replace function public.kb_lifecycle_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_old text := case when tg_op = 'UPDATE' then old.status else null end;
begin
  -- Chunks carry no lifecycle of their own; keep their status neutral.
  if new.chunk_of is not null then
    new.status := 'draft';
    new.approved_by := null; new.approved_at := null;
    return new;
  end if;

  -- No user session (service role / migration): trust the writer.
  if v_uid is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A document is always born a draft; approval is a separate act.
    new.status := 'draft';
    new.approved_by := null; new.approved_at := null;
    new.withdrawn_by := null; new.withdrawn_at := null;
    return new;
  end if;

  -- Server-owned stamps can never be written by a client.
  if new.status is not distinct from v_old then
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
    new.withdrawn_by := old.withdrawn_by; new.withdrawn_at := old.withdrawn_at;
    -- An approved document's substance is frozen: change = new version.
    if v_old = 'approved' and (
         new.content is distinct from old.content
      or new.title is distinct from old.title
      or new.version is distinct from old.version
      or new.effective_from is distinct from old.effective_from) then
      raise exception 'An approved document cannot be edited. Upload a new version that supersedes it.'
        using errcode = '22023';
    end if;
    return new;
  end if;

  if not (
       (v_old = 'draft'    and new.status in ('approved','withdrawn'))
    or (v_old = 'approved' and new.status in ('superseded','expired','withdrawn'))
    or (v_old = 'expired'  and new.status = 'withdrawn')
  ) then
    raise exception 'Document status cannot change from % to %', v_old, new.status
      using errcode = '22023';
  end if;

  if not public.kb_is_approver() then
    raise exception 'Only an Admin, Manager or Director can change a document''s status'
      using errcode = '42501';
  end if;

  if new.status = 'approved' then
    if old.created_by is not null and old.created_by = v_uid then
      raise exception 'The person who uploaded a document cannot approve it'
        using errcode = '42501';
    end if;
    if coalesce(new.chunk_count, 0) = 0 and coalesce(btrim(new.content), '') = '' then
      raise exception 'A document with no content cannot be approved' using errcode = '22023';
    end if;
    new.approved_by := v_uid;
    new.approved_at := now();
    if new.effective_from is null then new.effective_from := current_date; end if;
  elsif new.status = 'withdrawn' then
    new.withdrawn_by := v_uid;
    new.withdrawn_at := now();
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  else
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  end if;
  return new;
end;
$$;
revoke all on function public.kb_lifecycle_guard() from public, anon, authenticated;

drop trigger if exists trg_kb_lifecycle_guard on public.knowledge_documents;
create trigger trg_kb_lifecycle_guard
  before insert or update on public.knowledge_documents
  for each row execute function public.kb_lifecycle_guard();

-- Approving a new version retires the one it supersedes (same org only).
create or replace function public.kb_supersede_after()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.chunk_of is null
     and new.status = 'approved'
     and old.status is distinct from 'approved'
     and new.supersedes_id is not null then
    update public.knowledge_documents
       set status = 'superseded', updated_at = now()
     where id = new.supersedes_id
       and organisation_id = new.organisation_id
       and chunk_of is null
       and status = 'approved';
  end if;
  return null;
end;
$$;
revoke all on function public.kb_supersede_after() from public, anon, authenticated;

drop trigger if exists trg_kb_supersede_after on public.knowledge_documents;
create trigger trg_kb_supersede_after
  after update of status on public.knowledge_documents
  for each row execute function public.kb_supersede_after();

---------------------------------------------------------------- 4. RPCs
-- DEFINER so a Director (no direct table write policy) can approve. Each
-- re-checks org visibility; the trigger re-checks role + four eyes.
create or replace function public.kb_approve_document(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare r public.knowledge_documents;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if not public.kb_is_approver() then
    raise exception 'Only an Admin, Manager or Director can approve a document' using errcode = '42501';
  end if;
  select * into r from public.knowledge_documents
   where id = p_id and chunk_of is null
     and (organisation_id = public.app_current_org() or public.is_super_admin())
     and (country is null or public.app_can_see_country(country) is not false)
   for update;
  if not found then raise exception 'Document not found' using errcode = 'P0002'; end if;
  if r.status = 'approved' then
    return jsonb_build_object('ok', true, 'id', r.id, 'status', r.status, 'already', true);
  end if;
  update public.knowledge_documents set status = 'approved' where id = p_id;
  select * into r from public.knowledge_documents where id = p_id;
  return jsonb_build_object('ok', true, 'id', r.id, 'status', r.status,
    'version', r.version, 'approved_at', r.approved_at);
end;
$$;

create or replace function public.kb_withdraw_document(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare r public.knowledge_documents;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to withdraw a document' using errcode = '22023';
  end if;
  select * into r from public.knowledge_documents
   where id = p_id and chunk_of is null
     and (organisation_id = public.app_current_org() or public.is_super_admin())
     and (country is null or public.app_can_see_country(country) is not false)
   for update;
  if not found then raise exception 'Document not found' using errcode = 'P0002'; end if;
  update public.knowledge_documents
     set status = 'withdrawn', withdrawn_reason = left(btrim(p_reason), 1000)
   where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'status', 'withdrawn');
end;
$$;

-- Housekeeping: flip approved documents past expires_at to 'expired'. Retrieval
-- already excludes them by date, so this only keeps the register honest. Not
-- scheduled here (one cron.schedule line when wanted).
create or replace function public.kb_mark_expired()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare n integer;
begin
  update public.knowledge_documents
     set status = 'expired', updated_at = now()
   where chunk_of is null and status = 'approved'
     and expires_at is not null and expires_at <= current_date;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.kb_approve_document(uuid) from public, anon;
revoke all on function public.kb_withdraw_document(uuid, text) from public, anon;
revoke all on function public.kb_mark_expired() from public, anon, authenticated;
grant execute on function public.kb_approve_document(uuid) to authenticated, service_role;
grant execute on function public.kb_withdraw_document(uuid, text) to authenticated, service_role;
grant execute on function public.kb_mark_expired() to service_role;

------------------------------------------------- 5. retrieval: approved + in date
drop function if exists public.match_knowledge_documents(vector, integer, text, text, uuid);

create function public.match_knowledge_documents(
  query_embedding vector,
  match_count     integer default 5,
  filter_doc_type text default null::text,
  filter_site     text default null::text,
  filter_org      uuid default null::uuid)
returns table(
  id             uuid,
  document_id    uuid,
  title          text,
  version        integer,
  status         text,
  content        text,
  doc_type       text,
  site           text,
  page_from      integer,
  page_to        integer,
  chunk_index    integer,
  effective_from date,
  review_due     date,
  similarity     double precision)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select kd.id,
         coalesce(p.id, kd.id)                       as document_id,
         coalesce(p.title, kd.title)                 as title,
         coalesce(p.version, kd.version)             as version,
         coalesce(p.status, kd.status)               as status,
         kd.content,
         coalesce(p.doc_type, kd.doc_type)           as doc_type,
         coalesce(p.site, kd.site)                   as site,
         kd.page_from,
         kd.page_to,
         kd.chunk_index,
         coalesce(p.effective_from, kd.effective_from) as effective_from,
         coalesce(p.review_due, kd.review_due)       as review_due,
         1 - (kd.embedding <=> query_embedding)      as similarity
  from public.knowledge_documents kd
  left join public.knowledge_documents p
         on p.id = kd.chunk_of and p.organisation_id = kd.organisation_id
  where kd.embedding is not null
    -- A container parent is never itself a hit; its chunks are.
    and not (kd.chunk_of is null and coalesce(kd.chunk_count, 0) > 0)
    -- A chunk whose parent is gone (or in another org) is never returned.
    and (kd.chunk_of is null or p.id is not null)
    and kd.organisation_id = coalesce(filter_org, public.app_current_org())
    -- Same org guard as V548.
    and (filter_org is null
         or public.app_current_org() is null
         or filter_org = public.app_current_org()
         or public.is_super_admin())
    -- Lifecycle: only approved, in-date documents.
    and coalesce(p.status, kd.status) = 'approved'
    and (coalesce(p.effective_from, kd.effective_from) is null
         or coalesce(p.effective_from, kd.effective_from) <= current_date)
    and (coalesce(p.expires_at, kd.expires_at) is null
         or coalesce(p.expires_at, kd.expires_at) > current_date)
    and (filter_doc_type is null or coalesce(p.doc_type, kd.doc_type) = filter_doc_type)
    and (filter_site is null or coalesce(p.site, kd.site) = filter_site)
  order by kd.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$function$;

revoke all on function public.match_knowledge_documents(vector, integer, text, text, uuid) from public, anon;
grant execute on function public.match_knowledge_documents(vector, integer, text, text, uuid)
  to authenticated, service_role;

------------------------------------------------------------------- 6. guards
do $mig$
begin
  if has_function_privilege('anon', 'public.match_knowledge_documents(vector,integer,text,text,uuid)', 'EXECUTE') then
    raise exception 'knowledge_lifecycle: match_knowledge_documents is executable by anon';
  end if;
  if has_function_privilege('anon', 'public.kb_approve_document(uuid)', 'EXECUTE') then
    raise exception 'knowledge_lifecycle: kb_approve_document is executable by anon';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.knowledge_documents'::regclass
                    and tgname = 'trg_kb_lifecycle_guard' and tgenabled = 'O') then
    raise exception 'knowledge_lifecycle: lifecycle guard trigger missing or disabled';
  end if;
end $mig$;

select anum_integration.apply_reader_policies();

commit;
