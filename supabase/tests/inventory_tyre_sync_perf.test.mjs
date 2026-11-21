// Pending 20261121110000 (inv_tyre_sync_perf): the set-based tyre custody derivation
// produces EXACTLY the same tyre_items / conflicts as the released function, finds the
// seven production conflict patterns, never duplicates on re-run, never touches the tyre
// source tables, and is much faster (PGlite, synthetic data).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildDb, call, q, one, U, ORG_A } from './inventory_harness.test.mjs'

const FIX = readFileSync(new URL('../pending_migrations/20261121110000_inv_tyre_sync_perf.sql', import.meta.url), 'utf8')
const FIX_RB = readFileSync(new URL('../pending_migrations/20261121110000_inv_tyre_sync_perf_ROLLBACK.sql', import.meta.url), 'utf8')
const OLD_MD5 = '92e69b6622a88dddc3358ddea0ff1276'
const SRC_HASH = `select (select md5(string_agg(to_jsonb(t)::text, ',' order by id)) from tyre_records t) tr,
  (select md5(string_agg(to_jsonb(m)::text, ',' order by id)) from tyre_status_marks m) tm`
const ITEMS = `select country, serial, custody_state, basis, site, location_id, asset_no, position, last_asset_no, last_position,
  removed_at, brand, size, fitments, purchase_cost, currency from tyre_items order by country, serial`
const CONFLICTS = `select country, serial, conflict_type, status, detected_by, evidence from tyre_custody_conflicts
  order by country, serial, conflict_type`
const did = s => `md5('${s}')::uuid`

// The seven production patterns (doc 31): five KSA "pattern A" (serial on the new Active row,
// scrap mark meant for the removed one), one KSA "pattern B" (scrapped on one mixer, active
// on another two days later), one UAE "pattern C" (active in UAE, scrapped row + mark in KSA).
async function seedSeven (db) {
  const a = ['L52043311', 'YMM18886', 'YMM22455', 'YMM68731', 'YMY44573']
  let sql = ''
  a.forEach((s, i) => {
    sql += `(${did(s + 'old')},'${ORG_A}','KSA','S1',null,'TM5${i}','RHF1','Scrapped','2025-11-10','2026-06-16',900,'2025-11-10'),
      (${did(s + 'new')},'${ORG_A}','KSA','S1','${s}','TM5${i}','RHF1','Active','2026-06-16',null,950,'2026-08-02'),`
  })
  sql += `(${did('B-old')},'${ORG_A}','KSA','S1','YMU41519','TM543','RHF1','Scrapped','2025-01-01','2026-03-01',800,'2025-01-01'),
    (${did('B-new')},'${ORG_A}','KSA','S1','YMU41519','TM411','LHCI','Active','2026-03-03',null,null,'2026-03-03'),
    (${did('C-ksa')},'${ORG_A}','KSA','S1','YMA44467','TM642','RHF1','Scrapped','2025-10-01','2026-08-20',700,'2025-10-01'),
    (${did('C-uae')},'${ORG_A}','UAE','S1','YMA44467','TM204','RHF1','Active','2025-10-01',null,null,'2026-07-22')`
  await db.exec(`insert into tyre_records(id, organisation_id, country, site, serial_no, asset_no, tyre_position, status,
    issue_date, removal_date, cost_per_tyre, created_at) values ${sql}`)
  await db.exec(`insert into tyre_status_marks(serial, mark_type, organisation_id, country, reason, created_at) values
    ${a.map(s => `('${s}','scrap','${ORG_A}','KSA',null,'2026-07-28')`).join(',')},
    ('YMU41519','scrap','${ORG_A}','KSA','Needs to check in the system.','2026-07-27'),
    ('YMA44467','scrap','${ORG_A}','KSA',null,'2026-09-14')`)
}

// Volume: n serials with 1-3 rows each, unique dates per serial (no exact ties), some on two
// assets, some scrap marks, holdings and dispositions.
async function seedVolume (db, n) {
  await db.exec(`insert into tyre_records(id, organisation_id, country, site, serial_no, asset_no, tyre_position, status,
      issue_date, removal_date, cost_per_tyre, brand, size, created_at)
    select md5('v' || g || '-' || k)::uuid, '${ORG_A}', case when g % 5 = 0 then 'UAE' else 'KSA' end, 'S' || (1 + g % 2),
      'Q' || upper(substr(md5(g::text), 1, 7)) || (g % 10),
      'TM' || (100 + (g * 7 + k) % 300), (array['LHF1','RHF1','LHCI','RHCI','LHRO'])[1 + (g + k) % 5],
      case when k = 1 and g % 3 <> 0 then 'Removed' when k = 2 and g % 11 = 0 then 'Scrapped' else 'Active' end,
      date '2024-01-01' + (g % 200) + k * 150,
      case when k = 1 and g % 3 <> 0 then date '2024-01-01' + (g % 200) + 140 end,
      case when g % 4 = 0 then null else 600 + g % 90 + k end,
      'Brand ' || (g % 6), '315/80R22.5', timestamptz '2024-01-01' + (g % 200 + k * 150) * interval '1 day'
    from generate_series(1, ${n}) g cross join generate_series(1, 3) k
    where k = 1 or (k = 2 and g % 2 = 0) or (k = 3 and g % 17 = 0)`)
  await db.exec(`insert into tyre_status_marks(serial, mark_type, organisation_id, country, reason, created_at)
    select 'Q' || upper(substr(md5(g::text), 1, 7)) || (g % 10), 'scrap', '${ORG_A}', 'KSA', 'burst', '2025-06-01'
      from generate_series(1, ${n}) g where g % 53 = 0`)
  await db.exec(`insert into tyre_store_holdings(id, organisation_id, country, serial, custody_state, site, purchase_cost, currency, recorded_by)
    select md5('h' || g)::uuid, '${ORG_A}', 'KSA', 'Q' || upper(substr(md5(g::text), 1, 7)) || (g % 10), 'reusable', 'S1', 500, 'SAR', '${U.admin}'
      from generate_series(1, ${n}) g where g % 41 = 0 and g % 5 <> 0`)
  await db.exec(`insert into tyre_dispositions(id, organisation_id, country, serial, state, reason, decided_by, decided_at)
    select md5('d' || g)::uuid, '${ORG_A}', 'KSA', 'Q' || upper(substr(md5(g::text), 1, 7)) || (g % 10), 'quarantine', 'inspected', '${U.admin}', '2025-12-01'
      from generate_series(1, ${n}) g where g % 29 = 0 and g % 5 <> 0`)
}

async function runAll (db) {
  const t0 = Date.now()
  const r = {}
  for (const c of ['KSA', 'UAE', null]) r[c ?? 'ALL'] = await call(db, U.reviewer, 'inv_tyre_item_sync', { country: c })
  return { ms: Date.now() - t0, r, items: await q(db, ITEMS), conflicts: await q(db, CONFLICTS) }
}

test('tyre sync perf: same derivation as the released function, faster, idempotent', async t => {
  const oldDb = await buildDb(); const newDb = await buildDb()
  try {
    assert.equal((await one(oldDb, `select md5(replace(pg_get_functiondef('public._inv_tyre_item_sync(text)'::regprocedure), chr(13), '')) m`)).m, OLD_MD5,
      'harness carries the production definition')
    for (const db of [oldDb, newDb]) { await seedSeven(db); await seedVolume(db, 600) }
    await newDb.exec(FIX)
    const before = await one(newDb, SRC_HASH)

    const o = await runAll(oldDb); const n = await runAll(newDb)
    await t.test('identical tyre_items and conflicts (evidence included)', () => {
      assert.ok(n.items.length > 600)
      assert.deepEqual(n.items, o.items)
      assert.deepEqual(n.conflicts, o.conflicts)
      for (const k of ['KSA', 'UAE', 'ALL']) {
        for (const f of ['items', 'state_changes', 'new_conflicts', 'weak_serial_rows', 'tyre_records_written']) {
          assert.equal(n.r[k][f], o.r[k][f], `${k}.${f}`)
        }
      }
    })

    await t.test('the seven production conflicts are open (6 KSA, 1 UAE), no duplicates', async () => {
      const seven = ['L52043311', 'YMM18886', 'YMM22455', 'YMM68731', 'YMY44573', 'YMU41519', 'YMA44467']
      const rows = await q(newDb, `select country, serial from tyre_custody_conflicts where conflict_type = 'scrapped_but_active'
        and serial = any($1) and status = 'open' order by serial`, [seven])
      assert.deepEqual(rows.map(r => r.serial).sort(), [...seven].sort())
      assert.equal(rows.filter(r => r.country === 'KSA').length, 6)
      assert.deepEqual(rows.filter(r => r.country === 'UAE').map(r => r.serial), ['YMA44467'])
      assert.equal((await one(newDb, `select count(*)::int n from (select 1 from tyre_custody_conflicts
        group by organisation_id, country, serial, conflict_type, status having count(*) > 1) x`)).n, 0)
    })

    await t.test('repeat within 60 s with unchanged sources returns the cached result', async () => {
      // the UAE / all-country runs above opened a conflict, so the KSA fingerprint is stale: rescan
      const first = await call(newDb, U.reviewer, 'inv_tyre_item_sync', { country: 'KSA' })
      assert.equal(first.cached, false); assert.equal(first.new_conflicts, 0); assert.equal(first.items_written, 0)
      const c = await call(newDb, U.reviewer, 'inv_tyre_item_sync', { country: 'KSA' })
      assert.equal(c.cached, true); assert.equal(c.new_conflicts, 0); assert.equal(c.items, n.r.KSA.items)
    })

    await t.test('changed source rescans; only changed tyres are written; still no duplicates', async () => {
      const conflictsBefore = (await one(newDb, 'select count(*)::int n from tyre_custody_conflicts')).n
      await newDb.exec(`insert into tyre_dispositions(organisation_id, country, serial, state, reason, decided_by)
        select '${ORG_A}', country, serial, 'reusable', 'tread ok', '${U.admin}' from tyre_items
         where country = 'KSA' and custody_state = 'removed_pending' order by serial limit 1`)
      const r = await call(newDb, U.reviewer, 'inv_tyre_item_sync', { country: 'KSA' })
      assert.equal(r.cached, false)
      assert.equal(r.items_written, 1); assert.equal(r.state_changes, 1); assert.equal(r.new_conflicts, 0)
      assert.equal((await one(newDb, 'select count(*)::int n from tyre_custody_conflicts')).n, conflictsBefore)
      // expire the cooldown: a forced rescan with unchanged data writes nothing and adds nothing
      await newDb.exec("update inv_tyre_sync_runs set finished_at = now() - interval '5 minutes'")
      const again = await call(newDb, U.reviewer, 'inv_tyre_item_sync', { country: 'KSA' })
      assert.equal(again.cached, false); assert.equal(again.items_written, 0); assert.equal(again.new_conflicts, 0)
      assert.equal((await one(newDb, 'select count(*)::int n from tyre_custody_conflicts')).n, conflictsBefore)
    })

    await t.test('tyre_records and tyre_status_marks untouched; permissions unchanged', async () => {
      assert.deepEqual(await one(newDb, SRC_HASH), before)
      const p = await one(newDb, `select has_function_privilege('authenticated','public._inv_tyre_item_sync(text)','EXECUTE') inner_fn,
        has_function_privilege('authenticated','public.inv_tyre_item_sync(jsonb)','EXECUTE') wrapper,
        has_table_privilege('authenticated','public.inv_tyre_sync_runs','INSERT') ins`)
      assert.deepEqual([p.inner_fn, p.wrapper, p.ins], [false, true, false])
      await assert.rejects(call(newDb, U.viewer, 'inv_tyre_item_sync', {}), /42501|authorised/)
    })

    await t.test('re-applying is a no-op; rollback restores the released definition', async () => {
      await newDb.exec(FIX)
      await newDb.exec(FIX_RB)
      assert.equal((await one(newDb, `select md5(replace(pg_get_functiondef('public._inv_tyre_item_sync(text)'::regprocedure), chr(13), '')) m`)).m, OLD_MD5)
      assert.equal((await one(newDb, "select to_regclass('public.inv_tyre_sync_runs') r")).r, null)
    })

    console.log(`# timing (600 serials x 3 scopes): released ${o.ms} ms, set-based ${n.ms} ms`)
    assert.ok(n.ms < o.ms, `set-based (${n.ms} ms) must be faster than released (${o.ms} ms)`)
  } finally { await oldDb.close(); await newDb.close() }
})

test('tyre sync perf: KSA-scale volume (7,000 serials) completes quickly', async () => {
  const db = await buildDb()
  try {
    await db.exec(FIX)
    await seedSeven(db); await seedVolume(db, 7000)
    const t0 = Date.now()
    const r = await call(db, U.reviewer, 'inv_tyre_item_sync', { country: 'KSA' })
    const ms = Date.now() - t0
    console.log(`# timing (7,000 serials, ${(await one(db, "select count(*)::int n from tyre_records where country='KSA'")).n} KSA rows): set-based ${ms} ms`)
    assert.ok(r.items > 5000)
    assert.ok(ms < 30000, `took ${ms} ms`)
  } finally { await db.close() }
})
