-- 20261110145000 backup_restore_test_cron  (DRAFT - NOT APPLIED; lead applies)
-- F-K-03: monthly automated restore test. Restores the latest stock_records snapshot into a
-- session-local TEMP table (dropped at commit), compares counts, writes backups.restore_tests.
-- Never reads or writes a live business row. Status vocabulary follows the table CHECK: running|passed|failed.
-- NOTE: must be called as postgres/cron (no auth.uid); execute is revoked from every client role.

create or replace function backups.run_restore_test()
returns uuid
language plpgsql
security definer
set search_path = backups, public
as $fn$
declare
  v_id uuid := gen_random_uuid();
  v_snap uuid;
  v_taken timestamptz;
  v_expected bigint;
  v_restored bigint;
begin
  select s.id, s.taken_at into v_snap, v_taken
  from backups.snapshots s
  where exists (select 1 from backups.snapshot_tables t
                where t.snapshot_id = s.id and t.table_name = 'stock_records' and t.status = 'ok')
  order by s.taken_at desc limit 1;

  insert into backups.restore_tests (id, snapshot_id, snapshot_taken_at, started_at, tables_tested, status)
  values (v_id, v_snap, v_taken, now(), 1, 'running');

  if v_snap is null then
    update backups.restore_tests set status='failed', finished_at=now(),
      error='no usable stock_records snapshot', detail=jsonb_build_object('table','stock_records')
    where id = v_id;
    return v_id;
  end if;

  select coalesce(sum(row_count),0) into v_expected
  from backups.snapshot_tables where snapshot_id = v_snap and table_name='stock_records' and status='ok';

  -- real restore of the jsonb chunks into a scratch (temp) table
  create temp table _restore_scratch on commit drop as
    select r.* from backups.snapshot_tables t,
      lateral jsonb_populate_recordset(null::public.stock_records, t.data) r
    where t.snapshot_id = v_snap and t.table_name='stock_records' and t.status='ok';

  select count(*) into v_restored from _restore_scratch;

  update backups.restore_tests set
    finished_at = now(), rows_expected = v_expected, rows_restored = v_restored,
    status = case when v_expected = v_restored then 'passed' else 'failed' end,
    error = case when v_expected = v_restored then null else 'row count mismatch' end,
    detail = jsonb_build_object('table','stock_records','method','jsonb_populate_recordset into temp table',
      'uncovered_tables', jsonb_build_array('work_orders','parts_consumption','production_logs'))
  where id = v_id;
  return v_id;
exception when others then
  update backups.restore_tests set status='failed', finished_at=now(), error=left(sqlerrm,500) where id = v_id;
  return v_id;
end
$fn$;

revoke all on function backups.run_restore_test() from public, anon, authenticated;

select cron.schedule('backup-restore-test', '30 3 1 * *', $$select backups.run_restore_test()$$);

-- VERIFY (separate call; the function writes one restore_tests row - that is the intended evidence):
--   select backups.run_restore_test();
--   select status, rows_expected, rows_restored, error from backups.restore_tests order by started_at desc limit 1; -- passed, n = n
--   select jobname, schedule, active from cron.job where jobname='backup-restore-test';                            -- 1 row
--   select has_function_privilege('authenticated','backups.run_restore_test()','execute');                          -- false
-- ROLLBACK:
--   select cron.unschedule('backup-restore-test');
--   drop function if exists backups.run_restore_test();
