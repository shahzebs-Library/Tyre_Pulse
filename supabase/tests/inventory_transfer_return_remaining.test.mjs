// inv_transfer_return_remaining fix
// (supabase/migrations/20261122110000_inv_transfer_return_remaining_fix.sql, applied 2026-11-21).
// Before the fix a call without `lines` (or with []) flipped an in_transit transfer to
// partially_received while no stock moved. PGlite over the live-shaped inventory harness.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildDb, rpc, call, q, one, id, U, code } from './inventory_harness.test.mjs'

const PENDING = f => readFileSync(new URL(`../${f.endsWith('_ROLLBACK.sql') ? 'rollbacks' : 'migrations'}/${f}`, import.meta.url), 'utf8')
const UP = PENDING('20261122110000_inv_transfer_return_remaining_fix.sql')
const DOWN = PENDING('20261122110000_inv_transfer_return_remaining_fix_ROLLBACK.sql')
const FILTER = id(100); const BRAKE = id(104)
const j = JSON.stringify
const ret = (db, payload) => rpc(db, U.keeper, 'inv_transfer_return_remaining', [j(payload)])

async function setup ({ fixed = true } = {}) {
  const db = await buildDb()
  if (fixed) await db.exec(UP)
  const loc = p => call(db, U.admin, 'inv_location_upsert', p).then(r => r.id)
  const L = {
    s1: await loc({ country: 'KSA', site: 'S1', location_type: 'warehouse', code: 'WH1' }),
    s2: await loc({ country: 'KSA', site: 'S2', location_type: 'warehouse', code: 'WH2' }),
  }
  const post = p => rpc(db, U.keeper, 'inv_post_movement', [j(p)])
  const f = await post({ idempotency_key: 'r-f', item_id: FILTER, location_id: L.s1, movement_type: 'receipt', qty_change: 10, unit_cost: 4 })
  const b = await post({ idempotency_key: 'r-b', item_id: BRAKE, location_id: L.s1, movement_type: 'receipt', qty_change: 5, unit_cost: 20 })
  let n = 0
  const dispatch = async (qf = 6, qb = 3) => {
    const d = await rpc(db, U.keeper, 'inv_transfer_dispatch', [j({ idempotency_key: `d-${++n}`, from_location_id: L.s1, to_location_id: L.s2,
      lines: [{ scanned_code: `TP:STK:${f.stock_id}`, qty: qf }, { scanned_code: `TP:STK:${b.stock_id}`, qty: qb }] })])
    // dispatch does not promise line order, so lines[0] is always the filter line
    const lines = await q(db, `select * from stock_transfer_lines where transfer_id = $1
      order by (item_id = '${FILTER}') desc`, [d.transfer_id])
    return { id: d.transfer_id, lines }
  }
  const totals = item => one(db, `select sum(qty_on_hand)::numeric qty, sum(valued_value)::numeric v, sum(qty_reserved)::numeric r
    from stock_records where item_id = $1`, [item]).then(r => ({ qty: Number(r.qty), v: Number(r.v), r: Number(r.r) }))
  const qtyAt = sid => one(db, 'select qty_on_hand, qty_reserved from stock_records where id = $1', [sid])
    .then(r => ({ qty: Number(r.qty_on_hand), res: Number(r.qty_reserved) }))
  const transfer = tid => one(db, 'select status, cancel_reason from stock_transfers where id = $1', [tid])
  const ledger = tid => q(db, `select movement_type, qty_change::numeric q, stock_id from stock_movements
    where source_doc_type = 'stock_transfer' and source_doc_id = $1 order by created_at, id`, [tid])
  return { db, L, f, b, dispatch, totals, qtyAt, transfer, ledger }
}

test('BEFORE the fix: no lines marks the transfer partly received and moves nothing (reproduction)', async () => {
  const { db, f, dispatch, qtyAt, transfer } = await setup({ fixed: false })
  try {
    const t = await dispatch()
    const r = await ret(db, { idempotency_key: 'bug-1', transfer_id: t.id, reason: 'not needed' })
    assert.equal(r.status, 'partially_received')
    assert.equal((await transfer(t.id)).status, 'partially_received')
    assert.equal((await qtyAt(t.lines[0].transit_stock_id)).qty, 6) // still in transit
    assert.equal((await qtyAt(f.stock_id)).qty, 4)
  } finally { await db.close() }
})

test('absent lines: every remaining quantity returns to source, ledger written, stock conserved', async () => {
  const { db, f, b, dispatch, totals, qtyAt, transfer, ledger } = await setup()
  try {
    const before = { f: await totals(FILTER), b: await totals(BRAKE) }
    const t = await dispatch()
    const r = await ret(db, { idempotency_key: 'all-1', transfer_id: t.id, reason: 'cancelled job' })
    assert.equal(r.status, 'cancelled'); assert.equal(r.returned_lines, 2); assert.equal(Number(r.returned_qty), 9)
    assert.equal((await transfer(t.id)).cancel_reason, 'cancelled job')
    for (const ln of t.lines) assert.equal((await qtyAt(ln.transit_stock_id)).qty, 0)
    assert.equal((await qtyAt(f.stock_id)).qty, 10); assert.equal((await qtyAt(b.stock_id)).qty, 5)
    const lines = await q(db, `select qty_returned::numeric r, qty_received::numeric x from stock_transfer_lines where transfer_id = $1 order by (item_id = '${FILTER}') desc`, [t.id])
    assert.deepEqual(lines.map(l => [Number(l.r), Number(l.x)]), [[6, 0], [3, 0]])
    // ledger: dispatch (out source, in transit) + return (out transit, in source), signs mirror
    const lg = await ledger(t.id)
    const ret1 = lg.filter(m => m.stock_id === t.lines[0].transit_stock_id).map(m => [m.movement_type, Number(m.q)])
    assert.deepEqual(ret1, [['transfer_in', 6], ['transfer_out', -6]])
    const src = lg.filter(m => m.stock_id === f.stock_id).map(m => [m.movement_type, Number(m.q)])
    assert.deepEqual(src, [['transfer_out', -6], ['transfer_in', 6]])
    assert.equal(lg.reduce((s, m) => s + Number(m.q), 0), 0)
    assert.deepEqual(await totals(FILTER), before.f); assert.deepEqual(await totals(BRAKE), before.b)
  } finally { await db.close() }
})

test('partial receipt, then empty lines returns only what is still in transit', async () => {
  const { db, f, dispatch, totals, qtyAt, transfer } = await setup()
  try {
    const before = await totals(FILTER)
    const t = await dispatch()
    const rc = await rpc(db, U.site2Only, 'inv_transfer_receive', [j({ idempotency_key: 'rcv-1', transfer_id: t.id,
      lines: [{ line_id: t.lines[0].id, received_qty: 4 }] })])
    assert.equal(rc.status, 'partially_received')
    const r = await ret(db, { idempotency_key: 'rest-1', transfer_id: t.id, reason: 'short', lines: [] })
    assert.equal(r.status, 'completed'); assert.equal(Number(r.returned_qty), 5) // 2 filters + 3 brakes
    assert.equal((await transfer(t.id)).status, 'completed')
    assert.equal((await qtyAt(f.stock_id)).qty, 6) // 10 - 6 dispatched + 2 returned
    assert.equal((await qtyAt(t.lines[0].transit_stock_id)).qty, 0)
    assert.deepEqual(await totals(FILTER), before)
  } finally { await db.close() }
})

test('explicit lines still return only the chosen quantity', async () => {
  const { db, f, dispatch, qtyAt } = await setup()
  try {
    const t = await dispatch()
    const r = await ret(db, { idempotency_key: 'one-1', transfer_id: t.id, reason: 'one back', lines: [{ line_id: t.lines[0].id, qty: 2 }] })
    assert.equal(r.status, 'partially_received')
    assert.equal((await qtyAt(f.stock_id)).qty, 6); assert.equal((await qtyAt(t.lines[0].transit_stock_id)).qty, 4)
    await assert.rejects(ret(db, { idempotency_key: 'one-2', transfer_id: t.id, reason: 'x', lines: [{ line_id: t.lines[0].id, qty: 5 }] }), code('22023'))
  } finally { await db.close() }
})

test('replay: same key + payload moves nothing twice; same key + other payload is refused', async () => {
  const { db, f, dispatch, totals, qtyAt, ledger } = await setup()
  try {
    const t = await dispatch()
    const p = { idempotency_key: 'rep-1', transfer_id: t.id, reason: 'back' }
    const first = await ret(db, p)
    const n = (await ledger(t.id)).length
    const again = await ret(db, p)
    assert.equal(again.replayed, true); assert.equal(again.status, first.status)
    assert.equal((await ledger(t.id)).length, n)
    assert.equal((await qtyAt(f.stock_id)).qty, 10)
    await assert.rejects(ret(db, { ...p, reason: 'different' }), code('23505'))
    assert.equal((await totals(FILTER)).qty, 10)
  } finally { await db.close() }
})

test('refusals change nothing: completed transfer, non-array lines, receive with no lines', async () => {
  const { db, dispatch, transfer, ledger } = await setup()
  try {
    const t = await dispatch()
    const n = (await ledger(t.id)).length
    await assert.rejects(ret(db, { idempotency_key: 'bad-1', transfer_id: t.id, reason: 'x', lines: { line_id: t.lines[0].id } }), code('22023'))
    await assert.rejects(rpc(db, U.site2Only, 'inv_transfer_receive', [j({ idempotency_key: 'rcv-0', transfer_id: t.id, lines: [] })]), code('22023'))
    await assert.rejects(rpc(db, U.site2Only, 'inv_transfer_receive', [j({ idempotency_key: 'rcv-00', transfer_id: t.id })]), code('22023'))
    await assert.rejects(ret(db, { idempotency_key: 'bad-2', transfer_id: t.id, lines: [] }), code('22023')) // no reason
    assert.deepEqual(await transfer(t.id), { status: 'in_transit', cancel_reason: null })
    assert.equal((await ledger(t.id)).length, n)
    await ret(db, { idempotency_key: 'ok-1', transfer_id: t.id, reason: 'done' })
    await assert.rejects(ret(db, { idempotency_key: 'ok-2', transfer_id: t.id, reason: 'again' }), code('22023'))
    assert.equal((await transfer(t.id)).status, 'cancelled')
    // a refused call leaves no idempotency record, so the key can be reused correctly
    const rr = await one(db, `select count(*)::int c from inventory_rpc_requests where idempotency_key in ('bad-1','bad-2','ok-2')`)
    assert.equal(rr.c, 0)
  } finally { await db.close() }
})

test('reservations on the in-transit balance are released by the shortfall, ledgered', async () => {
  const { db, f, dispatch, totals, qtyAt } = await setup()
  try {
    const t = await dispatch()
    const transitId = t.lines[0].transit_stock_id
    const res = await rpc(db, U.keeper, 'inv_reserve', [j({ idempotency_key: 'res-t', stock_id: transitId, qty: 2 })])
    assert.equal((await qtyAt(transitId)).res, 2)
    const r = await ret(db, { idempotency_key: 'resret-1', transfer_id: t.id, reason: 'back' })
    assert.equal(r.status, 'cancelled'); assert.equal(Number(r.reservations_released_qty), 2)
    assert.deepEqual(await qtyAt(transitId), { qty: 0, res: 0 })
    const sr = await one(db, 'select status, qty_released::numeric r from stock_reservations where id = $1', [res.id])
    assert.equal(sr.status, 'released'); assert.equal(Number(sr.r), 2)
    const rel = await q(db, `select reserved_change::numeric rc from stock_movements where movement_type = 'release' and stock_id = $1`, [transitId])
    assert.deepEqual(rel.map(x => Number(x.rc)), [-2])
    assert.equal((await qtyAt(f.stock_id)).qty, 10)
    assert.deepEqual(await totals(FILTER), { qty: 10, v: 40, r: 0 })
  } finally { await db.close() }
})

test('a reservation that does not block the return is left alone', async () => {
  const { db, dispatch, qtyAt } = await setup()
  try {
    const t = await dispatch(6, 3)
    const transitId = t.lines[0].transit_stock_id
    await rpc(db, U.keeper, 'inv_reserve', [j({ idempotency_key: 'res-k', stock_id: transitId, qty: 2 })])
    const r = await ret(db, { idempotency_key: 'part-r', transfer_id: t.id, reason: 'part', lines: [{ line_id: t.lines[0].id, qty: 3 }] })
    assert.equal(Number(r.reservations_released_qty), 0)
    assert.deepEqual(await qtyAt(transitId), { qty: 3, res: 2 })
  } finally { await db.close() }
})

test('surface + rollback: helpers stay closed, rollback restores the live bodies', async () => {
  const { db } = await setup()
  try {
    const priv = await q(db, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('_inv_transfer_move','_inv_transfer_return_remaining')
        and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))`)
    assert.deepEqual(priv, [])
    const pub = await one(db, `select has_function_privilege('authenticated', 'public.inv_transfer_return_remaining(jsonb)', 'EXECUTE') ok`)
    assert.equal(pub.ok, true)
    const sec = await q(db, `select proname, prosecdef, proconfig from pg_proc where proname in ('_inv_transfer_move','_inv_transfer_return_remaining')`)
    for (const s of sec) { assert.equal(s.prosecdef, true); assert.match(String(s.proconfig), /search_path=public, pg_temp/) }
    await db.exec(DOWN)
    const body = await one(db, `select pg_get_functiondef('public._inv_transfer_move(jsonb,text)'::regprocedure) d`)
    assert.equal(body.d.includes('jsonb_array_length'), false)
    const body2 = await one(db, `select pg_get_functiondef('public._inv_transfer_return_remaining(jsonb)'::regprocedure) d`)
    assert.equal(body2.d.includes('_inv_req_begin'), false)
  } finally { await db.close() }
})
