// Warehouse and bin setup (supabase/pending_migrations/20261122120000_inv_location_setup.sql, DRAFT).
// PGlite over the live-shaped inventory harness: bulk create under a registered store,
// preview writes nothing, existing codes are reused, stores are never created,
// permission + scope + company isolation, idempotent replay, clean rollback.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildDb, call, q, one, U, ORG_A, ORG_B, code } from './inventory_harness.test.mjs'

const PENDING = f => readFileSync(new URL(`../pending_migrations/${f}`, import.meta.url), 'utf8')
const UP = PENDING('20261122120000_inv_location_setup.sql')
const DOWN = PENDING('20261122120000_inv_location_setup_ROLLBACK.sql')

const layout = (extra = {}) => ({
  country: 'KSA', site: 'S1',
  nodes: [
    { ref: 'r', code: 'A', name: 'Rack A', location_type: 'rack' },
    { ref: 's1', parent_ref: 'r', code: 'A-01', name: 'Shelf A-01', location_type: 'shelf' },
    { ref: 'b1', parent_ref: 's1', code: 'A-01-01', name: 'Bin A-01-01', location_type: 'bin' },
    { ref: 'b2', parent_ref: 's1', code: 'A-01-02', name: 'Bin A-01-02', location_type: 'bin' },
  ],
  ...extra,
})

test('inventory location setup: bulk create under an existing store', async t => {
  const db = await buildDb()
  try {
    await db.exec(`insert into public.sites(name, country, organisation_id, active) values
      ('S1','KSA','${ORG_A}',true),('S2','KSA','${ORG_A}',true),('OLD','KSA','${ORG_A}',false),('S1','KSA','${ORG_B}',true)`)
    await db.exec(UP)

    await t.test('closed surface', async () => {
      assert.equal((await one(db, "select has_function_privilege('anon','public.inv_location_bulk_create(jsonb)','EXECUTE') as x")).x, false)
      assert.equal((await one(db, "select has_function_privilege('authenticated','public.inv_location_bulk_create(jsonb)','EXECUTE') as x")).x, true)
    })

    await t.test('preview (dry run) reports new nodes and writes nothing', async () => {
      const r = await call(db, U.admin, 'inv_location_bulk_create', layout({ dry_run: true }))
      assert.equal(r.dry_run, true)
      assert.equal(r.created, 4)
      assert.equal((await one(db, 'select count(*)::int n from inventory_locations')).n, 0)
    })

    let rackId
    await t.test('create builds the tree with the right parents', async () => {
      const r = await call(db, U.approver, 'inv_location_bulk_create', layout())
      assert.equal(r.created, 4); assert.equal(r.existing, 0)
      const rows = await q(db, "select id, code, location_type, parent_id, site, label_code from inventory_locations order by code")
      assert.deepEqual(rows.map(x => x.code), ['A', 'A-01', 'A-01-01', 'A-01-02'])
      rackId = rows[0].id
      const byCode = Object.fromEntries((await q(db, 'select id, code, parent_id from inventory_locations')).map(x => [x.code, x]))
      assert.equal(byCode['A-01'].parent_id, byCode.A.id)
      assert.equal(byCode['A-01-02'].parent_id, byCode['A-01'].id)
      assert.ok(rows.every(x => x.site === 'S1' && x.label_code.startsWith('TP:LOC:')))
    })

    await t.test('existing codes are reused, new children attach to them', async () => {
      const r = await call(db, U.admin, 'inv_location_bulk_create', { country: 'KSA', site: 's1', nodes: [
        { ref: 'r', code: 'a', location_type: 'rack' },
        { ref: 's2', parent_ref: 'r', code: 'A-02', location_type: 'shelf' },
      ] })
      assert.equal(r.existing, 1); assert.equal(r.created, 1)
      const shelf = await one(db, "select p.code from inventory_locations c join inventory_locations p on p.id = c.parent_id where c.code = 'A-02'")
      assert.equal(shelf.code, 'A')
      assert.equal((await one(db, "select count(*)::int n from inventory_locations where code = 'A'")).n, 1)
    })

    await t.test('idempotent replay returns the stored result', async () => {
      const key = 'bulk-replay-1'
      const p = { idempotency_key: key, country: 'KSA', site: 'S2', nodes: [{ ref: 'x', code: 'R1', location_type: 'rack' }] }
      const a = await call(db, U.admin, 'inv_location_bulk_create', p)
      const b = await call(db, U.admin, 'inv_location_bulk_create', p)
      assert.equal(b.replayed, true)
      assert.deepEqual(a.nodes, b.nodes)
      assert.equal((await one(db, "select count(*)::int n from inventory_locations where site = 'S2'")).n, 1)
    })

    await t.test('stores are never created and must be active and registered', async () => {
      await assert.rejects(call(db, U.admin, 'inv_location_bulk_create', layout({ site: 'NEWSTORE' })), code('P0002'))
      await assert.rejects(call(db, U.admin, 'inv_location_bulk_create', layout({ site: 'OLD' })), code('P0002'))
      assert.equal((await one(db, "select count(*)::int n from sites where name in ('NEWSTORE')")).n, 0)
    })

    await t.test('bad payloads are refused', async () => {
      const dup = { country: 'KSA', site: 'S2', nodes: [{ ref: 'a', code: 'Z1', location_type: 'rack' }, { ref: 'b', code: 'z1', location_type: 'rack' }] }
      await assert.rejects(call(db, U.admin, 'inv_location_bulk_create', dup), code('23505'))
      const order = { country: 'KSA', site: 'S2', nodes: [{ ref: 'b', parent_ref: 'a', code: 'Z2', location_type: 'bin' }, { ref: 'a', code: 'Z3', location_type: 'rack' }] }
      await assert.rejects(call(db, U.admin, 'inv_location_bulk_create', order), code('22023'))
      const type = { country: 'KSA', site: 'S2', nodes: [{ ref: 'a', code: 'Q1', location_type: 'scrap' }] }
      await assert.rejects(call(db, U.admin, 'inv_location_bulk_create', type), code('22023'))
      const bad = { country: 'KSA', site: 'S2', nodes: [{ ref: 'a', code: 'A B', location_type: 'rack' }] }
      await assert.rejects(call(db, U.admin, 'inv_location_bulk_create', bad), code('22023'))
      const many = { country: 'KSA', site: 'S2', nodes: Array.from({ length: 501 }, (_, i) => ({ ref: `n${i}`, code: `M${i}`, location_type: 'bin' })) }
      await assert.rejects(call(db, U.admin, 'inv_location_bulk_create', many), code('22023'))
      await assert.rejects(call(db, U.admin, 'inv_location_bulk_create', { country: 'KSA', site: 'S2', nodes: [] }), code('22023'))
      // a parent from another store
      await assert.rejects(call(db, U.admin, 'inv_location_bulk_create', { country: 'KSA', site: 'S2', parent_id: rackId,
        nodes: [{ ref: 'a', code: 'P1', location_type: 'shelf' }] }), code('P0002'))
      assert.equal((await one(db, "select count(*)::int n from inventory_locations where code in ('Z1','Z2','Z3','Q1','P1')")).n, 0)
    })

    await t.test('permission, scope and company isolation', async () => {
      // a store keeper (transfer capability, not elevated) cannot create locations
      await assert.rejects(call(db, U.keeper, 'inv_location_bulk_create', layout({ dry_run: true })), code('42501'))
      await assert.rejects(call(db, U.viewer, 'inv_location_bulk_create', layout()), code('42501'))
      // company B Admin cannot use company A's store, and its own S1 is separate
      const b = await call(db, U.adminB, 'inv_location_bulk_create', layout())
      assert.equal(b.created, 4)
      assert.equal((await one(db, `select count(*)::int n from inventory_locations where organisation_id = '${ORG_B}'`)).n, 4)
      // a parent of company A is not found for company B
      await assert.rejects(call(db, U.adminB, 'inv_location_bulk_create', { country: 'KSA', site: 'S1', parent_id: rackId,
        nodes: [{ ref: 'a', code: 'X9', location_type: 'shelf' }] }), code('P0002'))
      // outside country scope
      await assert.rejects(call(db, U.admin, 'inv_location_bulk_create', { country: 'UAE', site: 'S1', nodes: [{ ref: 'a', code: 'U1', location_type: 'rack' }] }), code('42501'))
    })

    await t.test('rollback removes only the function', async () => {
      const before = (await one(db, 'select count(*)::int n from inventory_locations')).n
      await db.exec(DOWN)
      assert.equal((await one(db, "select count(*)::int n from pg_proc where proname = 'inv_location_bulk_create'")).n, 0)
      assert.equal((await one(db, 'select count(*)::int n from inventory_locations')).n, before)
    })
  } finally {
    await db.close()
  }
})
