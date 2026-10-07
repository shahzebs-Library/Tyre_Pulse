-- ============================================================================
-- Workshop Status - data model foundation (Loop 1)
-- ============================================================================
-- STATUS: APPLIED to production 2026-10-07 (owner go-ahead). Tested in PGlite (supabase/tests/
-- workshop_status_foundation.test.mjs). Apply to production only on an explicit
-- owner go-ahead.
--
-- Daily Ops -> Workshop Status. The daily workshop Excel decides which vehicles
-- are currently in the workshop report; TyrePulse owns the operational status,
-- reasons, responsibility, history and audit. This is NOT a Job Card workflow:
-- nothing here reads or writes work_orders / open_work_orders. The Excel's
-- "JOB CARD NO." is stored as plain reference text (job_card_ref) only.
--
-- Field ownership comes from the real file (docs/workshop-status/
-- EXCEL_MAPPING.md): Excel owns asset, registration, job card reference,
-- location, complaint, diagnostics, breakdown date, down days, account,
-- remarks and the section category. TyrePulse owns every operational field.
--
-- Design rules:
--   * No duplicate vehicle master. A record points at vehicle_fleet when the
--     asset exists; the canonical identity is (organisation_id, country,
--     asset_no) because the same asset_no in two countries is another machine.
--   * asset_breakdowns is referenced only (asset_breakdown_id), never written.
--   * One ACTIVE record per vehicle. A vehicle that leaves the report and later
--     returns gets a NEW record (a new downtime episode).
--   * Clients get SELECT only. Writes go through SECURITY DEFINER functions
--     (later loops). Those writers MUST use set_config(key, value, true)
--     (transaction-local) for the workshop.* settings, so a value can never
--     leak to another request on a pooled connection.
--   * Every "who" column is stamped from auth.uid() by trigger; a caller cannot
--     supply another person's id, name or timestamp.
--   * workshop_status_events and workshop_status_upload_rows are append-only:
--     UPDATE, DELETE and TRUNCATE always fail.
--   * Records are never removed when a vehicle leaves the Excel; they become
--     current_active = false. A hard DELETE (super admin, later loop) still
--     leaves a permanently_deleted event behind.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.workshop_status_actor_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(full_name), ''), nullif(btrim(username), ''), 'System')
    from public.profiles where id = auth.uid()
$$;

-- A workshop.* setting as text; '' and unset both become null.
create or replace function public.workshop_status_setting(p_key text)
returns text language sql stable set search_path = public as $$
  select nullif(btrim(coalesce(current_setting('workshop.' || p_key, true), '')), '')
$$;

-- workshop.upload_id as uuid; anything that is not a uuid becomes null instead
-- of aborting the write.
create or replace function public.workshop_status_setting_upload()
returns uuid language sql stable set search_path = public as $$
  select case when s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then s::uuid end
    from (select public.workshop_status_setting('upload_id') as s) x
$$;

create or replace function public.workshop_status_setting_source()
returns text language sql stable set search_path = public as $$
  select case when s in ('excel', 'manual', 'system') then s else 'system' end
    from (select public.workshop_status_setting('source') as s) x
$$;

-- ---------------------------------------------------------------------------
-- 1. Uploads - one row per daily Excel file.
-- ---------------------------------------------------------------------------
create table if not exists public.workshop_status_uploads (
  id                     uuid primary key default gen_random_uuid(),
  upload_no              bigint generated always as identity,
  organisation_id        uuid not null default public.app_current_org(),
  country                text not null,
  file_name              text not null,
  file_hash              text,
  file_size_bytes        bigint,
  storage_path           text,
  sheet_name             text,
  report_date            date,
  status                 text not null default 'previewed'
                           check (status in ('previewed', 'confirmed', 'cancelled', 'failed')),
  uploaded_by            uuid,
  uploaded_by_name       text,
  uploaded_at            timestamptz not null default now(),
  confirmed_by           uuid,
  confirmed_by_name      text,
  confirmed_at           timestamptz,
  cancelled_by           uuid,
  cancelled_at           timestamptz,
  total_rows             integer not null default 0,
  new_count              integer not null default 0,
  updated_count          integer not null default 0,
  unchanged_count        integer not null default 0,
  removed_count          integer not null default 0,
  closed_count           integer not null default 0,
  invalid_count          integer not null default 0,
  duplicate_count        integer not null default 0,
  previous_active_count  integer,
  header_map             jsonb not null default '{}'::jsonb,
  unmapped_headers       text[] not null default '{}',
  duplicate_of_upload_id uuid references public.workshop_status_uploads(id) on delete restrict,
  duplicate_acknowledged boolean not null default false,
  failure_reason         text,
  notes                  text
);

create index if not exists workshop_status_uploads_org_country_idx
  on public.workshop_status_uploads (organisation_id, country, uploaded_at desc);
create index if not exists workshop_status_uploads_hash_idx
  on public.workshop_status_uploads (organisation_id, file_hash) where file_hash is not null;

-- ---------------------------------------------------------------------------
-- 2. Workshop status records - one row per vehicle per downtime episode.
-- ---------------------------------------------------------------------------
create table if not exists public.workshop_status_records (
  id                         uuid primary key default gen_random_uuid(),
  organisation_id            uuid not null default public.app_current_org(),
  country                    text not null,
  asset_no                   text not null,
  vehicle_id                 uuid references public.vehicle_fleet(id) on delete set null,
  -- Loose link to the existing breakdown register. Read-only reference: this
  -- module never inserts, updates or deletes asset_breakdowns rows.
  asset_breakdown_id         uuid references public.asset_breakdowns(id) on delete set null,

  -- Excel-owned fields (refreshed by each confirmed upload).
  reg_no                     text,
  job_card_ref               text,
  vehicle_category           text,
  site                       text,
  department                 text,
  complaint                  text,
  diagnostics                text,
  ooc_since                  date,
  excel_down_days            integer,
  excel_expected_release     text,
  excel_status_note          text,
  source_remarks             text,
  excel_data                 jsonb not null default '{}'::jsonb,
  excel_updated_at           timestamptz,

  -- TyrePulse-owned operational fields (never written by an upload).
  current_stage              text,
  delay_reason               text,
  detailed_reason            text,
  work_done                  text,
  action_taken               text,
  next_action                text,
  parts_status               text,
  mr_number                  text,
  po_number                  text,
  responsible_user_id        uuid references public.profiles(id) on delete set null,
  supporting_user_id         uuid references public.profiles(id) on delete set null,
  expected_part_date         date,
  expected_release_date      date,
  blocker                    text,
  remarks                    text,

  -- Report membership and lineage.
  current_active             boolean not null default true,
  daily_report_status        text not null default 'active'
                               check (daily_report_status in
                                 ('active', 'removed_from_current_report', 'restored', 'archived')),
  first_seen_upload_id       uuid references public.workshop_status_uploads(id) on delete restrict,
  first_seen_at              timestamptz not null default now(),
  first_seen_by              uuid,
  last_seen_upload_id        uuid references public.workshop_status_uploads(id) on delete restrict,
  last_seen_at               timestamptz,
  removed_by_upload_id       uuid references public.workshop_status_uploads(id) on delete restrict,
  removed_at                 timestamptz,
  removed_by_user_id         uuid,
  removed_reason             text,
  previous_current_stage     text,
  previous_delay_reason      text,
  previous_responsible_user_id uuid,

  -- Final disposition (entered by a person; absence from Excel proves nothing).
  final_disposition          text check (final_disposition is null or final_disposition in
                               ('repair_completed', 'returned_to_operation', 'transferred_site',
                                'sent_external_workshop', 'vehicle_sold', 'vehicle_scrapped',
                                'wrong_entry', 'duplicate_entry', 'other')),
  final_disposition_remarks  text,
  final_disposition_by       uuid,
  final_disposition_by_name  text,
  final_disposition_at       timestamptz,

  -- Archive and soft delete.
  archived_at                timestamptz,
  archived_by                uuid,
  archive_reason             text,
  deleted_at                 timestamptz,
  deleted_by                 uuid,
  delete_reason              text,

  -- Last change (stamped by trigger).
  last_manual_update_at      timestamptz,
  last_updated_by            uuid,
  last_updated_by_name       text,
  last_update_source         text not null default 'excel'
                               check (last_update_source in ('excel', 'manual', 'system')),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint workshop_status_records_other_disposition
    check (final_disposition is distinct from 'other'
           or nullif(btrim(final_disposition_remarks), '') is not null)
);

create unique index if not exists workshop_status_records_one_active
  on public.workshop_status_records (organisation_id, country, asset_no)
  where current_active and deleted_at is null;
create index if not exists workshop_status_records_scope_idx
  on public.workshop_status_records (organisation_id, country, current_active, site);
create index if not exists workshop_status_records_asset_idx
  on public.workshop_status_records (organisation_id, asset_no);
create index if not exists workshop_status_records_responsible_idx
  on public.workshop_status_records (responsible_user_id) where responsible_user_id is not null;
create index if not exists workshop_status_records_removed_idx
  on public.workshop_status_records (organisation_id, removed_at desc) where removed_at is not null;
create index if not exists workshop_status_records_breakdown_idx
  on public.workshop_status_records (asset_breakdown_id) where asset_breakdown_id is not null;

-- Reliable breakdown link: the single OPEN asset_breakdowns row for the same
-- org, country and asset. Null when there is none or more than one.
create or replace function public.workshop_status_breakdown_for(p_org uuid, p_country text, p_asset text)
returns uuid language sql stable security definer set search_path = public as $$
  select case when count(*) = 1 then (array_agg(b.id))[1] end
    from public.asset_breakdowns b
   where b.organisation_id = p_org
     and b.country is not distinct from p_country
     and upper(regexp_replace(b.asset_no, '\s', '', 'g')) = upper(regexp_replace(p_asset, '\s', '', 'g'))
     and coalesce(b.returned_to_service, false) = false
$$;

-- ---------------------------------------------------------------------------
-- 3. Upload rows - parsed rows of each upload and their comparison outcome.
-- record_id has no foreign key so the evidence survives any record delete.
-- ---------------------------------------------------------------------------
create table if not exists public.workshop_status_upload_rows (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  country          text not null,
  upload_id        uuid not null references public.workshop_status_uploads(id) on delete restrict,
  row_number       integer,
  section          text,
  asset_no         text,
  site             text,
  outcome          text not null check (outcome in
                     ('new', 'changed', 'unchanged', 'removed', 'closed', 'invalid', 'duplicate')),
  data             jsonb not null default '{}'::jsonb,
  raw              jsonb not null default '{}'::jsonb,
  changes          jsonb not null default '{}'::jsonb,
  errors           text[] not null default '{}',
  record_id        uuid,
  created_at       timestamptz not null default now()
);
create index if not exists workshop_status_upload_rows_upload_idx
  on public.workshop_status_upload_rows (upload_id, outcome);

-- ---------------------------------------------------------------------------
-- 4. Events - append-only audit / activity log. No foreign key on record_id.
-- ---------------------------------------------------------------------------
create table if not exists public.workshop_status_events (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  country          text,
  site             text,
  record_id        uuid,
  asset_no         text,
  upload_id        uuid,
  event_type       text not null check (event_type in
                     ('added', 'excel_updated', 'removed', 'manual_update', 'field_change',
                      'restored', 'archived', 'unarchived', 'soft_deleted', 'undeleted',
                      'permanently_deleted', 'final_disposition', 'attachment_added',
                      'attachment_removed', 'upload_previewed', 'upload_confirmed',
                      'upload_cancelled', 'upload_failed', 'export')),
  field_name       text,
  old_value        text,
  new_value        text,
  reason           text,
  source           text not null default 'system'
                     check (source in ('excel', 'manual', 'system')),
  details          jsonb not null default '{}'::jsonb,
  actor_id         uuid,
  actor_name       text,
  created_at       timestamptz not null default now()
);
create index if not exists workshop_status_events_record_idx
  on public.workshop_status_events (record_id, created_at desc);
create index if not exists workshop_status_events_org_time_idx
  on public.workshop_status_events (organisation_id, created_at desc);
create index if not exists workshop_status_events_actor_idx
  on public.workshop_status_events (actor_id, created_at desc);
create index if not exists workshop_status_events_upload_idx
  on public.workshop_status_events (upload_id) where upload_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Attachments - files on a record (private bucket, later loop). Soft delete
-- only; record_id has no foreign key so the file history survives.
-- ---------------------------------------------------------------------------
create table if not exists public.workshop_status_attachments (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  country          text,
  site             text,
  record_id        uuid not null,
  asset_no         text,
  storage_path     text not null,
  file_name        text not null,
  mime_type        text,
  size_bytes       bigint,
  category         text not null default 'other' check (category in
                     ('damage_photo', 'repair_photo', 'quotation', 'mr', 'po',
                      'supplier_document', 'inspection', 'other')),
  description      text,
  related_event_id uuid,
  uploaded_by      uuid,
  uploaded_by_name text,
  uploaded_at      timestamptz not null default now(),
  deleted_at       timestamptz,
  deleted_by       uuid,
  delete_reason    text
);
create index if not exists workshop_status_attachments_record_idx
  on public.workshop_status_attachments (record_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Append-only guard (events and upload rows): UPDATE, DELETE, TRUNCATE fail.
-- ---------------------------------------------------------------------------
create or replace function public.workshop_status_event_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'Workshop status history cannot be changed or deleted'
    using errcode = '42501';
end $$;

drop trigger if exists trg_workshop_status_event_immutable on public.workshop_status_events;
create trigger trg_workshop_status_event_immutable
  before update or delete on public.workshop_status_events
  for each row execute function public.workshop_status_event_immutable();
drop trigger if exists trg_workshop_status_event_no_truncate on public.workshop_status_events;
create trigger trg_workshop_status_event_no_truncate
  before truncate on public.workshop_status_events
  for each statement execute function public.workshop_status_event_immutable();

drop trigger if exists trg_workshop_status_upload_rows_immutable on public.workshop_status_upload_rows;
create trigger trg_workshop_status_upload_rows_immutable
  before update or delete on public.workshop_status_upload_rows
  for each row execute function public.workshop_status_event_immutable();
drop trigger if exists trg_workshop_status_upload_rows_no_truncate on public.workshop_status_upload_rows;
create trigger trg_workshop_status_upload_rows_no_truncate
  before truncate on public.workshop_status_upload_rows
  for each statement execute function public.workshop_status_event_immutable();

-- ---------------------------------------------------------------------------
-- Event stamp: actor and time always from the session; country/site filled
-- from the record or upload so no event is left visible to every scope.
-- ---------------------------------------------------------------------------
create or replace function public.workshop_status_event_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  NEW.actor_id   := auth.uid();
  NEW.actor_name := coalesce(public.workshop_status_actor_name(), 'System');
  NEW.created_at := now();
  if NEW.record_id is not null and (NEW.country is null or NEW.site is null or NEW.asset_no is null) then
    select coalesce(NEW.country, r.country), coalesce(NEW.site, r.site), coalesce(NEW.asset_no, r.asset_no)
      into NEW.country, NEW.site, NEW.asset_no
      from public.workshop_status_records r where r.id = NEW.record_id;
  end if;
  if NEW.country is null and NEW.upload_id is not null then
    select u.country into NEW.country from public.workshop_status_uploads u where u.id = NEW.upload_id;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_workshop_status_event_stamp on public.workshop_status_events;
create trigger trg_workshop_status_event_stamp
  before insert on public.workshop_status_events
  for each row execute function public.workshop_status_event_stamp();

-- Upload rows inherit the upload's org and country.
create or replace function public.workshop_status_upload_row_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select u.organisation_id, u.country into NEW.organisation_id, NEW.country
    from public.workshop_status_uploads u where u.id = NEW.upload_id;
  NEW.created_at := now();
  return NEW;
end $$;

drop trigger if exists trg_workshop_status_upload_row_stamp on public.workshop_status_upload_rows;
create trigger trg_workshop_status_upload_row_stamp
  before insert on public.workshop_status_upload_rows
  for each row execute function public.workshop_status_upload_row_stamp();

-- Upload identity: uploader, confirmer and canceller come from the session.
create or replace function public.workshop_status_upload_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    NEW.uploaded_by := auth.uid();
    NEW.uploaded_by_name := coalesce(public.workshop_status_actor_name(), 'System');
    NEW.uploaded_at := now();
    NEW.confirmed_by := null; NEW.confirmed_by_name := null; NEW.confirmed_at := null;
    NEW.cancelled_by := null; NEW.cancelled_at := null;
    return NEW;
  end if;
  NEW.uploaded_by := OLD.uploaded_by;
  NEW.uploaded_by_name := OLD.uploaded_by_name;
  NEW.uploaded_at := OLD.uploaded_at;
  NEW.organisation_id := OLD.organisation_id;
  NEW.country := OLD.country;
  NEW.file_hash := OLD.file_hash;
  if OLD.status in ('confirmed', 'cancelled') and NEW.status is distinct from OLD.status then
    raise exception 'A % upload cannot change status', OLD.status using errcode = '42501';
  end if;
  if NEW.status = 'confirmed' and OLD.status is distinct from 'confirmed' then
    NEW.confirmed_by := auth.uid();
    NEW.confirmed_by_name := coalesce(public.workshop_status_actor_name(), 'System');
    NEW.confirmed_at := now();
  else
    NEW.confirmed_by := OLD.confirmed_by;
    NEW.confirmed_by_name := OLD.confirmed_by_name;
    NEW.confirmed_at := OLD.confirmed_at;
  end if;
  if NEW.status = 'cancelled' and OLD.status is distinct from 'cancelled' then
    NEW.cancelled_by := auth.uid();
    NEW.cancelled_at := now();
  else
    NEW.cancelled_by := OLD.cancelled_by;
    NEW.cancelled_at := OLD.cancelled_at;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_workshop_status_upload_stamp on public.workshop_status_uploads;
create trigger trg_workshop_status_upload_stamp
  before insert or update on public.workshop_status_uploads
  for each row execute function public.workshop_status_upload_stamp();

-- Attachment identity and scope.
create or replace function public.workshop_status_attachment_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    NEW.uploaded_by := auth.uid();
    NEW.uploaded_by_name := coalesce(public.workshop_status_actor_name(), 'System');
    NEW.uploaded_at := now();
    NEW.deleted_at := null; NEW.deleted_by := null;
    select r.organisation_id, r.country, r.site, r.asset_no
      into NEW.organisation_id, NEW.country, NEW.site, NEW.asset_no
      from public.workshop_status_records r where r.id = NEW.record_id;
    if NEW.country is null then
      raise exception 'Attachment must belong to a workshop record' using errcode = '23503';
    end if;
    return NEW;
  end if;
  NEW.uploaded_by := OLD.uploaded_by;
  NEW.uploaded_by_name := OLD.uploaded_by_name;
  NEW.uploaded_at := OLD.uploaded_at;
  NEW.record_id := OLD.record_id;
  NEW.organisation_id := OLD.organisation_id;
  NEW.country := OLD.country;
  NEW.storage_path := OLD.storage_path;
  if NEW.deleted_at is distinct from OLD.deleted_at then
    NEW.deleted_by := case when NEW.deleted_at is null then null else auth.uid() end;
    if NEW.deleted_at is not null then NEW.deleted_at := now(); end if;
  else
    NEW.deleted_by := OLD.deleted_by;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_workshop_status_attachment_stamp on public.workshop_status_attachments;
create trigger trg_workshop_status_attachment_stamp
  before insert or update on public.workshop_status_attachments
  for each row execute function public.workshop_status_attachment_stamp();

-- ---------------------------------------------------------------------------
-- Record normalisation: reuse the app's existing asset_no / site normalisers
-- when they exist. Named trg_a_* so they run BEFORE the stamp trigger.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'normalize_asset_no' and p.pronargs = 0) then
    execute 'drop trigger if exists trg_a_normalize_asset_no on public.workshop_status_records';
    execute 'create trigger trg_a_normalize_asset_no before insert or update on public.workshop_status_records
             for each row execute function public.normalize_asset_no()';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'normalize_site' and p.pronargs = 0) then
    execute 'drop trigger if exists trg_a_normalize_site on public.workshop_status_records';
    execute 'create trigger trg_a_normalize_site before insert or update on public.workshop_status_records
             for each row execute function public.normalize_site()';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Record stamp. Writers set (transaction-local):
--   workshop.source     'excel' | 'manual' | 'system'
--   workshop.upload_id  uuid of the upload being applied
--   workshop.reason     reason text for sensitive actions
-- When no workshop writer context is present (for example a foreign-key
-- set-null from deleting a vehicle), last_updated_* are left as they were;
-- the change is still captured in the event log with its actor.
-- ---------------------------------------------------------------------------
create or replace function public.workshop_status_record_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ctx boolean := public.workshop_status_setting('source') is not null;
  v_source text := public.workshop_status_setting_source();
  v_uid uuid := auth.uid();
  v_name text := coalesce(public.workshop_status_actor_name(), 'System');
begin
  if TG_OP = 'INSERT' then
    NEW.first_seen_by := v_uid;
    NEW.first_seen_at := now();
    NEW.created_at := now();
    NEW.updated_at := now();
    NEW.last_updated_by := v_uid;
    NEW.last_updated_by_name := v_name;
    NEW.last_update_source := v_source;
    NEW.last_manual_update_at := case when v_source = 'manual' then now() end;
    NEW.final_disposition_by := case when NEW.final_disposition is not null then v_uid end;
    NEW.final_disposition_by_name := case when NEW.final_disposition is not null then v_name end;
    NEW.final_disposition_at := case when NEW.final_disposition is not null then now() end;
    NEW.removed_by_user_id := case when NEW.removed_at is not null then v_uid end;
    NEW.archived_by := case when NEW.archived_at is not null then v_uid end;
    NEW.deleted_by := case when NEW.deleted_at is not null then v_uid end;
    return NEW;
  end if;

  -- Identity and lineage of an episode never change.
  if NEW.id <> OLD.id or NEW.organisation_id <> OLD.organisation_id
     or NEW.country <> OLD.country or NEW.asset_no <> OLD.asset_no
     or NEW.first_seen_upload_id is distinct from OLD.first_seen_upload_id
     or NEW.first_seen_at <> OLD.first_seen_at
     or NEW.first_seen_by is distinct from OLD.first_seen_by
     or NEW.created_at <> OLD.created_at then
    raise exception 'The identity of a workshop record cannot be changed' using errcode = '42501';
  end if;

  NEW.updated_at := now();
  if v_ctx then
    NEW.last_updated_by := v_uid;
    NEW.last_updated_by_name := v_name;
    NEW.last_update_source := v_source;
    NEW.last_manual_update_at := case when v_source = 'manual' then now() else OLD.last_manual_update_at end;
  else
    NEW.last_updated_by := OLD.last_updated_by;
    NEW.last_updated_by_name := OLD.last_updated_by_name;
    NEW.last_update_source := OLD.last_update_source;
    NEW.last_manual_update_at := OLD.last_manual_update_at;
  end if;

  -- "Who" columns follow the state change they describe.
  if NEW.final_disposition is distinct from OLD.final_disposition
     or NEW.final_disposition_remarks is distinct from OLD.final_disposition_remarks then
    NEW.final_disposition_by := case when NEW.final_disposition is null then null else v_uid end;
    NEW.final_disposition_by_name := case when NEW.final_disposition is null then null else v_name end;
    NEW.final_disposition_at := case when NEW.final_disposition is null then null else now() end;
  else
    NEW.final_disposition_by := OLD.final_disposition_by;
    NEW.final_disposition_by_name := OLD.final_disposition_by_name;
    NEW.final_disposition_at := OLD.final_disposition_at;
  end if;
  if NEW.removed_at is distinct from OLD.removed_at then
    NEW.removed_by_user_id := case when NEW.removed_at is null then null else v_uid end;
  else
    NEW.removed_by_user_id := OLD.removed_by_user_id;
  end if;
  if NEW.archived_at is distinct from OLD.archived_at then
    NEW.archived_by := case when NEW.archived_at is null then null else v_uid end;
  else
    NEW.archived_by := OLD.archived_by;
  end if;
  if NEW.deleted_at is distinct from OLD.deleted_at then
    NEW.deleted_by := case when NEW.deleted_at is null then null else v_uid end;
  else
    NEW.deleted_by := OLD.deleted_by;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_workshop_status_record_stamp on public.workshop_status_records;
create trigger trg_workshop_status_record_stamp
  before insert or update on public.workshop_status_records
  for each row execute function public.workshop_status_record_stamp();

-- ---------------------------------------------------------------------------
-- Record audit: insert, every tracked field change, and hard delete.
-- ---------------------------------------------------------------------------
create or replace function public.workshop_status_record_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_source text := public.workshop_status_setting_source();
  v_upload uuid := public.workshop_status_setting_upload();
  v_reason text := public.workshop_status_setting('reason');
  v_fields text[] := array[
    'reg_no', 'job_card_ref', 'vehicle_category', 'site', 'department', 'complaint',
    'diagnostics', 'ooc_since', 'excel_down_days', 'excel_expected_release',
    'excel_status_note', 'source_remarks', 'vehicle_id', 'asset_breakdown_id',
    'current_stage', 'delay_reason', 'detailed_reason', 'work_done', 'action_taken',
    'next_action', 'parts_status', 'mr_number', 'po_number', 'responsible_user_id',
    'supporting_user_id', 'expected_part_date', 'expected_release_date', 'blocker',
    'remarks', 'current_active', 'daily_report_status', 'final_disposition',
    'final_disposition_remarks', 'archived_at', 'deleted_at'];
  v_old jsonb; v_new jsonb; f text;
begin
  if TG_OP = 'DELETE' then
    insert into public.workshop_status_events
      (organisation_id, country, site, record_id, asset_no, upload_id, event_type, source, reason, details)
    values (OLD.organisation_id, OLD.country, OLD.site, OLD.id, OLD.asset_no, v_upload,
            'permanently_deleted', v_source, v_reason, jsonb_build_object('record', to_jsonb(OLD)));
    return OLD;
  end if;

  if TG_OP = 'INSERT' then
    insert into public.workshop_status_events
      (organisation_id, country, site, record_id, asset_no, upload_id, event_type, source, reason, details)
    values (NEW.organisation_id, NEW.country, NEW.site, NEW.id, NEW.asset_no, v_upload,
            'added', v_source, v_reason,
            jsonb_build_object('message', case when v_source = 'excel'
              then 'Vehicle added through Daily Workshop Excel upload.'
              else 'Vehicle added to the workshop report.' end));
    return NEW;
  end if;

  v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
  foreach f in array v_fields loop
    if (v_old -> f) is distinct from (v_new -> f) then
      insert into public.workshop_status_events
        (organisation_id, country, site, record_id, asset_no, upload_id, event_type,
         field_name, old_value, new_value, source, reason)
      values (NEW.organisation_id, NEW.country, NEW.site, NEW.id, NEW.asset_no, v_upload,
              'field_change', f, v_old ->> f, v_new ->> f, v_source, v_reason);
    end if;
  end loop;
  return NEW;
end $$;

drop trigger if exists trg_workshop_status_record_audit on public.workshop_status_records;
create trigger trg_workshop_status_record_audit
  after insert or update or delete on public.workshop_status_records
  for each row execute function public.workshop_status_record_audit();

-- ---------------------------------------------------------------------------
-- Visibility. Module permission key: daily_ops:workshop (existing RBAC).
-- ---------------------------------------------------------------------------
create or replace function public.workshop_status_can_view()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_is_active(), false)
     and (public.is_super_admin() or public.app_user_can('daily_ops:workshop', 'view'))
$$;

alter table public.workshop_status_uploads     enable row level security;
alter table public.workshop_status_records     enable row level security;
alter table public.workshop_status_upload_rows enable row level security;
alter table public.workshop_status_events      enable row level security;
alter table public.workshop_status_attachments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['workshop_status_uploads', 'workshop_status_records',
    'workshop_status_upload_rows', 'workshop_status_events', 'workshop_status_attachments'] loop
    execute format('drop policy if exists %I on public.%I', t || '_org_isolation', t);
    execute format($p$create policy %I on public.%I as restrictive for all to authenticated
      using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
      with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))$p$,
      t || '_org_isolation', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using ((select public.workshop_status_can_view()))$p$, t || '_read', t);
    -- Country scope, in the zero-argument InitPlan form (evaluated once per query).
    execute format('drop policy if exists %I on public.%I', t || '_country', t);
    execute format($p$create policy %I on public.%I as restrictive for select to authenticated
      using (country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries())
             or lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[])))$p$,
      t || '_country', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;

  -- Site scope on tables that carry a site.
  foreach t in array array['workshop_status_records', 'workshop_status_upload_rows',
    'workshop_status_events', 'workshop_status_attachments'] loop
    execute format('drop policy if exists %I on public.%I', t || '_site', t);
    execute format($p$create policy %I on public.%I as restrictive for select to authenticated
      using (site is null or btrim(site) = '' or (select public.app_sees_all_sites())
             or upper(btrim(site)) = any (coalesce((select public.app_site_scope()), '{}'::text[])))$p$,
      t || '_site', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Role defaults: every role that has Daily Ops gets Workshop Status view by
-- default; changeable per role / per user in Console -> Access Control.
-- Only ENABLED rows are copied: a role with Daily Ops off gets no row here, so
-- the explicit role matrix in the permissions migration can still grant it.
-- Skipped where module_permissions does not exist (the test harness).
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.module_permissions') is not null then
    insert into public.module_permissions (role, module_key, enabled, org_id)
    select mp.role, 'daily_ops:workshop', mp.enabled, null
      from public.module_permissions mp
     where mp.module_key = 'daily_ops' and mp.org_id is null and mp.enabled
       and not exists (select 1 from public.module_permissions x
                        where x.role = mp.role and x.module_key = 'daily_ops:workshop' and x.org_id is null);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Function privileges.
-- ---------------------------------------------------------------------------
revoke all on function public.workshop_status_breakdown_for(uuid, text, text) from public, anon, authenticated;
revoke all on function public.workshop_status_setting(text) from public, anon;
revoke all on function public.workshop_status_setting_upload() from public, anon;
revoke all on function public.workshop_status_setting_source() from public, anon;
revoke all on function public.workshop_status_actor_name() from public, anon;
revoke all on function public.workshop_status_can_view() from public, anon;
revoke all on function public.workshop_status_event_stamp() from public, anon, authenticated;
revoke all on function public.workshop_status_event_immutable() from public, anon, authenticated;
revoke all on function public.workshop_status_upload_row_stamp() from public, anon, authenticated;
revoke all on function public.workshop_status_upload_stamp() from public, anon, authenticated;
revoke all on function public.workshop_status_attachment_stamp() from public, anon, authenticated;
revoke all on function public.workshop_status_record_stamp() from public, anon, authenticated;
revoke all on function public.workshop_status_record_audit() from public, anon, authenticated;
grant execute on function public.workshop_status_setting(text) to authenticated;
grant execute on function public.workshop_status_setting_upload() to authenticated;
grant execute on function public.workshop_status_setting_source() to authenticated;
grant execute on function public.workshop_status_actor_name() to authenticated;
grant execute on function public.workshop_status_can_view() to authenticated;

-- Rollback (only before real data exists):
--   delete from public.module_permissions where module_key = 'daily_ops:workshop' and org_id is null;
--   drop table public.workshop_status_attachments, public.workshop_status_events,
--     public.workshop_status_upload_rows, public.workshop_status_records,
--     public.workshop_status_uploads;
--   drop function public.workshop_status_record_audit(), public.workshop_status_record_stamp(),
--     public.workshop_status_attachment_stamp(), public.workshop_status_upload_stamp(),
--     public.workshop_status_upload_row_stamp(), public.workshop_status_event_immutable(),
--     public.workshop_status_event_stamp(), public.workshop_status_can_view(),
--     public.workshop_status_actor_name(), public.workshop_status_setting_source(),
--     public.workshop_status_setting_upload(), public.workshop_status_setting(text),
--     public.workshop_status_breakdown_for(uuid, text, text);
