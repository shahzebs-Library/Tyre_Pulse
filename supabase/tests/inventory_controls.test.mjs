// Mandatory inventory controls (20261120104000 valuation rule, 108000 approvals, 109000 ERP
// reconciliation, 110000 metric catalogue, 111000 report schedules), end to end through the
// real client RPC payloads (PGlite, synthetic data only).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { buildDb, rpc, call, q, one, id, U, ORG_A, ORG_B, code, asUser } from './inventory_harness.test.mjs'

const j = JSON.stringify
const FILTER = id(100); const TYRE = id(101); const BRAKE = id(104); const SUP = id(200)
// Money columns that must never move because of inventory (CPK inputs, expense grid).
const PROTECTED = `select
  (select md5(coalesce(string_agg(concat_ws('|', id, serial_no, asset_no, status, cost_per_tyre, issue_date, removal_date), ',' order by id), '')) from public.tyre_records) as tyres,
  (select md5(coalesce(string_agg(concat_ws('|', id, item_code, qty_n, line_cost, tyre_cost, spare_cost, oil_cost, cost_category, event_date), ',' order by id), '')) from public.parts_consumption) as expense,
  (select count(*)::int from public.parts_consumption) as expense_rows`

async function setup () {
  const db = await buildDb()
  await db.exec(`insert into test_caps values ('${U.keeper}','procure'),('${U.approver}','procure'),('${U.approver}','financial_post'),
    ('${U.reviewer}','financial_post')`)
  const loc = p => call(db, U.admin, 'inv_location_upsert', p).then(r => r.id)
  const L = {
    s1: await loc({ country: 'KSA', site: 'S1', location_type: 'warehouse', code: 'WH1' }),
    s2: await loc({ country: 'KSA', site: 'S2', location_type: 'warehouse', code: 'WH2' }),
  }
  const post = (uid, p) => rpc(db, uid, 'inv_post_movement', [j(p)])
  const bal = sid => one(db, 'select * from stock_records where id = $1', [sid])
  return { db, L, post, bal }
}

test('purchase receipt to availability, reservation, issue to a work order', async () => {
  const { db, L, bal } = await setup()
  try {
    const before = await one(db, PROTECTED)
    const po = (await one(db, `insert into purchase_orders(po_number, organisation_id, country, site, supplier_id, currency, status)
      values ('PO-1', '${ORG_A}', 'KSA', 'S1', '${SUP}', 'SAR', 'Submitted') returning id`)).id
    const pl = (await call(db, U.keeper, 'inv_po_add_line', { po_id: po, item_id: BRAKE, qty_ordered: 8, unit_price: 25, location_id: L.s1 })).id
    await call(db, U.keeper, 'inv_receive_goods', { country: 'KSA', site: 'S1', po_id: po, supplier_id: SUP,
      lines: [{ po_line_id: pl, item_id: BRAKE, location_id: L.s1, qty_received: 8 }] })
    const avail = await asUser(db, U.keeper, () => one(db, `select id, qty_on_hand, qty_reserved, valuation_status from v_inv_balances where item_id = $1 and location_id = $2`, [BRAKE, L.s1]))
    assert.equal(Number(avail.qty_on_hand), 8); assert.equal(avail.valuation_status, 'valued')
    const res = await call(db, U.keeper, 'inv_reserve', { stock_id: avail.id, qty: 3, source_doc_type: 'work_order', source_doc_id: id(300) })
    let b = await bal(avail.id); assert.equal(Number(b.qty_reserved), 3)
    // availability = on hand - reserved: a second reservation for 6 is a shortage exception, never negative stock
    const short = await call(db, U.keeper, 'inv_reserve', { stock_id: avail.id, qty: 6 })
    assert.equal(short.status, 'refused_shortage')
    const iss = await call(db, U.keeper, 'inv_issue', { stock_id: avail.id, qty: 3, reservation_id: res.id, source_doc_type: 'work_order', source_doc_id: 'WO-1' })
    assert.equal(Number(iss.value_change), -75); assert.equal(Number(iss.valued_qty_moved), 3); assert.equal(Number(iss.unvalued_qty_moved), 0)
    b = await bal(avail.id); assert.equal(Number(b.qty_on_hand), 5); assert.equal(Number(b.qty_reserved), 0)
    assert.deepEqual(await one(db, PROTECTED), before, 'no CPK / expense input moved')
  } finally { await db.close() }
})

test('valuation with missing cost: no order assumed, pending allocation, reconciliation required', async t => {
  const { db, L, post, bal } = await setup()
  try {
    const before = await one(db, PROTECTED)
    const r = await post(U.keeper, { idempotency_key: 'm1', item_id: FILTER, location_id: L.s1, movement_type: 'receipt', qty_change: 5, unit_cost: 10 })
    const sid = r.stock_id
    await post(U.keeper, { idempotency_key: 'm2', stock_id: sid, movement_type: 'receipt', qty_change: 3 }) // no cost
    let recs = await q(db, `select * from inventory_cost_reconciliations where stock_id = $1 and status = 'open'`, [sid])
    assert.equal(recs.length, 1); assert.equal(recs[0].kind, 'unpriced_inbound'); assert.equal(Number(recs[0].unvalued_qty), 3)
    assert.equal(recs[0].created_by, U.keeper)

    let issueMov
    await t.test('a mixed balance assumes no order: certain parts post, the ambiguous part opens an issue_allocation with no value', async () => {
      // 5 valued + 3 unvalued, issue 7: at least 4 are valued, at least 2 unvalued, 1 undecided
      const i = await call(db, U.keeper, 'inv_issue', { stock_id: sid, qty: 7 })
      issueMov = i.movement_id
      assert.equal(Number(i.value_change), -40, 'the certain part only; no value for the undecided unit')
      assert.equal(Number(i.valued_qty_moved), 4); assert.equal(Number(i.unvalued_qty_moved), 2)
      assert.equal(Number(i.pending_allocation_qty), 1); assert.equal(i.valuation_status, 'pending_allocation')
      const b = await bal(sid)
      assert.equal(Number(b.qty_on_hand), 1)
      // the split is NOT updated for the undecided unit: it stays in the buckets as pending
      assert.deepEqual([Number(b.valued_qty), Number(b.valued_value), Number(b.unvalued_qty), Number(b.pending_allocation_out_qty)], [1, 10, 1, 1])
      const all = await q(db, `select kind, consumed, unvalued_qty, status, movement_id, snapshot from inventory_cost_reconciliations where stock_id = $1 order by kind`, [sid])
      assert.deepEqual(all.map(x => [x.kind, x.consumed, Number(x.unvalued_qty), x.status]),
        [['issue_allocation', false, 1, 'open'], ['unpriced_inbound', false, 1, 'open'], ['unpriced_inbound', true, 2, 'open']])
      assert.equal(all[0].movement_id, i.movement_id)
      assert.deepEqual([Number(all[0].snapshot.valued_qty), Number(all[0].snapshot.unvalued_qty), Number(all[0].snapshot.valued_value)], [5, 3, 50])
      assert.equal(all[2].movement_id, i.movement_id)
      // an in-stock cost cannot be placed while the split is undecided
      const ledger = await one(db, `select count(*)::int c from stock_movements where stock_id = $1 and movement_type = 'cost_allocation'`, [sid])
      assert.equal(ledger.c, 0)
    })

    await t.test('finance view: valued and unvalued side by side; partial value never labelled total', async () => {
      const v = await asUser(db, U.reviewer, () => one(db, 'select * from v_inv_valuation where stock_id = $1', [sid]))
      assert.equal(Number(v.valued_qty), 1); assert.equal(Number(v.unvalued_qty), 1); assert.equal(v.valuation_complete, false)
      assert.equal(Number(v.pending_allocation_qty), 1); assert.equal(v.valuation_status, 'pending_allocation')
      assert.equal(v.open_reconciliations, 3); assert.equal(v.open_allocations, 1); assert.equal(v.currency, 'SAR')
      const hidden = await asUser(db, U.keeper, () => one(db, 'select valued_amount from v_inv_valuation where stock_id = $1', [sid]))
      assert.equal(hidden.valued_amount, null, 'money hidden without stock:view_value')
      const s = await rpc(db, U.reviewer, 'inv_valuation_summary', ['KSA'])
      assert.equal(s.valuation_complete, false); assert.ok(s.open_reconciliations >= 2)
      const sar = s.by_currency.find(x => x.currency === 'SAR')
      assert.equal(sar.owned_value, null); assert.equal(sar.valuation_complete, false)
      assert.equal(Number(sar.owned_pending_allocation_qty), 1); assert.equal(sar.owned_value_reason, 'pending_allocation_present')
    })

    await t.test('nothing is valued without an approved reconciliation; separation of duties on every step', async () => {
      const consumed = await one(db, `select id from inventory_cost_reconciliations where stock_id = $1 and consumed and kind <> 'issue_allocation'`, [sid])
      await assert.rejects(call(db, U.approver, 'inv_cost_reconcile', { reconciliation_id: consumed.id }), /approval is required/)
      await assert.rejects(call(db, U.keeper, 'inv_request_approval', { entity_type: 'cost_reconciliation', entity_id: consumed.id,
        proposal: { resolution: 'resolved', unit_cost: 9 }, reason: 'x' }), code('42501'), 'keeper has neither financial_post nor view_value')
      await assert.rejects(call(db, U.reviewer, 'inv_request_approval', { entity_type: 'cost_reconciliation', entity_id: consumed.id,
        proposal: { resolution: 'resolved' } }), code('22023'), 'a resolution needs a unit cost')
      const req = await call(db, U.reviewer, 'inv_request_approval', { entity_type: 'cost_reconciliation', entity_id: consumed.id,
        proposal: { resolution: 'resolved', unit_cost: 9 }, evidence: [{ type: 'invoice', ref: 'INV-77' }] })
      assert.equal(req.route_source, 'default')
      await assert.rejects(call(db, U.reviewer, 'inv_request_approval', { entity_type: 'cost_reconciliation', entity_id: consumed.id,
        proposal: { resolution: 'written_off' }, reason: 'dup' }), code('23505'), 'one active request per record')
      await assert.rejects(call(db, U.reviewer, 'inv_approval_decide', { request_id: req.id, decision: 'approve' }), /requester/)
      await assert.rejects(call(db, U.keeper, 'inv_approval_decide', { request_id: req.id, decision: 'approve' }), /segregation|elevated/)
      await assert.rejects(call(db, U.viewer, 'inv_approval_decide', { request_id: req.id, decision: 'approve' }), /elevated/)
      const pend = await asUser(db, U.approver, () => q(db, 'select can_decide, blocked_reason from v_inv_pending_approvals where id = $1', [req.id]))
      assert.equal(pend[0].can_decide, true)
      await call(db, U.approver, 'inv_approval_decide', { request_id: req.id, decision: 'approve' })
      // the movement poster (creator) can never resolve it, even with financial_post
      await db.exec(`insert into test_caps values ('${U.keeper}','financial_post')`)
      await assert.rejects(call(db, U.keeper, 'inv_cost_reconcile', { reconciliation_id: consumed.id }), code('42501'))
      await assert.rejects(call(db, U.approver, 'inv_cost_reconcile', { reconciliation_id: consumed.id, unit_cost: 11 }), /differs from what was approved/)
      const done = await call(db, U.approver, 'inv_cost_reconcile', { reconciliation_id: consumed.id })
      assert.equal(done.status, 'resolved'); assert.equal(Number(done.resolved_value), 18); assert.equal(Number(done.applied_qty), 0)
      assert.equal(done.posting, 'none')
      assert.equal(Number((await bal(sid)).unvalued_qty), 1, 'consumed units are gone: the shelf is unchanged')
      // the database refuses a forged resolution by the creator even outside the RPC
      await assert.rejects(db.exec(`update inventory_cost_reconciliations set status='resolved', resolution_source='reconciliation',
        resolved_by='${U.keeper}', resolved_at=now() where stock_id='${sid}' and status='open'`), /sod_chk/)
    })

    await t.test('an issue allocation is decided by a person with evidence; only then does the value post (linked, append-only)', async () => {
      const al = await one(db, `select id from inventory_cost_reconciliations where stock_id = $1 and kind = 'issue_allocation'`, [sid])
      await assert.rejects(call(db, U.reviewer, 'inv_request_approval', { entity_type: 'cost_reconciliation', entity_id: al.id,
        proposal: { resolution: 'written_off' }, reason: 'x' }), /cannot be written off/)
      await assert.rejects(call(db, U.reviewer, 'inv_request_approval', { entity_type: 'cost_reconciliation', entity_id: al.id,
        proposal: { valued_qty: 2 }, reason: 'x' }), code('22023'), 'more than the undecided quantity')
      await assert.rejects(call(db, U.reviewer, 'inv_request_approval', { entity_type: 'cost_reconciliation', entity_id: al.id,
        proposal: { valued_qty: 1 } }), /evidence/)
      const req = await call(db, U.reviewer, 'inv_request_approval', { entity_type: 'cost_reconciliation', entity_id: al.id,
        proposal: { valued_qty: 1 }, evidence: [{ type: 'grn', ref: 'GRN-15', note: 'the issued unit carried the receipt label' }] })
      await assert.rejects(call(db, U.approver, 'inv_cost_reconcile', { reconciliation_id: al.id }), /approval is required/)
      await assert.rejects(call(db, U.reviewer, 'inv_approval_decide', { request_id: req.id, decision: 'approve' }), /requester/)
      await call(db, U.admin, 'inv_approval_decide', { request_id: req.id, decision: 'approve' })
      const before = await bal(sid)
      // the creator of the issue can never decide it, even with financial_post
      await assert.rejects(call(db, U.keeper, 'inv_cost_reconcile', { reconciliation_id: al.id }), code('42501'))
      await assert.rejects(call(db, U.approver, 'inv_cost_reconcile', { reconciliation_id: al.id, valued_qty: 0 }), /differs from what was approved/)
      assert.deepEqual(await bal(sid), before, 'nothing posted by the refused attempts')
      const done = await call(db, U.approver, 'inv_cost_reconcile', { reconciliation_id: al.id })
      assert.equal(done.status, 'resolved'); assert.equal(Number(done.resolved_valued_qty), 1); assert.equal(Number(done.resolved_unvalued_qty), 0)
      assert.equal(Number(done.resolved_value), 10); assert.equal(done.posting, 'none')
      const m = await one(db, 'select * from stock_movements where id = $1', [done.movement_id])
      assert.equal(m.movement_type, 'cost_allocation'); assert.equal(Number(m.value_change), -10); assert.equal(Number(m.qty_change), 0)
      assert.equal(m.source_doc_id, issueMov, 'linked to the issue it decides'); assert.equal(Number(m.pending_out_change), -1)
      const b = await bal(sid)
      assert.deepEqual([Number(b.qty_on_hand), Number(b.valued_qty), Number(b.valued_value), Number(b.unvalued_qty), Number(b.pending_allocation_out_qty)], [1, 0, 0, 1, 0])
      await assert.rejects(db.exec(`update stock_movements set value_change = 0 where id = '${done.movement_id}'`), /append-only/)
      await assert.rejects(db.exec(`update inventory_cost_reconciliations set status='resolved', resolution_source='reconciliation',
        resolved_by=created_by, resolved_at=now() where id='${al.id}'`), /sod_chk/)
    })

    await t.test('write-off keeps the unit unvalued for good', async () => {
      const open = await one(db, `select id from inventory_cost_reconciliations where stock_id = $1 and status = 'open' and kind = 'unpriced_inbound'`, [sid])
      const req = await call(db, U.reviewer, 'inv_request_approval', { entity_type: 'cost_reconciliation', entity_id: open.id,
        proposal: { resolution: 'written_off' }, reason: 'no document exists for this legacy unit' })
      await call(db, U.admin, 'inv_approval_decide', { request_id: req.id, decision: 'approve' })
      const w = await call(db, U.approver, 'inv_cost_reconcile', { reconciliation_id: open.id })
      assert.equal(w.status, 'written_off'); assert.equal(w.resolved_value, null)
      assert.equal(Number((await bal(sid)).unvalued_qty), 1)
    })
    assert.deepEqual(await one(db, PROTECTED), before)
  } finally { await db.close() }
})

test('reversal of an issue with an issue allocation: open is cancelled, decided is undone exactly', async () => {
  const { db, L, post, bal } = await setup()
  try {
    const before = await one(db, PROTECTED)
    const r = await post(U.keeper, { idempotency_key: 'ra1', item_id: FILTER, location_id: L.s2, movement_type: 'receipt', qty_change: 4, unit_cost: 5 })
    await post(U.keeper, { idempotency_key: 'ra2', stock_id: r.stock_id, movement_type: 'receipt', qty_change: 2 })
    const start = await bal(r.stock_id)
    const i1 = await call(db, U.keeper, 'inv_issue', { stock_id: r.stock_id, qty: 2 }) // 2 undecided
    assert.equal(Number(i1.pending_allocation_qty), 2); assert.equal(i1.value_change, null)
    await call(db, U.approver, 'inv_reverse_movement', { movement_id: i1.movement_id, reason: 'not issued' })
    let b = await bal(r.stock_id)
    assert.deepEqual([b.qty_on_hand, b.valued_qty, b.valued_value, b.unvalued_qty, b.pending_allocation_out_qty].map(Number),
      [start.qty_on_hand, start.valued_qty, start.valued_value, start.unvalued_qty, 0].map(Number))
    assert.equal((await one(db, `select status from inventory_cost_reconciliations where origin_movement_id = $1`, [i1.movement_id])).status, 'cancelled')
    const i2 = await call(db, U.keeper, 'inv_issue', { stock_id: r.stock_id, qty: 2 })
    const al = await one(db, `select id from inventory_cost_reconciliations where origin_movement_id = $1 and kind = 'issue_allocation'`, [i2.movement_id])
    const req = await call(db, U.reviewer, 'inv_request_approval', { entity_type: 'cost_reconciliation', entity_id: al.id,
      proposal: { valued_qty: 1 }, reason: 'one carried a receipt label, one did not' })
    await call(db, U.admin, 'inv_approval_decide', { request_id: req.id, decision: 'approve' })
    const done = await call(db, U.approver, 'inv_cost_reconcile', { reconciliation_id: al.id })
    assert.equal(Number(done.resolved_value), 5)
    b = await bal(r.stock_id)
    assert.deepEqual([b.qty_on_hand, b.valued_qty, b.valued_value, b.unvalued_qty, b.pending_allocation_out_qty].map(Number), [4, 3, 15, 1, 0])
    await assert.rejects(call(db, U.approver, 'inv_reverse_movement', { movement_id: done.movement_id, reason: 'x' }), /original movement/)
    const rev = await call(db, U.approver, 'inv_reverse_movement', { movement_id: i2.movement_id, reason: 'wrong vehicle' })
    assert.equal(Number(rev.value_change), 5)
    b = await bal(r.stock_id)
    assert.deepEqual([b.qty_on_hand, b.valued_qty, b.valued_value, b.unvalued_qty, b.pending_allocation_out_qty].map(Number),
      [start.qty_on_hand, start.valued_qty, start.valued_value, start.unvalued_qty, 0].map(Number))
    const openU = await one(db, `select sum(unvalued_qty)::numeric q from inventory_cost_reconciliations where stock_id = $1 and status = 'open' and not consumed and kind <> 'issue_allocation'`, [r.stock_id])
    assert.equal(Number(openU.q), Number(b.unvalued_qty), 'the consumed record came back with the unit')
    assert.deepEqual(await one(db, PROTECTED), before)
  } finally { await db.close() }
})

test('reversal of an issue that took unvalued units re-opens the record; the ledger stays append-only', async () => {
  const { db, L, post, bal } = await setup()
  try {
    const r = await post(U.keeper, { idempotency_key: 'rv1', item_id: BRAKE, location_id: L.s1, movement_type: 'receipt', qty_change: 2 })
    const iss = await call(db, U.keeper, 'inv_issue', { stock_id: r.stock_id, qty: 2 })
    assert.equal((await one(db, `select consumed from inventory_cost_reconciliations where stock_id = $1`, [r.stock_id])).consumed, true)
    const rev = await call(db, U.approver, 'inv_reverse_movement', { movement_id: iss.movement_id, reason: 'wrong vehicle' })
    assert.equal(Number(rev.unvalued_qty_change), 2); assert.equal(rev.value_change, 0)
    const rec = await one(db, `select consumed, kind, status, unvalued_qty from inventory_cost_reconciliations where stock_id = $1`, [r.stock_id])
    assert.deepEqual([rec.consumed, rec.kind, rec.status, Number(rec.unvalued_qty)], [false, 'reversal_return', 'open', 2])
    assert.equal(Number((await bal(r.stock_id)).unvalued_qty), 2)
    await assert.rejects(db.exec(`update stock_movements set qty_change = 0 where id = '${iss.movement_id}'`), /append-only/)
    await assert.rejects(call(db, U.approver, 'inv_reverse_movement', { movement_id: iss.movement_id, reason: 'again' }), code('23505'))
    // approvals ledger is append-only too
    await assert.rejects(db.exec(`update inventory_approval_decisions set decision = 'approved'`).then(async () => {
      const n = (await one(db, 'select count(*)::int c from inventory_approval_decisions')).c
      if (n === 0) throw new Error('append-only (no rows to test)')
    }), /append-only/)
  } finally { await db.close() }
})

test('approval engine: published policy routes, multi-stage, role match, signature, distinct reviewers, ambiguity refused', async () => {
  const { db, L, post } = await setup()
  try {
    await db.exec(`insert into profiles(id, organisation_id, org_id, role, full_name, country, sites) values
      ('${id(12)}','${ORG_A}','${ORG_A}','Finance Manager','Fin Mgr','{KSA}','{ALL}'),
      ('${id(13)}','${ORG_A}','${ORG_A}','Finance Manager','Fin Mgr 2','{KSA}','{ALL}')`)
    await db.exec(`insert into test_caps values ('${id(12)}','financial_post'),('${id(13)}','financial_post')`)
    await db.exec(`insert into approval_policies(organisation_id, name, entity_type, state, effective_at, stages) values
      ('${ORG_A}','Inventory cost recon KSA','inventory_cost_reconciliation','published', now() - interval '1 day',
       '[{"name":"Finance review","approver_role":"Finance Manager"},{"name":"Controller","approver_user_id":"${U.approver}"}]')`)
    const r = await post(U.keeper, { idempotency_key: 'p1', item_id: FILTER, location_id: L.s1, movement_type: 'receipt', qty_change: 4 })
    const rec = await one(db, `select id from inventory_cost_reconciliations where stock_id = $1`, [r.stock_id])
    const req = await call(db, U.reviewer, 'inv_request_approval', { entity_type: 'cost_reconciliation', entity_id: rec.id,
      proposal: { resolution: 'resolved', unit_cost: 6 }, reason: 'price list 2026' })
    assert.equal(req.route_source, 'policy'); assert.equal(req.stages, 2)
    // stage 1: role Finance Manager only; an Admin is not that role
    await assert.rejects(call(db, U.admin, 'inv_approval_decide', { request_id: req.id, decision: 'approve' }), /not_stage_approver/)
    await assert.rejects(call(db, id(12), 'inv_approval_decide', { request_id: req.id, decision: 'approve' }), /signature/)
    await call(db, id(12), 'inv_approval_decide', { request_id: req.id, decision: 'approve', signature: 'data:sig' })
    // stage 2: the named controller only; the stage-1 approver cannot do it again
    await assert.rejects(call(db, id(13), 'inv_approval_decide', { request_id: req.id, decision: 'approve', signature: 's' }), /not_stage_approver/)
    await assert.rejects(call(db, U.approver, 'inv_cost_reconcile', { reconciliation_id: rec.id }), /approval is required/, 'pending is not approved')
    const fin = await call(db, U.approver, 'inv_approval_decide', { request_id: req.id, decision: 'approve', signature: 's2' })
    assert.equal(fin.status, 'approved')
    const done = await call(db, id(13), 'inv_cost_reconcile', { reconciliation_id: rec.id })
    assert.equal(Number(done.applied_qty), 4)
    const st = await one(db, 'select valued_value, unvalued_qty from stock_records where id = $1', [r.stock_id])
    assert.equal(Number(st.valued_value), 24); assert.equal(Number(st.unvalued_qty), 0)
    // a rejection needs a note and ends the request
    const r2 = await post(U.keeper, { idempotency_key: 'p2', item_id: BRAKE, location_id: L.s1, movement_type: 'receipt', qty_change: 1 })
    const rec2 = await one(db, `select id from inventory_cost_reconciliations where stock_id = $1`, [r2.stock_id])
    const q2 = await call(db, U.reviewer, 'inv_request_approval', { entity_type: 'cost_reconciliation', entity_id: rec2.id,
      proposal: { resolution: 'resolved', unit_cost: 1 }, reason: 'guess' })
    await assert.rejects(call(db, id(12), 'inv_approval_decide', { request_id: q2.id, decision: 'reject' }), code('22023'))
    assert.equal((await call(db, id(12), 'inv_approval_decide', { request_id: q2.id, decision: 'reject', note: 'no evidence' })).status, 'rejected')
    // two equally specific published policies = ambiguous route: refused, never a silent default
    await db.exec(`insert into approval_policies(organisation_id, name, entity_type, state, effective_at, stages) values
      ('${ORG_A}','dup','inventory_cost_reconciliation','published', now() - interval '1 day', '[{"name":"x","approver_role":"Manager"}]')`)
    await assert.rejects(call(db, U.reviewer, 'inv_request_approval', { entity_type: 'cost_reconciliation', entity_id: rec2.id,
      proposal: { resolution: 'resolved', unit_cost: 1 }, reason: 'retry' }), /ambiguous/)
    // the requester can never be the decider (database CHECK)
    await assert.rejects(db.exec(`update inventory_approval_requests set decided_by = requested_by where id = '${q2.id}'`), /self_chk/)
    // the widened policy CHECK still refuses unknown entity types
    await assert.rejects(db.exec(`insert into approval_policies(organisation_id, name, entity_type, stages) values ('${ORG_A}','bad','inventory_nonsense','[{}]')`), /entity_type_check/)
  } finally { await db.close() }
})

test('count -> discrepancy -> recount by a different person -> approval -> adjustment; every separation-of-duties refusal', async () => {
  const { db, L, post, bal } = await setup()
  try {
    const s = await post(U.keeper, { idempotency_key: 'c1', item_id: BRAKE, location_id: L.s1, movement_type: 'receipt', qty_change: 6, unit_cost: 20 })
    const audit = (await call(db, U.reviewer, 'inv_audit_create', { country: 'KSA', site: 'S1', audit_type: 'cycle',
      scope: { location_ids: [L.s1] }, counter_id: U.counter, reviewer_id: U.reviewer, approver_id: U.approver })).id
    await call(db, U.reviewer, 'inv_audit_schedule', { audit_id: audit, due_at: new Date(Date.now() + 864e5).toISOString() })
    await call(db, U.reviewer, 'inv_audit_start', { audit_id: audit })
    // multiple people at the same location: only the assigned counter is accepted, from any of their devices
    const a = randomUUID(); const b2 = randomUUID()
    await call(db, U.counter, 'inv_count_submit', { audit_id: audit, device_id: 'phone-1', lines: [{ client_uuid: a, location_id: L.s1, item_id: BRAKE, counted_qty: 4 }] })
    await assert.rejects(call(db, U.keeper, 'inv_count_submit', { audit_id: audit, device_id: 'phone-k', lines: [{ client_uuid: randomUUID(), location_id: L.s1, item_id: BRAKE, counted_qty: 6 }] }), code('42501'))
    // duplicate offline replay (same client_uuid from another device) is a duplicate, not a second count
    const dup = await call(db, U.counter, 'inv_count_submit', { audit_id: audit, device_id: 'phone-2', lines: [{ client_uuid: a, location_id: L.s1, item_id: BRAKE, counted_qty: 4 }] })
    assert.deepEqual(dup.duplicates, [a])
    await call(db, U.counter, 'inv_audit_complete_counting', { audit_id: audit })
    // a delayed offline line counted AFTER the cutoff is rejected
    const late = await call(db, U.counter, 'inv_count_submit', { audit_id: audit, device_id: 'phone-2', lines: [{ client_uuid: b2, location_id: L.s1, item_id: BRAKE, counted_qty: 1, counted_at: new Date(Date.now() + 60e3).toISOString() }] })
    assert.equal(late.rejected[0].client_uuid, b2)
    await call(db, U.reviewer, 'inv_audit_reconcile', { audit_id: audit })
    const disc = await one(db, `select * from inventory_discrepancies where audit_id = $1 and variance_type = 'shortage'`, [audit])
    assert.equal(Number(disc.variance_qty), -2)

    // recount: request -> independent approval -> assignment; the recounter is never the counter
    await assert.rejects(call(db, U.reviewer, 'inv_request_approval', { entity_type: 'recount_assignment', entity_id: audit, proposal: { counter_id: U.counter } }), /different person/)
    await assert.rejects(call(db, U.keeper, 'inv_request_approval', { entity_type: 'recount_assignment', entity_id: audit, proposal: { counter_id: U.site2Only } }), code('42501'))
    const rq = await call(db, U.reviewer, 'inv_request_approval', { entity_type: 'recount_assignment', entity_id: audit, proposal: { counter_id: U.keeper } })
    for (const who of [U.counter, U.reviewer, U.keeper]) {
      await assert.rejects(call(db, who, 'inv_approval_decide', { request_id: rq.id, decision: 'approve' }), code('42501'), `decider ${who}`)
    }
    await call(db, U.approver, 'inv_approval_decide', { request_id: rq.id, decision: 'approve' })
    // the approval is for exactly that counter: another recounter is refused
    await assert.rejects(call(db, U.reviewer, 'inv_recount_assign', { audit_id: audit, recount_counter_id: U.site2Only, discrepancy_ids: [disc.id] }), /differs from what was approved/)
    await call(db, U.reviewer, 'inv_recount_assign', { audit_id: audit, recount_counter_id: U.keeper, discrepancy_ids: [disc.id] })
    // database CHECK: a recounter can never be the original counter, whatever the path
    await assert.rejects(db.exec(`update inventory_audits set recount_counter_id = counter_id where id = '${audit}'`), /recount_sod_chk|different person/)
    await call(db, U.keeper, 'inv_count_submit', { audit_id: audit, device_id: 'k', lines: [{ client_uuid: randomUUID(), location_id: L.s1, item_id: BRAKE, counted_qty: 4 }] })
    await call(db, U.keeper, 'inv_audit_complete_counting', { audit_id: audit })
    await call(db, U.reviewer, 'inv_audit_reconcile', { audit_id: audit })
    const d2 = await one(db, `select * from inventory_discrepancies where audit_id = $1 and variance_type = 'shortage' and status = 'open'`, [audit])
    await call(db, U.reviewer, 'inv_discrepancy_update', { discrepancy_id: d2.id, root_cause_category: 'unrecorded_issue', status: 'proposed' })
    const adj = await one(db, 'select * from inventory_adjustments where discrepancy_id = $1', [d2.id])
    const aq = await call(db, U.reviewer, 'inv_request_approval', { entity_type: 'stock_adjustment', entity_id: adj.id })
    for (const who of [U.counter, U.keeper, U.reviewer]) {
      await assert.rejects(call(db, who, 'inv_approval_decide', { request_id: aq.id, decision: 'approve' }), code('42501'))
    }
    await call(db, U.approver, 'inv_approval_decide', { request_id: aq.id, decision: 'approve' })
    // a direct status flip without the RPC still needs the approved request, and the proposer can never post
    await assert.rejects(db.exec(`update inventory_adjustments set status = 'posted', approved_by = proposed_by where id = '${adj.id}'`), /proposer/)
    const ok = await call(db, U.approver, 'inv_adjustment_approve', { adjustment_id: adj.id, decision: 'approve', note: 'agreed' })
    assert.equal(ok.status, 'posted')
    assert.equal(Number((await bal(s.stock_id)).qty_on_hand), 4)
    assert.equal((await one(db, `select status from inventory_approval_requests where id = $1`, [aq.id])).status, 'consumed')
  } finally { await db.close() }
})

test('opening balance: approver is never the preparer (CHECK + approval)', async () => {
  const { db, L } = await setup()
  try {
    const cb = await call(db, U.keeper, 'inv_opening_batch_create', { country: 'KSA', site: 'S1', reference: 'OB-9', source: 'manual',
      lines: [{ item_id: BRAKE, location_id: L.s1, qty: 2, unit_cost: 30 }] })
    const batch = cb.batch_id ?? cb.id
    const lines = await q(db, 'select id from opening_balance_lines where batch_id = $1', [batch])
    for (const l of lines) await call(db, U.keeper, 'inv_opening_line_map', { line_id: l.id, mapping_status: 'mapped', item_id: BRAKE, location_id: L.s1, qty: 2, unit_cost: 30 })
    await call(db, U.keeper, 'inv_opening_batch_submit', { batch_id: batch })
    await assert.rejects(call(db, U.reviewer, 'inv_request_approval', { entity_type: 'opening_balance_batch', entity_id: batch }), code('42501'))
    const rq = await call(db, U.keeper, 'inv_request_approval', { entity_type: 'opening_balance_batch', entity_id: batch })
    await assert.rejects(call(db, U.keeper, 'inv_approval_decide', { request_id: rq.id, decision: 'approve' }), code('42501'))
    await call(db, U.approver, 'inv_approval_decide', { request_id: rq.id, decision: 'approve' })
    await assert.rejects(db.exec(`update opening_balance_batches set status = 'approved', approved_by = prepared_by where id = '${batch}'`), /sod_chk|approval/)
    const ok = await call(db, U.approver, 'inv_opening_batch_approve', { batch_id: batch, decision: 'approve', note: 'counted' })
    assert.equal(ok.status, 'approved')
  } finally { await db.close() }
})

test('concurrency (single connection): the same key twice is one posting; lock order keeps the balance exact', async () => {
  const { db, L, post, bal } = await setup()
  try {
    const r = await post(U.keeper, { idempotency_key: 'k0', item_id: FILTER, location_id: L.s1, movement_type: 'receipt', qty_change: 10, unit_cost: 2 })
    // two "employees" issuing inside one transaction, in a fixed order: the second sees the first's lock result
    await asUser(db, U.keeper, async () => {
      await db.exec('begin')
      await db.query(`select public.inv_issue($1)`, [j({ idempotency_key: 'k1', stock_id: r.stock_id, qty: 6 })])
      const second = (await db.query(`select public.inv_issue($1) as r`, [j({ idempotency_key: 'k2', stock_id: r.stock_id, qty: 6 })])).rows[0].r
      assert.equal(second.status, 'refused_shortage', 'the later poster sees the committed-in-order balance, never a negative')
      await db.exec('commit')
    })
    const same = await Promise.all([1, 2].map(() => call(db, U.keeper, 'inv_issue', { idempotency_key: 'k3', stock_id: r.stock_id, qty: 1 })))
    assert.equal(same.filter(x => x.replayed).length, 1, 'a double-submit is replayed, not posted twice')
    const b = await bal(r.stock_id)
    assert.equal(Number(b.qty_on_hand), 3)
    const led = await one(db, 'select sum(qty_change)::numeric s from stock_movements where stock_id = $1', [r.stock_id])
    assert.equal(Number(led.s), 3)
  } finally { await db.close() }
})

test('tyre fit, removal, transfer and scrap reach tyre_items custody; tyre_records is never written by inventory', async () => {
  const { db } = await setup()
  try {
    const HASH = "select md5(string_agg(to_jsonb(t)::text, ',' order by id)) as h from public.tyre_records t"
    const sync = async () => {
      const before = await one(db, HASH)
      const r = await call(db, U.reviewer, 'inv_tyre_item_sync', { country: 'KSA' })
      assert.deepEqual(await one(db, HASH), before, 'the derivation wrote to tyre_records')
      assert.equal(r.tyre_records_written, 0)
      return (await one(db, "select custody_state, asset_no from tyre_items where serial = 'ZX9876543'"))
    }
    // fit (an outside module writes tyre_records; inventory only reads)
    await db.exec(`insert into tyre_records(organisation_id, country, site, serial_no, asset_no, tyre_position, status, issue_date, cost_per_tyre)
      values ('${ORG_A}','KSA','S1','ZX9876543','TM100','LHF1','Active','2026-01-01',1500)`)
    assert.equal((await sync()).custody_state, 'fitted')
    // removal
    await db.exec(`update tyre_records set status = 'Removed', removal_date = '2026-03-01' where serial_no = 'ZX9876543'`)
    assert.equal((await sync()).custody_state, 'removed_pending')
    // transfer to another vehicle
    await db.exec(`insert into tyre_records(organisation_id, country, site, serial_no, asset_no, tyre_position, status, issue_date)
      values ('${ORG_A}','KSA','S1','ZX9876543','TM200','RHF1','Active','2026-03-05')`)
    const moved = await sync()
    assert.equal(moved.custody_state, 'fitted'); assert.equal(moved.asset_no, 'TM200')
    // scrap
    await db.exec(`update tyre_records set status = 'Scrapped', removal_date = '2026-05-01' where serial_no = 'ZX9876543' and asset_no = 'TM200'`)
    await db.exec(`insert into tyre_status_marks(serial, mark_type, organisation_id, country, reason) values ('ZX9876543','scrap','${ORG_A}','KSA','bead damage')`)
    assert.equal((await sync()).custody_state, 'scrapped')
    const ev = await one(db, "select count(*)::int c from tyre_item_events e join tyre_items i on i.id = e.tyre_item_id where i.serial = 'ZX9876543'")
    assert.ok(ev.c >= 4, 'each custody change is an append-only event')
    const cost = await one(db, "select purchase_cost from tyre_items where serial = 'ZX9876543'")
    assert.equal(Number(cost.purchase_cost), 1500, 'a serialised tyre keeps its own purchase cost')
  } finally { await db.close() }
})

test('supplier-owned vs company-owned stock: separate balances, owned value excludes them', async () => {
  const { db, L, post } = await setup()
  try {
    await post(U.keeper, { idempotency_key: 'o1', item_id: BRAKE, location_id: L.s1, movement_type: 'receipt', qty_change: 2, unit_cost: 50 })
    await call(db, U.keeper, 'inv_supplier_agreement_upsert', { country: 'KSA', supplier_id: SUP, agreement_type: 'consignment',
      agreement_no: 'CON-9', currency: 'SAR', agreed_prices: { [BRAKE]: 40 } })
    await post(U.keeper, { idempotency_key: 'o2', item_id: BRAKE, location_id: L.s1, ownership: 'consignment', owner_supplier_id: SUP,
      movement_type: 'consignment_receipt', qty_change: 5, unit_cost: 40 })
    await post(U.keeper, { idempotency_key: 'o3', item_id: BRAKE, location_id: L.s1, ownership: 'supplier', owner_supplier_id: SUP,
      movement_type: 'consignment_receipt', qty_change: 3 })
    const rows = await asUser(db, U.reviewer, () => q(db, `select ownership, qty_on_hand, valued_amount from v_inv_valuation where item_id = $1 order by ownership`, [BRAKE]))
    assert.deepEqual(rows.map(r => [r.ownership, Number(r.qty_on_hand)]), [['consignment', 5], ['owned', 2], ['supplier', 3]])
    const sar = (await rpc(db, U.reviewer, 'inv_valuation_summary', ['KSA'])).by_currency.find(x => x.currency === 'SAR')
    assert.equal(Number(sar.owned_value), 100); assert.equal(Number(sar.consignment_agreed_value), 200); assert.equal(Number(sar.supplier_custody_qty), 3)
    const snap = await asUser(db, U.reviewer, () => q(db, `select currency, owned_valued_amount from v_inv_report_snapshot where site = 'S1'`))
    assert.equal(snap.length, 1); assert.equal(Number(snap[0].owned_valued_amount), 100, 'report digest counts owned stock only')
  } finally { await db.close() }
})

test('company, country, site and role restrictions on approvals, reconciliations and the ERP view', async () => {
  const { db, L, post } = await setup()
  try {
    const r = await post(U.keeper, { idempotency_key: 'x1', item_id: BRAKE, location_id: L.s2, movement_type: 'receipt', qty_change: 1 })
    const rec = await one(db, `select id from inventory_cost_reconciliations where stock_id = $1`, [r.stock_id])
    const req = await call(db, U.reviewer, 'inv_request_approval', { entity_type: 'cost_reconciliation', entity_id: rec.id,
      proposal: { resolution: 'written_off' }, reason: 'scrap value' })
    for (const [who, label] of [[U.adminB, 'other company'], [U.uaeOnly, 'other country']]) {
      const seen = await asUser(db, who, () => q(db, `select id from inventory_approval_requests where id = $1
        union all select id from inventory_cost_reconciliations where id = $2
        union all select id from v_inv_pending_approvals where id = $1`, [req.id, rec.id]))
      assert.equal(seen.length, 0, label)
      await assert.rejects(call(db, who, 'inv_approval_decide', { request_id: req.id, decision: 'approve' }),
        e => ['42501', 'P0002'].includes(e.code), label)
    }
    await db.exec(`insert into profiles(id, organisation_id, org_id, role, full_name, country, sites) values
      ('${id(14)}','${ORG_A}','${ORG_A}','Manager','S1 manager','{KSA}','{S1}')`)
    await assert.rejects(call(db, id(14), 'inv_approval_decide', { request_id: req.id, decision: 'approve' }), /out_of_scope/)
    const anon = await q(db, `select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'inv\\_%' or p.proname like '\\_inv\\_%') and has_function_privilege('anon', p.oid, 'EXECUTE')
      and p.proname not in ('inv_can','inv_blind_hides_balance','inv_canon_serial','inv_movement_kind')`)
    assert.deepEqual(anon.filter(x => /approval|cost_rec|reconcile/.test(x.sig)), [])
  } finally { await db.close() }
})

test('ERP reconciliation: every status, read-only, no double count, never sums currencies', async () => {
  const { db, L, post } = await setup()
  try {
    const month = new Date().toISOString().slice(0, 8) + '01'
    const S = (code, qty, value, extra = {}) => ({ code, qty, value, ...extra })
    const erp = [S('FLT-01', 4, 40), S('BRK-07', 3, 60), S('TYR-315', 1, 900), S('ERP-ONLY', 2, 10)]
    for (const e of erp) {
      await db.exec(`insert into parts_consumption(organisation_id, country, site, issue_number, item_code, qty_n, line_cost, currency, event_date)
        values ('${ORG_A}','KSA','S1','ISS-${e.code}','${e.code}',${e.qty},${e.value},'SAR','${month}')`)
    }
    // a store issue already in the ERP grid (same issue_number) must not be counted twice; one that is not, is added
    const mi1 = (await one(db, `insert into material_issues(organisation_id, country, site, issue_number, status, issued_at) values ('${ORG_A}','KSA','S1','ISS-FLT-01','issued',now()) returning id`)).id
    await db.exec(`insert into material_issue_lines(issue_id, item_code, qty, line_cost) values ('${mi1}','FLT-01',4,40)`)
    const before = await one(db, PROTECTED)
    // inventory side
    const f = await post(U.keeper, { idempotency_key: 'e1', item_id: FILTER, location_id: L.s1, movement_type: 'receipt', qty_change: 10, unit_cost: 10 })
    await call(db, U.keeper, 'inv_issue', { stock_id: f.stock_id, qty: 4 }) // 4 / 40 -> matched
    const b = await post(U.keeper, { idempotency_key: 'e2', item_id: BRAKE, location_id: L.s1, movement_type: 'receipt', qty_change: 10, unit_cost: 20 })
    await call(db, U.keeper, 'inv_issue', { stock_id: b.stock_id, qty: 2 }) // 2 vs 3 -> qty_diff
    const t = await post(U.keeper, { idempotency_key: 'e3', item_id: TYRE, location_id: L.s1, movement_type: 'receipt', qty_change: 1, unit_cost: 950 })
    await call(db, U.keeper, 'inv_issue', { stock_id: t.stock_id, qty: 1 }) // 950 vs 900 -> value_diff
    await db.exec(`insert into material_master(id, organisation_id, country, item_code, item_name, category) values ('${id(105)}','${ORG_A}','KSA','INV-ONLY','Only in stock','spare_part'),('${id(106)}','${ORG_A}','KSA','UNV-1','Unpriced','spare_part')`)
    const io = await post(U.keeper, { idempotency_key: 'e5', item_id: id(105), location_id: L.s1, movement_type: 'receipt', qty_change: 2, unit_cost: 1 })
    await call(db, U.keeper, 'inv_issue', { stock_id: io.stock_id, qty: 1 }) // inventory_only
    const un = await post(U.keeper, { idempotency_key: 'e6', item_id: id(106), location_id: L.s1, movement_type: 'receipt', qty_change: 2 })
    await call(db, U.keeper, 'inv_issue', { stock_id: un.stock_id, qty: 1 })
    await db.exec(`insert into parts_consumption(organisation_id, country, site, issue_number, item_code, qty_n, line_cost, currency, event_date)
      values ('${ORG_A}','KSA','S1','ISS-UNV','UNV-1',1,5,'SAR','${month}'), ('${ORG_A}','KSA','S1','ISS-AED','FLT-01',1,9,'AED','${month}')`)
    const rows = await asUser(db, U.reviewer, () => q(db, `select item_code, currency, status, inventory_qty, erp_qty, value_difference
      from v_inv_erp_reconciliation where site = 'S1' order by item_code, currency`))
    const st = Object.fromEntries(rows.map(r => [`${r.item_code}:${r.currency}`, r.status]))
    assert.deepEqual(st, {
      'BRK-07:SAR': 'qty_diff', 'ERP-ONLY:SAR': 'erp_only', 'FLT-01:AED': 'erp_only', 'FLT-01:SAR': 'matched',
      'INV-ONLY:SAR': 'inventory_only', 'TYR-315:SAR': 'value_diff', 'UNV-1:SAR': 'unvalued',
    })
    assert.equal(Number(rows.find(r => r.item_code === 'FLT-01' && r.currency === 'SAR').erp_qty), 4, 'store issue already in the grid not counted twice')
    assert.equal(Number(rows.find(r => r.item_code === 'TYR-315').value_difference), 50)
    // money is hidden without view_value; other companies see nothing
    const k = await asUser(db, U.keeper, () => q(db, `select value_difference from v_inv_erp_reconciliation where item_code = 'TYR-315'`))
    assert.equal(k[0].value_difference, null)
    assert.equal((await asUser(db, U.adminB, () => q(db, 'select * from v_inv_erp_reconciliation'))).length, 0)
    // reading it changes no expense figure
    await asUser(db, U.reviewer, () => q(db, 'select count(*) from v_inv_erp_reconciliation'))
    const after = await one(db, PROTECTED)
    assert.equal(after.expense, (await one(db, PROTECTED)).expense)
    assert.equal(before.tyres, after.tyres)
    const view = await one(db, "select pg_get_viewdef('public.v_inv_erp_reconciliation'::regclass) d")
    assert.doesNotMatch(view.d, /insert|update|delete/i)
  } finally { await db.close() }
})

test('metric catalogue holds the 25 inventory KPIs of kpi.js; report schedules accept inventory', async () => {
  const { db } = await setup()
  try {
    const src = readFileSync(new URL('../../src/lib/inventory/kpi.js', import.meta.url), 'utf8')
    const block = src.slice(src.indexOf('export const KPI_CATALOGUE'), src.indexOf('\n])', src.indexOf('export const KPI_CATALOGUE')))
    const ids = [...block.matchAll(/\{ id: '([a-z_]+)'/g)].map(m => m[1]).sort()
    assert.equal(ids.length, 25)
    const reg = await q(db, `select r.metric_id, r.status, r.lineage_domain, v.version, r.calc_ref from metric_registry r
      left join metric_versions v using (metric_id) where r.source_module = 'Inventory Control Center' order by 1`)
    assert.deepEqual(reg.map(r => r.metric_id), ids, 'metric_registry and KPI_CATALOGUE drifted - regenerate 20261120110000')
    assert.ok(reg.every(r => r.status === 'draft' && r.lineage_domain === null && r.version === 1 && r.calc_ref.endsWith(r.metric_id)))
    assert.equal((await one(db, "select count(*)::int c from metric_registry where metric_id = 'fleet_cpk'")).c, 1, 'existing metrics untouched')
    await db.exec(`insert into report_schedules(name, report_type, frequency, org_id) values ('Inventory weekly', 'inventory', 'weekly', '${ORG_A}')`)
    await assert.rejects(db.exec(`insert into report_schedules(name, report_type) values ('x', 'inventory_typo')`), /report_type_check/)
  } finally { await db.close() }
})

test('every new SECURITY DEFINER function pins search_path; none is executable by PUBLIC or anon', async () => {
  const { db } = await setup()
  try {
    const bad = await q(db, `select p.oid::regprocedure::text sig, p.proconfig,
        has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
        exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') public_x
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and (p.proname like 'inv\\_%' or p.proname like '\\_inv\\_%')
        and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
             or has_function_privilege('anon', p.oid, 'EXECUTE')
             or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
        and p.proname not in ('inv_can','inv_blind_hides_balance','inv_canon_serial','inv_movement_kind')`)
    assert.deepEqual(bad, [])
  } finally { await db.close() }
})

void ORG_B
