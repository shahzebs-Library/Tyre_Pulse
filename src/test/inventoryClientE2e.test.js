// @vitest-environment node
/**
 * CLIENT -> DATABASE end to end for Inventory Control & Audit.
 *
 * The REAL service functions of src/lib/api/inventory.js run against PGlite with
 * every pending inv_* migration applied over the live-shaped platform stubs of
 * supabase/tests/inventory_harness.test.mjs. The Supabase client is replaced by
 * supabase/tests/fixtures/postgrest_pglite_bridge.mjs, which executes each
 * .from()/.rpc() as `set role authenticated` with request.jwt.claims = {sub}, so
 * RLS, grants, SECURITY DEFINER gates, approvals and separation of duties are
 * the database's own answers, not scripted ones. No hand-written SQL drives a
 * flow; raw SQL is used only for fixtures an outside module would create
 * (tyre_records, ERP expense lines) and for assertions.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'

const holder = vi.hoisted(() => ({ client: null }))
// The harness module registers its own node:test self-check; neutralise it here.
vi.mock('node:test', () => ({ test: () => {}, default: { test: () => {} } }))
vi.mock('../lib/supabase', () => ({
  supabase: new Proxy({}, { get: (_t, k) => holder.client?.[k] }),
}))

import { buildDb, id, U, ORG_A, ORG_B } from '../../supabase/tests/inventory_harness.test.mjs'
import { createBridge, AUTH_SQL } from '../../supabase/tests/fixtures/postgrest_pglite_bridge.mjs'
import * as inv from '../lib/api/inventory'
import { targetToCorrection, correctionToTarget } from '../lib/inventory/auditView'

const FILTER = id(100); const TYRE = id(101); const BRAKE = id(104); const SUP = id(200)
const key = () => randomUUID()
const n = (v) => (v === null || v === undefined ? v : Number(v))

const PROTECTED = `select
  (select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by id), '')) from public.tyre_records t) as tyres,
  (select md5(coalesce(string_agg(concat_ws('|', id, item_code, qty_n, line_cost, tyre_cost, spare_cost, oil_cost, cost_category, event_date), ',' order by id), '')) from public.parts_consumption) as expense`

async function fresh () {
  const db = await buildDb()
  await db.exec(AUTH_SQL)
  await db.exec(`insert into test_caps values ('${U.keeper}','procure'),('${U.approver}','procure'),
    ('${U.approver}','financial_post'),('${U.reviewer}','financial_post')`)
  const api = createBridge(db)
  holder.client = api
  const as = (uid) => api.as(uid)
  as(U.admin)
  const L = {
    s1: (await inv.saveLocation({ country: 'KSA', site: 'S1', location_type: 'warehouse', code: 'WH1', name: 'Main' }, key())).id,
    s1b: (await inv.saveLocation({ country: 'KSA', site: 'S1', location_type: 'rack', code: 'R1', name: 'Rack 1' }, key())).id,
    s2: (await inv.saveLocation({ country: 'KSA', site: 'S2', location_type: 'warehouse', code: 'WH2', name: 'Site 2' }, key())).id,
  }
  return { db, api, as, L, close: () => db.close() }
}

/** Run a service call as `uid` and capture a thrown ServiceError instead of throwing. */
async function attempt (fn) {
  try { return { ok: true, value: await fn() } } catch (e) { return { ok: false, error: e } }
}

describe('bridge sanity: the client really runs as the signed-in user', () => {
  let env
  beforeAll(async () => { env = await fresh() }, 60000)

  it('auth.uid() and the role come from request.jwt.claims; anon reads nothing', async () => {
    const { api, as } = env
    as(U.keeper)
    const who = await api.rpc('inv_can', { p_cap: 'receive' })
    expect(who.error).toBeNull()
    expect(who.data).toBe(true)
    as(U.viewer)
    expect((await api.rpc('inv_can', { p_cap: 'receive' })).data).toBe(false)
    as(null)
    const anon = await api.from('v_inv_balances').select('id')
    expect(anon.data ?? []).toEqual([])
    expect(anon.error?.code || 'empty').toMatch(/42501|empty/)
  })
})

describe('purchase receipt -> availability -> reservation -> issue to a work order', () => {
  let env
  beforeAll(async () => { env = await fresh() }, 60000)

  it('runs through the real service functions and keeps CPK / expense inputs unchanged', async () => {
    const { as, api, L } = env
    const before = (await api.sql(PROTECTED))[0]
    as(U.keeper)
    const grn = await inv.receiveGoods({ country: 'KSA', site: 'S1', grnNo: 'GRN-E2E-1', supplierId: SUP,
      lines: [{ item_id: BRAKE, location_id: L.s1, qty_received: 8, qty_rejected: 1, rejection_reason: 'torn box', unit_cost: 25, currency: 'SAR' }] }, key())
    expect(grn.grn_id || grn.id).toBeTruthy()
    const page = await inv.listBalances({ country: 'KSA', site: 'S1', search: 'BRK' })
    expect(page.status).toBe('ok')
    const row = page.rows.find((r) => r.item_id === BRAKE && r.location_id === L.s1)
    expect(n(row.qty_on_hand)).toBe(7) // 8 received, 1 rejected: rejected units never enter stock
    expect(row.valuation_status).toBe('valued')
    expect(row.avg_unit_cost).toBeNull() // keeper has no stock:view_value
    const res = await inv.reserveStock({ stockId: row.id, qty: 3, sourceDocType: 'work_order', sourceDocId: id(300) }, key())
    expect(res.reservation_id).toBe(res.id)
    const short = await inv.reserveStock({ stockId: row.id, qty: 6 }, key())
    expect(short.status).toBe('refused_shortage')
    const iss = await inv.issueStock({ stockId: row.id, qty: 3, reservationId: res.reservation_id, sourceDocType: 'work_order', sourceDocId: 'WO-1' }, key())
    expect(n(iss.valued_qty_moved)).toBe(3)
    expect(n(iss.unvalued_qty_moved)).toBe(0)
    const after = (await inv.listBalances({ country: 'KSA', site: 'S1', search: 'BRK' })).rows.find((r) => r.id === row.id)
    expect([n(after.qty_on_hand), n(after.qty_reserved)]).toEqual([4, 0])
    as(U.reviewer)
    const mov = await inv.listMovements({ country: 'KSA', site: 'S1', type: 'issue' })
    expect(mov.rows.some((m) => m.stock_id === row.id && n(m.qty_change) === -3 && n(m.value_change) === -75)).toBe(true)
    expect((await api.sql(PROTECTED))[0]).toEqual(before)
  })
})

// Every relation the signed-in user can read, through the client path, searched for needles.
async function leakScan (api, uid, needles) {
  const rels = await api.sql(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','v') and has_table_privilege('authenticated', c.oid, 'SELECT')`)
  api.as(uid)
  const found = new Set()
  for (const { relname } of rels) {
    const { data, error } = await api.from(relname).select('*')
    if (error || !data) continue
    const text = JSON.stringify(data)
    if (needles.some((nd) => text.includes(nd))) found.add(relname)
  }
  return [...found]
}

const EXPECTED_KEYS = /expected_qty|expected_value|expected_cost|book_qty|qty_on_hand|snapshot_qty/

describe('physical audit: blind count -> discrepancy -> recount by another person -> approval -> adjustment posted', () => {
  let env; let audit; let sid; let disc; const uuidA = randomUUID()
  beforeAll(async () => {
    env = await fresh()
    env.as(U.keeper)
    const g = await inv.receiveGoods({ country: 'KSA', site: 'S1', grnNo: 'GRN-AUD', lines: [{ item_id: BRAKE, location_id: env.L.s1, qty_received: 6, unit_cost: 20, currency: 'SAR' }] }, key())
    expect(g).toBeTruthy()
    sid = (await inv.listBalances({ country: 'KSA', site: 'S1', search: 'BRK' })).rows[0].id
  }, 60000)

  it('creates and starts the audit the way the web screen does (draft -> schedule -> start)', async () => {
    env.as(U.reviewer)
    audit = (await inv.createAudit({ audit_type: 'cycle', site: 'S1', country: 'KSA', location_ids: [env.L.s1],
      counter_id: U.counter, reviewer_id: U.reviewer, approver_id: U.approver, due_at: new Date(Date.now() + 864e5).toISOString() }, key())).id
    expect(audit).toBeTruthy()
    env.as(U.counter)
    const self = await attempt(() => inv.startAudit(audit, key()))
    expect(self.ok).toBe(false)
    env.as(U.reviewer)
    const k = key()
    await inv.scheduleAudit(audit, `${k}:schedule`)
    await inv.startAudit(audit, k)
    expect((await inv.getAudit(audit)).status).toBe('in_progress')
  })

  it('the counter view (web service and the Flutter payload) carries no expected quantity, and no relation leaks it', async () => {
    env.as(U.counter)
    const web = await inv.getCounterView(audit)
    expect(web.lines.length).toBeGreaterThan(0)
    expect(JSON.stringify(web)).not.toMatch(EXPECTED_KEYS)
    const fl = await env.api.rpc('inv_audit_counter_view', { p_audit_id: audit })
    expect(fl.error).toBeNull()
    expect(Object.keys(fl.data)).toEqual(expect.arrayContaining(['audit', 'items']))
    expect(JSON.stringify(fl.data)).not.toMatch(EXPECTED_KEYS)
    const list = await env.api.rpc('inv_audit_counter_view', { p_audit_id: null })
    expect(list.error).toBeNull()
    expect(JSON.stringify(list.data)).toContain(audit)
    expect(JSON.stringify(list.data)).not.toMatch(EXPECTED_KEYS)
    expect(await leakScan(env.api, U.counter, [sid])).toEqual([])
    expect(await leakScan(env.api, U.reviewer, [sid])).toContain('stock_records')
  })

  it('multiple people at one location: only the assigned counter is accepted; duplicate and replayed submits post once', async () => {
    env.as(U.keeper)
    const other = await attempt(() => inv.submitCount({ auditId: audit, deviceId: 'web-k', lines: [{ location_id: env.L.s1, item_id: BRAKE, counted_qty: 6, client_uuid: randomUUID() }] }, key()))
    expect(other.ok).toBe(false)
    expect(other.error.code).toBe('INV_REFUSED')
    env.as(U.counter)
    const k = key()
    const first = await inv.submitCount({ auditId: audit, deviceId: 'web-1', lines: [{ location_id: env.L.s1, item_id: BRAKE, counted_qty: 4, client_uuid: uuidA }] }, k)
    expect(first.accepted).toEqual([uuidA])
    const replay = await inv.submitCount({ auditId: audit, deviceId: 'web-1', lines: [{ location_id: env.L.s1, item_id: BRAKE, counted_qty: 4, client_uuid: uuidA }] }, k)
    expect(replay.replayed).toBe(true)
    const fl = await env.api.rpc('inv_count_submit', { p_payload: { audit_id: audit, device_id: 'phone-2',
      lines: [{ client_uuid: uuidA, location_id: env.L.s1, item_id: BRAKE, serial_no: null, scanned_code: null, counted_qty: 4,
        confirmed_zero: false, condition: 'good', photos: [], remarks: null, unexpected: false, counted_at: new Date().toISOString(), round: 1 }] } })
    expect(fl.error).toBeNull()
    expect(fl.data.duplicates).toEqual([uuidA])
    const lines = await env.api.sql('select count(*)::int c from inventory_count_lines where audit_id = $1', [audit])
    expect(lines[0].c).toBe(1)
  })

  it('a delayed offline line counted after counting closed is rejected; one counted before is accepted', async () => {
    env.as(U.counter)
    const counted = new Date(Date.now() - 1000).toISOString()
    await inv.completeCounting(audit, key())
    expect((await inv.getAudit(audit)).status).toBe('counting_completed')
    const lateUuid = randomUUID(); const earlyUuid = randomUUID()
    const late = await env.api.rpc('inv_count_submit', { p_payload: { audit_id: audit, device_id: 'phone-2',
      lines: [{ client_uuid: lateUuid, location_id: env.L.s1, item_id: FILTER, counted_qty: 1, confirmed_zero: false, condition: 'good',
        photos: [], unexpected: true, counted_at: new Date(Date.now() + 60e3).toISOString(), round: 1 }] } })
    expect(late.error).toBeNull()
    expect(late.data.rejected.map((r) => r.client_uuid)).toEqual([lateUuid])
    const early = await env.api.rpc('inv_count_submit', { p_payload: { audit_id: audit, device_id: 'phone-2',
      lines: [{ client_uuid: earlyUuid, location_id: env.L.s1, item_id: FILTER, counted_qty: 0, confirmed_zero: true, condition: 'good',
        photos: [], unexpected: true, counted_at: counted, round: 1 }] } })
    expect(early.data.accepted).toEqual([earlyUuid])
  })

  it('reconcile -> shortage discrepancy, hidden from the counter; recount approval names the recounter, then the same person is assigned', async () => {
    env.as(U.reviewer)
    await inv.reconcileAudit(audit, key())
    const d = await inv.listDiscrepancies({ auditId: audit })
    disc = d.rows.find((r) => r.item_id === BRAKE)
    expect([n(disc.expected_qty), n(disc.counted_qty), n(disc.variance_qty)]).toEqual([6, 4, -2])
    env.as(U.counter)
    expect((await inv.listDiscrepancies({ auditId: audit })).rows).toEqual([])
    env.as(U.reviewer)
    const bad = await attempt(() => inv.requestApproval({ entityType: 'recount_assignment', entityId: audit, proposal: { counter_id: U.counter } }, key()))
    expect(bad.ok).toBe(false)
    const rq = await inv.requestApproval({ entityType: 'recount_assignment', entityId: audit, proposal: { counter_id: U.keeper }, reason: 'variance' }, key())
    expect((await inv.getApprovalState('recount_assignment', audit)).status).toBe('pending')
    env.as(U.approver)
    expect((await inv.getApprovalState('recount_assignment', audit)).status).toBe('pending')
    env.as(U.adminB)
    expect(await inv.getApprovalState('recount_assignment', audit)).toBeNull()
    env.as(U.keeper)
    const kq = (await inv.listPendingApprovals({ country: 'KSA' })).rows.find((r) => r.id === rq.id)
    expect(kq ? kq.can_decide : false).toBe(false)
    for (const who of [U.counter, U.reviewer, U.keeper]) {
      env.as(who)
      const r = await attempt(() => inv.decideApproval({ requestId: rq.id, decision: 'approve' }, key()))
      expect(r.ok).toBe(false)
    }
    env.as(U.approver)
    const aq = (await inv.listPendingApprovals({ country: 'KSA' })).rows.find((r) => r.id === rq.id)
    expect(aq.can_decide).toBe(true)
    await inv.decideApproval({ requestId: rq.id, decision: 'approve' }, key())
    env.as(U.reviewer)
    expect((await inv.getApprovalState('recount_assignment', audit)).status).toBe('approved')
    const wrong = await attempt(() => inv.recountDiscrepancies({ auditId: audit, recounterId: U.site2Only, discrepancyIds: [disc.id] }, key()))
    expect(wrong.ok).toBe(false)
    await inv.recountDiscrepancies({ auditId: audit, recounterId: U.keeper, discrepancyIds: [disc.id] }, key())
    expect((await inv.getAudit(audit)).status).toBe('recount')
  })

  it('the recounter counts round 2; the adjustment needs an approved request and an approver who neither counted nor proposed', async () => {
    env.as(U.keeper)
    const view = await inv.getCounterView(audit)
    expect(JSON.stringify(view)).not.toMatch(EXPECTED_KEYS)
    await inv.submitCount({ auditId: audit, round: 2, deviceId: 'web-k', lines: [{ location_id: env.L.s1, item_id: BRAKE, counted_qty: 4, client_uuid: randomUUID() }] }, key())
    await inv.completeCounting(audit, key())
    env.as(U.reviewer)
    await inv.reconcileAudit(audit, key())
    const d2 = (await inv.listDiscrepancies({ auditId: audit, status: 'open' })).rows.find((r) => r.item_id === BRAKE)
    expect(n(d2.variance_qty)).toBe(-2)
    await inv.updateDiscrepancy(d2.id, { category: 'unrecorded_issue', status: 'proposed', investigation_notes: 'job card JC-9 not booked', proposed_qty: targetToCorrection(d2, 4) }, key())
    const d3 = (await inv.listDiscrepancies({ auditId: audit })).rows.find((r) => r.id === d2.id)
    expect([n(d3.proposed_qty), correctionToTarget(d3)]).toEqual([-2, '4']) // correct quantity 4 -> correction -2
    const adj = (await inv.listAdjustments({ discrepancyId: d2.id })).rows[0]
    expect(adj.status).toBe('proposed')
    expect(n(adj.qty_change)).toBe(-2)
    env.as(U.approver)
    const early = await attempt(() => inv.decideAdjustment({ adjustmentId: adj.id, decision: 'approve', note: 'x' }, key()))
    expect(early.ok).toBe(false)
    expect(early.error.message).toMatch(/approv/i)
    env.as(U.reviewer)
    const aq = await inv.requestApproval({ entityType: 'stock_adjustment', entityId: adj.id, reason: 'recount confirmed' }, key())
    for (const who of [U.counter, U.keeper, U.reviewer]) {
      env.as(who)
      expect((await attempt(() => inv.decideApproval({ requestId: aq.id, decision: 'approve' }, key()))).ok).toBe(false)
    }
    env.as(U.approver)
    await inv.decideApproval({ requestId: aq.id, decision: 'approve', note: 'agreed' }, key())
    env.as(U.counter)
    expect((await attempt(() => inv.decideAdjustment({ adjustmentId: adj.id, decision: 'approve', note: 'mine' }, key()))).ok).toBe(false)
    env.as(U.approver)
    expect((await attempt(() => inv.decideAdjustment({ adjustmentId: adj.id, decision: 'recount' }, key()))).error.code).toBe('INV_BAD_DECISION')
    const ok = await inv.decideAdjustment({ adjustmentId: adj.id, decision: 'approve', note: 'agreed' }, key())
    expect(ok.status).toBe('posted')
    env.as(U.keeper)
    const bal = (await inv.listBalances({ country: 'KSA', site: 'S1', search: 'BRK' })).rows.find((r) => r.id === sid)
    expect(n(bal.qty_on_hand)).toBe(4)
    expect((await env.api.sql('select status from inventory_approval_requests where id = $1', [aq.id]))[0].status).toBe('consumed')
    env.as(U.reviewer)
    // close refuses while anything is undecided; the zero-count line is closed with a reason, then the audit closes
    expect((await attempt(() => inv.closeAudit(audit, key()))).error.message).toMatch(/Every discrepancy/)
    const rest = (await inv.listDiscrepancies({ auditId: audit, status: 'open' })).rows
    for (const d of rest) {
      await inv.updateDiscrepancy(d.id, { category: 'unrecorded_issue', status: 'closed', investigation_notes: 'zero confirmed, no book quantity' }, key())
    }
    await inv.closeAudit(audit, key())
    expect((await inv.getAudit(audit)).status).toBe('closed')
    // after close the counter may read the result
    env.as(U.counter)
    expect((await inv.listDiscrepancies({ auditId: audit })).rows.length).toBeGreaterThan(0)
  })
})

describe('tyre custody: fit, removal, transfer, scrap reach tyre_items; tyre_records never written; a person decides a conflict', () => {
  let env
  beforeAll(async () => { env = await fresh() }, 60000)
  const HASH = "select md5(coalesce(string_agg(to_jsonb(t)::text, ',' order by id), '')) as h from public.tyre_records t"
  const state = async () => {
    env.as(U.reviewer)
    const before = (await env.api.sql(HASH))[0]
    const r = await inv.syncTyreItems({ country: 'KSA' }, key())
    expect(r.tyre_records_written).toBe(0)
    expect((await env.api.sql(HASH))[0]).toEqual(before)
    return (await inv.listTyreItems({ country: 'KSA', search: 'ZX9876543' })).rows[0]
  }

  it('derives each custody change from the outside module rows', async () => {
    await env.api.exec(`insert into tyre_records(organisation_id, country, site, serial_no, asset_no, tyre_position, status, issue_date, cost_per_tyre)
      values ('${ORG_A}','KSA','S1','ZX9876543','TM100','LHF1','Active','2026-01-01',1500)`)
    expect((await state()).custody_state).toBe('fitted')
    await env.api.exec(`update tyre_records set status = 'Removed', removal_date = '2026-03-01' where serial_no = 'ZX9876543'`)
    expect((await state()).custody_state).toBe('removed_pending')
    await env.api.exec(`insert into tyre_records(organisation_id, country, site, serial_no, asset_no, tyre_position, status, issue_date)
      values ('${ORG_A}','KSA','S1','ZX9876543','TM200','RHF1','Active','2026-03-05')`)
    const moved = await state()
    expect([moved.custody_state, moved.asset_no]).toEqual(['fitted', 'TM200'])
    await env.api.exec(`update tyre_records set status = 'Scrapped', removal_date = '2026-05-01' where serial_no = 'ZX9876543' and asset_no = 'TM200'`)
    await env.api.exec(`insert into tyre_status_marks(serial, mark_type, organisation_id, country, reason) values ('ZX9876543','scrap','${ORG_A}','KSA','bead damage')`)
    expect((await state()).custody_state).toBe('scrapped')
    env.as(U.keeper)
    const tyre = (await inv.listTyreItems({ country: 'KSA', search: 'ZX9876543' })).rows[0]
    expect(tyre.purchase_cost).toBeNull()
  })

  it('a scrapped-yet-active tyre becomes a conflict with evidence; only a person with a reason closes it, and nothing is corrected', async () => {
    await env.api.exec(`insert into tyre_records(organisation_id, country, site, serial_no, asset_no, tyre_position, status, issue_date)
      values ('${ORG_A}','KSA','S1','QQ1234567','TM300','LHF1','Active','2026-01-01');
      insert into tyre_status_marks(serial, mark_type, organisation_id, country, reason) values ('QQ1234567','scrap','${ORG_A}','KSA','sidewall cut')`)
    env.as(U.reviewer)
    const before = (await env.api.sql(HASH))[0]
    await inv.syncTyreItems({ country: 'KSA' }, key())
    const c = (await inv.listCustodyConflicts({ status: 'open' })).rows.find((r) => r.serial_no === 'QQ1234567')
    expect(c.conflict_type).toBe('scrapped_but_active')
    expect(c.evidence).toBeTruthy()
    env.as(U.keeper)
    expect((await attempt(() => inv.decideCustodyConflict({ conflictId: c.id, status: 'resolved', note: 'x' }, key()))).ok).toBe(false)
    env.as(U.reviewer)
    expect((await attempt(() => inv.decideCustodyConflict({ conflictId: c.id, status: 'resolved', note: '' }, key()))).error.code).toBe('INV_NO_NOTE')
    await inv.decideCustodyConflict({ conflictId: c.id, status: 'resolved', note: 'Scrap mark confirmed by workshop; fitment row to be corrected by the tyre team' }, key())
    expect((await inv.listCustodyConflicts({ status: 'open' })).rows.find((r) => r.serial_no === 'QQ1234567')).toBeUndefined()
    expect((await env.api.sql(HASH))[0]).toEqual(before)
  })
})

describe('supplier-owned vs company-owned stock; missing cost -> unvalued -> approved reconciliation', () => {
  let env
  beforeAll(async () => { env = await fresh() }, 60000)

  it('keeps supplier stock out of owned value and never counts unknown cost as zero', async () => {
    env.as(U.keeper)
    await inv.receiveGoods({ country: 'KSA', site: 'S1', grnNo: 'GRN-OWN', lines: [
      { item_id: BRAKE, location_id: env.L.s1, qty_received: 2, unit_cost: 50, currency: 'SAR' },
      { item_id: BRAKE, location_id: env.L.s1, qty_received: 3, ownership: 'supplier', owner_supplier_id: SUP },
      { item_id: FILTER, location_id: env.L.s1, qty_received: 4 },
    ] }, key())
    env.as(U.reviewer)
    const v = await inv.loadValuation({ country: 'KSA', site: 'S1' })
    const brakeOwned = v.rows.find((r) => r.item_id === BRAKE && r.ownership === 'owned')
    const brakeSupplier = v.rows.find((r) => r.item_id === BRAKE && r.ownership === 'supplier')
    const filter = v.rows.find((r) => r.item_id === FILTER)
    expect([n(brakeOwned.qty_on_hand), n(brakeOwned.valued_amount)]).toEqual([2, 100])
    expect(n(brakeSupplier.qty_on_hand)).toBe(3)
    expect([n(filter.unvalued_qty), filter.valuation_complete]).toEqual([4, false])
    expect(filter.valued_amount === null || n(filter.valued_amount) === 0).toBe(true)
    const snap = await inv.loadReportSnapshot({ country: 'KSA', site: 'S1' })
    expect(n(snap.rows[0].owned_valued_amount)).toBe(100)
    expect(snap.rows[0].valuation_complete).toBe(false)
  })

  it('a cost becomes known only through an approved reconciliation by another person', async () => {
    env.as(U.reviewer)
    const rec = (await inv.listCostReconciliations({ status: 'open', country: 'KSA' })).rows.find((r) => r.item_id === FILTER)
    expect(rec).toBeTruthy()
    expect((await attempt(() => inv.requestApproval({ entityType: 'cost_reconciliation', entityId: rec.id, proposal: { resolution: 'resolved', unit_cost: '' }, reason: 'x' }, key()))).error.code).toBe('INV_NO_COST')
    expect((await attempt(() => inv.reconcileCost({ reconciliationId: rec.id, note: 'x' }, key()))).ok).toBe(false)
    const rq = await inv.requestApproval({ entityType: 'cost_reconciliation', entityId: rec.id, proposal: { resolution: 'resolved', unit_cost: 9 }, evidence: [{ type: 'invoice', ref: 'INV-77' }] }, key())
    expect((await attempt(() => inv.decideApproval({ requestId: rq.id, decision: 'approve' }, key()))).ok).toBe(false)
    env.as(U.approver)
    await inv.decideApproval({ requestId: rq.id, decision: 'approve' }, key())
    env.as(U.reviewer)
    await inv.reconcileCost({ reconciliationId: rec.id, note: 'invoice INV-77' }, key())
    const v = (await inv.loadValuation({ country: 'KSA', site: 'S1' })).rows.find((r) => r.item_id === FILTER)
    expect([n(v.unvalued_qty), n(v.valued_amount), v.valuation_complete]).toEqual([0, 36, true])
  })
})

describe('mixed balance: no order assumed; undecided split decided by another person; tracked items name their receipt', () => {
  let env; let sid
  beforeAll(async () => {
    env = await fresh()
    env.as(U.keeper)
    await inv.receiveGoods({ country: 'KSA', site: 'S1', grnNo: 'GRN-M1', lines: [{ item_id: FILTER, location_id: env.L.s1, qty_received: 5, unit_cost: 10, currency: 'SAR' }] }, key())
    await inv.receiveGoods({ country: 'KSA', site: 'S1', grnNo: 'GRN-M2', lines: [{ item_id: FILTER, location_id: env.L.s1, qty_received: 3 }] }, key())
    sid = (await inv.listBalances({ country: 'KSA', site: 'S1', search: 'FLT' })).rows[0].id
  }, 60000)

  it('issue 7 of (5 known + 3 unknown): 4 at known cost, 2 at unknown, 1 undecided with no value', async () => {
    env.as(U.keeper)
    const i = await inv.issueStock({ stockId: sid, qty: 7, sourceDocType: 'work_order', sourceDocId: 'WO-7' }, key())
    expect([n(i.valued_qty_moved), n(i.unvalued_qty_moved), n(i.pending_allocation_qty)]).toEqual([4, 2, 1])
    expect(n(i.value_change)).toBe(-40)
    env.as(U.reviewer)
    const v = (await inv.loadValuation({ country: 'KSA', site: 'S1' })).rows.find((r) => r.stock_id === sid)
    expect(v.valuation_complete).toBe(false)
    expect(n(v.pending_allocation_qty)).toBe(1)
  })

  it('the split is proposed with evidence, decided by someone else, then posted', async () => {
    env.as(U.reviewer)
    const alloc = (await inv.listCostReconciliations({ status: 'open', country: 'KSA' })).rows.find((r) => r.kind === 'issue_allocation')
    expect(alloc).toBeTruthy()
    expect((await attempt(() => inv.requestApproval({ entityType: 'cost_reconciliation', entityId: alloc.id, proposal: { valued_qty: 2, max_qty: 1 }, reason: 'x' }, key()))).error.code).toBe('INV_BAD_SPLIT')
    const rq = await inv.requestApproval({ entityType: 'cost_reconciliation', entityId: alloc.id, proposal: { valued_qty: 1, max_qty: 1 }, evidence: [{ type: 'grn', ref: 'GRN-M1' }] }, key())
    expect((await attempt(() => inv.decideApproval({ requestId: rq.id, decision: 'approve' }, key()))).ok).toBe(false)
    env.as(U.approver)
    await inv.decideApproval({ requestId: rq.id, decision: 'approve' }, key())
    env.as(U.reviewer)
    await inv.reconcileCost({ reconciliationId: alloc.id, note: 'GRN-M1 batch label' }, key())
    const v = (await inv.loadValuation({ country: 'KSA', site: 'S1' })).rows.find((r) => r.stock_id === sid)
    expect(n(v.pending_allocation_qty)).toBe(0)
    expect(n(v.open_allocations || 0)).toBe(0)
  })

  it('a serial / lot tracked item on a mixed balance is refused in plain words until a receipt is named; the picker lists it', async () => {
    await env.api.exec(`update material_master set serial_tracked = true where id = '${BRAKE}'`)
    env.as(U.keeper)
    await inv.receiveGoods({ country: 'KSA', site: 'S1', grnNo: 'GRN-T1', lines: [{ item_id: BRAKE, location_id: env.L.s1, qty_received: 2, unit_cost: 30, currency: 'SAR' }] }, key())
    await inv.receiveGoods({ country: 'KSA', site: 'S1', grnNo: 'GRN-T2', lines: [{ item_id: BRAKE, location_id: env.L.s1, qty_received: 2 }] }, key())
    const bsid = (await inv.listBalances({ country: 'KSA', site: 'S1', search: 'BRK' })).rows[0].id
    const refused = await attempt(() => inv.issueStock({ stockId: bsid, qty: 1 }, key()))
    expect(refused.ok).toBe(false)
    expect(refused.error.message).toMatch(/Choose the goods receipt the units came from/)
    const src = await inv.listReceiptSources(bsid)
    expect(src.status).toBe('ok')
    expect(src.rows.map((r) => [n(r.remaining_qty), r.cost_known])).toEqual([[2, true], [2, false]])
    expect(src.rows[0].unit_cost).toBeNull()
    const ok = await inv.issueStock({ stockId: bsid, qty: 1, sourceReceiptMovementId: src.rows[0].movement_id }, key())
    expect([n(ok.valued_qty_moved), n(ok.unvalued_qty_moved), n(ok.pending_allocation_qty), n(ok.value_change)]).toEqual([1, 0, 0, -30])
    env.as(U.reviewer)
    const after = await inv.listReceiptSources(bsid)
    expect(after.rows.map((r) => [n(r.remaining_qty), r.unit_cost === null ? null : n(r.unit_cost)])).toEqual([[1, 30], [2, null]])
    env.as(U.keeper)
    const noSrc = await attempt(() => inv.dispatchTransfer({ fromLocationId: env.L.s1, toLocationId: env.L.s2, lines: [{ stock_id: bsid, qty: 1 }] }, key()))
    expect(noSrc.ok).toBe(false)
    const tr = await inv.dispatchTransfer({ fromLocationId: env.L.s1, toLocationId: env.L.s2, lines: [{ stock_id: bsid, qty: 1, source_receipt_movement_id: after.rows[1].movement_id }] }, key())
    expect(tr.transfer_id).toBeTruthy()
    const line = (await env.api.sql('select carried_value, carried_unvalued_qty from stock_transfer_lines where transfer_id = $1', [tr.transfer_id]))[0]
    expect([n(line.carried_value) || 0, n(line.carried_unvalued_qty)]).toEqual([0, 1])
  })
})
