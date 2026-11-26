// Store Keeper phone receipts (20261126180000). PGlite over the inventory harness, synthetic data.
// A Store Keeper records a delivery against an open PO line for a site named in their own
// scope; nothing moves until a different "receive" holder approves, which posts the GRN
// through the existing _inv_receive_goods engine at the PO line price.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildDb, rpc, q, one, id, U, ORG_A, code, call, asUser } from './inventory_harness.test.mjs'

const MIG = readFileSync(new URL('../migrations/20261126180000_inv_store_keeper_phone_receipts.sql', import.meta.url), 'utf8')
const j = JSON.stringify
const FILTER = id(100); const BRAKE = id(104); const SUP = id(200)
const K = { pure: id(40), allSites: id(41), locked: id(42), reporter: id(43) }
let n = 0
const cu = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

async function setup () {
  const db = await buildDb()
  await db.exec(MIG)
  await db.exec(`insert into profiles(id, organisation_id, org_id, role, full_name, country, sites, locked) values
    ('${K.pure}','${ORG_A}','${ORG_A}','Store Keeper','Pure keeper',ARRAY['KSA'],ARRAY['S1'],false),
    ('${K.allSites}','${ORG_A}','${ORG_A}','Store Keeper','All-sites keeper',ARRAY['KSA'],ARRAY['ALL'],false),
    ('${K.locked}','${ORG_A}','${ORG_A}','Store Keeper','Locked keeper',ARRAY['KSA'],ARRAY['S1'],true),
    ('${K.reporter}','${ORG_A}','${ORG_A}','Reporter','Reporter',ARRAY['KSA'],ARRAY['S1'],false)`)
  await db.exec(`insert into test_caps values ('${U.approver}','receive'),('${U.keeper}','procure')`)
  const loc = p => call(db, U.admin, 'inv_location_upsert', p).then(r => r.id)
  const L = {
    s1: await loc({ country: 'KSA', site: 'S1', location_type: 'warehouse', code: 'WH1' }),
    s2: await loc({ country: 'KSA', site: 'S2', location_type: 'warehouse', code: 'WH2' }),
  }
  const mkPo = async (no, status = 'Submitted', site = 'S1', qty = 10, item = FILTER) => {
    const po = (await one(db, `insert into purchase_orders(po_number, organisation_id, country, site, supplier_id, currency, status)
      values ($1, '${ORG_A}', 'KSA', $2, '${SUP}', 'SAR', 'Submitted') returning id`, [no, site])).id
    const pl = await call(db, U.keeper, 'inv_po_add_line', { po_id: po, item_id: item, qty_ordered: qty, unit_price: 5,
      location_id: site === 'S1' ? L.s1 : L.s2 }).then(r => r.id ?? r)
    await db.exec(`update purchase_orders set status = '${status}' where id = '${po}'`)
    return { po, pl }
  }
  const submit = (uid, p) => rpc(db, uid, 'inv_store_receipt_submit', [j({ client_uuid: cu(), ...p })])
  const decide = (uid, p) => rpc(db, uid, 'inv_store_receipt_decide', [j(p)])
  return { db, L, mkPo, submit, decide }
}

test('store keeper records a receipt, a second person approves, stock moves at the PO price', async () => {
  const { db, L, mkPo, submit, decide } = await setup()
  try {
    const { po, pl } = await mkPo('PO-SK-1', 'Ordered')
    const r = await submit(K.pure, { po_line_id: pl, qty_received: 6, qty_rejected: 1, rejection_reason: 'One carton crushed',
      delivery_note_no: 'DN-77' })
    assert.equal(r.status, 'pending'); assert.equal(Number(r.open_after), 5)
    // nothing moved yet
    assert.equal((await q(db, 'select 1 from stock_records where item_id = $1 and location_id = $2', [FILTER, L.s1])).length, 0)
    assert.equal(Number((await one(db, 'select qty_accepted from purchase_order_lines where id = $1', [pl])).qty_accepted), 0)

    await assert.rejects(decide(K.pure, { request_id: r.id, decision: 'approve' }), code('42501'), 'no capability to decide')
    const ok = await decide(U.approver, { request_id: r.id, decision: 'approve' })
    assert.equal(ok.status, 'approved'); assert.ok(ok.grn_id)
    const again = await decide(U.approver, { request_id: r.id, decision: 'approve' })
    assert.equal(again.replayed, true)

    const line = await one(db, 'select * from purchase_order_lines where id = $1', [pl])
    assert.equal(Number(line.qty_accepted), 5); assert.equal(Number(line.qty_rejected), 1); assert.equal(line.status, 'partial')
    const bal = await one(db, 'select * from stock_records where item_id = $1 and location_id = $2', [FILTER, L.s1])
    assert.equal(Number(bal.qty_on_hand), 5); assert.equal(Number(bal.avg_unit_cost), 5, 'PO line price, never a phone price')
    const grn = await one(db, 'select * from goods_receipts where id = $1', [ok.grn_id])
    assert.equal(grn.received_by_id, K.pure); assert.equal(grn.created_by, U.approver); assert.equal(grn.delivery_note_no, 'DN-77')
    assert.equal(grn.po_id, po)
  } finally { await db.close() }
})

test('the recorder can never approve their own receipt, even holding "receive"', async () => {
  const { db, mkPo, submit, decide } = await setup()
  try {
    const { pl } = await mkPo('PO-SK-2', 'Approved')
    const r = await submit(U.keeper, { po_line_id: pl, qty_received: 2 })
    await assert.rejects(decide(U.keeper, { request_id: r.id, decision: 'approve' }), /a receipt you recorded/)
    await assert.rejects(decide(U.keeper, { request_id: r.id, decision: 'reject', note: 'mine' }), /a receipt you recorded/)
    await assert.rejects(decide(U.approver, { request_id: r.id, decision: 'reject' }), /Say why/)
    const rej = await decide(U.approver, { request_id: r.id, decision: 'reject', note: 'Wrong item delivered' })
    assert.equal(rej.status, 'rejected')
    await assert.rejects(decide(U.approver, { request_id: r.id, decision: 'approve' }), /already rejected/)
    // the DB check holds even for a direct superuser write
    await assert.rejects(db.exec(`update inv_store_receipt_requests set decided_by = submitted_by where id = '${r.id}'`))
  } finally { await db.close() }
})

test('site scope: only a site named in the keeper\'s own list; ALL never counts; country enforced', async () => {
  const { db, mkPo, submit } = await setup()
  try {
    const s1 = await mkPo('PO-SK-3', 'Ordered', 'S1')
    const s2 = await mkPo('PO-SK-4', 'Ordered', 'S2')
    await assert.rejects(submit(K.pure, { po_line_id: s2.pl, qty_received: 1 }), /assigned to you by name/)
    await assert.rejects(submit(K.allSites, { po_line_id: s1.pl, qty_received: 1 }), /assigned to you by name/)
    await assert.rejects(submit(U.uaeOnly, { po_line_id: s1.pl, qty_received: 1 }), /assigned to you by name/, 'UAE keeper on a KSA PO')
    assert.equal((await submit(U.site2Only, { po_line_id: s2.pl, qty_received: 1 })).status, 'pending')
    // a location at another site than the PO
    await assert.rejects(submit(U.keeper, { po_line_id: s1.pl, qty_received: 1, location_id: (await one(db,
      "select id from inventory_locations where site = 'S2'")).id }), /at the purchase order site/)
    // open lines only list the keeper's own named sites
    const open = await rpc(db, K.pure, 'inv_store_receipt_open_lines', [j({})])
    assert.deepEqual(open.lines.map(l => l.po_number), ['PO-SK-3'])
    assert.ok(open.lines.every(l => !('unit_price' in l)), 'no prices on the phone list')
    assert.deepEqual(open.locations.map(l => l.site), ['S1'])
    assert.deepEqual((await rpc(db, K.allSites, 'inv_store_receipt_open_lines', [j({})])).lines, [])
  } finally { await db.close() }
})

test('PO status, open quantity across pending receipts, price fields and idempotency', async () => {
  const { db, mkPo, submit } = await setup()
  try {
    const draft = await mkPo('PO-SK-5', 'Draft')
    await assert.rejects(submit(K.pure, { po_line_id: draft.pl, qty_received: 1 }), /approved or ordered/)
    const cancelled = await mkPo('PO-SK-6', 'Cancelled')
    await assert.rejects(submit(K.pure, { po_line_id: cancelled.pl, qty_received: 1 }), /approved or ordered/)

    const { pl } = await mkPo('PO-SK-7', 'Ordered', 'S1', 10)
    await assert.rejects(submit(K.pure, { po_line_id: pl, qty_received: 11 }), /Only 10 is still open/)
    await submit(K.pure, { po_line_id: pl, qty_received: 7 })
    await assert.rejects(submit(U.counter, { po_line_id: pl, qty_received: 4 }), /Only 3 is still open/,
      'a pending receipt holds its quantity')
    // rejected goods do not use open quantity
    assert.equal((await submit(U.counter, { po_line_id: pl, qty_received: 5, qty_rejected: 2, rejection_reason: 'Wet' })).status, 'pending')
    await assert.rejects(submit(U.counter, { po_line_id: pl, qty_received: 2, qty_rejected: 1 }), /Say why/)
    await assert.rejects(submit(K.pure, { po_line_id: pl, qty_received: 0 }), /above zero/)

    for (const f of ['unit_cost', 'unit_price', 'currency', 'price', 'cost']) {
      await assert.rejects(submit(K.pure, { po_line_id: pl, qty_received: 1, [f]: f === 'currency' ? 'USD' : 1 }), /cannot set a price/)
    }
    const fresh = (await mkPo('PO-SK-7B', 'Ordered')).pl
    await assert.rejects(submit(K.pure, { po_line_id: fresh, qty_received: 1, delivery_note_path: 'elsewhere/x.jpg' }), /your company/)
    await assert.rejects(submit(K.pure, { po_line_id: fresh, qty_received: 1, delivery_note_path: `store_receipts/${id(901)}/x.jpg` }),
      /your company/)
    assert.equal((await submit(K.pure, { po_line_id: fresh, qty_received: 1, delivery_note_path: `store_receipts/${ORG_A}/dn.jpg` })).status,
      'pending')

    // replay after a timeout stores nothing twice; a key is the first user's
    const key = cu()
    const first = await rpc(db, K.pure, 'inv_store_receipt_submit', [j({ client_uuid: key, po_line_id: (await mkPo('PO-SK-8', 'Ordered')).pl, qty_received: 1 })])
    const second = await rpc(db, K.pure, 'inv_store_receipt_submit', [j({ client_uuid: key, po_line_id: pl, qty_received: 1 })])
    assert.equal(second.id, first.id); assert.equal(second.replayed, true)
    await assert.rejects(rpc(db, U.counter, 'inv_store_receipt_submit', [j({ client_uuid: key, po_line_id: pl, qty_received: 1 })]),
      /someone else/)
  } finally { await db.close() }
})

test('who may record: locked, reporter and another company are refused; cancel is the recorder\'s only', async () => {
  const { db, mkPo, submit } = await setup()
  try {
    const { pl } = await mkPo('PO-SK-9', 'Ordered')
    await assert.rejects(submit(K.locked, { po_line_id: pl, qty_received: 1 }), code('42501'))
    await assert.rejects(submit(K.reporter, { po_line_id: pl, qty_received: 1 }), code('42501'))
    await assert.rejects(submit(U.adminB, { po_line_id: pl, qty_received: 1 }), /not found/, 'another company cannot reach the line')
    const r = await submit(K.pure, { po_line_id: pl, qty_received: 1 })
    await assert.rejects(rpc(db, U.counter, 'inv_store_receipt_cancel', [j({ request_id: r.id })]), /not found/)
    assert.equal((await rpc(db, K.pure, 'inv_store_receipt_cancel', [j({ request_id: r.id })])).status, 'cancelled')
    // cancelled frees the open quantity
    assert.equal((await submit(K.pure, { po_line_id: pl, qty_received: 10 })).status, 'pending')
  } finally { await db.close() }
})

test('grants and RLS: no direct write, no anon, internal helpers closed, reads scoped', async () => {
  const { db, mkPo, submit } = await setup()
  try {
    const g = await q(db, `select p.oid::regprocedure::text sig,
        has_function_privilege('anon', p.oid, 'EXECUTE') anon_x, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x
      from pg_proc p where p.proname like '%inv_store_%' order by 1`)
    assert.deepEqual(g.filter(r => r.anon_x).map(r => r.sig), [])
    assert.deepEqual(g.filter(r => r.sig.startsWith('_inv_store') && r.auth_x).map(r => r.sig), [])
    const t = await one(db, `select relrowsecurity rls, has_table_privilege('authenticated', oid, 'INSERT') ins,
        has_table_privilege('authenticated', oid, 'UPDATE') upd, has_table_privilege('authenticated', oid, 'DELETE') del,
        has_table_privilege('anon', oid, 'SELECT') anon_sel
      from pg_class where relname = 'inv_store_receipt_requests'`)
    assert.deepEqual(t, { rls: true, ins: false, upd: false, del: false, anon_sel: false })

    const { pl } = await mkPo('PO-SK-10', 'Ordered')
    await submit(K.pure, { po_line_id: pl, qty_received: 1 })
    const seen = uid => asUser(db, uid, async () => (await db.query('select id from inv_store_receipt_requests')).rows.length)
    assert.equal(await seen(K.pure), 1, 'recorder sees their own')
    assert.equal(await seen(U.approver), 1, 'receive holder in scope sees it')
    assert.equal(await seen(K.reporter), 0)
    assert.equal(await seen(U.adminB), 0, 'other company')
    assert.equal(await seen(U.uaeOnly), 0, 'receive holder out of country scope')
  } finally { await db.close() }
})
