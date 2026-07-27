-- V382b. Undo a scrap by RESTORING what the status was, not by assuming 'Active'.
--
-- Found while testing the new scrap path on a real serial. The existing undo -
-- both the web service and everything built on it - does:
--     update tyre_records set status='Active' where serial_no=? and status='Scrapped'
-- which is wrong twice over, and wrong for administrators today, not just for
-- the new roles:
--
--   1. A tyre that was 'Removed' before it was scrapped comes back 'Active'.
--      Undo silently promotes a dead tyre into the allocatable pool.
--   2. It can fail outright. Proven live on serial A206286507: reverting it to
--      Active raised guard_tyre_active_fitment, "Position RHCI on asset MP081
--      already has an active tyre", because the position was refilled while the
--      tyre was scrapped. The undo button simply errors.
--
-- The fix is to remember. The scrap records each row's previous status on the
-- mark, and the undo puts exactly that back. Restoring a row to what it already
-- was cannot trip the fitment guard, because it is not creating a new active
-- fitment.
alter table public.tyre_status_marks
  add column if not exists prior_status jsonb;

comment on column public.tyre_status_marks.prior_status is
  'Map of tyre_records id -> status at the moment of marking, so an undo restores the real previous state instead of assuming Active.';

create or replace function public.scrap_tyre_by_serial(
  p_serial  text,
  p_reason  text default null,
  p_country text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_org uuid := public.app_current_org();
  v_s   text := btrim(coalesce(p_serial, ''));
  v_prior jsonb;
  v_n   int;
begin
  if v_s = '' then
    raise exception 'Serial number is required' using errcode = '22023';
  end if;
  if v_org is null or not public.tyre_scrap_allowed() then
    raise exception 'You do not have permission to scrap a tyre' using errcode = '42501';
  end if;

  -- capture what each row is NOW, before the stamp overwrites it. Rows already
  -- Scrapped are skipped so a second scrap cannot record 'Scrapped' as the state
  -- to return to.
  select coalesce(jsonb_object_agg(t.id::text, coalesce(t.status, 'Active')), '{}'::jsonb)
    into v_prior
    from public.tyre_records t
   where t.serial_no = v_s
     and t.organisation_id = v_org
     and coalesce(t.status, '') <> 'Scrapped';

  insert into public.tyre_status_marks
    (serial, mark_type, reason, country, created_by, organisation_id, prior_status)
  values (v_s, 'scrap', nullif(btrim(coalesce(p_reason, '')), ''),
          nullif(btrim(coalesce(p_country, '')), ''), auth.uid(), v_org, v_prior)
  on conflict (serial, mark_type) do update
    set reason     = excluded.reason,
        created_by = excluded.created_by,
        country    = coalesce(excluded.country, tyre_status_marks.country),
        -- keep the ORIGINAL capture on a repeat scrap; the second one sees only
        -- 'Scrapped' rows and would record nothing useful
        prior_status = case
          when tyre_status_marks.prior_status is null
            or tyre_status_marks.prior_status = '{}'::jsonb
          then excluded.prior_status
          else tyre_status_marks.prior_status end;

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
  v_prior jsonb;
  v_n   int := 0;
begin
  if v_s = '' then
    raise exception 'Serial number is required' using errcode = '22023';
  end if;
  if v_org is null or not public.tyre_scrap_allowed() then
    raise exception 'You do not have permission to undo a scrap' using errcode = '42501';
  end if;

  select prior_status into v_prior
    from public.tyre_status_marks
   where serial = v_s and mark_type = 'scrap' and organisation_id = v_org;

  delete from public.tyre_status_marks
   where serial = v_s and mark_type = 'scrap' and organisation_id = v_org;

  if v_prior is not null and v_prior <> '{}'::jsonb then
    -- put back exactly what each row was
    update public.tyre_records t
       set status = v_prior ->> t.id::text
     where t.serial_no = v_s
       and t.organisation_id = v_org
       and t.status = 'Scrapped'
       and v_prior ? t.id::text;
    get diagnostics v_n = row_count;
  else
    -- Marked before this column existed, so the previous state was never
    -- recorded. 'Active' is the historical behaviour and the only guess
    -- available; a row whose position has since been refilled will still be
    -- refused by guard_tyre_active_fitment rather than quietly double-fitting.
    update public.tyre_records
       set status = 'Active'
     where serial_no = v_s
       and organisation_id = v_org
       and status = 'Scrapped';
    get diagnostics v_n = row_count;
  end if;

  return jsonb_build_object('ok', true, 'serial', v_s, 'updated', v_n,
                            'restored_exactly', (v_prior is not null and v_prior <> '{}'::jsonb));
end $$;

revoke all on function public.scrap_tyre_by_serial(text, text, text) from public, anon;
revoke all on function public.unscrap_tyre_by_serial(text) from public, anon;
grant execute on function public.scrap_tyre_by_serial(text, text, text) to authenticated;
grant execute on function public.unscrap_tyre_by_serial(text) to authenticated;
