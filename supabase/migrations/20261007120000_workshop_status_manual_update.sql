-- ============================================================================
-- Workshop Status - manual vehicle update (Loop 8)
-- ============================================================================
-- STATUS: APPLIED to production 2026-10-07 (owner go-ahead). Tested in PGlite (supabase/tests/
-- workshop_status_manual_update.test.mjs, applied on top of 20261007090000,
-- 20261007100000 and 20261007110000). Apply to production only on an explicit
-- owner go-ahead, and only after those three.
--
-- workshop_status_update_record(record_id, patch, expected_updated_at) is the
-- ONE writer for the TyrePulse-owned operational fields of a workshop vehicle
-- (the Vehicle Update Drawer). Rules enforced here, not in the browser:
--   * workshop_status_can('update'); changing the responsible or supporting
--     person additionally needs workshop_status_can('assign').
--   * Only the 15 TyrePulse-owned keys are accepted. Any other key (an
--     Excel-owned field, identity, lineage, membership, "updated by") is
--     refused with 22023, so an upload's data can never be edited by hand.
--   * Stage / delay reason / parts status are checked against the same lists
--     as src/lib/workshopStatus/vocab.js (workshop_status_manual_vocab below).
--     CHANGE BOTH TOGETHER - the PGlite test compares the two.
--     'Removed From Current Report' is set by an upload only, never by hand.
--   * Delay reason 'Other' needs a detailed reason.
--   * Responsible / supporting person must be an approved, unlocked profile in
--     the caller's organisation.
--   * Optimistic concurrency: a stale expected_updated_at is refused with
--     errcode PT409 and message 'record_changed: ...'. Never 40001 (PostgREST
--     retries 40001 forever).
--   * Who and when are NEVER taken from the input: the record stamp trigger
--     sets last_updated_by / last_updated_by_name / last_manual_update_at from
--     auth.uid() because workshop.source = 'manual' is set for this
--     transaction only (set_config(..., true)). The record audit trigger writes
--     one field_change event per changed field; this function adds one
--     manual_update summary event. A patch that changes nothing writes nothing.
--
-- Rollback:
--   drop function public.workshop_status_update_record(uuid, jsonb, timestamptz);
--   drop function public.workshop_status_manual_vocab(text);
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Controlled vocabularies (mirror of src/lib/workshopStatus/vocab.js).
-- 'stage' = SELECTABLE_STAGES (CURRENT_STAGES without 'Removed From Current
-- Report'), 'delay' = DELAY_REASONS, 'parts' = PARTS_STATUSES.
-- ---------------------------------------------------------------------------
create or replace function public.workshop_status_manual_vocab(p_kind text)
returns text[] language sql immutable set search_path = public as $$
  select case p_kind
    when 'stage' then array[
      'Newly Reported', 'Waiting for Diagnosis', 'Diagnosis in Progress', 'Repair in Progress',
      'Waiting', 'Waiting for Parts', 'Waiting for Approval', 'Waiting for Manpower',
      'Waiting for External Vendor', 'External Repair', 'Testing', 'Road Test',
      'QC / Inspection', 'Ready for Release', 'Operational Hold']
    when 'delay' then array[
      'Waiting for Spare Parts', 'Spare Parts Not Available', 'MR Pending', 'PO Pending',
      'Supplier Delivery Pending', 'Waiting for Manpower', 'Technician Not Available',
      'Specialist Technician Required', 'Waiting for Workshop Bay', 'Waiting for Tools / Equipment',
      'Waiting for External Vendor', 'Sent to External Workshop', 'Waiting for Diagnosis',
      'Repair in Progress', 'Waiting for Approval', 'Waiting for Budget Approval',
      'Waiting for Vehicle Recovery / Towing', 'Waiting for Site to Release Vehicle',
      'Waiting for Testing', 'Waiting for Road Test', 'Waiting for QC / Inspection',
      'Accident Repair', 'Warranty Claim', 'Major Engine Repair', 'Major Gearbox Repair',
      'Electrical Issue', 'Hydraulic Issue', 'Tyre Related', 'Body Repair',
      'No Operator / Driver', 'Operational Hold', 'Other']
    when 'parts' then array[
      'Not Required', 'Required', 'Checking Store', 'Available in Store', 'MR Pending',
      'MR Raised', 'MR Approved', 'PO Pending', 'PO Issued', 'Supplier Confirmed',
      'In Transit', 'Partially Received', 'Received', 'Not Available',
      'Alternative Part Under Review']
    else '{}'::text[]
  end
$$;

-- ---------------------------------------------------------------------------
-- The writer.
-- ---------------------------------------------------------------------------
create or replace function public.workshop_status_update_record(
  p_record_id uuid, p_patch jsonb, p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_org uuid := public.app_current_org();
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_allowed text[] := array[
    'current_stage', 'delay_reason', 'detailed_reason', 'work_done', 'action_taken',
    'next_action', 'parts_status', 'mr_number', 'po_number', 'responsible_user_id',
    'supporting_user_id', 'expected_part_date', 'expected_release_date', 'blocker', 'remarks'];
  v_text_fields text[] := array['detailed_reason', 'work_done', 'action_taken', 'next_action',
    'blocker', 'remarks'];
  v_ref_fields text[] := array['mr_number', 'po_number'];
  v_r public.workshop_status_records%rowtype;
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_raw text;
  v_val text;
  v_date date;
  v_changed text[] := '{}';
  v_out jsonb;
begin
  if not coalesce(public.workshop_status_can('update'), false) then
    raise exception 'You do not have permission to update workshop vehicles' using errcode = '42501';
  end if;
  if v_org is null then
    raise exception 'Your account is not linked to an organisation' using errcode = '42501';
  end if;
  if p_record_id is null then
    raise exception 'Choose a vehicle to update' using errcode = '22023';
  end if;
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception 'The update must be a set of named fields' using errcode = '22023';
  end if;

  -- Only TyrePulse-owned keys. Anything else is refused, never ignored.
  select k into v_key from jsonb_object_keys(v_patch) k where not (k = any (v_allowed)) limit 1;
  if found then
    raise exception 'This field cannot be changed here: %', v_key using errcode = '22023';
  end if;

  select * into v_r from public.workshop_status_records where id = p_record_id for update;
  -- Not found, another organisation, no longer active, soft deleted, or outside
  -- the caller's country / site scope: all read as "not found" so nothing about
  -- a record the caller cannot see leaks out.
  if not found or v_r.organisation_id <> v_org or not v_r.current_active or v_r.deleted_at is not null
     or not (
       coalesce(public.is_super_admin(), false)
       or v_r.country is null
       or coalesce(public.app_sees_all_countries(), false)
       or lower(btrim(v_r.country)) = any (coalesce(public.app_country_scope(), '{}'::text[])))
     or not (
       v_r.site is null or btrim(v_r.site) = ''
       or coalesce(public.app_sees_all_sites(), false)
       or upper(btrim(v_r.site)) = any (coalesce(public.app_site_scope(), '{}'::text[]))) then
    raise exception 'Workshop vehicle not found' using errcode = 'P0002';
  end if;

  if p_expected_updated_at is not null and v_r.updated_at is distinct from p_expected_updated_at then
    raise exception 'record_changed: this vehicle was updated by someone else' using errcode = 'PT409';
  end if;

  v_old := to_jsonb(v_r);
  v_new := v_old;

  foreach v_key in array v_allowed loop
    continue when not (v_patch ? v_key);
    v_raw := case when jsonb_typeof(v_patch -> v_key) = 'null' then null else v_patch ->> v_key end;
    v_val := nullif(btrim(coalesce(v_raw, '')), '');

    if v_key = 'current_stage' and v_val is not null
       and not (v_val = any (public.workshop_status_manual_vocab('stage'))) then
      raise exception 'Choose a current stage from the list' using errcode = '22023';
    elsif v_key = 'delay_reason' and v_val is not null
       and not (v_val = any (public.workshop_status_manual_vocab('delay'))) then
      raise exception 'Choose a delay reason from the list' using errcode = '22023';
    elsif v_key = 'parts_status' and v_val is not null
       and not (v_val = any (public.workshop_status_manual_vocab('parts'))) then
      raise exception 'Choose a parts status from the list' using errcode = '22023';
    elsif v_key = any (v_text_fields) and length(v_val) > 4000 then
      raise exception 'The text is too long (4000 characters at most)' using errcode = '22023';
    elsif v_key = any (v_ref_fields) and length(v_val) > 100 then
      raise exception 'The reference number is too long (100 characters at most)' using errcode = '22023';
    elsif v_key in ('expected_part_date', 'expected_release_date') and v_val is not null then
      begin
        if v_val !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad'; end if;
        v_date := v_val::date;
      exception when others then
        raise exception 'Enter a valid date (yyyy-mm-dd)' using errcode = '22023';
      end;
      if v_date < date '2000-01-01' or v_date > date '2100-12-31' then
        raise exception 'Enter a realistic date' using errcode = '22023';
      end if;
      v_val := v_date::text;
    elsif v_key in ('responsible_user_id', 'supporting_user_id') and v_val is not null then
      if v_val !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Choose a person from the list' using errcode = '22023';
      end if;
      v_val := lower(v_val);
    end if;

    v_new := jsonb_set(v_new, array[v_key], coalesce(to_jsonb(v_val), 'null'::jsonb));
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      v_changed := v_changed || v_key;
    end if;
  end loop;

  -- Delay reason 'Other' needs a written reason (checked on the final values
  -- whenever either field is part of the update).
  if (v_patch ? 'delay_reason' or v_patch ? 'detailed_reason')
     and (v_new ->> 'delay_reason') = 'Other'
     and nullif(btrim(coalesce(v_new ->> 'detailed_reason', '')), '') is null then
    raise exception 'A detailed reason is required when the delay reason is Other' using errcode = '22023';
  end if;

  if array_length(v_changed, 1) is null then
    return jsonb_build_object('ok', true, 'changed', 0, 'fields', '[]'::jsonb);
  end if;

  -- People: assignment permission, then a real approved person in this org.
  if ('responsible_user_id' = any (v_changed) or 'supporting_user_id' = any (v_changed))
     and not coalesce(public.workshop_status_can('assign'), false) then
    raise exception 'You do not have permission to assign workshop vehicles' using errcode = '42501';
  end if;
  foreach v_key in array array['responsible_user_id', 'supporting_user_id'] loop
    continue when not (v_key = any (v_changed)) or (v_new ->> v_key) is null;
    if not exists (select 1 from public.profiles p
                    where p.id = (v_new ->> v_key)::uuid
                      and p.organisation_id = v_org
                      and coalesce(p.approved, false)
                      and not coalesce(p.locked, false)) then
      raise exception 'Choose an approved person from your organisation' using errcode = '22023';
    end if;
  end loop;

  perform set_config('workshop.source', 'manual', true);
  perform set_config('workshop.upload_id', '', true);
  perform set_config('workshop.reason', '', true);
  perform set_config('workshop.suppress_fields', '', true);

  update public.workshop_status_records set
    current_stage         = v_new ->> 'current_stage',
    delay_reason          = v_new ->> 'delay_reason',
    detailed_reason       = v_new ->> 'detailed_reason',
    work_done             = v_new ->> 'work_done',
    action_taken          = v_new ->> 'action_taken',
    next_action           = v_new ->> 'next_action',
    parts_status          = v_new ->> 'parts_status',
    mr_number             = v_new ->> 'mr_number',
    po_number             = v_new ->> 'po_number',
    responsible_user_id   = (v_new ->> 'responsible_user_id')::uuid,
    supporting_user_id    = (v_new ->> 'supporting_user_id')::uuid,
    expected_part_date    = (v_new ->> 'expected_part_date')::date,
    expected_release_date = (v_new ->> 'expected_release_date')::date,
    blocker               = v_new ->> 'blocker',
    remarks               = v_new ->> 'remarks'
  where id = v_r.id;

  insert into public.workshop_status_events
    (organisation_id, country, site, record_id, asset_no, event_type, source, details)
  values (v_r.organisation_id, v_r.country, v_r.site, v_r.id, v_r.asset_no, 'manual_update', 'manual',
          jsonb_build_object('changed_fields', to_jsonb(v_changed), 'changed', array_length(v_changed, 1)));

  select to_jsonb(r)
         || jsonb_build_object(
              'last_updated_at', r.updated_at,
              'responsible_user_name', (select coalesce(nullif(btrim(p.full_name), ''), p.username)
                                          from public.profiles p where p.id = r.responsible_user_id),
              'supporting_user_name', (select coalesce(nullif(btrim(p.full_name), ''), p.username)
                                         from public.profiles p where p.id = r.supporting_user_id))
    into v_out
    from public.workshop_status_records r where r.id = v_r.id;

  return jsonb_build_object('ok', true, 'changed', array_length(v_changed, 1),
                            'fields', to_jsonb(v_changed), 'record', v_out);
end $$;

-- Writer: authenticated first, then revoke PUBLIC, then anon (V500 order).
-- The vocabulary helper is internal only.
grant execute on function public.workshop_status_update_record(uuid, jsonb, timestamptz) to authenticated;
revoke all on function public.workshop_status_update_record(uuid, jsonb, timestamptz) from public;
revoke all on function public.workshop_status_update_record(uuid, jsonb, timestamptz) from anon;
revoke all on function public.workshop_status_manual_vocab(text) from public, anon, authenticated;
