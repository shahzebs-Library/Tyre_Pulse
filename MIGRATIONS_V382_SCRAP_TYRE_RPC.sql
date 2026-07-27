-- V382. Let the people who actually handle tyres scrap one, atomically.
--
-- THE PROBLEM: scrapping is TWO writes - an authoritative mark in
-- tyre_status_marks and a status stamp on every tyre_records row for that
-- serial - and the two have different RLS. Measured on a real Tyre Data
-- Collector account:
--     is_approved_and_unlocked()            true   -> CAN write the mark
--     app_user_can('tyre_records','edit')   false
--     role_update_tyre_records (admin|manager only) -> CANNOT stamp the status
--
-- So simply showing the button to a tyre role produces a PARTIAL SCRAP: the
-- mark lands, the tyre keeps reading Active in the pool, and the two sources
-- disagree. This codebase has already reverted one change for exactly that
-- failure mode, so the fix has to make both writes succeed together or not at
-- all rather than loosening the table policy.
--
-- WHY NOT JUST WIDEN role_update_tyre_records: that would let a tyre collector
-- edit ANY column on ANY tyre record, when all they need is to mark one scrapped.
-- This function is the narrow right: it writes exactly two things and nothing else.
--
-- WHO CAN: the field roles that handle tyres, a super admin, or ANY individual
-- granted the tyre_records edit capability, so an admin can authorise one person
-- without a migration. A new custom role either goes in this list or gets the
-- capability grant.
create or replace function public.tyre_scrap_allowed()
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.is_approved_and_unlocked()
     and (
       public.is_super_admin()
       or public.app_role() in ('admin','manager','director','inspector',
                                'tyre_man','tyre_data_collector')
       or public.app_user_can('tyre_records', 'edit')
     );
$$;

create or replace function public.scrap_tyre_by_serial(
  p_serial  text,
  p_reason  text default null,
  p_country text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_org uuid := public.app_current_org();
  v_s   text := btrim(coalesce(p_serial, ''));
  v_n   int;
begin
  if v_s = '' then
    raise exception 'Serial number is required' using errcode = '22023';
  end if;
  -- DEFINER bypasses RLS, so org scope and permission are checked here by hand.
  if v_org is null or not public.tyre_scrap_allowed() then
    raise exception 'You do not have permission to scrap a tyre' using errcode = '42501';
  end if;

  -- 1. the authoritative mark. Idempotent: re-scrapping refreshes the reason.
  insert into public.tyre_status_marks (serial, mark_type, reason, country, created_by, organisation_id)
  values (v_s, 'scrap', nullif(btrim(coalesce(p_reason, '')), ''),
          nullif(btrim(coalesce(p_country, '')), ''), auth.uid(), v_org)
  on conflict (serial, mark_type) do update
    set reason     = excluded.reason,
        created_by = excluded.created_by,
        country    = coalesce(excluded.country, tyre_status_marks.country);

  -- 2. the lifecycle stamp on EVERY row for this serial, scoped to the caller's
  --    org only. Deliberately NOT scoped by country: the mark is global, so
  --    stamping one country's rows would leave the same tyre reading Scrapped in
  --    one view and Active in another. That partial state is the bug this
  --    function exists to prevent.
  update public.tyre_records
     set status = 'Scrapped'
   where serial_no = v_s
     and organisation_id = v_org;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'serial', v_s, 'updated', v_n);
end $$;

create or replace function public.unscrap_tyre_by_serial(p_serial text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_org uuid := public.app_current_org();
  v_s   text := btrim(coalesce(p_serial, ''));
  v_n   int;
begin
  if v_s = '' then
    raise exception 'Serial number is required' using errcode = '22023';
  end if;
  if v_org is null or not public.tyre_scrap_allowed() then
    raise exception 'You do not have permission to undo a scrap' using errcode = '42501';
  end if;

  delete from public.tyre_status_marks
   where serial = v_s and mark_type = 'scrap' and organisation_id = v_org;

  -- only rows still flagged Scrapped revert; removal_date and km_at_removal are
  -- untouched, so a genuinely removed tyre stays out of the allocatable pool.
  update public.tyre_records
     set status = 'Active'
   where serial_no = v_s
     and organisation_id = v_org
     and status = 'Scrapped';
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'serial', v_s, 'updated', v_n);
end $$;

revoke all on function public.tyre_scrap_allowed() from public, anon;
revoke all on function public.scrap_tyre_by_serial(text, text, text) from public, anon;
revoke all on function public.unscrap_tyre_by_serial(text) from public, anon;
grant execute on function public.tyre_scrap_allowed() to authenticated;
grant execute on function public.scrap_tyre_by_serial(text, text, text) to authenticated;
grant execute on function public.unscrap_tyre_by_serial(text) to authenticated;
