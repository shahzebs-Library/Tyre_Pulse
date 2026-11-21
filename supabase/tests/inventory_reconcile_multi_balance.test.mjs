// Follow-up 20261121100000 (pending): an item/location held in several balances
// (condition / ownership) and counted without naming a balance is reconciled ONCE
// for the item/location, never credited to an arbitrary balance (PGlite).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { buildDb, rpc, q, one, id, U, call } from './inventory_harness.test.mjs'

const j = JSON.stringify
const FILTER = id(100); const BRAKE = id(104)
const FIX = readFileSync(new URL('../pending_migrations/20261121100000_inv_reconcile_multi_balance.sql', import.meta.url), 'utf8')
const FIX_RB = readFileSync(new URL('../pending_migrations/20261121100000_inv_reconcile_multi_balance_ROLLBACK.sql', import.meta.url), 'utf8')

async function scenario (db, { fixed }) {
  const loc = p => call(db, U.admin, 'inv_location_upsert', p).then(r => r.id)
  const wh = await loc({ country: 'KSA', site: 'S1', location_type: 'warehouse', code: 'WH1' })
  const bin = await loc({ country: 'KSA', site: 'S1', location_type: 'bin', code: 'A-01', parent_id: wh })
  const post = p => rpc(db, U.keeper, 'inv_post_movement', [j(p)])
  const good = await post({ idempotency_key: 'm1', item_id: FILTER, location_id: bin, movement_type: 'receipt', qty_change: 6, unit_cost: 5 })
  const dmg = await post({ idempotency_key: 'm2', item_id: FILTER, location_id: bin, movement_type: 'receipt', qty_change: 4, unit_cost: 5, condition: 'damaged' })
  const brk = await post({ idempotency_key: 'm3', item_id: BRAKE, location_id: bin, movement_type: 'receipt', qty_change: 3, unit_cost: 20 })
  assert.notEqual(good.stock_id, dmg.stock_id, 'two balances for one item/location')
  const audit = await call(db, U.reviewer, 'inv_audit_create', { country: 'KSA', site: 'S1', audit_type: 'bin',
    scope: { location_ids: [wh] }, counter_id: U.counter, reviewer_id: U.reviewer, approver_id: U.approver }).then(r => r.id)
  await call(db, U.reviewer, 'inv_audit_schedule', { audit_id: audit, due_at: new Date(Date.now() + 864e5).toISOString() })
  await call(db, U.reviewer, 'inv_audit_start', { audit_id: audit })
  // the counter finds all 10 filters on the shelf and the 3 brakes; no balance named
  await call(db, U.counter, 'inv_count_submit', { audit_id: audit, device_id: 'd', lines: [
    { client_uuid: randomUUID(), location_id: bin, item_id: FILTER, counted_qty: 7 },
    { client_uuid: randomUUID(), location_id: bin, item_id: FILTER, counted_qty: 3 },
    { client_uuid: randomUUID(), location_id: bin, item_id: BRAKE, counted_qty: 3 },
  ] })
  await call(db, U.counter, 'inv_audit_complete_counting', { audit_id: audit })
  const rec = await call(db, U.reviewer, 'inv_audit_reconcile', { audit_id: audit })
  const disc = await q(db, `select stock_id, item_id, variance_type, expected_qty, counted_qty, variance_qty
    from inventory_discrepancies where audit_id = $1 and status <> 'superseded' order by variance_type`, [audit])
  return { rec, disc, good, dmg, brk }
}

test('multi-balance reconciliation: defect before the fix, exact after', async t => {
  await t.test('applied release (before the fix): the count is credited to ONE balance', async () => {
    const db = await buildDb()
    try {
      const { rec, disc } = await scenario(db, { fixed: false })
      assert.ok(rec.discrepancies >= 1, 'a false discrepancy appears although every unit was found')
      assert.ok(disc.length >= 1)
    } finally { await db.close() }
  })

  await t.test('with the fix: one item/location, 10 found = 10 expected -> no discrepancy', async () => {
    const db = await buildDb()
    try {
      await db.exec(FIX)
      assert.equal((await one(db, `select position('amb_counted' in pg_get_functiondef('public._inv_audit_reconcile(uuid)'::regprocedure)) > 0 as ok`)).ok, true)
      assert.equal((await one(db, `select has_function_privilege('authenticated', 'public._inv_audit_reconcile(uuid)', 'EXECUTE') as x`)).x, false)
      const { rec, disc } = await scenario(db, { fixed: true })
      assert.equal(rec.discrepancies, 0, JSON.stringify(disc))
      assert.equal(rec.matched, 2) // FILTER (aggregated) + BRAKE (single balance)
      // re-running the file is a no-op; the rollback restores the snapshot verbatim
      await db.exec(FIX)
      await db.exec(FIX_RB)
      assert.equal((await one(db, `select position('amb_counted' in pg_get_functiondef('public._inv_audit_reconcile(uuid)'::regprocedure)) > 0 as ok`)).ok, false)
    } finally { await db.close() }
  })

  await t.test('with the fix: a short count is ONE item/location shortage, not per balance', async () => {
    const db = await buildDb()
    try {
      await db.exec(FIX)
      const loc = p => call(db, U.admin, 'inv_location_upsert', p).then(r => r.id)
      const wh = await loc({ country: 'KSA', site: 'S1', location_type: 'warehouse', code: 'WH1' })
      const bin = await loc({ country: 'KSA', site: 'S1', location_type: 'bin', code: 'A-01', parent_id: wh })
      const post = p => rpc(db, U.keeper, 'inv_post_movement', [j(p)])
      await post({ idempotency_key: 'm1', item_id: FILTER, location_id: bin, movement_type: 'receipt', qty_change: 6, unit_cost: 5 })
      await post({ idempotency_key: 'm2', item_id: FILTER, location_id: bin, movement_type: 'receipt', qty_change: 4, unit_cost: 5, condition: 'damaged' })
      const audit = await call(db, U.reviewer, 'inv_audit_create', { country: 'KSA', site: 'S1', audit_type: 'bin',
        scope: { location_ids: [wh] }, counter_id: U.counter, reviewer_id: U.reviewer, approver_id: U.approver }).then(r => r.id)
      await call(db, U.reviewer, 'inv_audit_schedule', { audit_id: audit, due_at: new Date(Date.now() + 864e5).toISOString() })
      await call(db, U.reviewer, 'inv_audit_start', { audit_id: audit })
      await call(db, U.counter, 'inv_count_submit', { audit_id: audit, device_id: 'd', lines: [
        { client_uuid: randomUUID(), location_id: bin, item_id: FILTER, counted_qty: 5 }] })
      await call(db, U.counter, 'inv_audit_complete_counting', { audit_id: audit })
      const rec = await call(db, U.reviewer, 'inv_audit_reconcile', { audit_id: audit })
      const disc = await q(db, `select stock_id, variance_type, expected_qty::numeric e, counted_qty::numeric c, variance_qty::numeric v, value_impact::numeric vi
        from inventory_discrepancies where audit_id = $1 and status <> 'superseded'`, [audit])
      assert.equal(rec.discrepancies, 1, JSON.stringify(disc))
      assert.equal(disc[0].stock_id, null)
      assert.equal(disc[0].variance_type, 'shortage')
      assert.equal(Number(disc[0].e), 10); assert.equal(Number(disc[0].c), 5); assert.equal(Number(disc[0].v), -5)
      assert.equal(Number(disc[0].vi), -25)
    } finally { await db.close() }
  })
})
