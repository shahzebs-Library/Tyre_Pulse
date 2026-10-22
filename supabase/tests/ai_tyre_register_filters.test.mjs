import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

// Runs the REAL migration SQL on a minimal schema. Proves the whole-register server filters
// (not just the loaded page), exact totals, paging and the supervisor-only labelled export.
const MIGRATION = new URL('../migrations/20261023100000_ai_tyre_register_server_filters_and_labelled_findings.sql', import.meta.url)
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

async function setup(role = 'Manager') {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create function public.get_my_role() returns text language sql as $$ select '${role}' $$;
    create function public.is_super_admin() returns boolean language sql as $$ select false $$;
    create table public.inspections(id uuid primary key, asset_no text, site text, country text, status text,
      inspection_date date, tyre_conditions jsonb);
    create table public.ai_tyre_inspection_jobs(id uuid primary key, inspection_id uuid, status text,
      review_status text not null default 'unreviewed', reviewer_note text, reviewed_at timestamptz,
      model_version text, prompt_version text, tyre_position text, analysis jsonb, photo_ref text, cost_usd numeric);`)
  await db.exec(await readFile(MIGRATION, 'utf8'))
  const ins = (n, asset, site, date, tc, status = 'Done', country = 'KSA') => db.query(
    'insert into public.inspections values ($1,$2,$3,$4,$5,$6,$7)', [uid(n), asset, site, country, status, date, JSON.stringify(tc)])
  await ins(1, 'TM100', 'NHC', '2026-10-01', { LHF1: { condition: 'Worn', photo_url: 'tp-storage://a/b.jpg' }, RHF1: { condition: 'Good' } })
  await ins(2, 'TM101', 'NHC', '2026-10-02', { LHF1: { condition: 'Good', photo_url: 'tp-storage://a/c.jpg' } })
  await ins(3, 'TM102', 'RED SEA', '2026-10-03', { LHF1: { condition: 'Damaged', photos: [] } })
  await ins(4, 'MP200', 'NHC', '2026-10-04', [], 'Scheduled', 'UAE')
  await ins(5, 'TM103', 'NHC', '2026-10-05', { LHF1: { condition: 'Worn', photos: ['tp-storage://a/d.jpg'] } })
  const job = (id, insp, status, review) => db.query(
    'insert into public.ai_tyre_inspection_jobs(id,inspection_id,status,review_status) values ($1,$2,$3,$4)', [uid(id), uid(insp), status, review])
  await job(51, 1, 'completed', 'accepted')
  await job(52, 3, 'failed', 'unreviewed')
  await job(53, 5, 'pending', 'unreviewed')
  return db
}
const page = async (db, args) => {
  const keys = ['country', 'from', 'to', 'site', 'status', 'search', 'condition', 'photos', 'ai', 'review', 'offset', 'limit']
  const vals = keys.map(k => args[k] ?? null)
  const r = await db.query(
    `select id, total::int from public.ai_tyre_register_page($1,$2::date,$3::date,$4,$5,$6,$7,$8::boolean,$9,$10,coalesce($11::int,0),coalesce($12::int,50))`, vals)
  return { ids: r.rows.map(x => Number(x.id.slice(-12))), total: r.rows[0]?.total ?? 0 }
}

test('condition filter covers the whole register, not a page', async () => {
  const db = await setup()
  assert.deepEqual((await page(db, { condition: 'Worn' })).ids, [5, 1])
  assert.equal((await page(db, { condition: 'Damaged' })).total, 1)
  assert.equal((await page(db, { condition: 'Nonexistent' })).total, 0)
})

test('defect photos filter requires an abnormal position WITH a photo', async () => {
  const db = await setup()
  // 2 has a photo on a Good tyre (not a defect photo); 3 has an empty photos array.
  assert.deepEqual((await page(db, { photos: true })).ids, [5, 1])
})

test('AI status and review filters, including "no AI job"', async () => {
  const db = await setup()
  assert.deepEqual((await page(db, { ai: 'completed' })).ids, [1])
  assert.deepEqual((await page(db, { ai: 'failed' })).ids, [3])
  assert.deepEqual((await page(db, { ai: 'none' })).ids, [4, 2])
  assert.deepEqual((await page(db, { review: 'accepted' })).ids, [1])
  assert.deepEqual((await page(db, { review: 'unreviewed' })).ids, [5, 3])
})

test('filters combine with date, site, country, search; paging reports the exact total', async () => {
  const db = await setup()
  assert.deepEqual((await page(db, { site: 'NHC', condition: 'Worn', from: '2026-10-02' })).ids, [5])
  assert.deepEqual((await page(db, { country: 'UAE' })).ids, [4])
  assert.equal((await page(db, { to: '2026-10-03' })).total, 3)
  assert.deepEqual((await page(db, { search: 'tm10' })).ids, [5, 3, 2, 1])
  const p1 = await page(db, { limit: 2, offset: 0 })
  const p2 = await page(db, { limit: 2, offset: 2 })
  assert.equal(p1.total, 5)
  assert.deepEqual([...p1.ids, ...p2.ids], [5, 4, 3, 2])
})

test('search wildcards and injection text are inert', async () => {
  const db = await setup()
  assert.equal((await page(db, { search: '%' })).total, 5)
  assert.equal((await page(db, { search: "x'; drop table public.inspections;--" })).total, 0)
  assert.equal((await db.query('select count(*)::int c from public.inspections')).rows[0].c, 5)
})

test('limit is clamped and the functions are not executable by anon', async () => {
  const db = await setup()
  assert.equal((await page(db, { limit: 100000 })).ids.length, 5)
  const r = await db.query(`select
    has_function_privilege('anon','public.ai_tyre_register_page(text,date,date,text,text,text,text,boolean,text,text,integer,integer)','EXECUTE') a,
    has_function_privilege('authenticated','public.get_ai_tyre_labelled_findings(date,date,integer)','EXECUTE') b`)
  assert.equal(r.rows[0].a, false)
  assert.equal(r.rows[0].b, true)
})

test('labelled findings: only reviewed jobs, supervisor roles only', async () => {
  const db = await setup()
  await db.query(`update public.ai_tyre_inspection_jobs set status='completed', reviewed_at=now(), reviewer_note='real cut',
    analysis='{"assessable":true,"recommendation":"monitor","defects":[{"type":"sidewall_cut"}]}' where id=$1`, [uid(51)])
  const rows = (await db.query('select * from public.get_ai_tyre_labelled_findings()')).rows
  assert.equal(rows.length, 1)
  assert.equal(rows[0].review_status, 'accepted')
  assert.equal(rows[0].asset_no, 'TM100')
  assert.equal(rows[0].defects[0].type, 'sidewall_cut')
  assert.equal(rows[0].assessable, true)
  const tdc = await setup('Tyre Data Collector')
  await tdc.query(`update public.ai_tyre_inspection_jobs set status='completed', reviewed_at=now() where id=$1`, [uid(51)])
  assert.equal((await tdc.query('select * from public.get_ai_tyre_labelled_findings()')).rows.length, 0)
})
