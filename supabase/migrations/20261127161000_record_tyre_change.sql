-- A tyre change closes the old tyre and fits the new one in ONE step.
--
-- STATUS: APPLIED LIVE 2026-11-27 on owner OK (yes 1-4). Post-apply check as Driver 07540a9c: drivers 1, accidents 0, issues 0, own issue insert ok, old meter edit changed nothing.
-- 2026-11-27 (see VERIFY). The main session applies it.
--
-- OWNER RULE (2026-11-27): a tyre change on the phone closes the old tyre and
-- fits the new one. "If the latest file uploads, so be it": a later ERP or
-- monthly-consumption upload for the same asset + position stays authoritative.
--
-- WHAT WAS THERE (checked live 2026-11-27):
--   * public.apply_tyre_change(jsonb) already closes + fits, BUT it is gated on
--     is_approved_and_unlocked() only (any approved role, the Driver included),
--     needs the caller to pass removed_record_id, never sets total_km on the
--     closed tyre, never sets size or data_source, and does not write
--     tyre_replacement_log, so the replacement cannot be undone like an import
--     replacement can. It is left untouched (callers exist); see NOTES.
--   * public._tyre_close_replaced(...) is the canonical "close the tyre on this
--     wheel" used by the monthly-consumption pipe and the web ERP importer. It
--     finds the one active tyre on the wheel, refuses ambiguous cases
--     (several active, undated, later history, older date), computes
--     total_km with tyre_km_life() and logs to tyre_replacement_log.
--     THIS RPC REUSES IT, so the phone and the importer close a tyre by the
--     same rule and an upload that follows meets a consistent wheel.
--
-- WHAT THIS ADDS:
--   public.record_tyre_change(...) SECURITY DEFINER, one transaction:
--     1. role gate: approved + unlocked AND (super admin, elevated, Tyre Man,
--        Tyre Data Collector, Tire Planning Engineer, Inspector, or an
--        app_user_can('tyre_records','create') grant) AND not explicitly
--        revoked. The Driver role is refused.
--     2. country/site resolved from the vehicle register when not passed;
--        country must pass app_write_country_ok (same rule as the table).
--     3. idempotent on p_request_id (stored in extra_fields.phone_request_id):
--        a replay returns the row it already made.
--     4. the new serial may not already be active on another wheel.
--     5. closes the active tyre via _tyre_close_replaced (status 'Removed',
--        removal_date, km_at_removal, total_km, tyre_replacement_log row),
--        then stamps removal_reason on it.
--        'same_tyre' -> nothing to change, returns the current row.
--        ambiguous_* -> refused with the reason, nothing written.
--     6. inserts the new Active row: issue_date (fitment_date is GENERATED
--        from it and never written), km_at_fitment, hrs_at_fitment, serial,
--        brand, size, position AND tyre_position, data_source 'manual',
--        uploaded_by, category 'Tyre Change'.
--     7. writes one audit_log_v2 event (record_audit_event).
--   The approval gate (approval_private.guard_tyre_execution) is NOT bypassed:
--   if tyre-change approval is ever enforced for the org, the insert raises
--   42501 and the phone must use request_tyre_change_approval instead.
--
-- HOW A LATER UPLOAD MEETS THE PHONE ROW (import code NOT changed):
--   Monthly consumption (stg_monthly_tyres -> process_stg_monthly_tyres):
--     * Exact match key = serial + country + org + fix_date + job_card +
--       position. The phone row has NO job_card, so an ERP row for the same
--       tyre never exact-matches it.
--     * It then calls _tyre_close_replaced for the wheel. With the SAME serial
--       already active it returns 'same_tyre' and the importer REJECTS the ERP
--       row as 'replacement_needs_review:same_tyre' (stg_monthly_tyres_audit).
--       Result: NO duplicate, but the ERP job card / km / cost are not merged
--       into the phone row either. The phone row stays authoritative until a
--       reviewer acts. This contradicts "latest upload wins".
--     * A DIFFERENT serial (phone typo) with a fix date on/after the phone
--       date closes the phone row and fits the ERP tyre: the upload SUPERSEDES
--       it, leaving the phone row as a short removed history row.
--     * An ERP fix date BEFORE the phone date returns ambiguous_not_later and
--       the ERP row is held for review.
--   Web ERP intake (src/lib/api/erpIntake.js insertTyreRecords):
--     * key = serial | asset | position | fix_date (lower-cased). Same four ->
--       the phone row is REFRESHED in place from the file (non-blank fields
--       win), i.e. superseded. A different fix date for the same serial falls to
--       the same _tyre_close_replaced check above ('same_tyre' -> review).
--   PROPOSED RECONCILE RULE (needs the owner's yes, then an import change):
--     When the import meets 'same_tyre' and the live row is data_source
--     'manual' with no job_card, PATCH the live row from the upload
--     (job_card, issue_date, km_at_fitment, brand, size, cost_per_tyre) with
--     import_changed_supplied_patch, set data_source = 'upload', and log the
--     before/after to stg_monthly_tyres_audit. When the import closes a
--     'manual' row fitted within 3 days with total_km < 100, flag it
--     extra_fields.superseded_phone_row = true so tyre-life reports skip it.
--
-- NOTES:
--   * Consider revoking apply_tyre_change from the Driver role or gating it the
--     same way once callers move to record_tyre_change (owner decision).

begin;

create or replace function public.record_tyre_change(
  p_asset_no       text,
  p_position       text,
  p_new_serial     text,
  p_brand          text    default null,
  p_size           text    default null,
  p_change_date    date    default null,
  p_km             numeric default null,
  p_hours          numeric default null,
  p_removal_reason text    default null,
  p_country        text    default null,
  p_site           text    default null,
  p_cost           numeric default null,
  p_request_id     uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_org     uuid := public.app_current_org();
  v_asset   text := nullif(upper(regexp_replace(coalesce(p_asset_no, ''), '\s+', '', 'g')), '');
  v_pos     text := nullif(upper(btrim(coalesce(p_position, ''))), '');
  v_serial  text := nullif(btrim(coalesce(p_new_serial, '')), '');
  v_date    date := coalesce(p_change_date, current_date);
  v_reason  text := nullif(btrim(coalesce(p_removal_reason, '')), '');
  v_country text := nullif(btrim(coalesce(p_country, '')), '');
  v_site    text := nullif(btrim(coalesce(p_site, '')), '');
  v_vtype   text;
  v_n       int;
  v_close   jsonb;
  v_status  text;
  v_closed  uuid;
  v_new     uuid;
  v_row     public.tyre_records%rowtype;
begin
  -- 1. who may change a tyre
  if v_uid is null or not coalesce(public.is_approved_and_unlocked(), false) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if not (
       public.is_super_admin()
    or public.app_is_elevated()
    or public.app_role() in ('tyre_man', 'tyre_data_collector', 'tire_planning_engineer', 'inspector')
    or public.app_user_can('tyre_records', 'create')
  ) or public.app_cap_revoked('tyre_records', 'create') then
    raise exception 'You do not have permission to record a tyre change.' using errcode = '42501';
  end if;

  if v_asset is null then raise exception 'Asset number is required.' using errcode = '22004'; end if;
  if v_pos is null or v_pos = '0' then raise exception 'Tyre position is required.' using errcode = '22004'; end if;
  if v_serial is null then raise exception 'New tyre serial is required.' using errcode = '22004'; end if;
  if v_date > current_date + 1 then raise exception 'The change date is in the future.' using errcode = '22023'; end if;
  if p_km is not null and (p_km < 0 or p_km::text in ('NaN', 'Infinity')) then
    raise exception 'Odometer reading is not valid.' using errcode = '22023'; end if;
  if p_hours is not null and (p_hours < 0 or p_hours::text in ('NaN', 'Infinity')) then
    raise exception 'Hour meter reading is not valid.' using errcode = '22023'; end if;

  -- 3. replay of a request already recorded
  if p_request_id is not null then
    select * into v_row from public.tyre_records
     where organisation_id is not distinct from v_org
       and extra_fields ->> 'phone_request_id' = p_request_id::text
     limit 1;
    if found then
      return jsonb_build_object('ok', true, 'replayed', true, 'fitted_record_id', v_row.id);
    end if;
  end if;

  -- 2. resolve country / site / vehicle type from the register
  select count(*) into v_n from public.vehicle_fleet f
   where f.organisation_id is not distinct from v_org
     and upper(regexp_replace(coalesce(f.asset_no, ''), '\s+', '', 'g')) = v_asset
     and (v_country is null or lower(btrim(f.country)) = lower(v_country));
  if v_n = 1 then
    select coalesce(v_country, f.country), coalesce(v_site, f.site), f.vehicle_type
      into v_country, v_site, v_vtype
      from public.vehicle_fleet f
     where f.organisation_id is not distinct from v_org
       and upper(regexp_replace(coalesce(f.asset_no, ''), '\s+', '', 'g')) = v_asset
       and (v_country is null or lower(btrim(f.country)) = lower(v_country));
  elsif v_n > 1 then
    raise exception 'Asset % exists in more than one country; choose the country.', v_asset using errcode = '22023';
  end if;
  if v_country is null then
    raise exception 'Choose the country for asset %.', v_asset using errcode = '22004';
  end if;
  v_country := public.normalize_country(v_country);
  if not public.app_write_country_ok(v_country) then
    raise exception 'Cross-country tyre change denied.' using errcode = '42501';
  end if;
  if v_site is not null and not (
       public.app_sees_all_sites()
    or upper(btrim(v_site)) = any (coalesce(public.app_site_scope(), '{}'::text[]))) then
    raise exception 'This site is outside your access.' using errcode = '42501';
  end if;

  -- 4. the new serial must not already be on another wheel
  if exists (
    select 1 from public.tyre_records t
     where t.organisation_id is not distinct from v_org
       and coalesce(t.country, '') = coalesce(v_country, '')
       and upper(btrim(coalesce(t.serial_no, ''))) = upper(v_serial)
       and public.tyre_status_is_active(t.status)
       and not (upper(regexp_replace(coalesce(t.asset_no, t.asset_number, ''), '\s+', '', 'g')) = v_asset
                and upper(btrim(coalesce(t.tyre_position, t.position, ''))) = v_pos)
  ) then
    raise exception 'Tyre % is already fitted on another wheel. Remove it there first.', v_serial using errcode = '23505';
  end if;

  -- 5. close the tyre on this wheel (canonical rule shared with the importers)
  v_close := public._tyre_close_replaced(
    v_org, v_country, v_asset, v_pos, v_serial, v_date, p_km, p_hours,
    'phone_tyre_change', coalesce(p_request_id, gen_random_uuid()), false, false);
  v_status := coalesce(v_close ->> 'status', 'unknown');

  if v_status = 'same_tyre' then
    return jsonb_build_object('ok', true, 'unchanged', true, 'reason', 'same_tyre',
                              'fitted_record_id', (v_close ->> 'tyre_id')::uuid);
  end if;
  if v_status not in ('closed', 'no_previous') then
    raise exception 'The tyre on % % cannot be closed automatically (%). Ask a supervisor to review the wheel history.',
      v_asset, v_pos, v_status using errcode = '23514';
  end if;
  v_closed := nullif(v_close ->> 'tyre_id', '')::uuid;
  if v_closed is not null and v_reason is not null then
    update public.tyre_records set removal_reason = v_reason where id = v_closed;
  end if;

  -- 6. fit the new tyre
  insert into public.tyre_records
    (asset_no, serial_no, brand, size, site, country, vehicle_type, cost_per_tyre, qty,
     position, tyre_position, km_at_fitment, hrs_at_fitment, issue_date,
     status, risk_level, category, data_source, uploaded_by, organisation_id, extra_fields)
  values
    (v_asset, v_serial, nullif(btrim(coalesce(p_brand, '')), ''), nullif(btrim(coalesce(p_size, '')), ''),
     v_site, v_country, v_vtype, p_cost, 1,
     v_pos, v_pos, p_km, p_hours, v_date,
     'Active', 'Low', 'Tyre Change', 'manual', v_uid, v_org,
     jsonb_strip_nulls(jsonb_build_object('phone_request_id', p_request_id::text,
                                          'replaced_record_id', v_closed::text,
                                          'entry_channel', 'record_tyre_change')))
  returning id into v_new;

  -- 7. audit
  perform public.record_audit_event('tyre_change', 'tyre_records', v_new::text,
    case when v_closed is null then null else jsonb_build_object('removed_record_id', v_closed,
      'old_serial', v_close ->> 'old_serial', 'removal_reason', v_reason, 'status', 'Removed') end,
    jsonb_build_object('fitment_record_id', v_new, 'asset_no', v_asset, 'position', v_pos,
      'serial_no', v_serial, 'brand', p_brand, 'size', p_size, 'km_at_fitment', p_km,
      'hrs_at_fitment', p_hours, 'fitment_date', v_date, 'data_source', 'manual'));

  return jsonb_build_object('ok', true, 'fitted_record_id', v_new,
                            'removed_record_id', v_closed, 'close_status', v_status,
                            'old_serial', v_close ->> 'old_serial');
end;
$$;

comment on function public.record_tyre_change(text, text, text, text, text, date, numeric, numeric, text, text, text, numeric, uuid) is
  'Phone tyre change: closes the active tyre on asset+position via _tyre_close_replaced and fits the new one (data_source manual) in one transaction. Tyre roles + elevated only.';

revoke execute on function public.record_tyre_change(text, text, text, text, text, date, numeric, numeric, text, text, text, numeric, uuid) from public;
revoke execute on function public.record_tyre_change(text, text, text, text, text, date, numeric, numeric, text, text, text, numeric, uuid) from anon;
grant execute on function public.record_tyre_change(text, text, text, text, text, date, numeric, numeric, text, text, text, numeric, uuid) to authenticated, service_role;

commit;

-- VERIFY (rolled back):
--   begin;
--   select set_config('request.jwt.claims','{"sub":"4b760941-85bc-43c5-ae2f-f881c2911f67","role":"authenticated"}',true);
--   set local role authenticated;
--   select record_tyre_change('TM715','LHRI','V2TEST001','TRIANGLE','315/80R22.5',current_date,70000,null,'Worn out',null,null,null,gen_random_uuid());
--   -- expect ok, close_status 'closed', old tyre Removed with total_km = 70000 - 66833
--   rollback;
--   Driver 07540a9c -> 42501.
--   Tested 2026-11-27 as Tyre Man 4b760941 (rolled back):
--     change TM715 LHRI -> ok, close_status closed; old row Removed,
--       removal_date today, km_at_removal 70000, total_km 3167, reason WORN OUT;
--       new row Active, data_source manual, issue_date = fitment_date = today,
--       position/tyre_position LHRI, size set; 1 active tyre on the wheel;
--       1 tyre_replacement_log row (source phone_tyre_change).
--     replay same p_request_id -> {replayed:true}, same row, nothing new.
--     same serial again, new request id -> {unchanged, same_tyre}.
--     that serial on BH024 RHF2 -> 23505 already fitted on another wheel.
--     BH024 RHF2 dated before its current fitment -> 23514 ambiguous_not_later.
--     country UAE -> 42501 cross-country.
--     Driver -> 42501 no permission.
--
-- ROLLBACK:
--   drop function public.record_tyre_change(text, text, text, text, text, date, numeric, numeric, text, text, text, numeric, uuid);
