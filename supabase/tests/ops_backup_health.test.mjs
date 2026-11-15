import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// PGlite harness for the DRAFT migration
// supabase/pending_migrations/20261113142000_ops_backup_coverage_restore_test_health.sql
// (REL-2, REL-3, REL-10): the scheduled restore test must cover every captured
// table and report a failure, and health_ping must turn false when the
// snapshot is stale, a job is in alarm or the restore test failed.

const SQL = readFileSync(new URL('../pending_migrations/20261113142000_ops_backup_coverage_restore_test_health.sql', import.meta.url), 'utf8')
const db = new PGlite()
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const ping = async () => (await one('select public.health_ping() r')).r
const lastTest = () => one('select * from backups.restore_tests order by started_at desc, finished_at desc limit 1')

async function snapshot (ageHours = 1) {
  const s = await one("insert into backups.snapshots(reason, taken_at) values ('nightly', now() - make_interval(hours => $1)) returning id", [ageHours])
  for (const t of ['stock_records', 'corrective_actions']) {
    await db.query(
      `insert into backups.snapshot_tables(snapshot_id, table_name, row_count, data, chunk_no, status)
       select $1, $2, count(*)::int, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb), 0, 'ok' from public.${t} x`, [s.id, t])
  }
  await db.query("insert into backups.snapshot_tables(snapshot_id, table_name, row_count, data, chunk_no, status) values ($1, 'work_orders', 96944, '[]', 0, 'skipped_too_large')", [s.id])
  return s.id
}

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema backups;
    create table backups.snapshots(id uuid primary key default gen_random_uuid(), reason text, taken_by uuid,
      taken_at timestamptz not null default now(), table_count int, total_rows bigint);
    create table backups.snapshot_tables(id uuid primary key default gen_random_uuid(),
      snapshot_id uuid references backups.snapshots(id) on delete cascade, table_name text, row_count int,
      data jsonb, chunk_no int, status text, note text);
    create table backups.restore_tests(id uuid primary key default gen_random_uuid(), snapshot_id uuid,
      snapshot_taken_at timestamptz, started_at timestamptz default now(), finished_at timestamptz,
      tables_tested int, rows_expected bigint, rows_restored bigint,
      status text check (status in ('running','passed','failed')), detail jsonb, error text, run_by uuid);
    create table public.system_logs(id uuid primary key default gen_random_uuid(), severity text not null,
      source text, message text not null, detail jsonb not null default '{}'::jsonb, created_at timestamptz default now());
    create table public.cron_alert_state(jobid bigint primary key, jobname text, kind text, detail text,
      open boolean, opened_at timestamptz, closed_at timestamptz, ok_streak int);
    create table public.stock_records(id uuid primary key default gen_random_uuid(), item text, qty numeric);
    create table public.corrective_actions(id uuid primary key default gen_random_uuid(), title text, due_date date);
    insert into public.stock_records(item, qty) select 'item ' || g, g from generate_series(1, 36) g;
    insert into public.corrective_actions(title, due_date) select 'action ' || g, current_date from generate_series(1, 5) g;
  `)
  await db.exec(SQL)
})

test('the snapshot list keeps the original eight and adds the small tables that cannot be re-imported', async () => {
  const list = (await one('select backups._core_tables() t')).t
  assert.equal(list.length, 29)
  assert.equal(new Set(list).size, 29)
  for (const t of ['tyre_records', 'vehicle_fleet', 'accidents', 'inspections', 'work_orders', 'pm_programs', 'pm_service_records', 'stock_records']) assert.ok(list.includes(t), t)
  for (const t of ['corrective_actions', 'checklist_submissions', 'odometer_logs', 'engine_hours_logs', 'sites', 'module_permissions']) assert.ok(list.includes(t), t)
  for (const t of ['parts_consumption', 'production_logs', 'audit_log_v2', 'profiles', 'work_order_line_items']) assert.ok(!list.includes(t), t)
})

test('with no snapshot at all: the test fails loudly and health is not ok', async () => {
  await db.query('select backups.run_restore_test()')
  const t = await lastTest()
  assert.equal(t.status, 'failed')
  assert.equal((await one("select count(*)::int n from system_logs where source = 'backup-restore-test' and severity = 'critical'")).n, 1)
  const h = await ping()
  assert.equal(h.ok, false)
  assert.equal(h.backup_fresh, false)
  assert.equal(h.backup_age_hours, null)
  await db.exec('delete from backups.restore_tests; delete from public.system_logs')
})

test('a good snapshot: every captured table is tested, the skipped one is named, nothing is written', async () => {
  await snapshot(1)
  await db.query('select backups.run_restore_test()')
  const t = await lastTest()
  assert.equal(t.status, 'passed')
  assert.equal(t.tables_tested, 2)
  assert.equal(Number(t.rows_expected), 41)
  assert.equal(Number(t.rows_restored), 41)
  assert.deepEqual(t.detail.tables.map((x) => [x.table, x.ok]), [['corrective_actions', true], ['stock_records', true]])
  assert.deepEqual(t.detail.not_captured, [{ table: 'work_orders', status: 'skipped_too_large' }])
  assert.equal((await one('select count(*)::int n from system_logs')).n, 0)
  assert.equal((await one('select count(*)::int n from stock_records')).n, 36)
  const h = await ping()
  assert.deepEqual([h.ok, h.backup_fresh, h.cron_alerts_open, h.restore_test, h.database], [true, true, 0, 'passed', 'up'])
})

test('a snapshot whose stored rows do not match its count fails and is reported as critical', async () => {
  const id = await snapshot(0)
  await db.query("update backups.snapshot_tables set row_count = row_count + 3 where snapshot_id = $1 and table_name = 'stock_records'", [id])
  await db.query('select backups.run_restore_test()')
  const t = await lastTest()
  assert.equal(t.status, 'failed')
  assert.equal(t.detail.tables.find((x) => x.table === 'stock_records').ok, false)
  assert.equal(t.detail.tables.find((x) => x.table === 'corrective_actions').ok, true)
  assert.equal((await one("select count(*)::int n from system_logs where source = 'backup-restore-test' and severity = 'critical'")).n, 1)
  assert.equal((await ping()).ok, false)
  assert.equal((await ping()).restore_test, 'failed')
  await db.query('delete from backups.snapshots where id = $1', [id])
})

test('a copy that can no longer be rebuilt (column type changed) fails that table only', async () => {
  const id = await snapshot(0)
  await db.query(`update backups.snapshot_tables set data = jsonb_set(data, '{0,due_date}', '"not a date"') where snapshot_id = $1 and table_name = 'corrective_actions'`, [id])
  await db.query('select backups.run_restore_test()')
  const t = await lastTest()
  assert.equal(t.status, 'failed')
  assert.ok(t.detail.tables.find((x) => x.table === 'corrective_actions').error)
  assert.equal(t.detail.tables.find((x) => x.table === 'stock_records').ok, true)
  await db.query('delete from backups.snapshots where id = $1', [id])
  await db.exec('delete from backups.restore_tests')
})

test('health turns false for a stale snapshot and for an open job alarm, and leaks nothing', async () => {
  await db.exec('delete from backups.snapshots')
  await snapshot(30)
  let h = await ping()
  assert.equal(h.ok, false)
  assert.equal(h.backup_fresh, false)
  assert.ok(Number(h.backup_age_hours) >= 30)
  await snapshot(2)
  assert.equal((await ping()).ok, true)
  await db.query("insert into cron_alert_state(jobid, jobname, kind, detail, open) values (29, 'due-alerts-scan', 'failing', '24 failures in a row.', true)")
  h = await ping()
  assert.equal(h.ok, false)
  assert.equal(h.cron_alerts_open, 1)
  assert.deepEqual(Object.keys(h).sort(), ['backup_age_hours', 'backup_fresh', 'checked_at', 'cron_alerts_open', 'database', 'ok', 'restore_test'])
  assert.ok(!JSON.stringify(h).includes('due-alerts-scan'))
})

test('grants: the monitor may call health_ping; nobody outside cron may run the restore test', async () => {
  const p = await one(`select
    has_function_privilege('anon', 'public.health_ping()', 'EXECUTE') h_anon,
    has_function_privilege('anon', 'backups.run_restore_test()', 'EXECUTE') r_anon,
    has_function_privilege('authenticated', 'backups.run_restore_test()', 'EXECUTE') r_auth`)
  assert.deepEqual(p, { h_anon: true, r_anon: false, r_auth: false })
})
