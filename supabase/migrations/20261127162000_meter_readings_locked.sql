-- Meter readings are locked after submit; wrong readings go to review.
--
-- STATUS: APPLIED LIVE 2026-11-27 on owner OK (yes 1-4). Post-apply check as Driver 07540a9c: drivers 1, accidents 0, issues 0, own issue insert ok, old meter edit changed nothing.
-- 2026-11-27 (see VERIFY). The main session applies it.
--
-- OWNER RULE (2026-11-27): a driver cannot change a reading once it is
-- submitted. Only an elevated role or a supervisor corrects it, through a
-- correction that keeps the original. "If wrong then needs review": readings
-- already flagged (regression / implausible / big jump) appear in a review list.
--
-- WHAT WAS WRONG (live 2026-11-27):
--   * odometer_logs_update / engine_hours_logs_update (PERMISSIVE) admitted
--     created_by = auth.uid(): any user could rewrite their own reading - the
--     value, date or asset - after submit, with no record of the original.
--   * Nothing stopped a user clearing their own flagged / reviewed columns.
--   * 194 odometer and 225 engine-hour readings are flagged; there was no single
--     review list across both tables.
--
-- WHAT THIS CHANGES:
--   1. ALTER POLICY (no drop) on both UPDATE policies: USING now admits
--      elevated, super admin, the supervisor roles (Fleet Supervisor, Fleet
--      Incharge, Workshop Supervisor, Maintenance Supervisor), an explicit
--      app_user_can('<table>','edit') grant, or the row's own creator ONLY while
--      the row is still in the transaction that inserted it (created_at = now()).
--      That last case is what save_vehicle_meter_readings needs: it inserts and
--      then updates the flag columns in the same call.
--   2. BEFORE UPDATE guard trg_zz_meter_reading_locked on both tables: the same
--      rule, enforced on the row itself, and for anyone else EVERY column change
--      except updated_at is refused (42501). Service-role / cron / import
--      writes (auth.uid() IS NULL) pass. The guard is named zz_ so it runs after
--      set_updated_at.
--      INSERT is not touched, so trg_sync_asset_current_km (AFTER INSERT) and
--      trg_flag_meter_regression (BEFORE INSERT) keep working.
--   3. public.meter_review_queue(p_country, p_limit): flagged readings not yet
--      reviewed, both tables, newest first, for privileged users only. SECURITY
--      INVOKER, so RLS org/country/site scope applies.
--   4. public.mark_meter_reading_reviewed(p_kind, p_id, p_note): marks a flagged
--      reading reviewed (accepted as-is) and writes the before/after to
--      audit_log. Admin / super admin only (the existing canReview rule).
--      A wrong value is fixed with the existing correct_vehicle_meter_reading(),
--      which already writes old_data/new_data to audit_log (original kept).
--
-- KNOWN SIDE EFFECTS (deliberate, stated):
--   * correct_vehicle_meter_reading() lets anyone with app_user_can
--     ('odometer_logs','view') correct. After this, a non-privileged holder of
--     that grant gets 42501 'Reading unavailable' (its SELECT ... FOR UPDATE now
--     needs the UPDATE policy). Fleet Supervisor still corrects.
--   * inspection_meter_to_logs() re-syncs a meter row when an inspection's km
--     is edited later, as the inspection's editor. For a non-privileged editor
--     that UPDATE is now refused; the function already catches it and raises a
--     WARNING, so the inspection save still succeeds and the original reading
--     stays. Inspections are locked after approval anyway.

begin;

create or replace function public.meter_reading_privileged(p_table text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and coalesce(public.app_is_active(), false)
     and (
          public.is_super_admin()
       or public.app_is_elevated()
       or public.app_role() in ('fleet_supervisor', 'fleet_incharge', 'workshop_supervisor', 'maintenance_supervisor')
       or public.app_user_can(case when p_table = 'engine_hours_logs' then 'engine_hours' else 'odometer_logs' end, 'edit')
     );
$$;
comment on function public.meter_reading_privileged(text) is
  'Who may change a submitted odometer / engine-hour reading: elevated, super admin, supervisor roles, or an explicit edit grant.';
revoke execute on function public.meter_reading_privileged(text) from public;
revoke execute on function public.meter_reading_privileged(text) from anon;
grant execute on function public.meter_reading_privileged(text) to authenticated, service_role;

alter policy odometer_logs_update on public.odometer_logs
  using (
    (select auth.uid()) is not null
    and (
      (select public.meter_reading_privileged('odometer_logs'))
      or (created_by = (select auth.uid()) and created_at = now())
    )
  )
  with check ((select auth.uid()) is not null);

alter policy engine_hours_logs_update on public.engine_hours_logs
  using (
    (select auth.uid()) is not null
    and (
      (select public.meter_reading_privileged('engine_hours_logs'))
      or (created_by = (select auth.uid()) and created_at = now())
    )
  )
  with check ((select auth.uid()) is not null);

create or replace function public.guard_meter_reading_locked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;                                   -- service role, cron, imports
  end if;
  if public.meter_reading_privileged(tg_table_name) then
    return new;
  end if;
  if old.created_by = auth.uid() and old.created_at = now() then
    return new;                                   -- same transaction as the insert
  end if;
  if (to_jsonb(old) - 'updated_at') is distinct from (to_jsonb(new) - 'updated_at') then
    raise exception 'This reading is locked after submit. Ask a supervisor to correct it.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_meter_reading_locked() from public;
revoke execute on function public.guard_meter_reading_locked() from anon;

create trigger trg_zz_meter_reading_locked
  before update on public.odometer_logs
  for each row execute function public.guard_meter_reading_locked();
create trigger trg_zz_meter_reading_locked
  before update on public.engine_hours_logs
  for each row execute function public.guard_meter_reading_locked();

create or replace function public.meter_review_queue(p_country text default null, p_limit int default 200)
returns table (
  kind text, id uuid, asset_no text, country text, site text, reading numeric,
  previous_reading numeric, reading_date date, flag_reason text, source text,
  created_by uuid, created_by_name text, created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not (public.meter_reading_privileged('odometer_logs') or public.meter_reading_privileged('engine_hours_logs')) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  return query
  select q.* from (
    select 'km'::text, o.id, o.asset_no, o.country, o.site, o.odometer_km, o.flagged_prev_reading,
           o.reading_date, o.flag_reason, o.source, o.created_by, p.full_name, o.created_at
      from public.odometer_logs o left join public.profiles p on p.id = o.created_by
     where coalesce(o.flagged, false) and not coalesce(o.reviewed, false)
       and (p_country is null or lower(btrim(o.country)) = lower(btrim(p_country)))
    union all
    select 'hours'::text, e.id, e.asset_no, e.country, e.site, e.engine_hours, e.flagged_prev_reading,
           e.reading_date, e.flag_reason, e.source, e.created_by, p.full_name, e.created_at
      from public.engine_hours_logs e left join public.profiles p on p.id = e.created_by
     where coalesce(e.flagged, false) and not coalesce(e.reviewed, false)
       and (p_country is null or lower(btrim(e.country)) = lower(btrim(p_country)))
  ) q
  order by q.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;
revoke execute on function public.meter_review_queue(text, int) from public;
revoke execute on function public.meter_review_queue(text, int) from anon;
grant execute on function public.meter_review_queue(text, int) to authenticated;

create or replace function public.mark_meter_reading_reviewed(p_kind text, p_id uuid, p_note text default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare old_row jsonb; new_row jsonb; t text;
begin
  if not coalesce((public.vehicle_meter_permissions() ->> 'canReview')::boolean, false) then
    raise exception 'Admin review required' using errcode = '42501';
  end if;
  if p_kind not in ('km', 'hours') or p_id is null then
    raise exception 'Invalid review' using errcode = '22023';
  end if;
  t := case when p_kind = 'km' then 'odometer_logs' else 'engine_hours_logs' end;
  execute format('select to_jsonb(r) from public.%I r where id = $1 and organisation_id = public.app_current_org() for update', t)
    into old_row using p_id;
  if old_row is null then raise exception 'Reading unavailable' using errcode = '42501'; end if;
  execute format('update public.%I r set reviewed = true, reviewed_by = auth.uid(), reviewed_at = now() where id = $1 returning to_jsonb(r)', t)
    into new_row using p_id;
  insert into public.audit_log(table_name, record_id, action, old_data, new_data, changed_by, organisation_id, details)
  values (t, p_id, 'UPDATE', old_row, new_row, auth.uid(), public.app_current_org(),
          jsonb_build_object('channel', 'Meter review', 'decision', 'accepted', 'note', left(btrim(coalesce(p_note, '')), 2000)));
  return new_row;
end;
$$;
revoke execute on function public.mark_meter_reading_reviewed(text, uuid, text) from public;
revoke execute on function public.mark_meter_reading_reviewed(text, uuid, text) from anon;
grant execute on function public.mark_meter_reading_reviewed(text, uuid, text) to authenticated;

commit;

-- VERIFY (rolled back):
--   Driver 07540a9c: update own odometer_logs row (older) -> 0 rows (RLS) ;
--     direct guard check with RLS bypassed -> 42501.
--   Driver inserts a reading and updates it in the same transaction -> allowed.
--   Driver insert still advances vehicle_fleet.current_km (trg_sync_asset_current_km).
--   Fleet Supervisor f3a70480: update a reading -> allowed; meter_review_queue -> rows.
--   Driver meter_review_queue -> 42501.
--   Tested 2026-11-27 (rolled back):
--     BEFORE: Driver update own submitted reading (TM661, 104069 km) -> 1 row.
--     AFTER : Driver update own submitted reading -> 0 rows; clear own flags -> 0 rows;
--             same update with RLS bypassed (postgres + driver JWT) -> 42501 from the guard;
--             Driver insert + update in the same transaction -> 1 row (allowed);
--             Driver insert still moved vehicle_fleet.current_km TM661 to 104500;
--             Fleet Supervisor update -> 1 row; review queue 292 rows (286 KSA);
--             service role (no JWT) update -> allowed; Driver review queue -> 42501.
--
-- ROLLBACK:
--   drop trigger trg_zz_meter_reading_locked on public.odometer_logs;
--   drop trigger trg_zz_meter_reading_locked on public.engine_hours_logs;
--   alter policy odometer_logs_update on public.odometer_logs
--     using (((select auth.uid()) is not null) and ((created_by = (select auth.uid())) or (select app_is_elevated())
--            or (select is_super_admin()) or (select app_user_can('odometer_logs','view'))))
--     with check (auth.uid() is not null);
--   alter policy engine_hours_logs_update on public.engine_hours_logs
--     using (((select auth.uid()) is not null) and ((created_by = (select auth.uid())) or (select app_is_elevated())
--            or (select is_super_admin()) or (select app_user_can('odometer_logs','view'))
--            or (select app_user_can('engine_hours','view'))))
--     with check (auth.uid() is not null);
--   drop function public.mark_meter_reading_reviewed(text, uuid, text);
--   drop function public.meter_review_queue(text, int);
--   drop function public.guard_meter_reading_locked();
--   drop function public.meter_reading_privileged(text);
