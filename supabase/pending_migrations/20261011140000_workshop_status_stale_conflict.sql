-- !! DO NOT APPLY AS-IS (2026-10-11). The live workshop_status_confirm_upload /
-- !! stage_upload are NOT the 110000 bodies this file copies: a parallel session
-- !! (branch claude/dreamy-faraday-9bwtmt) applied workshop_status_stale_file_guard
-- !! (kept_newer_manual_update, workshop_status_local_day, kept_count) and
-- !! workshop_status_upload_country_scope live with no repo file on this branch.
-- !! Applying this would overwrite them. Reconcile the two loop-16 designs first.
-- ============================================================================
-- Workshop Status - stale daily Excel vs a newer manual update (Loop 16)
-- ============================================================================
-- STATUS: AUTHORED, NOT APPLIED. Tested in PGlite (supabase/tests/
-- workshop_status_stale_conflict.test.mjs, applied on top of 20261007090000,
-- 20261007100000, 20261007110000, 20261007120000 and 20261007130000). Apply
-- only on an explicit owner go-ahead, and only after those five.
--
-- Problem: the daily Excel describes the workshop as it was on its REPORT
-- DATE. A person may have worked on a vehicle in TyrePulse after that (a
-- manual update in the Vehicle Update Drawer, or a restore of a released
-- vehicle - both stamp workshop_status_records.last_manual_update_at). An
-- older or same-day file must not silently overwrite that newer knowledge:
--   * a 'changed' row would refresh the vehicle's Excel fields, and
--   * a vehicle missing from the file would be RELEASED (DB token
--     removed_from_current_report).
--
-- Rule (mirror of src/lib/workshopStatus/compareUpload.js isManualNewer -
-- CHANGE BOTH TOGETHER):
--   conflict 'manual_newer' when the file has a report date AND the record has
--   a last_manual_update_at AND the manual update's LOCAL calendar day (the
--   record's country time zone) is on or after the report date. A file with no
--   report date cannot be judged and never conflicts. A manual update before
--   the report date is older than the file and is overwritten normally.
--
-- Resolution per conflicting row: 'keep_manual' (DEFAULT - the record is left
-- exactly as it is; a vehicle the file would release stays active) or
-- 'take_file' (the upload applies as before). The browser sends the choice as
-- `resolution` on the staged row; the CONFIRM function re-checks the conflict
-- against the live record at apply time (the authority) and only then reads the
-- choice, so a missing or stale choice always falls back to keep_manual.
-- Upload rows stay append-only: the stage step records the conflict evidence
-- (conflict / resolution / conflict_details), the confirm records what it
-- actually applied in the upload_confirmed event (details.conflict_rows) and
-- in workshop_status_uploads.conflict_count / kept_manual_count.
--
-- Also fixes: workshop_status_stage_upload raised "record v_dup is not
-- assigned yet" when the file hash was null. A null hash now simply means no
-- duplicate check.
--
-- Every other behaviour of stage / confirm is unchanged (bodies taken from
-- 20261007110000, the latest definition). SECURITY DEFINER, search_path public,
-- authenticated first then revoke PUBLIC then anon (V500 order).
--
-- Rollback: re-run sections 1 and 2 of 20261007110000 (stage + confirm); the
-- added columns are nullable / defaulted and can stay.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Columns.
-- ---------------------------------------------------------------------------
alter table public.workshop_status_upload_rows
  add column if not exists conflict text,
  add column if not exists resolution text,
  add column if not exists conflict_details jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workshop_status_upload_rows_conflict_chk') then
    alter table public.workshop_status_upload_rows
      add constraint workshop_status_upload_rows_conflict_chk
      check (conflict is null or conflict in ('manual_newer'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'workshop_status_upload_rows_resolution_chk') then
    alter table public.workshop_status_upload_rows
      add constraint workshop_status_upload_rows_resolution_chk
      check (resolution is null or resolution in ('keep_manual', 'take_file'));
  end if;
end $$;

alter table public.workshop_status_uploads
  add column if not exists conflict_count integer not null default 0,
  add column if not exists kept_manual_count integer not null default 0;

-- ---------------------------------------------------------------------------
-- Helpers (internal).
-- ---------------------------------------------------------------------------

-- Calendar day of a timestamp in the country's own time zone.
create or replace function public.workshop_status_local_date(p_ts timestamptz, p_country text)
returns date language sql stable set search_path = public as $$
  select case when p_ts is null then null else
    (p_ts at time zone (case upper(btrim(coalesce(p_country, '')))
       when 'KSA' then 'Asia/Riyadh'
       when 'SAUDI ARABIA' then 'Asia/Riyadh'
       when 'UAE' then 'Asia/Dubai'
       when 'EGYPT' then 'Africa/Cairo'
       else 'UTC' end))::date end
$$;

-- A manual update on or after the file's report date (local day).
create or replace function public.workshop_status_manual_newer(
  p_manual_at timestamptz, p_country text, p_report_date date)
returns boolean language sql stable set search_path = public as $$
  select coalesce(p_manual_at is not null and p_report_date is not null
                  and public.workshop_status_local_date(p_manual_at, p_country) >= p_report_date, false)
$$;

-- ---------------------------------------------------------------------------
-- 1. Stage an upload (status 'previewed').
-- ---------------------------------------------------------------------------
create or replace function public.workshop_status_stage_upload(
  p_country text, p_file_name text, p_file_hash text, p_file_size bigint, p_sheet_name text,
  p_report_date date, p_header_map jsonb, p_unmapped text[], p_rows jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_org uuid := public.app_current_org();
  v_country text := nullif(btrim(coalesce(p_country, '')), '');
  v_hash text := nullif(btrim(coalesce(p_file_hash, '')), '');
  v_rows jsonb := coalesce(p_rows, '[]'::jsonb);
  v_n integer;
  v_bad text;
  -- Scalars, not a record: with no hash the duplicate lookup never runs and a
  -- record variable would stay unassigned (the old null-hash bug).
  v_dup_id uuid;
  v_dup_no bigint;
  v_dup_at timestamptz;
  v_dup_by text;
  v_dup_status text;
  v_id uuid;
  v_no bigint;
  v_prev integer;
  v_conflicts integer;
begin
  if not coalesce(public.workshop_status_can('upload'), false) then
    raise exception 'You do not have permission to upload the workshop report' using errcode = '42501';
  end if;
  if v_org is null then
    raise exception 'Your account is not linked to an organisation' using errcode = '42501';
  end if;
  if v_country is null then
    raise exception 'Choose the country this workshop report belongs to' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_file_name, '')), '') is null then
    raise exception 'The file name is missing' using errcode = '22023';
  end if;
  if jsonb_typeof(v_rows) <> 'array' then
    raise exception 'The upload rows must be a list' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(v_rows);
  if v_n > 5000 then
    raise exception 'The upload has % rows; the limit is 5000', v_n using errcode = '22023';
  end if;
  select e ->> 'outcome' into v_bad
    from jsonb_array_elements(v_rows) e
   where coalesce(e ->> 'outcome', '') not in
         ('new', 'changed', 'unchanged', 'removed', 'closed', 'invalid', 'duplicate')
   limit 1;
  if found then
    raise exception 'Unknown row outcome: %', coalesce(v_bad, '(blank)') using errcode = '22023';
  end if;
  select e ->> 'resolution' into v_bad
    from jsonb_array_elements(v_rows) e
   where nullif(btrim(coalesce(e ->> 'resolution', '')), '') is not null
     and e ->> 'resolution' not in ('keep_manual', 'take_file')
   limit 1;
  if found then
    raise exception 'Unknown conflict choice: %', v_bad using errcode = '22023';
  end if;

  perform set_config('workshop.source', 'excel', true);
  perform set_config('workshop.reason', '', true);

  -- An earlier upload of exactly the same file (confirmed first, then previewed).
  if v_hash is not null then
    select u.id, u.upload_no, u.uploaded_at, u.uploaded_by_name, u.status
      into v_dup_id, v_dup_no, v_dup_at, v_dup_by, v_dup_status
      from public.workshop_status_uploads u
     where u.organisation_id = v_org and u.file_hash = v_hash
       and u.status in ('confirmed', 'previewed')
     order by (u.status = 'confirmed') desc, u.uploaded_at desc, u.upload_no desc
     limit 1;
  end if;

  select count(*)::int into v_prev
    from public.workshop_status_records r
   where r.organisation_id = v_org and r.country = v_country
     and r.current_active and r.deleted_at is null;

  insert into public.workshop_status_uploads
    (organisation_id, country, file_name, file_hash, file_size_bytes, sheet_name, report_date,
     status, header_map, unmapped_headers, previous_active_count, duplicate_of_upload_id,
     total_rows, new_count, updated_count, unchanged_count, removed_count, closed_count,
     invalid_count, duplicate_count)
  select v_org, v_country, btrim(p_file_name), v_hash, p_file_size, nullif(btrim(coalesce(p_sheet_name, '')), ''),
         p_report_date, 'previewed', coalesce(p_header_map, '{}'::jsonb), coalesce(p_unmapped, '{}'),
         v_prev, v_dup_id,
         count(*) filter (where e ->> 'outcome' <> 'removed'),
         count(*) filter (where e ->> 'outcome' = 'new'),
         count(*) filter (where e ->> 'outcome' = 'changed'),
         count(*) filter (where e ->> 'outcome' = 'unchanged'),
         count(*) filter (where e ->> 'outcome' = 'removed'),
         count(*) filter (where e ->> 'outcome' = 'closed'),
         count(*) filter (where e ->> 'outcome' = 'invalid'),
         count(*) filter (where e ->> 'outcome' = 'duplicate')
    from jsonb_array_elements(v_rows) e
  returning id, upload_no into v_id, v_no;

  perform set_config('workshop.upload_id', v_id::text, true);

  -- Conflict evidence: a 'changed' or 'removed' row whose live record carries a
  -- manual update on or after the report date. The confirm re-checks this.
  insert into public.workshop_status_upload_rows
    (upload_id, row_number, section, asset_no, site, outcome, data, raw, changes, errors, record_id,
     conflict, resolution, conflict_details)
  select v_id,
         public.workshop_status_jint(e ->> 'row_number'),
         public.workshop_status_jtext(e, 'section'),
         public.workshop_status_asset_key(e ->> 'asset_no'),
         public.workshop_status_jtext(e, 'site'),
         e ->> 'outcome',
         case when jsonb_typeof(e -> 'data') = 'object' then e -> 'data' else '{}'::jsonb end,
         case when jsonb_typeof(e -> 'raw') = 'object' then e -> 'raw' else '{}'::jsonb end,
         case when jsonb_typeof(e -> 'changes') = 'object' then e -> 'changes' else '{}'::jsonb end,
         case when jsonb_typeof(e -> 'errors') = 'array'
              then array(select jsonb_array_elements_text(e -> 'errors')) else '{}'::text[] end,
         case when (e ->> 'record_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (e ->> 'record_id')::uuid end,
         case when m.id is not null then 'manual_newer' end,
         case when m.id is not null then nullif(btrim(coalesce(e ->> 'resolution', '')), '') end,
         case when m.id is null then '{}'::jsonb else jsonb_build_object(
           'record_id', m.id,
           'last_manual_update_at', m.last_manual_update_at,
           'last_updated_by_name', m.last_updated_by_name,
           'report_date', p_report_date) end
    from jsonb_array_elements(v_rows) with ordinality as t(e, ord)
    left join lateral (
      select r.id, r.last_manual_update_at, r.last_updated_by_name
        from public.workshop_status_records r
       where e ->> 'outcome' in ('changed', 'removed')
         and r.organisation_id = v_org and r.country = v_country
         and r.current_active and r.deleted_at is null
         and public.workshop_status_asset_key(r.asset_no) = public.workshop_status_asset_key(e ->> 'asset_no')
         and public.workshop_status_manual_newer(r.last_manual_update_at, r.country, p_report_date)
       order by r.id
       limit 1) m on true
   order by ord;

  select count(*)::int into v_conflicts
    from public.workshop_status_upload_rows where upload_id = v_id and conflict is not null;
  if v_conflicts > 0 then
    update public.workshop_status_uploads set conflict_count = v_conflicts where id = v_id;
  end if;

  insert into public.workshop_status_events (organisation_id, country, upload_id, event_type, source, details)
  values (v_org, v_country, v_id, 'upload_previewed', 'excel',
          jsonb_build_object('file_name', btrim(p_file_name), 'rows', v_n,
                             'duplicate_of_upload_id', v_dup_id, 'conflicts', v_conflicts));

  return jsonb_build_object(
    'upload_id', v_id,
    'upload_no', v_no,
    'conflicts', v_conflicts,
    'duplicate_of', case when v_dup_id is null then null else jsonb_build_object(
      'id', v_dup_id, 'upload_no', v_dup_no, 'uploaded_at', v_dup_at,
      'uploaded_by_name', v_dup_by, 'status', v_dup_status) end);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Confirm an upload. ONE transaction: any raise rolls everything back, so
-- the live list is either fully updated or untouched.
-- ---------------------------------------------------------------------------
create or replace function public.workshop_status_confirm_upload(
  p_upload_id uuid, p_acknowledge_duplicate boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_org uuid := public.app_current_org();
  v_up public.workshop_status_uploads%rowtype;
  v_country text;
  v_prior text[];
  v_active text[] := '{}';
  v_closed text[];
  s record;
  r public.workshop_status_records%rowtype;
  v_data jsonb;
  v_reg text; v_jc text; v_cat text; v_site text; v_dept text; v_comp text; v_diag text;
  v_ooc date; v_days integer; v_etr text; v_note text; v_rem text;
  v_changed boolean;
  v_fields text[];
  v_vehicle uuid;
  v_new_id uuid;
  v_reason text;
  v_closed_row jsonb;
  v_conflict boolean;
  v_choice text;
  v_new_ids uuid[] := '{}'; v_upd_ids uuid[] := '{}'; v_same_ids uuid[] := '{}'; v_rem_ids uuid[] := '{}';
  v_kept_ids uuid[] := '{}'; v_taken_ids uuid[] := '{}';
  v_conflict_log jsonb := '[]'::jsonb;
  v_n_closed integer; v_n_invalid integer; v_n_dup integer; v_n_prev integer; v_n_after integer;
  v_summary jsonb;
begin
  if not coalesce(public.workshop_status_can('confirm'), false) then
    raise exception 'You do not have permission to confirm the workshop report' using errcode = '42501';
  end if;

  select * into v_up from public.workshop_status_uploads where id = p_upload_id for update;
  if not found or v_org is null or v_up.organisation_id <> v_org then
    raise exception 'Upload not found' using errcode = 'P0002';
  end if;
  if v_up.status <> 'previewed' then
    raise exception 'upload_not_previewed: this upload is % and cannot be confirmed', v_up.status
      using errcode = 'P0001';
  end if;
  v_country := v_up.country;

  -- Two confirms for one org + country run one after the other.
  perform pg_advisory_xact_lock(hashtext('workshop_status:' || v_org::text || ':' || v_country));

  if v_up.duplicate_of_upload_id is not null and not coalesce(p_acknowledge_duplicate, false) then
    raise exception 'duplicate_file: this file was already uploaded' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.workshop_status_uploads u
              where u.organisation_id = v_org and u.country = v_country and u.id <> v_up.id
                and u.status = 'confirmed' and u.confirmed_at > v_up.uploaded_at) then
    raise exception 'stale_preview: another upload for this country was confirmed after this preview'
      using errcode = 'P0001';
  end if;

  perform set_config('workshop.source', 'excel', true);
  perform set_config('workshop.upload_id', v_up.id::text, true);
  perform set_config('workshop.reason', '', true);
  perform set_config('workshop.suppress_fields', '', true);

  -- Active records before this upload (for the closed count and the summary).
  select coalesce(array_agg(public.workshop_status_asset_key(asset_no)), '{}'), count(*)::int
    into v_prior, v_n_prev
    from public.workshop_status_records
   where organisation_id = v_org and country = v_country and current_active and deleted_at is null;

  select coalesce(array_agg(distinct asset_no) filter (where asset_no is not null), '{}')
    into v_closed
    from public.workshop_status_upload_rows
   where upload_id = v_up.id and outcome = 'closed';

  -- Active staged rows: one per canonical asset (first row wins).
  for s in
    select distinct on (public.workshop_status_asset_key(ur.asset_no))
           public.workshop_status_asset_key(ur.asset_no) as asset, ur.data, ur.row_number, ur.id
      from public.workshop_status_upload_rows ur
     where ur.upload_id = v_up.id and ur.outcome in ('new', 'changed', 'unchanged')
       and public.workshop_status_asset_key(ur.asset_no) is not null
     order by public.workshop_status_asset_key(ur.asset_no), ur.row_number nulls last, ur.created_at, ur.id
  loop
    v_active := v_active || s.asset;
    v_data := coalesce(s.data, '{}'::jsonb);
    v_reg  := public.workshop_status_jtext(v_data, 'reg_no');
    v_jc   := public.workshop_status_jtext(v_data, 'job_card_ref');
    v_cat  := public.workshop_status_jtext(v_data, 'vehicle_category');
    v_site := public.workshop_status_jtext(v_data, 'site');
    v_dept := public.workshop_status_jtext(v_data, 'department');
    v_comp := public.workshop_status_jtext(v_data, 'complaint');
    v_diag := public.workshop_status_jtext(v_data, 'diagnostics');
    v_ooc  := public.workshop_status_jdate(v_data ->> 'ooc_since');
    v_days := public.workshop_status_jint(v_data ->> 'excel_down_days');
    v_etr  := public.workshop_status_jtext(v_data, 'excel_expected_release');
    v_note := public.workshop_status_jtext(v_data, 'excel_status_note');
    v_rem  := public.workshop_status_jtext(v_data, 'source_remarks');

    select * into r from public.workshop_status_records
     where organisation_id = v_org and country = v_country and current_active and deleted_at is null
       and public.workshop_status_asset_key(asset_no) = s.asset
     order by id limit 1
     for update;

    if found then
      -- excel_down_days deliberately not compared (daily formula).
      v_fields := array_remove(array[
        case when public.workshop_status_cmp('reg_no', r.reg_no) is distinct from public.workshop_status_cmp('reg_no', v_reg) then 'reg_no' end,
        case when public.workshop_status_cmp('job_card_ref', r.job_card_ref) is distinct from public.workshop_status_cmp('job_card_ref', v_jc) then 'job_card_ref' end,
        case when public.workshop_status_cmp('vehicle_category', r.vehicle_category) is distinct from public.workshop_status_cmp('vehicle_category', v_cat) then 'vehicle_category' end,
        case when public.workshop_status_cmp('site', r.site) is distinct from public.workshop_status_cmp('site', v_site) then 'site' end,
        case when public.workshop_status_cmp('department', r.department) is distinct from public.workshop_status_cmp('department', v_dept) then 'department' end,
        case when public.workshop_status_cmp('complaint', r.complaint) is distinct from public.workshop_status_cmp('complaint', v_comp) then 'complaint' end,
        case when public.workshop_status_cmp('diagnostics', r.diagnostics) is distinct from public.workshop_status_cmp('diagnostics', v_diag) then 'diagnostics' end,
        case when r.ooc_since is distinct from v_ooc then 'ooc_since' end,
        case when public.workshop_status_cmp('excel_expected_release', r.excel_expected_release) is distinct from public.workshop_status_cmp('excel_expected_release', v_etr) then 'excel_expected_release' end,
        case when public.workshop_status_cmp('excel_status_note', r.excel_status_note) is distinct from public.workshop_status_cmp('excel_status_note', v_note) then 'excel_status_note' end,
        case when public.workshop_status_cmp('source_remarks', r.source_remarks) is distinct from public.workshop_status_cmp('source_remarks', v_rem) then 'source_remarks' end
      ], null);
      v_changed := cardinality(v_fields) > 0;

      -- Stale file vs a newer manual update: keep the record unless the person
      -- chose to take the file. Re-checked here against the live record.
      v_conflict := v_changed and public.workshop_status_manual_newer(r.last_manual_update_at, v_country, v_up.report_date);
      v_choice := null;
      if v_conflict then
        select ur.resolution into v_choice
          from public.workshop_status_upload_rows ur
         where ur.upload_id = v_up.id and ur.resolution is not null
           and public.workshop_status_asset_key(ur.asset_no) = s.asset
         order by (ur.id = s.id) desc, ur.row_number nulls last, ur.id
         limit 1;
        v_choice := coalesce(v_choice, 'keep_manual');
        -- Upload rows are append-only: the applied choice is recorded in the
        -- upload_confirmed event instead.
        v_conflict_log := v_conflict_log || jsonb_build_object(
          'asset_no', s.asset, 'record_id', r.id, 'kind', 'changed', 'resolution', v_choice,
          'fields', to_jsonb(v_fields), 'last_manual_update_at', r.last_manual_update_at,
          'last_updated_by_name', r.last_updated_by_name);
      end if;

      if v_conflict and v_choice = 'keep_manual' then
        -- The record keeps every value; only the lineage notes the vehicle was
        -- in the file (no writer context, no field_change event).
        perform set_config('workshop.source', '', true);
        update public.workshop_status_records set
          last_seen_upload_id = v_up.id, last_seen_at = now()
         where id = r.id;
        perform set_config('workshop.source', 'excel', true);
        v_kept_ids := v_kept_ids || r.id;
      elsif v_changed then
        update public.workshop_status_records set
          reg_no = v_reg, job_card_ref = v_jc, vehicle_category = v_cat, site = v_site,
          department = v_dept, complaint = v_comp, diagnostics = v_diag, ooc_since = v_ooc,
          excel_down_days = v_days, excel_expected_release = v_etr, excel_status_note = v_note,
          source_remarks = v_rem, excel_data = v_data, excel_updated_at = now(),
          last_seen_upload_id = v_up.id, last_seen_at = now()
         where id = r.id;
        insert into public.workshop_status_events
          (organisation_id, country, record_id, upload_id, event_type, source, details)
        values (v_org, v_country, r.id, v_up.id, 'excel_updated', 'excel',
                jsonb_strip_nulls(jsonb_build_object('fields', to_jsonb(v_fields), 'row_number', s.row_number,
                  'conflict', case when v_conflict then 'manual_newer' end,
                  'resolution', case when v_conflict then v_choice end,
                  'message', 'Vehicle details refreshed from the Daily Workshop Excel upload.')));
        v_upd_ids := v_upd_ids || r.id;
        if v_conflict then v_taken_ids := v_taken_ids || r.id; end if;
      else
        -- Nothing the workshop would call a change: keep the daily down-days
        -- figure and the lineage, without touching the record's last-updated
        -- stamp (no writer context) and without a field_change event.
        perform set_config('workshop.source', '', true);
        perform set_config('workshop.suppress_fields', 'excel_down_days', true);
        update public.workshop_status_records set
          excel_down_days = v_days, excel_data = v_data,
          last_seen_upload_id = v_up.id, last_seen_at = now()
         where id = r.id;
        perform set_config('workshop.suppress_fields', '', true);
        perform set_config('workshop.source', 'excel', true);
        v_same_ids := v_same_ids || r.id;
      end if;
    else
      select case when count(*) = 1 then (array_agg(f.id))[1] end into v_vehicle
        from public.vehicle_fleet f
       where f.organisation_id = v_org and f.country is not distinct from v_country
         and public.workshop_status_asset_key(f.asset_no) = s.asset;

      insert into public.workshop_status_records
        (organisation_id, country, asset_no, vehicle_id, asset_breakdown_id,
         reg_no, job_card_ref, vehicle_category, site, department, complaint, diagnostics,
         ooc_since, excel_down_days, excel_expected_release, excel_status_note, source_remarks,
         excel_data, excel_updated_at, current_active, daily_report_status,
         first_seen_upload_id, last_seen_upload_id, last_seen_at)
      values
        (v_org, v_country, s.asset, v_vehicle, public.workshop_status_breakdown_for(v_org, v_country, s.asset),
         v_reg, v_jc, v_cat, v_site, v_dept, v_comp, v_diag,
         v_ooc, v_days, v_etr, v_note, v_rem,
         v_data, now(), true, 'active',
         v_up.id, v_up.id, now())
      returning id into v_new_id;
      v_new_ids := v_new_ids || v_new_id;
    end if;
  end loop;

  -- Every active record not in today's active rows leaves the current report
  -- (UI: "Released") - unless a newer manual update is kept.
  for r in
    select * from public.workshop_status_records
     where organisation_id = v_org and country = v_country and current_active and deleted_at is null
       and not (public.workshop_status_asset_key(asset_no) = any (v_active))
     order by asset_no, id
     for update
  loop
    v_conflict := public.workshop_status_manual_newer(r.last_manual_update_at, v_country, v_up.report_date);
    if v_conflict then
      select ur.resolution into v_choice
        from public.workshop_status_upload_rows ur
       where ur.upload_id = v_up.id and ur.outcome = 'removed' and ur.resolution is not null
         and (ur.record_id = r.id or ur.asset_no = public.workshop_status_asset_key(r.asset_no))
       order by (ur.record_id = r.id) desc nulls last, ur.id
       limit 1;
      v_choice := coalesce(v_choice, 'keep_manual');
      v_conflict_log := v_conflict_log || jsonb_build_object(
        'asset_no', public.workshop_status_asset_key(r.asset_no), 'record_id', r.id, 'kind', 'removed',
        'resolution', v_choice, 'last_manual_update_at', r.last_manual_update_at,
        'last_updated_by_name', r.last_updated_by_name);
      if v_choice = 'keep_manual' then
        v_kept_ids := v_kept_ids || r.id;
        continue;
      end if;
      v_taken_ids := v_taken_ids || r.id;
    end if;

    if public.workshop_status_asset_key(r.asset_no) = any (v_closed) then
      v_reason := 'listed_as_closed';
      select jsonb_build_object('row_number', ur.row_number, 'section', ur.section,
                                'job_card_ref', ur.data ->> 'job_card_ref')
        into v_closed_row
        from public.workshop_status_upload_rows ur
       where ur.upload_id = v_up.id and ur.outcome = 'closed'
         and ur.asset_no = public.workshop_status_asset_key(r.asset_no)
       order by ur.row_number nulls last, ur.id limit 1;
    else
      v_reason := 'missing_from_upload';
      v_closed_row := null;
    end if;

    perform set_config('workshop.reason', v_reason, true);
    update public.workshop_status_records set
      current_active = false,
      daily_report_status = 'removed_from_current_report',
      removed_at = now(),
      removed_by_upload_id = v_up.id,
      removed_reason = v_reason,
      previous_current_stage = r.current_stage,
      previous_delay_reason = r.delay_reason,
      previous_responsible_user_id = r.responsible_user_id
     where id = r.id;

    insert into public.workshop_status_events
      (organisation_id, country, site, record_id, asset_no, upload_id, event_type, reason, source, details)
    values (v_org, v_country, r.site, r.id, r.asset_no, v_up.id, 'removed', v_reason, 'excel',
            jsonb_strip_nulls(jsonb_build_object(
              'reason', v_reason,
              'closed_row', v_closed_row,
              'conflict', case when v_conflict then 'manual_newer' end,
              'resolution', case when v_conflict then 'take_file' end,
              'message', case when v_reason = 'listed_as_closed'
                then 'Vehicle removed from current workshop report because it was listed under closed details in the Excel.'
                else 'Vehicle removed from current workshop report because it was not present in the latest confirmed Excel upload.' end)));
    v_rem_ids := v_rem_ids || r.id;
  end loop;
  perform set_config('workshop.reason', '', true);

  -- Closed rows that are evidence only (not active today, not active before).
  select count(*)::int into v_n_closed
    from public.workshop_status_upload_rows ur
   where ur.upload_id = v_up.id and ur.outcome = 'closed'
     and ur.asset_no is not null
     and not (ur.asset_no = any (v_active)) and not (ur.asset_no = any (v_prior));
  select (count(*) filter (where outcome = 'invalid'))::int,
         (count(*) filter (where outcome = 'duplicate'))::int
    into v_n_invalid, v_n_dup
    from public.workshop_status_upload_rows where upload_id = v_up.id;
  -- An extra active row for an asset already taken is a duplicate too.
  v_n_dup := v_n_dup + (
    select count(*)::int from public.workshop_status_upload_rows
     where upload_id = v_up.id and outcome in ('new', 'changed', 'unchanged')
       and public.workshop_status_asset_key(asset_no) is not null) - cardinality(v_active);

  select count(*)::int into v_n_after
    from public.workshop_status_records
   where organisation_id = v_org and country = v_country and current_active and deleted_at is null;

  update public.workshop_status_uploads set
    status = 'confirmed',
    new_count = cardinality(v_new_ids),
    updated_count = cardinality(v_upd_ids),
    unchanged_count = cardinality(v_same_ids),
    removed_count = cardinality(v_rem_ids),
    closed_count = v_n_closed,
    invalid_count = v_n_invalid,
    duplicate_count = v_n_dup,
    previous_active_count = v_n_prev,
    conflict_count = cardinality(v_kept_ids) + cardinality(v_taken_ids),
    kept_manual_count = cardinality(v_kept_ids),
    duplicate_acknowledged = (v_up.duplicate_of_upload_id is not null and coalesce(p_acknowledge_duplicate, false))
   where id = v_up.id;

  v_summary := jsonb_build_object(
    'upload_id', v_up.id,
    'new', cardinality(v_new_ids),
    'updated', cardinality(v_upd_ids),
    'unchanged', cardinality(v_same_ids),
    'removed', cardinality(v_rem_ids),
    'closed', v_n_closed,
    'invalid', v_n_invalid,
    'duplicate', v_n_dup,
    'previous_active', v_n_prev,
    'active_after', v_n_after,
    'conflicts', cardinality(v_kept_ids) + cardinality(v_taken_ids),
    'kept_manual', cardinality(v_kept_ids));

  insert into public.workshop_status_events (organisation_id, country, upload_id, event_type, source, details)
  values (v_org, v_country, v_up.id, 'upload_confirmed', 'excel',
          v_summary || jsonb_build_object(
            'duplicate_acknowledged', (v_up.duplicate_of_upload_id is not null and coalesce(p_acknowledge_duplicate, false)),
            'duplicate_of_upload_id', v_up.duplicate_of_upload_id,
            'report_date', v_up.report_date,
            'conflict_rows', v_conflict_log,
            'record_ids', jsonb_build_object('new', to_jsonb(v_new_ids), 'updated', to_jsonb(v_upd_ids),
                                             'unchanged', to_jsonb(v_same_ids), 'removed', to_jsonb(v_rem_ids),
                                             'kept_manual', to_jsonb(v_kept_ids),
                                             'took_file', to_jsonb(v_taken_ids))));

  return v_summary;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges. Writers: authenticated first, then revoke PUBLIC, then anon
-- (V500 order). Helpers are internal only.
-- ---------------------------------------------------------------------------
grant execute on function public.workshop_status_stage_upload(text, text, text, bigint, text, date, jsonb, text[], jsonb) to authenticated;
grant execute on function public.workshop_status_confirm_upload(uuid, boolean) to authenticated;
revoke all on function public.workshop_status_stage_upload(text, text, text, bigint, text, date, jsonb, text[], jsonb) from public;
revoke all on function public.workshop_status_confirm_upload(uuid, boolean) from public;
revoke all on function public.workshop_status_stage_upload(text, text, text, bigint, text, date, jsonb, text[], jsonb) from anon;
revoke all on function public.workshop_status_confirm_upload(uuid, boolean) from anon;

revoke all on function public.workshop_status_local_date(timestamptz, text) from public, anon, authenticated;
revoke all on function public.workshop_status_manual_newer(timestamptz, text, date) from public, anon, authenticated;
