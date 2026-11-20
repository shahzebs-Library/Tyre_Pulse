// Transfers, reservations/issue, GRN, three-way match, consignment, valuation,
// opening balances and master-data review (PGlite, synthetic data).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDb, rpc, q, one, id, U, code , call } from './inventory_harness.test.mjs'

const j = JSON.stringify
const FILTER = id(100); const BRAKE = id(104); const SUP = id(200)

async function setup () {
  const db = await buildDb()
  await db.exec(`insert into test_caps values ('${U.keeper}','procure'),('${U.keeper}','view_value'),('${U.approver}','procure'),('${U.approver}','financial_post')`)
  const loc = p => call(db, U.admin, 'inv_location_upsert', p).then(r => r.id)
  const L = {
    s1: await loc({ country: 'KSA', site: 'S1', location_type: 'warehouse', code: 'WH1' }),
    s2: await loc({ country: 'KSA', site: 'S2', location_type: 'warehouse', code: 'WH2' }),
  }
  const post = (uid, p) => rpc(db, uid, 'inv_post_movement', [j(p)])
  const bal = sid => one(db, 'select * from stock_records where id = $1', [sid])
  return { db, L, post, bal }
}

test('transfer: dispatch carries cost into transit, partial receipt, return of the rest', async () => {
  const { db, L, post, bal } = await setup()
  try {
    const src = await post(U.keeper, { idempotency_key: 't1', item_id: FILTER, location_id: L.s1, movement_type: 'receipt', qty_change: 10, unit_cost: 4 })
    await post(U.keeper, { idempotency_key: 't0', stock_id: src.stock_id, movement_type: 'receipt', qty_change: 2 }) // 2 unvalued
    const d = await rpc(db, U.keeper, 'inv_transfer_dispatch', [j({ idempotency_key: 'trf-1', from_location_id: L.s1, to_location_id: L.s2,
      remarks: 'to S2', lines: [{ scanned_code: `TP:STK:${src.stock_id}`, qty: 11 }] })])
    assert.equal(d.status, 'in_transit')
    const replay = await rpc(db, U.keeper, 'inv_transfer_dispatch', [j({ idempotency_key: 'trf-1', from_location_id: L.s1, to_location_id: L.s2, lines: [] })])
    assert.equal(replay.replayed, true)
    const line = await one(db, 'select * from stock_transfer_lines where transfer_id = $1', [d.transfer_id])
    // valued units leave first (owner decision): 10 valued at 4 = 40, then 1 unvalued (no cost invented)
    assert.equal(Number(line.carried_unvalued_qty), 1); assert.equal(Number(line.carried_value), 40)
    const transit = await bal(line.transit_stock_id)
    assert.equal(Number(transit.qty_on_hand), 11); assert.equal(Number(transit.unvalued_qty), 1); assert.equal(Number(transit.valued_value), 40)
    assert.equal(Number((await bal(src.stock_id)).qty_on_hand), 1)
    // the open reconciliation travelled with the unvalued unit (split), never duplicated
    const recs = await q(db, `select stock_id, unvalued_qty from inventory_cost_reconciliations where status = 'open' and not consumed and item_id = '${FILTER}' order by stock_id`)
    assert.equal(recs.reduce((s, r) => s + Number(r.unvalued_qty), 0), 2)
    assert.equal(Number(recs.find(r => r.stock_id === line.transit_stock_id).unvalued_qty), 1)
    // partial receipt at S2 with a damaged condition
    const r1 = await rpc(db, U.site2Only, 'inv_transfer_receive', [j({ idempotency_key: 'rcv-1', transfer_id: d.transfer_id,
      lines: [{ line_id: line.id, received_qty: 4, condition: 'good' }] })])
    assert.equal(r1.status, 'partially_received')
    await assert.rejects(rpc(db, U.site2Only, 'inv_transfer_receive', [j({ idempotency_key: 'rcv-2', transfer_id: d.transfer_id,
      lines: [{ line_id: line.id, received_qty: 8 }] })]), code('22023'))
    const dest = await one(db, `select * from stock_records where location_id = $1 and item_id = $2`, [L.s2, FILTER])
    assert.equal(Number(dest.qty_on_hand), 4); assert.equal(Number(dest.unvalued_qty), 0); assert.equal(Number(dest.valued_value), 16)
    // site-1-only keeper cannot receive at S2? (keeper has S1,S2) - a UAE user cannot
    await assert.rejects(rpc(db, U.uaeOnly, 'inv_transfer_receive', [j({ idempotency_key: 'rcv-x', transfer_id: d.transfer_id,
      lines: [{ line_id: line.id, received_qty: 1 }] })]), /not found|scope|42501/)
    const back = await rpc(db, U.keeper, 'inv_transfer_return_remaining', [j({ idempotency_key: 'ret-1', transfer_id: d.transfer_id,
      reason: 'short shipped', lines: [{ line_id: line.id, qty: 7 }] })])
    assert.equal(back.status, 'completed')
    assert.equal(Number((await bal(line.transit_stock_id)).qty_on_hand), 0)
    const s1 = await bal(src.stock_id)
    assert.equal(Number(s1.qty_on_hand), 8); assert.equal(Number(s1.unvalued_qty), 2); assert.equal(Number(s1.valued_value), 24)
    // total value conserved: 40 bought, 16 at S2, 24 at S1; unvalued units and their open records agree
    const tot = await one(db, `select sum(valued_value)::numeric v, sum(qty_on_hand)::numeric qty, sum(unvalued_qty)::numeric u from stock_records where item_id = $1`, [FILTER])
    assert.equal(Number(tot.v), 40); assert.equal(Number(tot.qty), 12)
    const openQ = await one(db, `select sum(unvalued_qty)::numeric q from inventory_cost_reconciliations where status = 'open' and not consumed and item_id = $1`, [FILTER])
    assert.equal(Number(openQ.q), Number(tot.u))
  } finally { await db.close() }
})

test('reservations, issue consuming a reservation, and consignment kept out of owned value', async () => {
  const { db, L, post, bal } = await setup()
  try {
    const s = await post(U.keeper, { idempotency_key: 'c1', item_id: BRAKE, location_id: L.s1, movement_type: 'receipt', qty_change: 5, unit_cost: 10 })
    const res = await rpc(db, U.keeper, 'inv_reserve', [j({ idempotency_key: 'res-1', stock_id: s.stock_id, qty: 3, source_doc_type: 'work_order', source_doc_id: 'WO-1' })])
    assert.equal(Number((await bal(s.stock_id)).qty_reserved), 3)
    const tooMuch = await rpc(db, U.keeper, 'inv_reserve', [j({ idempotency_key: 'res-2', stock_id: s.stock_id, qty: 3 })])
    assert.equal(tooMuch.status, 'refused_shortage')
    const iss = await rpc(db, U.keeper, 'inv_issue', [j({ idempotency_key: 'is-1', stock_id: s.stock_id, qty: 2, reservation_id: res.id })])
    assert.equal(Number(iss.value_change), -20)
    let b = await bal(s.stock_id)
    assert.equal(Number(b.qty_on_hand), 3); assert.equal(Number(b.qty_reserved), 1)
    await call(db, U.keeper, 'inv_release', { reservation_id: res.id, idempotency_key: 'rel-1' })
    b = await bal(s.stock_id); assert.equal(Number(b.qty_reserved), 0)
    // consignment
    await call(db, U.keeper, 'inv_supplier_agreement_upsert', { country: 'KSA', supplier_id: SUP, agreement_type: 'consignment',
      agreement_no: 'CON-1', currency: 'SAR', agreed_prices: { [BRAKE]: 15 } }).then(r => r.id ?? r)
    await assert.rejects(post(U.keeper, { idempotency_key: 'c2', item_id: BRAKE, location_id: L.s1, movement_type: 'consignment_receipt', qty_change: 4 }), code('22023'))
    const cons = await post(U.keeper, { idempotency_key: 'c3', item_id: BRAKE, location_id: L.s1, ownership: 'consignment',
      owner_supplier_id: SUP, movement_type: 'consignment_receipt', qty_change: 4, unit_cost: 15 })
    assert.notEqual(cons.stock_id, s.stock_id)
    const sum = await rpc(db, U.keeper, 'inv_valuation_summary', ['KSA'])
    const sar = sum.by_currency.find(x => x.currency === 'SAR')
    assert.equal(Number(sar.owned_value), 30); assert.equal(Number(sar.consignment_qty), 4); assert.equal(Number(sar.consignment_agreed_value), 60)
    const ci = await rpc(db, U.keeper, 'inv_issue', [j({ idempotency_key: 'is-2', stock_id: cons.stock_id, qty: 1 })])
    const cc = await one(db, 'select * from consignment_consumptions where movement_id = $1', [ci.movement_id])
    assert.equal(Number(cc.agreed_value), 15); assert.match(cc.note, /not an accounting posting/)
    // an unvalued owned unit makes the owned headline honest (null), never 0
    await post(U.keeper, { idempotency_key: 'c4', stock_id: s.stock_id, movement_type: 'receipt', qty_change: 1 })
    const sum2 = (await rpc(db, U.keeper, 'inv_valuation_summary', ['KSA'])).by_currency.find(x => x.currency === 'SAR')
    assert.equal(sum2.owned_value, null); assert.equal(sum2.owned_value_reason, 'unvalued_stock_present'); assert.equal(Number(sum2.owned_valued_value), 30)
    // view_value is required to see money
    await assert.rejects(rpc(db, U.viewer, 'inv_valuation_summary', ['KSA']), code('42501'))
    const v = await one(db, `select valued_value from v_inventory_valuation where stock_id = $1`, [s.stock_id])
    assert.ok(v)
    // nothing ever reaches the ERP cost ledger
    const pc = await one(db, `select count(*)::int c from pg_proc where prosrc ilike '%parts_consumption%' and proname like 'inv\\_%'`)
    assert.equal(pc.c, 0)
  } finally { await db.close() }
})

test('value-only movements: landed cost, supplier credit, cost assignment', async () => {
  const { db, L, post, bal } = await setup()
  try {
    const s = await post(U.keeper, { idempotency_key: 'v1', item_id: FILTER, location_id: L.s1, movement_type: 'receipt', qty_change: 4, unit_cost: 10 })
    await post(U.keeper, { idempotency_key: 'v2', stock_id: s.stock_id, movement_type: 'receipt', qty_change: 2 })
    await assert.rejects(post(U.keeper, { idempotency_key: 'v3', stock_id: s.stock_id, movement_type: 'landed_cost', value: 8 }), code('42501'))
    await post(U.approver, { idempotency_key: 'v4', stock_id: s.stock_id, movement_type: 'landed_cost', value: 8 })
    let b = await bal(s.stock_id); assert.equal(Number(b.avg_unit_cost), 12)
    const cr = await post(U.approver, { idempotency_key: 'v5', stock_id: s.stock_id, movement_type: 'supplier_credit', value: 100 })
    assert.equal(Number(cr.value_change), -48); assert.equal(cr.variance_kind, 'supplier_credit_exceeds_stock_value'); assert.equal(Number(cr.variance_amount), -52)
    // nothing becomes valued without an approved cost reconciliation
    await assert.rejects(post(U.approver, { idempotency_key: 'v7', stock_id: s.stock_id, movement_type: 'cost_assignment', qty: 2, unit_cost: 5 }), /cost reconciliation/)
    const rec = await one(db, `select id from inventory_cost_reconciliations where stock_id = $1 and status = 'open'`, [s.stock_id])
    const req = await call(db, U.approver, 'inv_request_approval', { entity_type: 'cost_reconciliation', entity_id: rec.id,
      proposal: { resolution: 'resolved', unit_cost: 5 }, reason: 'supplier invoice INV-9' })
    await call(db, U.admin, 'inv_approval_decide', { request_id: req.id, decision: 'approve' })
    const res = await call(db, U.approver, 'inv_cost_reconcile', { reconciliation_id: rec.id })
    assert.equal(res.status, 'resolved'); assert.equal(Number(res.applied_qty), 2); assert.equal(res.posting, 'none')
    b = await bal(s.stock_id)
    assert.equal(Number(b.unvalued_qty), 0); assert.equal(Number(b.valued_value), 10); assert.equal(Number(b.qty_on_hand), 6)
  } finally { await db.close() }
})

test('goods receipt against a PO and three-way match (no posting)', async () => {
  const { db, L } = await setup()
  try {
    const po = (await one(db, `insert into purchase_orders(po_number, organisation_id, country, site, supplier_id, currency, status)
      values ('PO-77', '${id(900)}', 'KSA', 'S1', '${SUP}', 'SAR', 'Submitted') returning id`)).id
    const pl = await call(db, U.keeper, 'inv_po_add_line', { po_id: po, ...{ item_id: FILTER, qty_ordered: 10, unit_price: 5, location_id: L.s1 } }).then(r => r.id)
    const g = await rpc(db, U.keeper, 'inv_receive_goods', [j({ idempotency_key: 'grn-1', country: 'KSA', site: 'S1', po_id: po, supplier_id: SUP,
      lines: [{ po_line_id: pl, item_id: FILTER, location_id: L.s1, qty_received: 6, qty_rejected: 1 }] })])
    assert.equal(g.lines, 1)
    const again = await rpc(db, U.keeper, 'inv_receive_goods', [j({ idempotency_key: 'grn-1', country: 'KSA', site: 'S1', lines: [] })])
    assert.equal(again.replayed, true)
    const line = await one(db, 'select * from purchase_order_lines where id = $1', [pl])
    assert.equal(Number(line.qty_accepted), 5); assert.equal(line.status, 'partial')
    const bal = await one(db, 'select * from stock_records where item_id = $1 and location_id = $2', [FILTER, L.s1])
    assert.equal(Number(bal.qty_on_hand), 5); assert.equal(Number(bal.avg_unit_cost), 5)
    await assert.rejects(rpc(db, U.keeper, 'inv_receive_goods', [j({ idempotency_key: 'grn-2', country: 'KSA', site: 'S1', po_id: po,
      lines: [{ po_line_id: pl, item_id: FILTER, location_id: L.s1, qty_received: 6 }] })]), code('22023'))
    const inv = await call(db, U.approver, 'inv_supplier_invoice_create', { country: 'KSA', supplier_id: SUP, invoice_no: 'INV-1', currency: 'SAR', po_id: po,
      lines: [{ po_line_id: pl, item_id: FILTER, qty: 6, unit_price: 5.5 }] }).then(r => r.id ?? r)
    const m = await call(db, U.approver, 'inv_supplier_invoice_match', { invoice_id: inv })
    assert.equal(m.match_status, 'qty_and_price_mismatch'); assert.equal(m.posting, 'none')
    const inv2 = await call(db, U.approver, 'inv_supplier_invoice_create', { country: 'KSA', supplier_id: SUP, invoice_no: 'INV-2', currency: 'SAR', po_id: po,
      lines: [{ po_line_id: pl, item_id: FILTER, qty: 5, unit_price: 5 }] }).then(r => r.id ?? r)
    await db.exec(`update supplier_invoices set status = 'rejected' where id = '${inv}'`)
    assert.equal((await call(db, U.approver, 'inv_supplier_invoice_match', { invoice_id: inv2 })).match_status, 'matched')
  } finally { await db.close() }
})

test('opening balance: legacy rows reviewed, preparer cannot approve, drift recorded not posted', async () => {
  const { db, L, bal } = await setup()
  try {
    const cb = await call(db, U.keeper, 'inv_opening_batch_create', { country: 'KSA', site: 'S1', reference: 'OB-2026-01', source: 'legacy_stock_records' })
    const batch = cb.batch_id; const n = cb.seeded_legacy_lines
    assert.equal(n, 2)
    const lines = await q(db, 'select * from opening_balance_lines where batch_id = $1 order by line_no', [batch])
    const rim = lines.find(l => l.target_stock_id === id(401)); const tyre = lines.find(l => l.target_stock_id === id(400))
    assert.equal(rim.history_certainty, 'uncertain'); assert.equal(Number(rim.legacy_drift), 4); assert.equal(rim.missing_cost, true)
    assert.equal(tyre.history_certainty, 'known')
    await assert.rejects(call(db, U.keeper, 'inv_opening_batch_submit', { batch_id: batch }), code('22023'))
    await call(db, U.keeper, 'inv_opening_line_map', { line_id: rim.id, ...{ mapping_status: 'mapped', item_id: BRAKE, location_id: L.s1, qty: 3, unit_cost: 7 } })
    await call(db, U.keeper, 'inv_opening_line_map', { line_id: tyre.id, ...{ mapping_status: 'excluded', notes: 'tyres via tyre_items' } })
    await call(db, U.keeper, 'inv_opening_batch_submit', { batch_id: batch })
    await db.exec(`insert into test_caps values ('${U.keeper}','adjustment_approve')`)
    await assert.rejects(call(db, U.keeper, 'inv_opening_batch_decide', { batch_id: batch, decision: 'approve', note: 'mine' }), code('42501'))
    // independent approval through the approval engine before the batch can post
    await assert.rejects(call(db, U.approver, 'inv_opening_batch_approve', { batch_id: batch, decision: 'approve', note: 'early' }), /approval is required/)
    const req = await call(db, U.keeper, 'inv_request_approval', { entity_type: 'opening_balance_batch', entity_id: batch })
    await assert.rejects(call(db, U.keeper, 'inv_approval_decide', { request_id: req.id, decision: 'approve' }), code('42501'))
    await call(db, U.approver, 'inv_approval_decide', { request_id: req.id, decision: 'approve' })
    const ok = await call(db, U.approver, 'inv_opening_batch_approve', { batch_id: batch, decision: 'approve', note: 'checked against count' })
    assert.equal(ok.lines_posted, 1)
    const b = await bal(id(401))
    assert.equal(Number(b.qty_on_hand), 3); assert.equal(Number(b.avg_unit_cost), 7); assert.equal(b.item_id, BRAKE)
    const mv = await one(db, `select * from stock_movements where stock_id = $1 and movement_type = 'opening'`, [id(401)])
    assert.equal(Number(mv.qty_change), -1); assert.equal(Number(mv.value_change), 21)
    // no manufactured history: the only movements on the row are the approved opening
    assert.equal((await one(db, 'select count(*)::int c from stock_movements where stock_id = $1', [id(401)])).c, 1)
    // the legacy unknown cost is closed by the approved batch: 1 unit removed (cancelled), 3 priced (resolved at 7)
    const lr = await q(db, `select status, unvalued_qty, resolution_source, resolved_value from inventory_cost_reconciliations where stock_id = $1 order by status`, [id(401)])
    assert.deepEqual(lr.map(r => [r.status, Number(r.unvalued_qty), r.resolution_source]), [['cancelled', 1, 'opening_batch'], ['resolved', 3, 'opening_batch']])
    assert.equal(Number(lr[1].resolved_value), 21)
  } finally { await db.close() }
})

test('master data review: no auto-merge, proposer cannot approve', async () => {
  const { db } = await setup()
  try {
    const r = await call(db, U.keeper, 'inv_master_review_submit', { item_id: FILTER, change_type: 'update', reason: 'set levels',
      proposed: { min_qty: 2, max_qty: 10, stocked: true } }).then(r => r.id ?? r)
    await assert.rejects(call(db, U.keeper, 'inv_master_review_submit', { item_id: FILTER, change_type: 'update', reason: 'x', proposed: { item_code: 'HACK' } }).then(r => r.id ?? r), code('22023'))
    await db.exec(`update profiles set role = 'Manager' where id = '${U.keeper}'`)
    await assert.rejects(call(db, U.keeper, 'inv_master_review_decide', { review_id: r, decision: 'approve', note: 'ok' }), code('42501'))
    await db.exec(`update profiles set role = 'Store Keeper' where id = '${U.keeper}'`)
    await call(db, U.approver, 'inv_master_review_decide', { review_id: r, decision: 'approve', note: 'ok' })
    const m = await one(db, 'select min_qty, max_qty, stocked from material_master where id = $1', [FILTER])
    assert.equal(Number(m.min_qty), 2); assert.equal(m.stocked, true)
    const merge = await call(db, U.keeper, 'inv_master_review_submit', { item_id: BRAKE, target_item_id: FILTER, change_type: 'merge', reason: 'duplicate?' }).then(r => r.id ?? r)
    assert.equal((await one(db, 'select status from material_master where id = $1', [BRAKE])).status, 'active')
    await call(db, U.approver, 'inv_master_review_decide', { review_id: merge, decision: 'reject', note: 'different part' })
    assert.equal((await one(db, 'select status from material_master where id = $1', [BRAKE])).status, 'active')
  } finally { await db.close() }
})
