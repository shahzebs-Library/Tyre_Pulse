-- V383. Who may scrap, who may undo, and a scrapped register that is actually
-- the scrapped tyres.
--
-- Three problems, all reported from the floor:
--   1. A Tyre Data Collector should be able to mark a tyre scrapped. V382 gave
--      them the right; this splits it from the undo right so widening one does
--      not widen the other.
--   2. Scrap Management showed no scrapped tyres. It never read the scrap marks
--      at all - it guessed from risk_level='Critical' OR category='Scrap', a
--      heuristic that has nothing to do with anyone pressing Scrap. So a tyre
--      scrapped from Serial Tracker or the phone was invisible there.
--   3. Undo erased the evidence. The mark was DELETED, taking created_by with
--      it, so after an undo nothing recorded that the tyre had ever been
--      scrapped or by whom.

-- ---------------------------------------------------------------------------
-- 1. UNDO IS ADMIN ONLY, and it is a SEPARATE right from scrapping.
--    Marking a scrap is a field observation and belongs with the people
--    handling tyres. Reversing one is a correction to the record and stays with
--    an administrator, which is what was asked for.
-- ---------------------------------------------------------------------------
create or replace function public.tyre_unscrap_allowed()
returns boolean language sql stable security definer set search_path to 'public' as $fn$
  select public.is_approved_and_unlocked()
     and (public.is_super_admin() or public.app_role() = 'admin');
$fn$;

comment on function public.tyre_unscrap_allowed() is
  'Undo a scrap. Deliberately narrower than tyre_scrap_allowed: admin or super admin only.';

-- ---------------------------------------------------------------------------
-- 2. The audit. It lives in audit_log_v2 rather than a new table, and it is
--    written BEFORE the mark is removed, which is the whole point: the mark
--    disappears on undo, so if the trace lived only on the mark it would be
--    destroyed by the very action it needs to record.
-- ---------------------------------------------------------------------------
create or replace function public._log_scrap_action(
  p_action text, p_serial text, p_old jsonb, p_new jsonb, p_country text)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare v_email text; v_role text;
begin
  select email, role into v_email, v_role from public.profiles where id = auth.uid();
  insert into public.audit_log_v2
    (user_id, user_email, user_role, action, table_name, record_id,
     old_data, new_data, country, org_id, created_at)
  values (auth.uid(), v_email, v_role, p_action, 'tyre_status_marks', p_serial,
          p_old, p_new, p_country, public.app_current_org(), now());
exception when others then
  -- an audit failure must never block the operational write
  null;
end $fn$;

-- ---------------------------------------------------------------------------
-- 3. Scrap: unchanged permission, now audited and stamping the actor + time on
--    every scrap. On a repeat scrap created_by and created_at move TOGETHER;
--    before, created_by was updated while created_at was not, so a trace read
--    the newest person against the oldest date.
-- ---------------------------------------------------------------------------
create or replace function public.scrap_tyre_by_serial(
  p_serial  text,
  p_reason  text default null,
  p_country text default null)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
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

  select coalesce(jsonb_object_agg(t.id::text, coalesce(t.status, 'Active')), '{}'::jsonb)
    into v_prior
    from public.tyre_records t
   where t.serial_no = v_s
     and t.organisation_id = v_org
     and coalesce(t.status, '') <> 'Scrapped';

  insert into public.tyre_status_marks
    (serial, mark_type, reason, country, created_by, created_at, organisation_id, prior_status)
  values (v_s, 'scrap', nullif(btrim(coalesce(p_reason, '')), ''),
          nullif(btrim(coalesce(p_country, '')), ''), auth.uid(), now(), v_org, v_prior)
  on conflict (serial, mark_type) do update
    set reason     = excluded.reason,
        created_by = excluded.created_by,
        created_at = excluded.created_at,
        country    = coalesce(excluded.country, tyre_status_marks.country),
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

  perform public._log_scrap_action('tyre_scrap', v_s, v_prior,
    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), ''), 'rows', v_n),
    nullif(btrim(coalesce(p_country, '')), ''));

  return jsonb_build_object('ok', true, 'serial', v_s, 'updated', v_n);
end $fn$;

-- ---------------------------------------------------------------------------
-- 4. Undo: admin only, and it records who reversed it and what it reversed
--    before the mark is gone.
-- ---------------------------------------------------------------------------
create or replace function public.unscrap_tyre_by_serial(p_serial text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_org uuid := public.app_current_org();
  v_s   text := btrim(coalesce(p_serial, ''));
  v_mark record;
  v_prior jsonb;
  v_n   int := 0;
begin
  if v_s = '' then
    raise exception 'Serial number is required' using errcode = '22023';
  end if;
  if v_org is null or not public.tyre_unscrap_allowed() then
    raise exception 'Only an administrator can undo a scrap' using errcode = '42501';
  end if;

  select * into v_mark from public.tyre_status_marks
   where serial = v_s and mark_type = 'scrap' and organisation_id = v_org;
  v_prior := v_mark.prior_status;

  -- audit FIRST: the delete below is what destroys the evidence
  perform public._log_scrap_action('tyre_unscrap', v_s,
    jsonb_build_object('scrapped_by', v_mark.created_by, 'scrapped_at', v_mark.created_at,
                       'reason', v_mark.reason, 'prior_status', v_prior),
    null, v_mark.country);

  delete from public.tyre_status_marks
   where serial = v_s and mark_type = 'scrap' and organisation_id = v_org;

  if v_prior is not null and v_prior <> '{}'::jsonb then
    update public.tyre_records t
       set status = v_prior ->> t.id::text
     where t.serial_no = v_s
       and t.organisation_id = v_org
       and t.status = 'Scrapped'
       and v_prior ? t.id::text;
    get diagnostics v_n = row_count;
  else
    update public.tyre_records
       set status = 'Active'
     where serial_no = v_s
       and organisation_id = v_org
       and status = 'Scrapped';
    get diagnostics v_n = row_count;
  end if;

  return jsonb_build_object('ok', true, 'serial', v_s, 'updated', v_n,
                            'restored_exactly', (v_prior is not null and v_prior <> '{}'::jsonb));
end $fn$;

-- ---------------------------------------------------------------------------
-- 5. Editing the reason went straight to the table under a policy that lets any
--    approved user update any mark. Behind an audited RPC it is now the same
--    right as scrapping, and it leaves a record.
-- ---------------------------------------------------------------------------
create or replace function public.set_scrap_reason(p_serial text, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_org uuid := public.app_current_org();
  v_s   text := btrim(coalesce(p_serial, ''));
  v_old text;
begin
  if v_s = '' then
    raise exception 'Serial number is required' using errcode = '22023';
  end if;
  if v_org is null or not public.tyre_scrap_allowed() then
    raise exception 'You do not have permission to edit a scrap reason' using errcode = '42501';
  end if;

  select reason into v_old from public.tyre_status_marks
   where serial = v_s and mark_type = 'scrap' and organisation_id = v_org;

  update public.tyre_status_marks
     set reason = nullif(btrim(coalesce(p_reason, '')), '')
   where serial = v_s and mark_type = 'scrap' and organisation_id = v_org;

  perform public._log_scrap_action('tyre_scrap_reason', v_s,
    jsonb_build_object('reason', v_old),
    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), '')), null);

  return jsonb_build_object('ok', true, 'serial', v_s);
end $fn$;

-- ---------------------------------------------------------------------------
-- 6. Close the direct-table bypass. tyre_status_marks_write was PERMISSIVE FOR
--    ALL on is_approved_and_unlocked(), so any approved user could simply DELETE
--    a scrap mark and sidestep the admin-only undo entirely. Split it: insert
--    and update unchanged, delete of a SCRAP mark needs an administrator. Other
--    mark types (returned / written_off, used by Tyre Exchange) are untouched.
-- ---------------------------------------------------------------------------
drop policy if exists tyre_status_marks_write on public.tyre_status_marks;

create policy tyre_status_marks_insert on public.tyre_status_marks
  for insert to authenticated
  with check ((select public.is_approved_and_unlocked()));

create policy tyre_status_marks_update on public.tyre_status_marks
  for update to authenticated
  using ((select public.is_approved_and_unlocked()))
  with check ((select public.is_approved_and_unlocked()));

create policy tyre_status_marks_delete on public.tyre_status_marks
  for delete to authenticated
  using (
    (select public.is_approved_and_unlocked())
    and (mark_type <> 'scrap' or (select public.tyre_unscrap_allowed()))
  );

-- ---------------------------------------------------------------------------
-- 7. THE REGISTER. What Scrap Management should have been reading all along.
--
--    It returns BOTH sources and says which is which, because they genuinely
--    differ: a tyre scrapped through the button carries a mark and an actor,
--    while a tyre bulk-scrapped from the Tyre Records grid only ever got
--    status='Scrapped' with no mark and no attribution. Showing only the marked
--    ones would hide real scrapped stock; merging them silently would invent an
--    accountability that does not exist for the second kind.
-- ---------------------------------------------------------------------------
create or replace function public.list_scrapped_tyres(
  p_search  text default null,
  p_country text default null,
  p_limit   int  default 500)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v_org uuid := public.app_current_org();
  v_q   text := nullif(btrim(coalesce(p_search, '')), '');
  v_lim int  := least(greatest(coalesce(p_limit, 500), 1), 2000);
  result jsonb;
begin
  if v_org is null or not public.app_is_active() then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  with marked as (
    select m.serial, m.reason, m.created_at as scrapped_at, m.created_by,
           coalesce(m.country, '') as mark_country
      from public.tyre_status_marks m
     where m.mark_type = 'scrap'
       and m.organisation_id = v_org
  ), rec as (
    -- one row per serial: the most recent record carries the live detail
    select distinct on (t.serial_no)
           t.serial_no, t.asset_no, t.tyre_position, t.brand, t.size, t.site,
           t.country, t.cost_per_tyre, t.issue_date, t.removal_date, t.status,
           t.removal_reason
      from public.tyre_records t
     where t.organisation_id = v_org
       and nullif(btrim(coalesce(t.serial_no, '')), '') is not null
     order by t.serial_no, t.issue_date desc nulls last, t.created_at desc nulls last
  ), joined as (
    select coalesce(m.serial, r.serial_no) as serial,
           r.asset_no, r.tyre_position, r.brand, r.size, r.site,
           coalesce(nullif(m.mark_country, ''), r.country) as country,
           r.cost_per_tyre, r.issue_date, r.removal_date, r.removal_reason,
           coalesce(m.reason, r.removal_reason) as reason,
           m.scrapped_at, m.created_by,
           (m.serial is not null) as marked
      from marked m
      full outer join rec r on r.serial_no = m.serial
     where m.serial is not null                       -- pressed the button
        or coalesce(r.status, '') = 'Scrapped'        -- bulk-scrapped, no mark
  ), named as (
    select j.*,
           coalesce(nullif(btrim(p.full_name), ''), p.username, p.email) as scrapped_by_name
      from joined j
      left join public.profiles p on p.id = j.created_by
  )
  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'total', (select count(*) from named
               where (p_country is null or country = p_country)),
    'marked_total', (select count(*) from named
                      where marked and (p_country is null or country = p_country)),
    'unattributed_total', (select count(*) from named
                            where not marked and (p_country is null or country = p_country)),
    'rows', (select coalesce(jsonb_agg(to_jsonb(x) order by x.scrapped_at desc nulls last, x.serial), '[]'::jsonb)
               from (select * from named
                      where (p_country is null or country = p_country)
                        and (v_q is null
                             or serial   ilike '%' || v_q || '%'
                             or coalesce(asset_no, '') ilike '%' || v_q || '%'
                             or coalesce(brand, '')    ilike '%' || v_q || '%'
                             or coalesce(reason, '')   ilike '%' || v_q || '%')
                      order by scrapped_at desc nulls last, serial
                      limit v_lim) x)
  ) into result;

  return result;
end $fn$;

revoke all on function public.tyre_unscrap_allowed() from public, anon;
revoke all on function public._log_scrap_action(text, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.set_scrap_reason(text, text) from public, anon;
revoke all on function public.list_scrapped_tyres(text, text, int) from public, anon;
grant execute on function public.tyre_unscrap_allowed() to authenticated;
grant execute on function public.set_scrap_reason(text, text) to authenticated;
grant execute on function public.list_scrapped_tyres(text, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- V383b. The register's counts must describe what the table is showing.
--
-- As first written the three totals applied the country filter but not the
-- search, so typing a serial that matches nothing left the panel reading
-- "11 scrapped tyres" above an empty table. Both now read from ONE filtered
-- set, and a result set larger than the page size reports `truncated` rather
-- than quietly showing the first N as if that were all of them.
-- ---------------------------------------------------------------------------
create or replace function public.list_scrapped_tyres(
  p_search  text default null,
  p_country text default null,
  p_limit   int  default 500)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  v_org uuid := public.app_current_org();
  v_q   text := nullif(btrim(coalesce(p_search, '')), '');
  v_lim int  := least(greatest(coalesce(p_limit, 500), 1), 2000);
  result jsonb;
begin
  if v_org is null or not public.app_is_active() then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  with marked as (
    select m.serial, m.reason, m.created_at as scrapped_at, m.created_by,
           coalesce(m.country, '') as mark_country
      from public.tyre_status_marks m
     where m.mark_type = 'scrap'
       and m.organisation_id = v_org
  ), rec as (
    select distinct on (t.serial_no)
           t.serial_no, t.asset_no, t.tyre_position, t.brand, t.size, t.site,
           t.country, t.cost_per_tyre, t.issue_date, t.removal_date, t.status,
           t.removal_reason
      from public.tyre_records t
     where t.organisation_id = v_org
       and nullif(btrim(coalesce(t.serial_no, '')), '') is not null
     order by t.serial_no, t.issue_date desc nulls last, t.created_at desc nulls last
  ), joined as (
    select coalesce(m.serial, r.serial_no) as serial,
           r.asset_no, r.tyre_position, r.brand, r.size, r.site,
           coalesce(nullif(m.mark_country, ''), r.country) as country,
           r.cost_per_tyre, r.issue_date, r.removal_date, r.removal_reason,
           coalesce(m.reason, r.removal_reason) as reason,
           m.scrapped_at, m.created_by,
           (m.serial is not null) as marked
      from marked m
      full outer join rec r on r.serial_no = m.serial
     where m.serial is not null
        or coalesce(r.status, '') = 'Scrapped'
  ), named as (
    select j.*,
           coalesce(nullif(btrim(p.full_name), ''), p.username, p.email) as scrapped_by_name
      from joined j
      left join public.profiles p on p.id = j.created_by
  ), visible as (
    -- ONE filtered set behind both the counts and the rows, so the panel can
    -- never report a number the table does not show
    select * from named
     where (p_country is null or country = p_country)
       and (v_q is null
            or serial   ilike '%' || v_q || '%'
            or coalesce(asset_no, '')         ilike '%' || v_q || '%'
            or coalesce(brand, '')            ilike '%' || v_q || '%'
            or coalesce(reason, '')           ilike '%' || v_q || '%'
            or coalesce(scrapped_by_name, '') ilike '%' || v_q || '%')
  )
  select jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'total',              (select count(*) from visible),
    'marked_total',       (select count(*) from visible where marked),
    'unattributed_total', (select count(*) from visible where not marked),
    'search',  v_q,
    'country', p_country,
    'truncated', (select count(*) from visible) > v_lim,
    'rows', (select coalesce(jsonb_agg(to_jsonb(x) order by x.scrapped_at desc nulls last, x.serial), '[]'::jsonb)
               from (select * from visible
                      order by scrapped_at desc nulls last, serial
                      limit v_lim) x)
  ) into result;

  return result;
end $fn$;

revoke all on function public.list_scrapped_tyres(text, text, int) from public, anon;
grant execute on function public.list_scrapped_tyres(text, text, int) to authenticated;
