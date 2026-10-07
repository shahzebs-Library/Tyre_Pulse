-- ============================================================================
-- Workshop Status - atomic upload staging and confirmation (Loop 6)
-- ============================================================================
-- STATUS: APPLIED to production 2026-10-07 (owner go-ahead). Tested in PGlite (supabase/tests/
-- workshop_status_upload_confirm.test.mjs, applied on top of the Loop 1
-- foundation and the Loop 2 permissions). Apply to production only on an
-- explicit owner go-ahead, and only after 20261007090000 and 20261007100000.
--
-- Flow: the browser parses the daily Excel and builds a preview
-- (excelParser + compareUpload). It then:
--   1. workshop_status_stage_upload(...)   -> stores the upload + parsed rows
--                                              (status 'previewed'), reports a
--                                              duplicate file by hash.
--   2. workshop_status_confirm_upload(id)  -> ONE transaction: applies the
--                                              staged rows to the live list.
--      or workshop_status_cancel_upload(id).
--
-- Rules enforced on the server (the client preview is advisory only):
--   * Membership is RECOMPUTED here from the staged rows; the client's
--     outcome labels are not trusted for which vehicles are active.
--   * An upload writes ONLY Excel-owned columns. TyrePulse-owned fields
--     (stage, delay reason, people, release date, remarks ...) are never
--     touched, and nothing is ever deleted. A vehicle absent from the file
--     becomes current_active = false with a reason; final_disposition is left
--     for a person.
--   * excel_down_days is a daily formula in the file, so it is STORED but
--     left out of change detection (mirror of compareUpload
--     DEFAULT_IGNORED_FIELDS). An upload whose only difference is down days
--     counts as unchanged and writes no field_change event.
--   * Text is compared the way the preview compares it: trimmed, collapsed,
--     case-insensitive; site upper case with a trailing -ST/_ST stripped.
--     CHANGE BOTH TOGETHER (src/lib/workshopStatus/compareUpload.js).
--   * Two confirms for one org + country serialise on an advisory lock, and a
--     preview made before another upload of the same country was confirmed is
--     refused as stale_preview.
--   * workshop.* settings are set with set_config(..., true): transaction
--     local, never leaked to the next request on a pooled connection.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers (internal; executed only from the SECURITY DEFINER writers).
-- ---------------------------------------------------------------------------

-- yyyy-mm-dd text -> date; anything else (or an impossible date) -> null.
create or replace function public.workshop_status_jdate(p text)
returns date language plpgsql immutable set search_path = public as $$
begin
  if p is null or btrim(p) !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return btrim(p)::date;
exception when others then
  return null;
end $$;

-- integer text (optionally "12.0") -> integer; anything else -> null.
create or replace function public.workshop_status_jint(p text)
returns integer language plpgsql immutable set search_path = public as $$
begin
  if p is null or btrim(p) !~ '^-?\d{1,9}(\.\d+)?$' then return null; end if;
  return round(btrim(p)::numeric)::integer;
exception when others then
  return null;
end $$;

-- Text value of a jsonb key; blank -> null.
create or replace function public.workshop_status_jtext(p_data jsonb, p_key text)
returns text language sql immutable set search_path = public as $$
  select nullif(btrim(p_data ->> p_key), '')
$$;

-- Comparable form of an Excel-owned text value (mirror of compareUpload
-- normaliseForCompare for text and site).
create or replace function public.workshop_status_cmp(p_field text, p_value text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_value is null then null
    when p_field = 'site' then
      nullif(btrim(regexp_replace(upper(btrim(regexp_replace(replace(p_value, chr(160), ' '), '\s+', ' ', 'g'))),
                                  '[-_]ST$', '')), '')
    else nullif(lower(btrim(regexp_replace(replace(p_value, chr(160), ' '), '\s+', ' ', 'g'))), '')
  end
$$;

-- Canonical asset number: upper case, no whitespace.
create or replace function public.workshop_status_asset_key(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '\s', '', 'g')), '')
$$;

-- ---------------------------------------------------------------------------
-- Record audit: same as the foundation, plus workshop.suppress_fields - a
-- comma list of fields whose field_change event is skipped for this write.
-- The confirm function sets it to 'excel_down_days' only for a write whose
-- sole difference is the daily down-days formula.
-- ---------------------------------------------------------------------------
create or replace function public.workshop_status_record_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_source text := public.workshop_status_setting_source();
  v_upload uuid := public.workshop_status_setting_upload();
  v_reason text := public.workshop_status_setting('reason');
  v_suppress text[] := coalesce(string_to_array(replace(coalesce(public.workshop_status_setting('suppress_fields'), ''), ' ', ''), ','), '{}');
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
    if f = any (v_suppress) then continue; end if;
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
  v_dup record;
  v_id uuid;
  v_no bigint;
  v_prev integer;
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

  perform set_config('workshop.source', 'excel', true);
  perform set_config('workshop.reason', '', true);

  -- An earlier upload of exactly the same file (confirmed first, then previewed).
  if v_hash is not null then
    select u.id, u.upload_no, u.uploaded_at, u.uploaded_by_name, u.status into v_dup
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
         v_prev, v_dup.id,
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

  insert into public.workshop_status_upload_rows
    (upload_id, row_number, section, asset_no, site, outcome, data, raw, changes, errors, record_id)
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
              then (e ->> 'record_id')::uuid end
    from jsonb_array_elements(v_rows) with ordinality as t(e, ord)
   order by ord;

  insert into public.workshop_status_events (organisation_id, country, upload_id, event_type, source, details)
  values (v_org, v_country, v_id, 'upload_previewed', 'excel',
          jsonb_build_object('file_name', btrim(p_file_name), 'rows', v_n,
                             'duplicate_of_upload_id', v_dup.id));

  return jsonb_build_object(
    'upload_id', v_id,
    'upload_no', v_no,
    'duplicate_of', case when v_dup.id is null then null else jsonb_build_object(
      'id', v_dup.id, 'upload_no', v_dup.upload_no, 'uploaded_at', v_dup.uploaded_at,
      'uploaded_by_name', v_dup.uploaded_by_name, 'status', v_dup.status) end);
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
  v_new_ids uuid[] := '{}'; v_upd_ids uuid[] := '{}'; v_same_ids uuid[] := '{}'; v_rem_ids uuid[] := '{}';
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

      if v_changed then
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
                jsonb_build_object('fields', to_jsonb(v_fields), 'row_number', s.row_number,
                  'message', 'Vehicle details refreshed from the Daily Workshop Excel upload.'));
        v_upd_ids := v_upd_ids || r.id;
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

  -- Every active record not in today's active rows leaves the current report.
  for r in
    select * from public.workshop_status_records
     where organisation_id = v_org and country = v_country and current_active and deleted_at is null
       and not (public.workshop_status_asset_key(asset_no) = any (v_active))
     order by asset_no, id
     for update
  loop
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
    'active_after', v_n_after);

  insert into public.workshop_status_events (organisation_id, country, upload_id, event_type, source, details)
  values (v_org, v_country, v_up.id, 'upload_confirmed', 'excel',
          v_summary || jsonb_build_object(
            'duplicate_acknowledged', (v_up.duplicate_of_upload_id is not null and coalesce(p_acknowledge_duplicate, false)),
            'duplicate_of_upload_id', v_up.duplicate_of_upload_id,
            'record_ids', jsonb_build_object('new', to_jsonb(v_new_ids), 'updated', to_jsonb(v_upd_ids),
                                             'unchanged', to_jsonb(v_same_ids), 'removed', to_jsonb(v_rem_ids))));

  return v_summary;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Cancel a previewed upload.
-- ---------------------------------------------------------------------------
create or replace function public.workshop_status_cancel_upload(p_upload_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_org uuid := public.app_current_org();
  v_up public.workshop_status_uploads%rowtype;
begin
  if not (coalesce(public.workshop_status_can('upload'), false) or coalesce(public.workshop_status_can('confirm'), false)) then
    raise exception 'You do not have permission to cancel a workshop upload' using errcode = '42501';
  end if;
  select * into v_up from public.workshop_status_uploads where id = p_upload_id for update;
  if not found or v_org is null or v_up.organisation_id <> v_org then
    raise exception 'Upload not found' using errcode = 'P0002';
  end if;
  if v_up.status <> 'previewed' then
    raise exception 'upload_not_previewed: this upload is % and cannot be cancelled', v_up.status
      using errcode = 'P0001';
  end if;

  perform set_config('workshop.source', 'excel', true);
  perform set_config('workshop.upload_id', v_up.id::text, true);
  update public.workshop_status_uploads set status = 'cancelled' where id = v_up.id;
  insert into public.workshop_status_events (organisation_id, country, upload_id, event_type, source, details)
  values (v_org, v_up.country, v_up.id, 'upload_cancelled', 'excel',
          jsonb_build_object('file_name', v_up.file_name));
  return jsonb_build_object('upload_id', v_up.id, 'status', 'cancelled');
end $$;

-- ---------------------------------------------------------------------------
-- Privileges. Writers: authenticated first, then revoke PUBLIC, then anon
-- (V500 order). Helpers are internal only.
-- ---------------------------------------------------------------------------
grant execute on function public.workshop_status_stage_upload(text, text, text, bigint, text, date, jsonb, text[], jsonb) to authenticated;
grant execute on function public.workshop_status_confirm_upload(uuid, boolean) to authenticated;
grant execute on function public.workshop_status_cancel_upload(uuid) to authenticated;
revoke all on function public.workshop_status_stage_upload(text, text, text, bigint, text, date, jsonb, text[], jsonb) from public;
revoke all on function public.workshop_status_confirm_upload(uuid, boolean) from public;
revoke all on function public.workshop_status_cancel_upload(uuid) from public;
revoke all on function public.workshop_status_stage_upload(text, text, text, bigint, text, date, jsonb, text[], jsonb) from anon;
revoke all on function public.workshop_status_confirm_upload(uuid, boolean) from anon;
revoke all on function public.workshop_status_cancel_upload(uuid) from anon;

revoke all on function public.workshop_status_jdate(text) from public, anon, authenticated;
revoke all on function public.workshop_status_jint(text) from public, anon, authenticated;
revoke all on function public.workshop_status_jtext(jsonb, text) from public, anon, authenticated;
revoke all on function public.workshop_status_cmp(text, text) from public, anon, authenticated;
revoke all on function public.workshop_status_asset_key(text) from public, anon, authenticated;
revoke all on function public.workshop_status_record_audit() from public, anon, authenticated;

-- Rollback:
--   drop function public.workshop_status_cancel_upload(uuid);
--   drop function public.workshop_status_confirm_upload(uuid, boolean);
--   drop function public.workshop_status_stage_upload(text, text, text, bigint, text, date, jsonb, text[], jsonb);
--   drop function public.workshop_status_asset_key(text), public.workshop_status_cmp(text, text),
--     public.workshop_status_jtext(jsonb, text), public.workshop_status_jint(text),
--     public.workshop_status_jdate(text);
--   then re-run the workshop_status_record_audit() definition from
--   20261007090000_workshop_status_foundation.sql (it ignores suppress_fields).
