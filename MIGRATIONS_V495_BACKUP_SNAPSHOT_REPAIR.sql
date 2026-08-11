-- MIGRATIONS_V495_BACKUP_SNAPSHOT_REPAIR.sql
-- STATUS: APPLIED LIVE 2026-08-10 (V495 + V495b + V495c), full round trip tested.
--
-- WHY
-- The nightly backup had failed 20 consecutive runs since 2026-07-22 with
-- "server restarted", and nobody was told. Even its last SUCCESSFUL run captured
-- 2,160 rows in total, because on 2026-07-21 the database itself was still small.
--
-- ROOT CAUSE (not a cron problem, a design problem):
--   backups._do_snapshot built EACH WHOLE TABLE as ONE jsonb value -
--   jsonb_agg(to_jsonb(t)) over the entire table - and stored it in a single
--   column. That is bounded by neither work_mem nor the 1 GB per-field limit.
--   It worked while work_orders held 1 row. The ERP loads then took work_orders
--   to 88,773 and tyre_records to 11,132, the aggregate blew past what the
--   backend could hold, and the connection died every night from then on.
--
-- WHAT CHANGED
--  1. CHUNKED CAPTURE. 5,000 rows per row of snapshot_tables, keyset-paginated on
--     id, so peak memory is bounded no matter how large a table grows.
--  2. PER-TABLE EXCEPTION ISOLATION. A table that fails records status='error'
--     with its message and the rest of the snapshot still completes. This proved
--     itself immediately: the V495 first run hit the max(uuid) bug below on all
--     eight tables, recorded all eight, and still finished instead of dying.
--  3. AN HONEST OVERSIZED PATH. A table above system_config.backup_max_table_rows
--     (seeded 20000) is recorded as status='skipped_too_large' WITH its true row
--     count and an explicit note, instead of silently looking covered. Restoring
--     such a table RAISES rather than quietly restoring nothing.
--  4. LOUD FAILURE. cron_run_backup writes a critical system_logs row when the
--     snapshot throws, and a warning when it completes with gaps. A dead backup
--     can never again be silent for 20 days. (Verified: the broken first run
--     logged "7 table(s) failed"; the fixed run logged 13,017 rows captured.)
--  5. RESTORE READS CHUNKS (V495b). Both restore functions previously used a
--     SCALAR subquery over snapshot_tables, which assumes one row per table and
--     raises "more than one row returned" once chunked. They now stream with a
--     LATERAL join - which also avoids rebuilding the whole table as one
--     in-memory value at restore time, i.e. the same defect that killed the job.
--     The column list MUST be qualified with b. : snapshot_tables has its own
--     `id` column and unqualified names are ambiguous.
--     backup_restore_preview additionally guards `created_at` - stock_records has
--     no such column and the old code would have failed on it.
--
-- V495c: this Postgres has no max(uuid) aggregate, so the keyset cursor raised
--   "function max(uuid) does not exist". The last id is now taken positionally
--   from an ordered array_agg, which is exact; max(t.id::text)::uuid would happen
--   to work only because uuids render lowercase canonical, and that is a
--   coincidence rather than a contract.
--
-- VERIFIED LIVE
--   Run completes:  accidents 38, inspections 236, stock_records 1,
--                   tyre_records 11,132 (3 chunks - chunking exercised),
--                   vehicle_fleet 1,610, pm_programs 0, pm_service_records 0,
--                   work_orders skipped_too_large (88,773, recorded honestly).
--                   13,017 rows captured, zero errors.
--   RESTORE ROUND TRIP (rolled back): 11,132 -> delete 3 -> 11,129 ->
--                   preview reports missing_rows 3 -> restore reports restored 3
--                   -> 11,132, and the three rows match field for field on
--                   serial_no / tyre_position / total_km.
--                   THIS IS THE TESTED RESTORE THE AUDIT SAID DID NOT EXIST.
--   Restoring work_orders raises the too-large message instead of silently
--   restoring nothing.
--
-- WHAT THIS IS NOT
--   A row snapshot living in the same cluster is NOT disaster recovery. It
--   recovers rows deleted by a bad import; it does not survive losing the
--   database. Real DR is platform point-in-time recovery, which is a Supabase
--   project setting and NOT something this migration can turn on. The oversized
--   note says so in the data itself so nobody reads "backup" as "DR".
--   work_orders (88,773) and the financial tables (parts_consumption 208,375,
--   work_order_line_items 184,025, production_logs 297,354) are deliberately NOT
--   in _core_tables(): a nightly full jsonb copy of ~800k rows retained 30 days
--   would add tens of GB to a 1.6 GB database for a mechanism that is not DR
--   anyway. Raising backup_max_table_rows is a cost decision, not a fix.
--
-- ROLLBACK: restore the prior bodies of backups._do_snapshot,
--   public.cron_run_backup, public.backup_restore_preview and
--   public.backup_restore_missing; the added snapshot_tables columns
--   (chunk_no, status, note) are additive and can stay.

alter table backups.snapshot_tables
  add column if not exists chunk_no int not null default 0,
  add column if not exists status  text not null default 'ok',
  add column if not exists note    text;

create index if not exists idx_snapshot_tables_snap_tbl
  on backups.snapshot_tables (snapshot_id, table_name, chunk_no);

insert into public.system_config (key, value)
values ('backup_max_table_rows', '20000')
on conflict (key) do nothing;

create or replace function backups._do_snapshot(p_reason text default 'manual', p_by uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public,backups'
as $fn$
DECLARE
  v_snap uuid; v_tbl text; v_data jsonb; v_cnt int; v_last uuid;
  v_total bigint := 0; v_tc int := 0; v_i int; v_rows bigint;
  v_chunk int := 5000; v_max int;
BEGIN
  select coalesce(nullif(btrim(value), '')::int, 20000) into v_max
    from public.system_config where key = 'backup_max_table_rows';
  if v_max is null then v_max := 20000; end if;

  insert into backups.snapshots (reason, taken_by)
  values (coalesce(p_reason, 'manual'), p_by) returning id into v_snap;

  foreach v_tbl in array backups._core_tables() loop
    if to_regclass('public.' || v_tbl) is null then continue; end if;
    begin
      execute format('select count(*) from public.%I', v_tbl) into v_rows;

      if v_rows > v_max then
        insert into backups.snapshot_tables (snapshot_id, table_name, row_count, data, chunk_no, status, note)
        values (v_snap, v_tbl, v_rows, '[]'::jsonb, 0, 'skipped_too_large',
                format('%s rows exceeds backup_max_table_rows (%s). This table is NOT captured by row snapshots - recover it with platform point-in-time recovery.', v_rows, v_max));
        v_tc := v_tc + 1;
        continue;
      end if;

      v_last := null; v_i := 0;
      loop
        execute format(
          'select coalesce(jsonb_agg(to_jsonb(t) order by t.id), ''[]''::jsonb),
                  count(*)::int,
                  (array_agg(t.id order by t.id))[count(*)::int]
             from (select * from public.%I where ($1::uuid is null or id > $1::uuid) order by id limit %s) t',
          v_tbl, v_chunk)
          using v_last into v_data, v_cnt, v_last;
        exit when v_cnt = 0;
        insert into backups.snapshot_tables (snapshot_id, table_name, row_count, data, chunk_no, status)
        values (v_snap, v_tbl, v_cnt, v_data, v_i, 'ok');
        v_total := v_total + v_cnt;
        v_i := v_i + 1;
        exit when v_cnt < v_chunk;
      end loop;

      -- an empty table still gets one row, so "covered but empty" stays
      -- distinguishable from "never attempted"
      if v_i = 0 then
        insert into backups.snapshot_tables (snapshot_id, table_name, row_count, data, chunk_no, status)
        values (v_snap, v_tbl, 0, '[]'::jsonb, 0, 'ok');
      end if;
      v_tc := v_tc + 1;
    exception when others then
      insert into backups.snapshot_tables (snapshot_id, table_name, row_count, data, chunk_no, status, note)
      values (v_snap, v_tbl, 0, '[]'::jsonb, 0, 'error', left(sqlerrm, 400));
    end;
  end loop;

  update backups.snapshots set table_count = v_tc, total_rows = v_total where id = v_snap;
  return v_snap;
END; $fn$;

create or replace function public.cron_run_backup()
returns void
language plpgsql
security definer
set search_path to 'public,backups'
as $fn$
declare v_on text; v_snap uuid; v_bad int; v_skip int; v_rows bigint;
begin
  select value into v_on from public.system_config where key = 'backup_enabled';
  if v_on is not null and lower(btrim(v_on)) in ('false','0','off','no') then
    return;
  end if;

  begin
    v_snap := backups._do_snapshot('nightly', null);
    perform backups._purge(30);

    select count(*) filter (where status = 'error'),
           count(*) filter (where status = 'skipped_too_large'),
           coalesce(sum(row_count) filter (where status = 'ok'), 0)
      into v_bad, v_skip, v_rows
      from backups.snapshot_tables where snapshot_id = v_snap;

    if v_bad > 0 or v_skip > 0 then
      insert into public.system_logs (severity, source, message, detail)
      values ('warning', 'nightly-backup',
              format('Nightly snapshot completed with gaps: %s table(s) failed, %s skipped as too large, %s rows captured.', v_bad, v_skip, v_rows),
              jsonb_build_object('snapshot_id', v_snap, 'failed', v_bad, 'skipped', v_skip, 'rows', v_rows));
    else
      insert into public.system_logs (severity, source, message, detail)
      values ('info', 'nightly-backup',
              format('Nightly snapshot completed: %s rows captured.', v_rows),
              jsonb_build_object('snapshot_id', v_snap, 'rows', v_rows));
    end if;
  exception when others then
    -- A failed backup must never again be silent.
    insert into public.system_logs (severity, source, message, detail)
    values ('critical', 'nightly-backup',
            'Nightly backup FAILED - no snapshot was taken tonight.',
            jsonb_build_object('error', left(sqlerrm, 400), 'sqlstate', sqlstate));
    raise;
  end;
end; $fn$;

create or replace function public.backup_restore_preview(p_snapshot_id uuid, p_table text)
returns jsonb
language plpgsql
security definer
set search_path to 'public,backups'
as $fn$
DECLARE v_taken timestamptz; v_snap_rows bigint; v_cur int; v_missing int; v_newer int;
        v_status text; v_note text; v_has_created boolean;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT (p_table = ANY (backups._core_tables())) THEN RAISE EXCEPTION 'Unknown table'; END IF;

  SELECT sn.taken_at INTO v_taken FROM backups.snapshots sn WHERE sn.id = p_snapshot_id;
  IF v_taken IS NULL THEN RAISE EXCEPTION 'Snapshot not found'; END IF;

  SELECT coalesce(sum(st.row_count) FILTER (WHERE st.status = 'ok'), 0),
         max(st.status) FILTER (WHERE st.status <> 'ok'),
         max(st.note)
    INTO v_snap_rows, v_status, v_note
    FROM backups.snapshot_tables st
   WHERE st.snapshot_id = p_snapshot_id AND st.table_name = p_table;

  EXECUTE format('SELECT count(*) FROM public.%I', p_table) INTO v_cur;

  EXECUTE format(
    'SELECT count(*) FROM backups.snapshot_tables st
       CROSS JOIN LATERAL jsonb_populate_recordset(null::public.%I, st.data) b
      WHERE st.snapshot_id = %L AND st.table_name = %L AND st.status = ''ok''
        AND NOT EXISTS (SELECT 1 FROM public.%I c WHERE c.id = b.id)',
    p_table, p_snapshot_id, p_table, p_table) INTO v_missing;

  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name=p_table AND column_name='created_at')
    INTO v_has_created;
  IF v_has_created THEN
    EXECUTE format('SELECT count(*) FROM public.%I WHERE created_at > %L', p_table, v_taken) INTO v_newer;
  ELSE
    v_newer := NULL;
  END IF;

  RETURN jsonb_build_object(
    'table', p_table, 'taken_at', v_taken, 'snapshot_rows', v_snap_rows,
    'current_rows', v_cur, 'missing_rows', v_missing, 'newer_current_rows', v_newer,
    'status', coalesce(v_status, 'ok'), 'note', v_note);
END; $fn$;

create or replace function public.backup_restore_missing(p_snapshot_id uuid, p_table text)
returns jsonb
language plpgsql
security definer
set search_path to 'public,backups'
as $fn$
DECLARE v_cols text; v_cols_b text; v_n int; v_status text;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT (p_table = ANY (backups._core_tables())) THEN RAISE EXCEPTION 'Unknown table'; END IF;

  SELECT max(st.status) FILTER (WHERE st.status <> 'ok') INTO v_status
    FROM backups.snapshot_tables st
   WHERE st.snapshot_id = p_snapshot_id AND st.table_name = p_table;
  IF v_status = 'skipped_too_large' THEN
    RAISE EXCEPTION 'This table was not captured in that snapshot (too large for row snapshots) - use platform point-in-time recovery';
  END IF;

  -- Non-generated columns only (a GENERATED column cannot be inserted into).
  SELECT string_agg(quote_ident(column_name), ','),
         string_agg('b.' || quote_ident(column_name), ',')
    INTO v_cols, v_cols_b
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name=p_table AND is_generated='NEVER';

  EXECUTE format(
    'INSERT INTO public.%I (%s)
     SELECT %s FROM backups.snapshot_tables st
       CROSS JOIN LATERAL jsonb_populate_recordset(null::public.%I, st.data) b
      WHERE st.snapshot_id = %L AND st.table_name = %L AND st.status = ''ok''
        AND NOT EXISTS (SELECT 1 FROM public.%I c WHERE c.id = b.id)
     ON CONFLICT (id) DO NOTHING',
    p_table, v_cols, v_cols_b, p_table, p_snapshot_id, p_table, p_table);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('table', p_table, 'restored', v_n);
END; $fn$;
