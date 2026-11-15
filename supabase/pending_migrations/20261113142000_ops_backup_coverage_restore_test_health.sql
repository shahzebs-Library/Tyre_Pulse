-- OPS-3 (REL-2, REL-3, REL-10): wider row snapshots, a restore test that covers
-- every snapshotted table and reports failure, and a health answer an outside
-- uptime monitor can read for free.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the LIVE definitions of
--         backups._core_tables(), backups._do_snapshot(text, uuid),
--         backups.run_restore_test(), public.cron_run_backup(),
--         public.backup_restore_preview/_missing and public.cron_alert_state.
--         Not applied to any database. Tested on PGlite only
--         (supabase/tests/ops_backup_health.test.mjs).
--         NOTE FOR WHOEVER APPLIES IT: this text contains the word "drop" (in
--         the rollback note), so the Supabase MCP destructive-statement gate
--         may ask a human to confirm. Nothing here removes data or objects.
--
-- FACTS (read only, 2026-11-12)
--   * The nightly snapshot (cron job 9, 00:30 UTC) has run every night for the
--     last 30 days, 0 failures. It covers 8 tables; work_orders (96,944 rows)
--     is skipped every night as too large, so 7 are really captured:
--     accidents 43, inspections 2,596, stock_records 36, tyre_records 11,260,
--     vehicle_fleet 1,622, pm_programs 0, pm_service_records 0.
--   * Small tables that cannot be re-imported from an ERP file are NOT
--     captured: corrective actions, checklist submissions and templates,
--     phone-entered odometer and engine hour readings, wash records, scrap
--     marks, sites, access configuration, budgets, KPI targets, SCO and SANY
--     cost ledgers, accident case workstreams.
--   * The monthly restore test (cron job 30, first run due 2026-12-01) calls
--     backups.run_restore_test(), which tests ONE table (stock_records, 36
--     rows) and writes nothing anywhere a person looks when it fails. The
--     console button (admin_run_restore_test) already tests every table; the
--     scheduled job does not.
--   * There is no address an outside uptime monitor can call to learn that the
--     database answers, that last night's snapshot exists and that no
--     scheduled job is in alarm.
--
-- WHAT THIS CHANGES
--   1. backups._core_tables(): 21 more small tables (each has a uuid "id"
--      primary key, which the snapshot and the recover-missing-rows tools
--      need). Every one becomes restorable from Console, Backups. The row
--      limit (backup_max_table_rows, 20,000) still protects the database: a
--      table that grows past it is reported as skipped, exactly like
--      work_orders today. Estimated extra storage: about 6 MB per night, about
--      85 MB at the current 14 night retention (estimate from live table
--      sizes; jsonb compresses, so likely less).
--      NOT added on purpose: work_orders, parts_consumption,
--      work_order_line_items, production_logs, audit_log_v2 (too large for
--      row snapshots; platform backup is their only recovery path), profiles
--      (tied to sign-in identities and holds columns that must not be copied
--      around), system_config (no uuid id).
--   2. backups.run_restore_test(): rebuilds EVERY captured table of the latest
--      snapshot in memory, compares the row count and the number of distinct
--      ids with what the snapshot recorded, stores a per-table result, and on
--      failure writes a critical row to system_logs. Nothing is written to any
--      business table.
--   3. public.health_ping(): a tiny read-only answer for an outside monitor:
--        { ok, checked_at, database, backup_fresh, backup_age_hours,
--          cron_alerts_open, restore_test }
--      ok is true only when the last snapshot is younger than 26 hours, no
--      scheduled job is in alarm and the latest restore test did not fail.
--      It exposes no names, no counts of business data and no identifiers.
--      OWNER DECISION: it is executable without signing in (that is the point:
--      a free monitor can call it with the public key). That adds ONE function
--      to the reviewed list of functions an anonymous caller may run
--      (14 today). If that is not wanted, grant it to authenticated only and
--      use a monitor that can sign in.
--
-- RISK TO THE CURRENT COMPANY: low. The nightly job takes a little longer
--   (it took at most 19 seconds in the last 7 days). No business table is
--   written. The snapshot schema grows by the estimate above.
--
-- VERIFY (read only, after applying, then after the next 00:30 UTC run)
--   select array_length(backups._core_tables(), 1);                 -- 29
--   select table_name, status, sum(row_count) from backups.snapshot_tables
--    where snapshot_id = (select id from backups.snapshots order by taken_at desc limit 1)
--    group by 1, 2 order by 1;                                      -- 29 tables, work_orders skipped_too_large
--   select public.health_ping();                                    -- ok true
--   select status, tables_tested, rows_expected, rows_restored from backups.restore_tests
--    order by started_at desc limit 1;                              -- after the next scheduled test
--
-- ROLLBACK
--   Re-create backups._core_tables() with the original 8 names
--   ('tyre_records','vehicle_fleet','accidents','inspections','work_orders',
--    'pm_programs','pm_service_records','stock_records'), re-create
--   backups.run_restore_test() from migration 20261111052021, and
--   drop function if exists public.health_ping();
--   Snapshots already taken with the wider list stay readable.

-- ---------------------------------------------------------------------------
-- 1. Wider snapshot list
-- ---------------------------------------------------------------------------
create or replace function backups._core_tables()
returns text[]
language sql
immutable
set search_path = backups, public
as $$
  select array[
    -- original eight
    'tyre_records','vehicle_fleet','accidents','inspections','work_orders',
    'pm_programs','pm_service_records','stock_records',
    -- field work that cannot be re-imported
    'corrective_actions','checklist_submissions','checklist_templates',
    'odometer_logs','engine_hours_logs','wash_records','tyre_status_marks',
    'accident_case_workstreams','warranty_claims',
    -- small cost ledgers entered by hand or from one-off files
    'sco_costs','sany_invoices','budgets','kpi_targets','tyre_life_targets','store_site_map',
    -- organisation setup and access
    'organisations','sites','custom_roles','module_permissions','user_access_grants','report_schedules'
  ]::text[];
$$;

-- ---------------------------------------------------------------------------
-- 2. Restore test over every captured table, with failure reporting
-- ---------------------------------------------------------------------------
create or replace function backups.run_restore_test()
returns uuid
language plpgsql
security definer
set search_path = backups, public
as $$
declare
  v_id       uuid := gen_random_uuid();
  v_snap     uuid;
  v_taken    timestamptz;
  r          record;
  v_rows     bigint;
  v_ids      bigint;
  v_expected bigint := 0;
  v_total    bigint := 0;
  v_tables   int := 0;
  v_failed   boolean := false;
  v_detail   jsonb := '[]'::jsonb;
  v_skipped  jsonb := '[]'::jsonb;
begin
  select s.id, s.taken_at into v_snap, v_taken
    from backups.snapshots s order by s.taken_at desc limit 1;

  insert into backups.restore_tests (id, snapshot_id, snapshot_taken_at, started_at, tables_tested, status)
  values (v_id, v_snap, v_taken, now(), 0, 'running');

  if v_snap is null then
    update backups.restore_tests set status = 'failed', finished_at = now(), error = 'no snapshot exists'
     where id = v_id;
    v_failed := true;
  else
    for r in
      select st.table_name,
             coalesce(sum(st.row_count) filter (where st.status = 'ok'), 0) as expected,
             bool_or(st.status = 'ok') as has_ok,
             max(st.status) filter (where st.status <> 'ok') as bad_status
        from backups.snapshot_tables st
       where st.snapshot_id = v_snap
       group by st.table_name
       order by st.table_name
    loop
      if not coalesce(r.has_ok, false) then
        -- skipped_too_large or error: not captured, so there is nothing to test.
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('table', r.table_name, 'status', r.bad_status));
        if r.bad_status = 'error' then v_failed := true; end if;
        continue;
      end if;
      v_tables := v_tables + 1;
      begin
        if to_regclass('public.' || quote_ident(r.table_name)) is null then
          raise exception 'table no longer exists';
        end if;
        -- Rebuild typed rows from the stored copy (the same decode the real
        -- recover-missing-rows tool uses) and count them. Nothing is written.
        execute format(
          'select count(*), count(distinct b.id)
             from backups.snapshot_tables st
            cross join lateral jsonb_populate_recordset(null::public.%I, st.data) b
            where st.snapshot_id = %L and st.table_name = %L and st.status = ''ok''',
          r.table_name, v_snap, r.table_name)
          into v_rows, v_ids;
        v_expected := v_expected + r.expected;
        v_total := v_total + v_rows;
        if v_rows <> r.expected or v_ids <> v_rows then v_failed := true; end if;
        v_detail := v_detail || jsonb_build_array(jsonb_build_object(
          'table', r.table_name, 'expected', r.expected, 'restored', v_rows, 'distinct_ids', v_ids,
          'ok', (v_rows = r.expected and v_ids = v_rows)));
      exception when others then
        v_failed := true;
        v_detail := v_detail || jsonb_build_array(jsonb_build_object(
          'table', r.table_name, 'expected', r.expected, 'restored', 0, 'ok', false,
          'error', left(sqlerrm, 200)));
      end;
    end loop;

    if v_tables = 0 then v_failed := true; end if;

    update backups.restore_tests
       set finished_at = now(), tables_tested = v_tables, rows_expected = v_expected, rows_restored = v_total,
           status = case when v_failed then 'failed' else 'passed' end,
           error = case when v_failed then 'one or more tables could not be rebuilt exactly' end,
           detail = jsonb_build_object('method', 'jsonb_populate_recordset, counted in memory',
                                       'tables', v_detail, 'not_captured', v_skipped,
                                       'not_in_snapshot_list', jsonb_build_array('parts_consumption', 'work_order_line_items', 'production_logs', 'audit_log_v2', 'profiles'))
     where id = v_id;
  end if;

  if v_failed then
    begin
      insert into public.system_logs (severity, source, message, detail)
      values ('critical', 'backup-restore-test',
              'The scheduled restore test FAILED. The row snapshots may not be restorable. Open Console, Backups and run the restore test.',
              jsonb_build_object('restore_test_id', v_id, 'snapshot_id', v_snap, 'tables', v_detail));
    exception when others then null;
    end;
  end if;
  return v_id;
exception when others then
  begin
    insert into backups.restore_tests (id, snapshot_id, snapshot_taken_at, started_at, finished_at, tables_tested, status, error)
    values (v_id, v_snap, v_taken, now(), now(), 0, 'failed', left(sqlerrm, 500))
    on conflict (id) do update set status = 'failed', finished_at = now(), error = excluded.error;
    insert into public.system_logs (severity, source, message, detail)
    values ('critical', 'backup-restore-test', 'The scheduled restore test could not run.',
            jsonb_build_object('restore_test_id', v_id, 'error', left(sqlerrm, 300)));
  exception when others then null;
  end;
  return v_id;
end
$$;

revoke all on function backups.run_restore_test() from public;

-- ---------------------------------------------------------------------------
-- 3. Health answer for an outside uptime monitor
-- ---------------------------------------------------------------------------
create or replace function public.health_ping()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, backups
as $$
declare
  v_last    timestamptz;
  v_age     numeric;
  v_alerts  int := 0;
  v_restore text;
  v_fresh   boolean;
begin
  select max(taken_at) into v_last from backups.snapshots;
  v_age := case when v_last is null then null
                else round((extract(epoch from now() - v_last) / 3600.0)::numeric, 1) end;
  v_fresh := v_last is not null and v_last > now() - interval '26 hours';
  begin
    select count(*) into v_alerts from public.cron_alert_state where open;
  exception when others then v_alerts := 0;
  end;
  select status into v_restore from backups.restore_tests
   where status <> 'running' order by started_at desc limit 1;
  return jsonb_build_object(
    'ok', (v_fresh and v_alerts = 0 and coalesce(v_restore, 'passed') <> 'failed'),
    'checked_at', now(),
    'database', 'up',
    'backup_fresh', v_fresh,
    'backup_age_hours', v_age,
    'cron_alerts_open', v_alerts,
    'restore_test', coalesce(v_restore, 'never_run'));
end
$$;

comment on function public.health_ping() is
  'Read-only health answer for an external uptime monitor. No business data. ok is false when the nightly snapshot is older than 26 hours, a scheduled job is in alarm, or the latest restore test failed.';

revoke all on function public.health_ping() from public;
grant execute on function public.health_ping() to anon, authenticated, service_role;
