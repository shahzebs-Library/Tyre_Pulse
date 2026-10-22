import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Executes the REAL migration against a minimal schema. PGlite is single-connection, so this proves
// the ceiling arithmetic, one-reservation-per-job, exactly-once settlement and privileges; true
// multi-connection row-lock behaviour still needs a live concurrency check (see handover).
const MIGRATION = new URL('../migrations/20261023090000_ai_tyre_budget_reservation_and_feedback.sql', import.meta.url);

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create function public.get_my_role() returns text language sql as $$ select 'Manager' $$;
    create function public.is_super_admin() returns boolean language sql as $$ select false $$;
    create table public.ai_tyre_inspection_jobs (
      id uuid primary key default gen_random_uuid(), organisation_id uuid not null default gen_random_uuid(),
      status text not null default 'pending', attempts integer not null default 0,
      model_version text, prompt_version text, review_status text not null default 'unreviewed',
      reviewer_note text, error_message text, cost_usd numeric(12,6), created_at timestamptz not null default now(),
      updated_at timestamptz not null default now());
    grant all on public.ai_tyre_inspection_jobs to service_role;`);
  await db.exec(await readFile(MIGRATION, 'utf8'));
  return db;
}
const job = async (db, status = 'processing') => (await db.query(
  'insert into public.ai_tyre_inspection_jobs(status) values ($1) returning id', [status])).rows[0].id;
const reserve = async (db, id, est = 0.01, limit = 0.03) =>
  (await db.query('select public.ai_tyre_reserve_budget($1,$2,$3) as r', [id, est, limit])).rows[0].r;
const settle = async (db, id, actual, called = true) =>
  (await db.query('select public.ai_tyre_settle_budget($1,$2,$3) as r', [id, actual, called])).rows[0].r;
const budget = async (db) => (await db.query('select reserved_usd::float8 r, settled_usd::float8 s, unknown_cost_calls u from public.ai_tyre_daily_budget')).rows[0];

test('reservations stop at the ceiling and a job can only reserve once', async () => {
  const db = await setup();
  try {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await job(db));
    const results = [];
    for (const id of ids) results.push(await reserve(db, id));
    assert.deepEqual(results.map(r => r.ok), [true, true, true, false, false]);
    assert.match(results[3].reason, /Daily AI spending limit reached/);
    assert.deepEqual(await budget(db), { r: 0.03, s: 0, u: 0 });
    assert.equal((await reserve(db, ids[0])).ok, false, 'no second reservation / second paid call for the same job');
    const pending = await job(db, 'pending');
    assert.equal((await reserve(db, pending)).ok, false, 'only a processing job may reserve');
    assert.equal((await reserve(db, ids[4], 0)).ok, false, 'invalid estimate refused');
  } finally { await db.close(); }
});

test('settlement is exactly-once; unknown usage is charged at the reservation and counted', async () => {
  const db = await setup();
  try {
    const known = await job(db), unknown = await job(db), uncalled = await job(db);
    for (const id of [known, unknown, uncalled]) assert.equal((await reserve(db, id)).ok, true);
    assert.equal((await settle(db, known, 0.0002)).charged, 0.0002);
    assert.equal((await settle(db, known, 0.0002)).note, 'Already settled');
    assert.equal((await settle(db, unknown, null)).usage_known, false);
    assert.equal((await settle(db, uncalled, null, false)).charged, 0);
    const b = await budget(db);
    assert.ok(Math.abs(b.s - 0.0102) < 1e-9, `settled ${b.s}`);
    assert.equal(b.u, 1);
    assert.ok(Math.abs(b.r) < 1e-9, 'all reservations released');
    // an uncalled job gave its reservation back and may reserve again
    assert.equal((await reserve(db, uncalled)).ok, true);
    // the job cost column is untouched: unknown stays NULL
    assert.equal((await db.query('select cost_usd from public.ai_tyre_inspection_jobs where id=$1', [unknown])).rows[0].cost_usd, null);
  } finally { await db.close(); }
});

test('stalled processing jobs fail for manual review and settle their reservation conservatively', async () => {
  const db = await setup();
  try {
    const stale = await job(db), fresh = await job(db);
    await reserve(db, stale);
    await db.query("update public.ai_tyre_inspection_jobs set updated_at = now() - interval '30 minutes' where id=$1", [stale]);
    const n = (await db.query('select public.ai_tyre_fail_stale_processing(15) as n')).rows[0].n;
    assert.equal(n, 1);
    const rows = (await db.query('select id,status,failure_kind from public.ai_tyre_inspection_jobs')).rows;
    assert.equal(rows.find(r => r.id === stale).status, 'failed');
    assert.equal(rows.find(r => r.id === stale).failure_kind, 'stalled');
    assert.equal(rows.find(r => r.id === fresh).status, 'processing');
    const b = await budget(db);
    assert.equal(b.u, 1); assert.ok(Math.abs(b.s - 0.01) < 1e-9);
    assert.equal((await db.query('select public.ai_tyre_fail_stale_processing(15) as n')).rows[0].n, 0, 'idempotent');
  } finally { await db.close(); }
});

test('budget functions are service-role only; the budget table is not client readable', async () => {
  const db = await setup();
  try {
    const priv = async (role, fn) => (await db.query('select has_function_privilege($1,$2,$3) as ok', [role, fn, 'EXECUTE'])).rows[0].ok;
    for (const fn of ['public.ai_tyre_reserve_budget(uuid,numeric,numeric)', 'public.ai_tyre_settle_budget(uuid,numeric,boolean)', 'public.ai_tyre_fail_stale_processing(integer)']) {
      assert.equal(await priv('anon', fn), false, fn);
      assert.equal(await priv('authenticated', fn), false, fn);
      assert.equal(await priv('service_role', fn), true, fn);
    }
    assert.equal(await priv('anon', 'public.get_ai_tyre_review_feedback(date,date)'), false);
    assert.equal(await priv('authenticated', 'public.get_ai_tyre_review_feedback(date,date)'), true);
    const t = (await db.query("select has_table_privilege('authenticated','public.ai_tyre_daily_budget','SELECT') as a, has_table_privilege('anon','public.ai_tyre_daily_budget','SELECT') as b")).rows[0];
    assert.deepEqual(t, { a: false, b: false });
    const rls = (await db.query("select relrowsecurity from pg_class where relname='ai_tyre_daily_budget'")).rows[0];
    assert.equal(rls.relrowsecurity, true);
  } finally { await db.close(); }
});

test('reviewer feedback aggregates per model and prompt, counting unpriced attempted jobs', async () => {
  const db = await setup();
  try {
    const add = (status, review, cost, attempts, model = 'claude-haiku-5-5', prompt = 'tyre-photo-v1', note = null) =>
      db.query(`insert into public.ai_tyre_inspection_jobs(status,review_status,cost_usd,provider_attempts,model_version,prompt_version,reviewer_note)
                values ($1,$2,$3,$4,$5,$6,$7)`, [status, review, cost, attempts, model, prompt, note]);
    await add('completed', 'accepted', 0.0002, 1, undefined, undefined, 'clear cut');
    await add('completed', 'rejected', 0.0002, 1, undefined, undefined, 'false positive');
    await add('completed', 'unreviewed', 0.0002, 1);
    await add('failed', 'unreviewed', null, 1);            // attempted, usage unknown => unpriced
    await add('completed', 'unreviewed', null, 0, null, null); // legacy row: unknown model/prompt
    const rows = (await db.query('select * from public.get_ai_tyre_review_feedback()')).rows;
    const main = rows.find(r => r.model_version === 'claude-haiku-5-5');
    assert.equal(Number(main.jobs), 4); assert.equal(Number(main.reviewed), 2);
    assert.equal(Number(main.accepted), 1); assert.equal(Number(main.rejected), 1);
    assert.equal(Number(main.unreviewed), 1); assert.equal(Number(main.with_reviewer_note), 2);
    assert.equal(Number(main.unpriced_jobs), 1);
    assert.ok(Math.abs(Number(main.known_cost_usd) - 0.0006) < 1e-9);
    const legacy = rows.find(r => r.model_version === 'unknown');
    assert.equal(legacy.prompt_version, 'unversioned');
    assert.equal(Number(legacy.unpriced_jobs), 0, 'never-attempted legacy rows are not reported as unpriced charges');
    assert.equal((await db.query("select count(*) c from public.get_ai_tyre_review_feedback('2999-01-01','2999-12-31')")).rows[0].c, 0);
  } finally { await db.close(); }
});
