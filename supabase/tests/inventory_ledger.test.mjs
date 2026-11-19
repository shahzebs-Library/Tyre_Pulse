// P0 ledger integrity + valuation + legacy wrappers + write gates (PGlite, synthetic data).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDb, asUser, rpc, q, one, id, U, ORG_A, ORG_B, code } from './inventory_harness.test.mjs'

const j = JSON.stringify
let n = 0
const key = () => `k-${++n}`

async function setup () {
  const db = await buildDb()
  const loc = async (uid, p) => rpc(db, uid, 'inv_location_upsert', [j(p)])
  const L = {}
  L.s1 = await loc(U.admin, { country: 'KSA', site: 'S1', location_type: 'warehouse', code: 'WH1' })
  L.s1bin = await loc(U.admin, { country: 'KSA', site: 'S1', location_type: 'bin', code: 'A-01', parent_id: L.s1 })
  L.s2 = await loc(U.admin, { country: 'KSA', site: 'S2', location_type: 'warehouse', code: 'WH2' })
  L.uae = await loc(U.super, { country: 'UAE', site: 'U1', location_type: 'warehouse', code: 'WHU' })
  L.b = await loc(U.adminB, { country: 'KSA', site: 'S1', location_type: 'warehouse', code: 'WH1' })
  const post = (uid, p) => rpc(db, uid, 'inv_post_movement', [j(p)])
  const bal = async sid => one(db, 'select * from stock_records where id = $1', [sid])
  return { db, L, post, bal }
}

const FILTER = id(100); const BRAKE = id(104); const UAE_FILTER = id(102); const B_FILTER = id(103)

test('ledger: weighted average, unvalued-first, refusals, idempotency, reversal', async t => {
  const { db, L, post, bal } = await setup()
  try {
    let sid
    await t.test('receipt creates the balance and values it at cost', async () => {
      const r = await post(U.keeper, { idempotency_key: 'r1', item_id: FILTER, location_id: L.s1bin, movement_type: 'receipt', qty_change: 10, unit_cost: 5 })
      assert.equal(r.status, 'posted'); sid = r.stock_id
      const r2 = await post(U.keeper, { idempotency_key: 'r2', item_id: FILTER, location_id: L.s1bin, movement_type: 'receipt', qty_change: 10, unit_cost: 7 })
      assert.equal(r2.stock_id, sid)
      const b = await bal(sid)
      assert.equal(Number(b.qty_on_hand), 20); assert.equal(Number(b.avg_unit_cost), 6); assert.equal(Number(b.valued_value), 120)
      assert.equal(b.stock_qty, 20); assert.equal(b.currency, 'SAR'); assert.equal(b.site, 'S1')
    })
    await t.test('unpriced receipt is unvalued (never 0) and leaves first', async () => {
      await post(U.keeper, { idempotency_key: 'r3', stock_id: sid, movement_type: 'receipt', qty_change: 4 })
      let b = await bal(sid)
      assert.equal(Number(b.unvalued_qty), 4); assert.equal(Number(b.valued_qty), 20); assert.equal(Number(b.avg_unit_cost), 6)
      const i1 = await post(U.keeper, { idempotency_key: 'i1', stock_id: sid, movement_type: 'issue', qty_change: -3 })
      assert.equal(i1.value_change, null); assert.equal(i1.valuation_status, 'unvalued'); assert.equal(Number(i1.unvalued_qty_change), -3)
      const i2 = await post(U.keeper, { idempotency_key: 'i2', stock_id: sid, movement_type: 'issue', qty_change: -6 })
      assert.equal(i2.valuation_status, 'partially_valued'); assert.equal(Number(i2.value_change), -30)
      b = await bal(sid)
      assert.equal(Number(b.qty_on_hand), 15); assert.equal(Number(b.unvalued_qty), 0); assert.equal(Number(b.valued_value), 90)
    })
    await t.test('idempotent retry replays; a changed payload with the same key is refused', async () => {
      const again = await post(U.keeper, { idempotency_key: 'i2', stock_id: sid, movement_type: 'issue', qty_change: -6 })
      assert.equal(again.replayed, true)
      assert.equal(Number((await bal(sid)).qty_on_hand), 15)
      await assert.rejects(post(U.keeper, { idempotency_key: 'i2', stock_id: sid, movement_type: 'issue', qty_change: -7 }), code('23505'))
      await assert.rejects(post(U.keeper, { stock_id: sid, movement_type: 'issue', qty_change: -1 }), code('22023'))
    })
    await t.test('stale version is refused (optimistic concurrency) and sequential posts never lose a unit', async () => {
      const b = await bal(sid)
      await assert.rejects(post(U.keeper, { idempotency_key: 'v1', stock_id: sid, movement_type: 'issue', qty_change: -1, expected_version: b.version - 1 }), code('PT409'))
      await Promise.all([1, 2, 3, 4, 5].map(i => post(U.keeper, { idempotency_key: `par-${i}`, stock_id: sid, movement_type: 'issue', qty_change: -1 })))
      const after = await bal(sid)
      assert.equal(Number(after.qty_on_hand), 10)
      const led = await one(db, 'select sum(qty_change)::numeric s, count(*)::int c from stock_movements where stock_id=$1', [sid])
      assert.equal(Number(led.s), 10)
      const seqs = await q(db, 'select movement_seq from stock_movements where stock_id=$1 order by movement_seq', [sid])
      assert.equal(new Set(seqs.map(r => r.movement_seq)).size, seqs.length)
    })
    await t.test('negative stock is refused with a shortage exception, never an override', async () => {
      const r = await post(U.keeper, { idempotency_key: 'neg1', stock_id: sid, movement_type: 'issue', qty_change: -11 })
      assert.equal(r.status, 'refused_shortage')
      const ex = await one(db, 'select * from stock_exceptions where id=$1', [r.exception_id])
      assert.equal(ex.exception_type, 'shortage'); assert.equal(Number(ex.qty), 1); assert.equal(Number(ex.qty_available), 10)
      assert.equal(Number((await bal(sid)).qty_on_hand), 10)
      const adm = await post(U.admin, { idempotency_key: 'neg2', stock_id: sid, movement_type: 'adjustment_down', qty_change: -50 })
      assert.equal(adm.status, 'refused_shortage')
      await assert.rejects(rpc(db, U.admin, 'post_stock_movement', [sid, 'adjustment_down', 50, 'x', null]), code('23514'))
      // exception replay returns the same refusal
      const again = await post(U.keeper, { idempotency_key: 'neg1', stock_id: sid, movement_type: 'issue', qty_change: -11 })
      assert.equal(again.replayed, true); assert.equal(again.exception_id, r.exception_id)
    })
    await t.test('currency is never mixed', async () => {
      await assert.rejects(post(U.keeper, { idempotency_key: 'cur1', stock_id: sid, movement_type: 'receipt', qty_change: 1, unit_cost: 1, currency: 'AED' }), code('22023'))
    })
    await t.test('reversal negates exactly, only once, and refuses when the units are gone', async () => {
      const rc = await post(U.keeper, { idempotency_key: 'rv-src', stock_id: sid, movement_type: 'receipt', qty_change: 10, unit_cost: 12 })
      let b = await bal(sid); assert.equal(Number(b.avg_unit_cost), 9)
      await assert.rejects(rpc(db, U.keeper, 'inv_reverse_movement', [rc.movement_id, 'wrong qty', 'rv1']), code('42501'))
      const rv = await rpc(db, U.approver, 'inv_reverse_movement', [rc.movement_id, 'wrong qty', 'rv1'])
      assert.equal(Number(rv.qty_change), -10); assert.equal(Number(rv.value_change), -120)
      b = await bal(sid); assert.equal(Number(b.avg_unit_cost), 6); assert.equal(Number(b.qty_on_hand), 10)
      await assert.rejects(rpc(db, U.approver, 'inv_reverse_movement', [rc.movement_id, 'again', 'rv2']), code('23505'))
      const big = await post(U.keeper, { idempotency_key: 'rv-big', stock_id: sid, movement_type: 'receipt', qty_change: 5, unit_cost: 6 })
      await post(U.keeper, { idempotency_key: 'rv-out', stock_id: sid, movement_type: 'issue', qty_change: -14 })
      const refused = await rpc(db, U.approver, 'inv_reverse_movement', [big.movement_id, 'late', 'rv3'])
      assert.equal(refused.status, 'refused_shortage')
    })
    await t.test('the ledger is append-only even for the database owner', async () => {
      await assert.rejects(db.exec(`update stock_movements set reason='x' where stock_id='${sid}'`), /append-only/)
      await assert.rejects(db.exec(`delete from stock_movements where stock_id='${sid}'`), /append-only/)
      await assert.rejects(db.exec('truncate stock_movements cascade'), /append-only|inventory posting function/)
      await assert.rejects(db.exec(`insert into stock_movements(stock_id,site,movement_type,qty_before,qty_change,qty_after,organisation_id,idempotency_key) values ('${sid}','S1','receipt',0,1,1,'${ORG_A}','forged')`), /posting function/)
      await assert.rejects(db.exec(`delete from stock_records where id='${sid}'`), /still holds stock|violates foreign key/)
    })
  } finally { await db.close() }
})

test('ledger: direct client writes are refused; settings stay editable', async () => {
  const { db, L, post, bal } = await setup()
  try {
    const r = await post(U.keeper, { idempotency_key: 'd1', item_id: FILTER, location_id: L.s1, movement_type: 'receipt', qty_change: 3, unit_cost: 2 })
    const sid = r.stock_id
    for (const sql of [
      `insert into stock_movements(stock_id,site,movement_type,qty_before,qty_change,qty_after,organisation_id,idempotency_key) values ('${sid}','S1','receipt',3,1,4,'${ORG_A}','x')`,
      `update stock_movements set qty_change = 99 where stock_id = '${sid}'`,
      `delete from stock_movements where stock_id = '${sid}'`,
      `update stock_records set qty_on_hand = 99 where id = '${sid}'`,
      `update stock_records set stock_qty = 99 where id = '${sid}'`,
      `insert into stock_records(organisation_id,country,site,description,stock_qty) values ('${ORG_A}','KSA','S1','forged',5)`,
      `insert into stock_exceptions(organisation_id,exception_type,qty) values ('${ORG_A}','shortage',1)`,
      `insert into materials(organisation_id,name) values ('${ORG_A}','x')`,
    ]) {
      await asUser(db, U.admin, async () => { await assert.rejects(db.exec(sql), /permission denied|row-level security|posted movement/, sql) })
    }
    await asUser(db, U.admin, async () => {
      const res = await db.query(`update stock_records set min_level = 7, critical_level = 2 where id = $1 returning min_level`, [sid])
      assert.equal(res.rows[0].min_level, 7)
    })
    await asUser(db, U.viewer, async () => {
      const res = await db.query(`update stock_records set min_level = 9 where id = $1`, [sid])
      assert.equal(res.affectedRows ?? 0, 0)
    })
    assert.equal(Number((await bal(sid)).qty_on_hand), 3)
  } finally { await db.close() }
})

test('ledger: company, country, site and capability boundaries', async () => {
  const { db, L, post } = await setup()
  try {
    const r = await post(U.keeper, { idempotency_key: 'b1', item_id: FILTER, location_id: L.s1, movement_type: 'receipt', qty_change: 3 })
    // other company cannot read or post to company A
    const seen = await asUser(db, U.adminB, async () => q(db, 'select id from stock_records where id = $1', [r.stock_id]))
    assert.equal(seen.length, 0)
    await assert.rejects(post(U.adminB, { idempotency_key: 'b2', stock_id: r.stock_id, movement_type: 'issue', qty_change: -1 }), code('42501'))
    await assert.rejects(post(U.adminB, { idempotency_key: 'b3', item_id: FILTER, location_id: L.s1, movement_type: 'receipt', qty_change: 1 }), code('42501'))
    // company B uses its own item and location fine; A cannot see it
    const rb = await post(U.adminB, { idempotency_key: 'b4', item_id: B_FILTER, location_id: L.b, movement_type: 'receipt', qty_change: 2 })
    assert.equal(rb.status, 'posted')
    const crossMov = await asUser(db, U.admin, async () => q(db, 'select id from stock_movements where stock_id = $1', [rb.stock_id]))
    assert.equal(crossMov.length, 0)
    // country and site scope
    await assert.rejects(post(U.uaeOnly, { idempotency_key: 'b5', stock_id: r.stock_id, movement_type: 'receipt', qty_change: 1 }), code('42501'))
    await assert.rejects(post(U.site2Only, { idempotency_key: 'b6', stock_id: r.stock_id, movement_type: 'receipt', qty_change: 1 }), code('42501'))
    const uae = await asUser(db, U.uaeOnly, async () => q(db, 'select id from stock_records where id = $1', [r.stock_id]))
    assert.equal(uae.length, 0)
    // item country must match location country
    await assert.rejects(post(U.admin, { idempotency_key: 'b7', item_id: UAE_FILTER, location_id: L.s1, movement_type: 'receipt', qty_change: 1 }), code('22023'))
    // capability: a viewer cannot receive; a keeper cannot approve adjustments
    await assert.rejects(post(U.viewer, { idempotency_key: 'b8', stock_id: r.stock_id, movement_type: 'receipt', qty_change: 1 }), code('42501'))
    await assert.rejects(post(U.keeper, { idempotency_key: 'b9', stock_id: r.stock_id, movement_type: 'adjustment_up', qty_change: 1 }), code('42501'))
    // opening/reversal never through the public RPC
    await assert.rejects(post(U.admin, { idempotency_key: 'b10', stock_id: r.stock_id, movement_type: 'opening', qty_change: 1 }), code('22023'))
    // anon has nothing
    await db.exec('set role anon')
    await assert.rejects(db.query('select * from stock_movements'), /permission denied/)
    await assert.rejects(db.query(`select public.inv_post_movement('{}'::jsonb)`), /permission denied/)
    await db.exec('reset role')
  } finally { await db.close() }
})

test('legacy writers become wrappers over the one posting function', async () => {
  const { db, L, post, bal } = await setup()
  try {
    // legacy row: qty 10, one Initial movement
    const legacy = id(400)
    const pm = await rpc(db, U.keeper, 'post_stock_movement', [legacy, 'issue', 2, 'fit', 'WO-1'])
    assert.equal(Number(pm.qty_after), 8)
    const mv = await one(db, 'select * from stock_movements where id = $1', [pm.movement_id])
    assert.match(mv.idempotency_key, /^legacy-psm:/); assert.equal(mv.country, 'KSA')
    await assert.rejects(rpc(db, U.viewer, 'set_stock_count', [legacy, 5, 'x']), code('42501'))
    const sc = await rpc(db, U.keeper, 'set_stock_count', [legacy, 6.5, 'count'])
    assert.equal(Number(sc.qty_after), 6.5)
    assert.equal((await bal(legacy)).stock_qty, 6)
    // reservations live on stock_records.qty_reserved, never the legacy stock table
    await db.exec(`insert into test_caps values ('${U.keeper}','view')`)
    const res = await rpc(db, U.keeper, 'reserve_work_order_stock', [id(300), j([{ stock_id: legacy, qty: 4 }]), 'wo-res-1'])
    assert.equal(res.status, 'reserved')
    let b = await bal(legacy)
    assert.equal(Number(b.qty_reserved), 4); assert.equal(Number(b.qty_on_hand), 6.5)
    await assert.rejects(rpc(db, U.keeper, 'reserve_work_order_stock', [id(300), j([{ stock_id: legacy, qty: 1 }]), 'wo-res-1b']), code('23505'))
    // issuing reserved stock without consuming the reservation is a shortage
    const short = await post(U.keeper, { idempotency_key: 'lg1', stock_id: legacy, movement_type: 'issue', qty_change: -3 })
    assert.equal(short.status, 'refused_shortage')
    const rel = await rpc(db, U.keeper, 'release_work_order_stock', [id(300), 'done'])
    assert.equal(rel.released, true)
    b = await bal(legacy); assert.equal(Number(b.qty_reserved), 0)
    assert.equal(Number((await one(db, 'select count(*)::int c from stock')).c), 0)
    // save_stock_entry keeps its contract and now posts through _inv_post
    const se = await rpc(db, U.admin, 'save_stock_entry', [id(500), 'KSA', 'S1', 'count', '', 'n',
      j([{ stock_id: legacy, quantity: '9', unit: 'PCS', expected_qty: 6.5, expected_updated_at: b.updated_at.toISOString() }])])
    assert.equal(se.status, 'posted'); assert.equal(Number(se.items[0].qty_after), 9)
    const sem = await one(db, 'select * from stock_movements where id = $1', [se.items[0].movement_id])
    assert.equal(sem.idempotency_key, `save_stock_entry:${id(500)}:${legacy}`)
    const replay = await rpc(db, U.admin, 'save_stock_entry', [id(500), 'KSA', 'S1', 'count', '', 'n',
      j([{ stock_id: legacy, quantity: '9', unit: 'PCS', expected_qty: 6.5, expected_updated_at: b.updated_at.toISOString() }])])
    assert.equal(replay.replayed, true)
    // transfer_stock_entry carries cost and keeps unvalued units unvalued
    const other = await post(U.keeper, { idempotency_key: 'lg2', item_id: FILTER, location_id: L.s2, movement_type: 'receipt', qty_change: 1, unit_cost: 3 })
    const priced = await post(U.keeper, { idempotency_key: 'lg3', item_id: FILTER, location_id: L.s1, movement_type: 'receipt', qty_change: 4, unit_cost: 5 })
    await db.exec(`update stock_records set custom_data='{"stock_item":{"code":"FLT-01","unit":"PCS"}}' where id in ('${other.stock_id}','${priced.stock_id}')`)
    const a = await bal(priced.stock_id); const c = await bal(other.stock_id)
    const tr = await rpc(db, U.admin, 'transfer_stock_entry', [id(501), priced.stock_id, other.stock_id, 2, a.stock_qty, c.stock_qty, 'move'])
    assert.equal(tr.status, 'posted')
    const dest = await bal(other.stock_id)
    assert.equal(Number(dest.qty_on_hand), 3); assert.equal(Number(dest.valued_value), 13); assert.equal(Number(dest.avg_unit_cost), 4.3333)
    // reconcile view reports the legacy rows' unexplained history honestly
    const drift = await q(db, 'select * from v_stock_balance_reconcile where stock_id = $1', [id(401)])
    assert.equal(drift[0].has_drift, true)
  } finally { await db.close() }
})

test('procurement and master tables are gated server-side', async () => {
  const { db } = await setup()
  try {
    await asUser(db, U.viewer, async () => {
      await assert.rejects(db.query(`insert into goods_receipts(organisation_id, item, qty_received) values ('${ORG_A}','x',1)`), /row-level security/)
      await assert.rejects(db.query(`insert into suppliers(supplier_name, organisation_id) values ('x','${ORG_A}')`), /row-level security/)
      await assert.rejects(db.query(`insert into purchase_orders(po_number, organisation_id) values ('PO-9','${ORG_A}')`), /row-level security/)
      await db.query(`insert into requisitions(organisation_id, item, created_by) values ('${ORG_A}','filter','${U.viewer}')`)
      await assert.rejects(db.query(`insert into requisitions(organisation_id, item, created_by) values ('${ORG_A}','filter','${U.keeper}')`), /row-level security/)
    })
    await db.exec(`insert into test_caps values ('${U.keeper}','procure')`)
    await asUser(db, U.keeper, async () => {
      await db.query(`insert into purchase_orders(po_number, organisation_id) values ('PO-1','${ORG_A}')`)
      await assert.rejects(db.query(`insert into purchase_orders(po_number, organisation_id) values ('PO-1','${ORG_A}')`), /duplicate key/)
    })
    await asUser(db, U.adminB, async () => { await db.query(`insert into purchase_orders(po_number, organisation_id) values ('PO-1','${ORG_B}')`) })
  } finally { await db.close() }
})
