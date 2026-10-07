-- ============================================================================
-- Workshop Status - removed / closed record recovery (Loop 11)
-- ============================================================================
-- STATUS: NOT APPLIED. Tested in PGlite (supabase/tests/
-- workshop_status_removed_recovery.test.mjs, applied on top of 20261007090000,
-- 20261007100000, 20261007110000 and 20261007120000). Apply to production
-- only on an explicit owner go-ahead, and only after those four.
--
-- workshop_status_record_action(record_id, action, reason, disposition,
-- remarks, expected_updated_at) is the ONE writer for what happens to a
-- vehicle after it left the daily report ("Released" in the UI). Actions:
--
--   disposition       record how the vehicle left        can('disposition')
--   restore           back to the active report          can('restore')
--   archive           move to the archive                can('archive')
--   unarchive         back to the removed list           can('archive')
--   soft_delete       hide a wrong / duplicate record    can('soft_delete')
--   undelete          bring a soft-deleted record back   can('soft_delete')
--   permanent_delete  erase a soft-deleted record        can('permanent_delete')
--                                                        (super admin only)
--
-- Rules enforced here, not in the browser:
--   * Only records that are NOT in the active report are handled here. An
--     active vehicle leaves the report through an upload only.
--   * Every action except disposition needs a reason (at least 5 characters);
--     disposition 'other' needs remarks (table check constraint).
--   * restore refuses when the same vehicle already has an active record (a
--     later upload started a new episode) and when the record is archived
--     (unarchive first). It clears final_disposition, because the vehicle is
--     back in the workshop; the old disposition stays in the event log.
--   * The removal is never erased: removed_at / removed_by_upload_id /
--     removed_reason stay as the record of the last removal, and the
--     'removed' event is append-only. Restore writes its own 'restored' event
--     carrying the removal it reverses.
--   * permanent_delete only erases a record that is already soft deleted. The
--     record audit trigger leaves a 'permanently_deleted' event with the full
--     row and the reason, so the history survives.
--   * Optimistic concurrency: a stale expected_updated_at is refused with
--     errcode PT409 'record_changed: ...'. Never 40001.
--   * Not found, another organisation, or outside the caller's country / site
--     scope all read as "not found" (P0002).
--   * Who and when come from auth.uid() through the record stamp trigger
--     (workshop.source = 'manual', workshop.reason = the reason, for this
--     transaction only).
--
-- Rollback:
--   drop function public.workshop_status_record_action(uuid, text, text, text, text, timestamptz);
-- ============================================================================

create or replace function public.workshop_status_record_action(
  p_record_id uuid,
  p_action text,
  p_reason text default null,
  p_disposition text default null,
  p_remarks text default null,
  p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_org uuid := public.app_current_org();
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_disp text := nullif(btrim(coalesce(p_disposition, '')), '');
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
  v_perm text;
  v_r public.workshop_status_records%rowtype;
  v_event text;
  v_details jsonb;
  v_out jsonb;
begin
  v_perm := case v_action
    when 'disposition' then 'disposition'
    when 'restore' then 'restore'
    when 'archive' then 'archive'
    when 'unarchive' then 'archive'
    when 'soft_delete' then 'soft_delete'
    when 'undelete' then 'soft_delete'
    when 'permanent_delete' then 'permanent_delete'
  end;
  if v_perm is null then
    raise exception 'Unknown action' using errcode = '22023';
  end if;
  if not coalesce(public.workshop_status_can(v_perm), false) then
    raise exception 'You do not have permission to do this' using errcode = '42501';
  end if;
  if v_org is null and not coalesce(public.is_super_admin(), false) then
    raise exception 'Your account is not linked to an organisation' using errcode = '42501';
  end if;
  if p_record_id is null then
    raise exception 'Choose a vehicle' using errcode = '22023';
  end if;

  select * into v_r from public.workshop_status_records where id = p_record_id for update;
  if not found
     or (v_r.organisation_id is distinct from v_org and not coalesce(public.is_super_admin(), false))
     or not (
       coalesce(public.is_super_admin(), false)
       or v_r.country is null
       or coalesce(public.app_sees_all_countries(), false)
       or lower(btrim(v_r.country)) = any (coalesce(public.app_country_scope(), '{}'::text[])))
     or not (
       coalesce(public.is_super_admin(), false)
       or v_r.site is null or btrim(v_r.site) = ''
       or coalesce(public.app_sees_all_sites(), false)
       or upper(btrim(v_r.site)) = any (coalesce(public.app_site_scope(), '{}'::text[])))
     -- A soft-deleted record is invisible to anyone who cannot soft delete.
     or (v_r.deleted_at is not null and not coalesce(public.workshop_status_can('soft_delete'), false)) then
    raise exception 'Workshop vehicle not found' using errcode = 'P0002';
  end if;

  if p_expected_updated_at is not null and v_r.updated_at is distinct from p_expected_updated_at then
    raise exception 'record_changed: this vehicle was updated by someone else' using errcode = 'PT409';
  end if;

  if v_r.current_active then
    raise exception 'This vehicle is still in the active report' using errcode = '22023';
  end if;

  if v_action <> 'disposition' then
    if v_reason is null or length(v_reason) < 5 then
      raise exception 'Enter a reason (at least 5 characters)' using errcode = '22023';
    end if;
    if length(v_reason) > 1000 then
      raise exception 'The reason is too long (1000 characters at most)' using errcode = '22023';
    end if;
  end if;

  -- State checks per action.
  if v_action in ('disposition', 'restore', 'archive', 'unarchive', 'soft_delete')
     and v_r.deleted_at is not null then
    raise exception 'This record is deleted. Undelete it first' using errcode = '22023';
  end if;
  if v_action in ('undelete', 'permanent_delete') and v_r.deleted_at is null then
    raise exception 'This record is not deleted' using errcode = '22023';
  end if;
  if v_action in ('restore', 'archive') and v_r.archived_at is not null then
    raise exception 'This record is archived. Unarchive it first' using errcode = '22023';
  end if;
  if v_action = 'unarchive' and v_r.archived_at is null then
    raise exception 'This record is not archived' using errcode = '22023';
  end if;

  if v_action = 'disposition' then
    if v_disp is null or not (v_disp = any (array[
        'repair_completed', 'returned_to_operation', 'transferred_site', 'sent_external_workshop',
        'vehicle_sold', 'vehicle_scrapped', 'wrong_entry', 'duplicate_entry', 'other'])) then
      raise exception 'Choose a final disposition from the list' using errcode = '22023';
    end if;
    if v_disp = 'other' and v_remarks is null then
      raise exception 'Remarks are required when the disposition is Other' using errcode = '22023';
    end if;
    if length(v_remarks) > 2000 then
      raise exception 'The remarks are too long (2000 characters at most)' using errcode = '22023';
    end if;
    if v_disp is not distinct from v_r.final_disposition
       and v_remarks is not distinct from v_r.final_disposition_remarks then
      return jsonb_build_object('ok', true, 'changed', 0);
    end if;
  end if;

  if v_action = 'restore' and exists (
      select 1 from public.workshop_status_records x
       where x.organisation_id = v_r.organisation_id
         and x.country is not distinct from v_r.country
         and x.asset_no = v_r.asset_no
         and x.current_active and x.deleted_at is null
         and x.id <> v_r.id) then
    raise exception 'This vehicle is already in the active report' using errcode = '23505';
  end if;

  perform set_config('workshop.source', 'manual', true);
  perform set_config('workshop.upload_id', '', true);
  perform set_config('workshop.reason', coalesce(v_reason, ''), true);
  perform set_config('workshop.suppress_fields', '', true);

  if v_action = 'permanent_delete' then
    delete from public.workshop_status_records where id = v_r.id;
    return jsonb_build_object('ok', true, 'changed', 1, 'deleted', true, 'record_id', v_r.id);
  end if;

  if v_action = 'disposition' then
    update public.workshop_status_records
       set final_disposition = v_disp, final_disposition_remarks = v_remarks
     where id = v_r.id;
    v_event := 'final_disposition';
    v_details := jsonb_strip_nulls(jsonb_build_object(
      'disposition', v_disp, 'remarks', v_remarks,
      'previous_disposition', v_r.final_disposition));
  elsif v_action = 'restore' then
    update public.workshop_status_records
       set current_active = true,
           daily_report_status = 'restored',
           final_disposition = null,
           final_disposition_remarks = null
     where id = v_r.id;
    v_event := 'restored';
    v_details := jsonb_strip_nulls(jsonb_build_object(
      'message', 'Vehicle restored to the active workshop report.',
      'removed_at', v_r.removed_at,
      'removed_by_upload_id', v_r.removed_by_upload_id,
      'removed_reason', v_r.removed_reason,
      'cleared_disposition', v_r.final_disposition));
  elsif v_action = 'archive' then
    update public.workshop_status_records
       set archived_at = now(), archive_reason = v_reason, daily_report_status = 'archived'
     where id = v_r.id;
    v_event := 'archived';
  elsif v_action = 'unarchive' then
    update public.workshop_status_records
       set archived_at = null, archive_reason = null,
           daily_report_status = 'removed_from_current_report'
     where id = v_r.id;
    v_event := 'unarchived';
  elsif v_action = 'soft_delete' then
    update public.workshop_status_records
       set deleted_at = now(), delete_reason = v_reason
     where id = v_r.id;
    v_event := 'soft_deleted';
  elsif v_action = 'undelete' then
    update public.workshop_status_records
       set deleted_at = null, delete_reason = null
     where id = v_r.id;
    v_event := 'undeleted';
  end if;

  insert into public.workshop_status_events
    (organisation_id, country, site, record_id, asset_no, event_type, source, reason, details)
  values (v_r.organisation_id, v_r.country, v_r.site, v_r.id, v_r.asset_no, v_event, 'manual',
          v_reason, coalesce(v_details, '{}'::jsonb));

  select to_jsonb(r) into v_out from public.workshop_status_records r where r.id = v_r.id;
  return jsonb_build_object('ok', true, 'changed', 1, 'record', v_out);
end $$;

-- Writer: authenticated first, then revoke PUBLIC, then anon (V500 order).
grant execute on function public.workshop_status_record_action(uuid, text, text, text, text, timestamptz) to authenticated;
revoke all on function public.workshop_status_record_action(uuid, text, text, text, text, timestamptz) from public;
revoke all on function public.workshop_status_record_action(uuid, text, text, text, text, timestamptz) from anon;
