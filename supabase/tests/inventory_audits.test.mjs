// Physical audits: blind counting enforced in the database, cutoff reconciliation,
// late offline counts, recount by another person, segregation of duties (PGlite).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { buildDb, asUser, rpc, q, one, id, U, code , call } from './inventory_harness.test.mjs'

const j = JSON.stringify
const FILTER = id(100); const BRAKE = id(104); const TYRE = id(101)

// Every relation the counter can SELECT, scanned for any trace of in-scope balances.
async function leaks (db, uid, needles) {
  const rels = await q(db, `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','v') and has_table_privilege('authenticated', c.oid, 'SELECT')`)
  const found = []
  await asUser(db, uid, async () => {
    for (const { relname } of rels) {
      let rows
      try { rows = (await db.query(`select to_jsonb(t)::text as x from public.${relname} t`)).rows } catch { continue }
      for (const r of rows) if (needles.some(nd => r.x.includes(nd))) found.push(relname)
    }
  })
  return [...new Set(found)]
}

test('blind physical audit end to end', async t => {
  const db = await buildDb()
  try {
    const loc = p => call(db, U.admin, 'inv_location_upsert', p).then(r => r.id)
    const wh = await loc({ country: 'KSA', site: 'S1', location_type: 'warehouse', code: 'WH1' })
    const bin = await loc({ country: 'KSA', site: 'S1', location_type: 'bin', code: 'A-01', parent_id: wh })
    const other = await loc({ country: 'KSA', site: 'S2', location_type: 'warehouse', code: 'WH2' })
    const post = (uid, p) => rpc(db, uid, 'inv_post_movement', [j(p)])
    const f = await post(U.keeper, { idempotency_key: 'a1', item_id: FILTER, location_id: bin, movement_type: 'receipt', qty_change: 10, unit_cost: 5 })
    const b = await post(U.keeper, { idempotency_key: 'a2', item_id: BRAKE, location_id: bin, movement_type: 'receipt', qty_change: 4, unit_cost: 20 })
    const outside = await post(U.keeper, { idempotency_key: 'a3', item_id: FILTER, location_id: other, movement_type: 'receipt', qty_change: 7 })

    await t.test('segregation is enforced at creation', async () => {
      await assert.rejects(call(db, U.reviewer, 'inv_audit_create', { country: 'KSA', site: 'S1', audit_type: 'bin',
        scope: { location_ids: [wh] }, counter_id: U.counter, approver_id: U.counter }).then(r => r.id), /check constraint|violates/)
      await assert.rejects(call(db, U.counter, 'inv_audit_create', { country: 'KSA', site: 'S1', audit_type: 'bin' }).then(r => r.id), code('42501'))
    })

    const audit = await call(db, U.reviewer, 'inv_audit_create', { country: 'KSA', site: 'S1', audit_type: 'bin',
      scope: { location_ids: [wh] }, counter_id: U.counter, reviewer_id: U.reviewer, approver_id: U.approver, instructions: 'Count bin A-01' }).then(r => r.id)
    await call(db, U.reviewer, 'inv_audit_schedule', { audit_id: audit, due_at: new Date(Date.now() + 864e5).toISOString() })
    await assert.rejects(call(db, U.counter, 'inv_audit_start', { audit_id: audit }), code('42501'))
    const started = await call(db, U.reviewer, 'inv_audit_start', { audit_id: audit })
    assert.equal(started.snapshot_lines, 2)

    await t.test('the counter cannot see an expected quantity through any table, view or RPC', async () => {
      const leaked = await leaks(db, U.counter, [f.stock_id, b.stock_id])
      assert.deepEqual(leaked, [])
      // a reviewer can (proves the scan would detect it)
      const seen = await leaks(db, U.reviewer, [f.stock_id])
      assert.ok(seen.includes('stock_records') && seen.includes('inventory_audit_snapshot_lines'), seen.join(','))
      // out-of-scope stock stays visible to the counter (blind is scoped, not a blackout)
      const vis = await asUser(db, U.counter, async () => q(db, 'select id from stock_records where id = $1', [outside.stock_id]))
      assert.equal(vis.length, 1)
      // write paths refuse and do not echo a quantity
      await assert.rejects(post(U.counter, { idempotency_key: 'c1', stock_id: f.stock_id, movement_type: 'receipt', qty_change: 1 }), e => e.code === '42501' && !/\d/.test(e.message))
      await assert.rejects(rpc(db, U.counter, 'set_stock_count', [f.stock_id, 3, 'peek']), code('42501'))
      await assert.rejects(rpc(db, U.counter, 'post_stock_movement', [f.stock_id, 'receipt', 1, 'peek', null]), code('42501'))
      await assert.rejects(call(db, U.counter, 'inv_audit_reconcile', { audit_id: audit }), code('42501'))
      const view = await rpc(db, U.counter, 'inv_audit_counter_view', [audit])
      const text = JSON.stringify(view)
      assert.ok(!/expected|on_hand|unit_cost|value|variance/i.test(text), text)
      assert.equal(view.items.length, 2); assert.ok(view.locations.some(l => l.id === bin))
      const mine = await rpc(db, U.counter, 'inv_audit_counter_view', [null])
      assert.equal(mine.audits.length, 1); assert.equal(mine.audits[0].id, audit)
    })

    // a movement after the snapshot, before the count (cutoff reconciliation)
    await post(U.keeper, { idempotency_key: 'a4', stock_id: f.stock_id, movement_type: 'issue', qty_change: -2 })
    const c1 = randomUUID(); const c2 = randomUUID()
    const sub = await call(db, U.counter, 'inv_count_submit', { audit_id: audit, device_id: 'dev-1', lines: [
      { client_uuid: c1, location_id: bin, item_id: FILTER, counted_qty: 8, condition: 'good' },
      { client_uuid: c2, location_id: bin, item_id: BRAKE, counted_qty: 3 },
      { client_uuid: 'not-a-uuid', item_id: BRAKE, counted_qty: 1 },
    ] })
    assert.deepEqual(sub.accepted.sort(), [c1, c2].sort()); assert.equal(sub.rejected.length, 1)
    assert.deepEqual(Object.keys(sub).sort(), ['accepted', 'duplicates', 'rejected'])
    const dup = await call(db, U.counter, 'inv_count_submit', { audit_id: audit, device_id: 'dev-1', lines: [{ client_uuid: c1, location_id: bin, item_id: FILTER, counted_qty: 8 }] })
    assert.deepEqual(dup.duplicates, [c1])
    // a movement after the line was counted must NOT change its expected quantity
    await post(U.keeper, { idempotency_key: 'a5', stock_id: b.stock_id, movement_type: 'receipt', qty_change: 1, unit_cost: 20 })
    await call(db, U.counter, 'inv_audit_complete_counting', { audit_id: audit })

    await t.test('late offline lines are accepted only if counted before counting closed', async () => {
      const early = randomUUID(); const late = randomUUID()
      const r = await call(db, U.counter, 'inv_count_submit', { audit_id: audit, device_id: 'dev-2', lines: [
        { client_uuid: early, location_id: bin, item_id: TYRE, counted_qty: 1, counted_at: new Date(Date.now() - 60000).toISOString() },
        { client_uuid: late, location_id: bin, item_id: TYRE, counted_qty: 1, counted_at: new Date(Date.now() + 60000).toISOString() },
      ] })
      assert.deepEqual(r.accepted, [early]); assert.equal(r.rejected[0].client_uuid, late)
      const row = await one(db, 'select late, unexpected from inventory_count_lines where client_uuid = $1', [early])
      assert.equal(row.late, true); assert.equal(row.unexpected, true)
    })

    let disc
    await t.test('cutoff reconciliation: movements before the count adjust the expectation, later ones do not', async () => {
      const rec = await call(db, U.reviewer, 'inv_audit_reconcile', { audit_id: audit })
      assert.equal(rec.matched, 1)
      const rows = await q(db, 'select * from inventory_discrepancies where audit_id = $1 order by variance_type', [audit])
      const short = rows.find(r => r.variance_type === 'shortage')
      assert.equal(Number(short.expected_qty), 4); assert.equal(Number(short.counted_qty), 3); assert.equal(Number(short.value_impact), -20)
      assert.ok(rows.some(r => r.variance_type === 'unexpected_item'))
      disc = short
      // the counter still cannot read discrepancies while the audit is open
      const seen = await asUser(db, U.counter, async () => q(db, 'select id from inventory_discrepancies where audit_id = $1', [audit]))
      assert.equal(seen.length, 0)
    })

    await t.test('recount must be a different person who has not counted', async () => {
      await assert.rejects(call(db, U.reviewer, 'inv_recount_assign', { audit_id: audit, recount_counter_id: U.counter, discrepancy_ids: [disc.id] }), code('42501'))
      await assert.rejects(call(db, U.reviewer, 'inv_recount_assign', { audit_id: audit, recount_counter_id: U.approver, discrepancy_ids: [disc.id] }), code('42501'))
      const ra = await call(db, U.reviewer, 'inv_recount_assign', { audit_id: audit, recount_counter_id: U.keeper, discrepancy_ids: [disc.id] })
      assert.equal(ra.round, 2)
      // the recount counter is blind too
      assert.deepEqual(await leaks(db, U.keeper, [b.stock_id]), [])
      const rc = randomUUID()
      // physical truth at recount time: 3 found earlier + 1 received after the first count = 4,
      // against an expectation of 5 (4 snapshot + the receipt, now before this line's count time)
      await call(db, U.keeper, 'inv_count_submit', { audit_id: audit, device_id: 'dev-3', lines: [{ client_uuid: rc, location_id: bin, item_id: BRAKE, counted_qty: 4 }] })
      await call(db, U.keeper, 'inv_audit_complete_counting', { audit_id: audit })
      const rec2 = await call(db, U.reviewer, 'inv_audit_reconcile', { audit_id: audit })
      assert.ok(rec2.discrepancies >= 1)
      disc = await one(db, `select * from inventory_discrepancies where audit_id = $1 and variance_type = 'shortage' and status = 'open'`, [audit])
      assert.equal(disc.round, 2)
    })

    await t.test('adjustment approval refuses counters, the creator and the proposer; approval posts through the ledger', async () => {
      await assert.rejects(call(db, U.counter, 'inv_discrepancy_update', { discrepancy_id: disc.id, ...{ root_cause_category: 'count_error', status: 'proposed' } }), code('42501'))
      await call(db, U.reviewer, 'inv_discrepancy_update', { discrepancy_id: disc.id, ...{ root_cause_category: 'unrecorded_issue', status: 'proposed',
        investigation_notes: 'job card missing' } })
      const adj = await one(db, 'select * from inventory_adjustments where discrepancy_id = $1', [disc.id])
      assert.equal(Number(adj.qty_change), -1)
      await assert.rejects(call(db, U.counter, 'inv_adjustment_approve', { adjustment_id: adj.id, decision: 'approve', note: 'ok' }), code('42501'))
      await db.exec(`insert into test_caps values ('${U.reviewer}','adjustment_approve')`)
      await assert.rejects(call(db, U.reviewer, 'inv_adjustment_approve', { adjustment_id: adj.id, decision: 'approve', note: 'ok' }), code('42501'))
      await assert.rejects(call(db, U.keeper, 'inv_adjustment_approve', { adjustment_id: adj.id, decision: 'approve', note: 'ok' }), code('42501'))
      const ok = await call(db, U.approver, 'inv_adjustment_approve', { adjustment_id: adj.id, decision: 'approve', note: 'agreed' })
      assert.equal(ok.status, 'posted')
      const mv = await one(db, 'select * from stock_movements where id = $1', [ok.movement_id])
      assert.equal(mv.movement_type, 'adjustment_down'); assert.equal(mv.source_doc_type, 'inventory_adjustment')
      assert.equal(Number((await one(db, 'select qty_on_hand from stock_records where id = $1', [b.stock_id])).qty_on_hand), 4)
    })

    await t.test('close requires every discrepancy decided; afterwards the counter may read the result', async () => {
      await assert.rejects(call(db, U.approver, 'inv_audit_close', { audit_id: audit, note: 'done' }), code('22023'))
      const rest = await q(db, `select id from inventory_discrepancies where audit_id = $1 and status = 'open'`, [audit])
      for (const r of rest) await call(db, U.reviewer, 'inv_discrepancy_update', { discrepancy_id: r.id, ...{ root_cause_category: 'wrong_location', status: 'closed' } })
      await assert.rejects(call(db, U.counter, 'inv_audit_close', { audit_id: audit, note: 'mine' }), code('42501'))
      const cl = await call(db, U.approver, 'inv_audit_close', { audit_id: audit, note: 'done' })
      assert.equal(cl.status, 'closed')
      const snap = await asUser(db, U.counter, async () => q(db, 'select id from inventory_audit_snapshot_lines where audit_id = $1', [audit]))
      assert.equal(snap.length, 2)
      const bal = await asUser(db, U.counter, async () => q(db, 'select id from stock_records where id = $1', [f.stock_id]))
      assert.equal(bal.length, 1)
      const after = await call(db, U.counter, 'inv_count_submit', { audit_id: audit, device_id: 'dev-1', lines: [{ client_uuid: randomUUID(), item_id: FILTER, location_id: bin, counted_qty: 1 }] })
      assert.equal(after.rejected[0].reason, 'Audit is closed')
    })
  } finally { await db.close() }
})
