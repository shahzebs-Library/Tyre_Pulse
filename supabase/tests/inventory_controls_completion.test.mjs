// Controls completion (20261120113000 approval roles, 114000 tyre conflict investigation,
// 115000 hardening) plus the architect review items: fingerprint guards, lifecycle
// mutability, legacy procurement RLS and cross-company id injection. PGlite, synthetic data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDb, MIGRATIONS, ROLLBACKS, sqlOf, rpc, call, q, one, id, U, ORG_A, ORG_B, code, asUser } from './inventory_harness.test.mjs'

const BRAKE = id(104)
const LIVE_VALIDATE_MD5 = 'b76c1c97d59bc5b384041b5f8b67c867'
const U2 = {
  pmv: id(20), tpe: id(21), uaeManager: id(22), finance: id(23), ctrl2: id(24), tdc1: id(25), tdc2: id(26), managerB: id(27),
}
const md5Of = (db, sig) => one(db, `select md5(replace(pg_get_functiondef($1::regprocedure), chr(13), '')) m`, [sig]).then(r => r.m)

async function seedPeople (db) {
  await db.exec(`insert into profiles(id, organisation_id, org_id, role, full_name, country, sites) values
    ('${U2.pmv}','${ORG_A}','${ORG_A}','PMV Manager','PMV',ARRAY['KSA'],ARRAY['ALL']),
    ('${U2.tpe}','${ORG_A}','${ORG_A}','Tire Planning Engineer','TPE',ARRAY['KSA'],ARRAY['ALL']),
    ('${U2.uaeManager}','${ORG_A}','${ORG_A}','Manager','UAE manager',ARRAY['UAE'],ARRAY['ALL']),
    ('${U2.finance}','${ORG_A}','${ORG_A}','Finance Manager','Finance',ARRAY['KSA'],ARRAY['ALL']),
    ('${U2.ctrl2}','${ORG_A}','${ORG_A}','Inventory Controller','Controller 2',ARRAY['KSA'],ARRAY['ALL']),
    ('${U2.tdc1}','${ORG_A}','${ORG_A}','Tyre Data Collector','Central reviewer',ARRAY['KSA'],ARRAY['ALL']),
    ('${U2.tdc2}','${ORG_A}','${ORG_A}','Tyre Data Collector','Western reviewer',ARRAY['KSA'],ARRAY['ALL']),
    ('${U2.managerB}','${ORG_B}','${ORG_B}','Manager','Manager B',ARRAY['KSA'],ARRAY['ALL'])`)
  await db.exec(`insert into test_caps values ('${U2.pmv}','scrap_approve'),('${U2.uaeManager}','adjustment_approve'),
    ('${U2.finance}','adjustment_approve'),('${U2.ctrl2}','adjustment_approve'),('${U.approver}','financial_post'),
    ('${U2.managerB}','adjustment_approve')`)
  await db.exec(`insert into sites(name, country, organisation_id, region, active) values
    ('NHC','KSA','${ORG_A}','CENTRAL',true),('JED','KSA','${ORG_A}','WESTERN',true),('S1','KSA','${ORG_A}','CENTRAL',true)`)
}

// The three live approval policies (shape read from production 2026-11-20; people synthetic).
const LIVE_POLICIES = () => `insert into approval_policies(id, organisation_id, name, entity_type, state, match_country, match_region, stages) values
  ('${id(700)}','${ORG_A}','KSA Central tyre inspections','inspection','draft','KSA','CENTRAL',
   '[{"name":"Central region sign-off","approver_user_id":"${U2.tdc1}","distinct_reviewer":true,"require_signature":true,"prevent_self_approval":true}]'),
  ('${id(701)}','${ORG_A}','KSA Western tyre inspections','inspection','draft','KSA','WESTERN',
   '[{"name":"Western region sign-off","approver_user_id":"${U2.tdc2}","distinct_reviewer":true,"require_signature":true,"prevent_self_approval":true}]'),
  ('${id(702)}','${ORG_A}','All other tyre inspections','inspection','draft',null,null,
   '[{"name":"Admin sign-off","approver_role":"Admin","distinct_reviewer":true,"require_signature":true,"prevent_self_approval":true}]')`

async function validateAll (db) {
  const out = []
  for (const r of await q(db, 'select id from approval_policies order by id')) {
    try { await q(db, 'select approval_private.validate_policy(p) from approval_policies p where p.id = $1', [r.id]); out.push([r.id, 'ok']) } catch (e) { out.push([r.id, e.message]) }
  }
  return out
}

test('validate_policy: the 3 live inspection policies validate identically before and after; inventory roles routed', async t => {
  const upTo = MIGRATIONS.indexOf('20261120113000_inv_approval_roles.sql')
  const before = await buildDb({ upTo })
  await seedPeople(before)
  await before.exec(LIVE_POLICIES())
  // a deliberately wrong inspection policy (Store Keeper may not sign inspections today)
  await before.exec(`insert into approval_policies(id, organisation_id, name, entity_type, stages) values
    ('${id(703)}','${ORG_A}','bad','inspection','[{"name":"x","approver_role":"Store Keeper"}]')`)
  assert.equal(await md5Of(before, 'approval_private.validate_policy(approval_policies)'), LIVE_VALIDATE_MD5, 'harness copy is the live body')
  const vBefore = await validateAll(before)
  await before.close()

  const db = await buildDb()
  try {
    await seedPeople(db)
    await db.exec(LIVE_POLICIES())
    await db.exec(`insert into approval_policies(id, organisation_id, name, entity_type, stages) values
      ('${id(703)}','${ORG_A}','bad','inspection','[{"name":"x","approver_role":"Store Keeper"}]')`)
    assert.deepEqual(await validateAll(db), vBefore)
    assert.deepEqual(vBefore.slice(0, 3).map(x => x[1]), ['ok', 'ok', 'ok'])

    await t.test('inventory stages: Inventory Controller / Finance Manager accepted, Store Keeper never', async () => {
      const ins = async (pid, type, stage) => db.exec(`insert into approval_policies(id, organisation_id, name, entity_type, match_country, stages)
        values ('${pid}','${ORG_A}','inv','${type}','KSA','[${JSON.stringify(stage)}]')`)
      const v = pid => q(db, 'select approval_private.validate_policy(p) from approval_policies p where p.id = $1', [pid])
      await ins(id(710), 'inventory_stock_adjustment', { name: 'Controller', approver_role: 'Inventory Controller' })
      await v(id(710))
      await ins(id(711), 'inventory_cost_reconciliation', { name: 'Finance', approver_role: 'Finance Manager' })
      await v(id(711))
      await ins(id(712), 'inventory_opening_balance_batch', { name: 'Keeper', approver_role: 'Store Keeper' })
      await assert.rejects(v(id(712)), /no active approver/)
      await ins(id(713), 'inventory_cost_reconciliation', { name: 'Named keeper', approver_user_id: U.keeper })
      await assert.rejects(v(id(713)), /no active approver/, 'a named Store Keeper is refused too')
      await ins(id(714), 'inventory_cost_reconciliation', { name: 'Controller on cost', approver_role: 'Inventory Controller' })
      await assert.rejects(v(id(714)), /no active approver/, 'cost reconciliation is a finance decision')
      await ins(id(715), 'inventory_stock_adjustment', { name: 'UAE only manager', approver_user_id: U2.uaeManager })
      await assert.rejects(v(id(715)), /no active approver/, 'approver outside the policy country')
    })

    await t.test('role records added to custom_roles only; rollback restores the live function byte for byte', async () => {
      const roles = await q(db, "select organisation_id, name from custom_roles where name in ('Inventory Controller','Finance Manager') order by 1, 2")
      assert.equal(roles.length, 4, 'two roles for each of the two companies')
      assert.notEqual(await md5Of(db, 'approval_private.validate_policy(approval_policies)'), LIVE_VALIDATE_MD5)
      for (const f of [...ROLLBACKS].reverse().slice(0, 3)) await db.exec(sqlOf(f).replace(/^begin;/m, "begin;\nset local inv.rollback_discard = 'on';"))
      assert.equal(await md5Of(db, 'approval_private.validate_policy(approval_policies)'), LIVE_VALIDATE_MD5)
      // roles a user holds are kept (company A); unused ones are removed (company B)
      const left = await q(db, "select organisation_id, name from custom_roles where name in ('Inventory Controller','Finance Manager')")
      assert.deepEqual(left.map(r => r.organisation_id), [ORG_A, ORG_A])
      assert.deepEqual((await validateAll(db)).filter(x => x[0] <= id(703)), vBefore)
    })
  } finally { await db.close() }
})

test('fingerprint guard: an in-place patch aborts cleanly when the function is not the reviewed one', async () => {
  const upTo = MIGRATIONS.indexOf('20261120113000_inv_approval_roles.sql')
  const db = await buildDb({ upTo })
  try {
    // somebody changed the live function (same anchor still present): the migration must refuse
    const def = (await one(db, "select pg_get_functiondef('approval_private.validate_policy(approval_policies)'::regprocedure) d")).d
    await db.exec(def.replace("'Use one to five ordered stages'", "'Use 1 to 5 ordered stages'"))
    await assert.rejects(db.exec(sqlOf('20261120113000_inv_approval_roles.sql')), /differs from the reviewed definition/)
    await db.exec('rollback')
    assert.equal((await q(db, "select 1 from pg_proc where proname = 'inv_approver_roles'")).length, 0, 'nothing half-applied')
    // 112000 carries the same guard
    const db2 = await buildDb({ upTo: MIGRATIONS.indexOf('20261120112000_inv_source_receipt.sql') })
    const d2 = (await one(db2, "select pg_get_functiondef('public._inv_issue(jsonb)'::regprocedure) d")).d
    await db2.exec(d2.replace('begin', 'begin\n  -- edited outside the release'))
    await assert.rejects(db2.exec(sqlOf('20261120112000_inv_source_receipt.sql')), /differs from the reviewed definition/)
    await db2.close()
  } finally { await db.close() }
})

// Opening balance batch prepared by `uid` with one line.
async function batch (db, uid, ref, qty, unitCost, L) {
  const cb = await call(db, uid, 'inv_opening_batch_create', { country: 'KSA', site: 'S1', reference: ref, source: 'manual',
    lines: [{ item_id: BRAKE, location_id: L, qty, unit_cost: unitCost }] })
  const b = cb.batch_id ?? cb.id
  for (const l of await q(db, 'select id from opening_balance_lines where batch_id = $1', [b])) {
    await call(db, uid, 'inv_opening_line_map', { line_id: l.id, mapping_status: 'mapped', item_id: BRAKE, location_id: L, qty, unit_cost: unitCost })
  }
  await call(db, uid, 'inv_opening_batch_submit', { batch_id: b })
  return b
}

test('approval authority: Store Keeper, multi-role preparer, scope, thresholds and escalation (DB enforced)', async t => {
  const db = await buildDb()
  try {
    await seedPeople(db)
    const L = (await call(db, U.admin, 'inv_location_upsert', { country: 'KSA', site: 'S1', location_type: 'warehouse', code: 'WH1' })).id

    await t.test('valid approver accepted on the default route', async () => {
      const b = await batch(db, U.keeper, 'OB-1', 2, 30, L)
      const rq = await call(db, U.keeper, 'inv_request_approval', { entity_type: 'opening_balance_batch', entity_id: b })
      const ok = await call(db, U.approver, 'inv_approval_decide', { request_id: rq.id, decision: 'approve' })
      assert.equal(ok.status, 'approved')
    })

    await t.test('Store Keeper refused at the approval stage, even when a policy names them and they hold the capability', async () => {
      // policy names a controller; the controller is later re-roled to Store Keeper
      await db.exec(`insert into approval_policies(organisation_id, name, entity_type, state, effective_at, stages) values
        ('${ORG_A}','OB by person','inventory_opening_balance_batch','published', now() - interval '1 minute',
         '[{"name":"Controller","approver_user_id":"${U2.ctrl2}","require_signature":false}]')`)
      const b = await batch(db, U.keeper, 'OB-2', 1, 30, L)
      const rq = await call(db, U.keeper, 'inv_request_approval', { entity_type: 'opening_balance_batch', entity_id: b })
      assert.equal(rq.route_source, 'policy')
      await db.exec(`update profiles set role = 'Store Keeper' where id = '${U2.ctrl2}'`)
      await assert.rejects(call(db, U2.ctrl2, 'inv_approval_decide', { request_id: rq.id, decision: 'approve' }), /store_keeper_cannot_approve/)
      await db.exec(`update profiles set role = 'Inventory Controller' where id = '${U2.ctrl2}'`)
      assert.equal((await call(db, U2.ctrl2, 'inv_approval_decide', { request_id: rq.id, decision: 'approve' })).status, 'approved')
      await db.exec("delete from approval_policies where name = 'OB by person'")
      // a Store Keeper with every capability, on the default route
      await db.exec(`insert into test_caps values ('${U.counter}','financial_post'),('${U.counter}','view_value'),('${U.counter}','discrepancy_review') on conflict do nothing`)
      const b2 = await batch(db, U.keeper, 'OB-3', 1, 30, L)
      const rq2 = await call(db, U.keeper, 'inv_request_approval', { entity_type: 'opening_balance_batch', entity_id: b2 })
      await assert.rejects(call(db, U.counter, 'inv_approval_decide', { request_id: rq2.id, decision: 'approve' }), code('42501'))
    })

    await t.test('multi-role / multi-capability preparer can never approve their own transaction', async () => {
      await db.exec(`insert into test_caps values ('${U.approver}','receive'),('${U.approver}','count') on conflict do nothing`)
      const b = await batch(db, U.approver, 'OB-4', 1, 30, L)
      const rq = await call(db, U.approver, 'inv_request_approval', { entity_type: 'opening_balance_batch', entity_id: b })
      await assert.rejects(call(db, U.approver, 'inv_approval_decide', { request_id: rq.id, decision: 'approve' }), /segregation_of_duties/)
      // the same person promoted to Admin is still the preparer
      await db.exec(`update profiles set role = 'Admin' where id = '${U.approver}'`)
      await assert.rejects(call(db, U.approver, 'inv_approval_decide', { request_id: rq.id, decision: 'approve' }), /segregation_of_duties/)
      await db.exec(`update profiles set role = 'Manager' where id = '${U.approver}'`)
    })

    await t.test('out-of-scope approver refused (another country; another company)', async () => {
      const b = await batch(db, U.keeper, 'OB-5', 1, 30, L)
      const rq = await call(db, U.keeper, 'inv_request_approval', { entity_type: 'opening_balance_batch', entity_id: b })
      await assert.rejects(call(db, U2.uaeManager, 'inv_approval_decide', { request_id: rq.id, decision: 'approve' }), /out_of_scope/)
      await assert.rejects(call(db, U2.managerB, 'inv_approval_decide', { request_id: rq.id, decision: 'approve' }), code('P0002'))
    })

    await t.test('thresholds: under the limit approves; above escalates to a higher limit; unknown value never passes a cap', async () => {
      await assert.rejects(call(db, U.approver, 'inv_approval_limit_upsert', { entity_type: 'opening_balance_batch', approver_role: 'Manager', max_value: 100 }), code('42501'))
      await assert.rejects(call(db, U.admin, 'inv_approval_limit_upsert', { entity_type: 'opening_balance_batch', approver_role: 'Store Keeper', max_value: 100 }), code('22023'))
      await call(db, U.admin, 'inv_approval_limit_upsert', { entity_type: 'opening_balance_batch', approver_role: 'Manager', max_value: 100, currency: 'SAR', max_qty: 5 })
      await call(db, U.admin, 'inv_approval_limit_upsert', { entity_type: 'opening_balance_batch', approver_role: 'Admin' })
      const small = await batch(db, U.keeper, 'OB-6', 2, 30, L) // 60 SAR
      const r1 = await call(db, U.keeper, 'inv_request_approval', { entity_type: 'opening_balance_batch', entity_id: small })
      assert.equal((await call(db, U.approver, 'inv_approval_decide', { request_id: r1.id, decision: 'approve' })).status, 'approved')
      const big = await batch(db, U.keeper, 'OB-7', 4, 300, L) // 1,200 SAR
      const r2 = await call(db, U.keeper, 'inv_request_approval', { entity_type: 'opening_balance_batch', entity_id: big })
      await assert.rejects(call(db, U.approver, 'inv_approval_decide', { request_id: r2.id, decision: 'approve' }), /above_threshold: value/)
      const pend = await asUser(db, U.approver, () => one(db, 'select can_decide, blocked_reason from v_inv_pending_approvals where id = $1', [r2.id]))
      assert.equal(pend.can_decide, false); assert.match(pend.blocked_reason, /above_threshold/)
      assert.equal((await call(db, U.admin, 'inv_approval_decide', { request_id: r2.id, decision: 'approve' })).status, 'approved', 'escalated')
      const many = await batch(db, U.keeper, 'OB-8', 9, 1, L) // 9 units, 9 SAR
      const r3 = await call(db, U.keeper, 'inv_request_approval', { entity_type: 'opening_balance_batch', entity_id: many })
      await assert.rejects(call(db, U.approver, 'inv_approval_decide', { request_id: r3.id, decision: 'approve' }), /above_threshold: quantity/)
      const unpriced = await batch(db, U.keeper, 'OB-9', 1, null, L)
      const r4 = await call(db, U.keeper, 'inv_request_approval', { entity_type: 'opening_balance_batch', entity_id: unpriced })
      await assert.rejects(call(db, U.approver, 'inv_approval_decide', { request_id: r4.id, decision: 'approve' }), /value is not known/)
      // a role with no limit row once limits exist for the type
      await db.exec(`update profiles set role = 'Director' where id = '${U2.finance}'`)
      await assert.rejects(call(db, U2.finance, 'inv_approval_decide', { request_id: r4.id, decision: 'approve' }), /no approval limit/)
      await db.exec(`update profiles set role = 'Finance Manager' where id = '${U2.finance}'`)
    })
  } finally { await db.close() }
})

// Two scrap-marked serials that are still Active in tyre records (synthetic).
async function tyreSetup (db) {
  await db.exec(`insert into public.tyre_records(id, organisation_id, country, site, serial_no, asset_no, tyre_position, status, issue_date) values
      ('${id(800)}','${ORG_A}','KSA','S1','EF1111111','TM101','RHF1','Active','2026-06-16'),
      ('${id(801)}','${ORG_A}','KSA','S1',null,'TM101','RHF1','Scrapped','2025-11-10'),
      ('${id(802)}','${ORG_A}','KSA','S1','EF2222222','TM102','RHCI','Active','2026-02-28')`)
  await db.exec(`insert into public.tyre_status_marks(serial, mark_type, organisation_id, country, reason) values
      ('EF1111111','scrap','${ORG_A}','KSA',null),('EF2222222','scrap','${ORG_A}','KSA','cut')`)
  await call(db, U.reviewer, 'inv_tyre_item_sync', { country: 'KSA' })
  return Object.fromEntries((await q(db, "select serial, id from tyre_custody_conflicts where conflict_type = 'scrapped_but_active'")).map(r => [r.serial, r.id]))
}
const TYRE_HASH = `select (select md5(string_agg(to_jsonb(t)::text, ',' order by id)) from tyre_records t) tr,
  (select md5(string_agg(to_jsonb(m)::text, ',' order by id)) from tyre_status_marks m) tm`

test('tyre conflict investigation: engineer investigates, independent PMV Manager approves, decision only', async t => {
  const db = await buildDb()
  try {
    await seedPeople(db)
    const C = await tyreSetup(db)
    const before = await one(db, TYRE_HASH)

    await t.test('the direct decide path is closed for scrapped-but-active', async () => {
      await assert.rejects(call(db, U.reviewer, 'inv_tyre_conflict_decide', { conflict_id: C.EF1111111, status: 'resolved', note: 'looks fine' }), /investigation/)
    })

    await t.test('assignment: only a manager role assigns, only a Tyre / PMV Engineering user investigates', async () => {
      await assert.rejects(call(db, U.keeper, 'inv_tyre_conflict_assign', { conflict_id: C.EF1111111, investigator_id: U2.tpe }), code('42501'))
      await assert.rejects(call(db, U.admin, 'inv_tyre_conflict_assign', { conflict_id: C.EF1111111, investigator_id: U.keeper }), /Engineering/)
      await assert.rejects(call(db, U2.managerB, 'inv_tyre_conflict_assign', { conflict_id: C.EF1111111, investigator_id: U2.tpe }), code('P0002'), 'another company')
      const a = await call(db, U2.pmv, 'inv_tyre_conflict_assign', { conflict_id: C.EF1111111, investigator_id: U2.tpe, note: 'please check TM101' })
      assert.equal(a.investigation_status, 'investigating')
    })

    let req
    await t.test('findings then a proposal opens an approval request; only the investigator acts', async () => {
      await assert.rejects(call(db, U.admin, 'inv_tyre_conflict_investigate', { conflict_id: C.EF1111111, note: 'x' }), /assigned investigator/)
      await assert.rejects(call(db, U2.tpe, 'inv_tyre_conflict_propose', { conflict_id: C.EF1111111, correction: { action: 'clear_scrap_mark', detail: 'x' } }), /finding/)
      await call(db, U2.tpe, 'inv_tyre_conflict_investigate', { conflict_id: C.EF1111111,
        note: 'Scrapped row TM101 RHF1 removed on the day the Active row was fitted, same job card', evidence: [{ type: 'job_card', ref: 'JC-1' }] })
      await assert.rejects(call(db, U2.tpe, 'inv_tyre_conflict_propose', { conflict_id: C.EF1111111, correction: { action: 'delete_everything', detail: 'x' } }), code('22023'))
      const p = await call(db, U2.tpe, 'inv_tyre_conflict_propose', { conflict_id: C.EF1111111,
        correction: { action: 'clear_scrap_mark', detail: 'Scrap mark belongs to the removed tyre; serial was stamped on it', tyre_record_id: id(801) } })
      assert.equal(p.investigation_status, 'proposed'); req = p.approval_request_id
      assert.equal((await one(db, 'select status from tyre_custody_conflicts where id = $1', [C.EF1111111])).status, 'open', 'stays open until closed')
    })

    await t.test('approval: investigator refused, Admin refused (not PMV Manager), PMV Manager approves', async () => {
      await assert.rejects(call(db, U2.tpe, 'inv_approval_decide', { request_id: req, decision: 'approve' }), /segregation_of_duties|not_stage_approver/)
      await assert.rejects(call(db, U.admin, 'inv_approval_decide', { request_id: req, decision: 'approve' }), /not_stage_approver|role_not_authorised/)
      await assert.rejects(call(db, U.keeper, 'inv_tyre_conflict_close', { conflict_id: C.EF1111111 }), code('42501'))
      await assert.rejects(call(db, U2.pmv, 'inv_tyre_conflict_close', { conflict_id: C.EF1111111 }), /approved correction/)
      await call(db, U2.pmv, 'inv_approval_decide', { request_id: req, decision: 'approve' })
      assert.equal((await one(db, 'select investigation_status from tyre_custody_conflicts where id = $1', [C.EF1111111])).investigation_status, 'approved')
    })

    await t.test('PMV Manager who investigated can never approve (keyed on user id)', async () => {
      await db.exec(`update profiles set role = 'Tire Planning Engineer' where id = '${U2.pmv}'`)
      await call(db, U.admin, 'inv_tyre_conflict_assign', { conflict_id: C.EF2222222, investigator_id: U2.pmv })
      await call(db, U2.pmv, 'inv_tyre_conflict_investigate', { conflict_id: C.EF2222222, note: 'checked the vehicle' })
      const p = await call(db, U2.pmv, 'inv_tyre_conflict_propose', { conflict_id: C.EF2222222, correction: { action: 'no_change', detail: 'two tyres' } })
      await db.exec(`update profiles set role = 'PMV Manager' where id = '${U2.pmv}'`)
      await assert.rejects(call(db, U2.pmv, 'inv_approval_decide', { request_id: p.approval_request_id, decision: 'approve' }), /segregation_of_duties/)
      // rejection by another PMV Manager sends it back for re-work
      await db.exec(`insert into profiles(id, organisation_id, org_id, role, full_name, country, sites) values ('${id(28)}','${ORG_A}','${ORG_A}','PMV Manager','PMV 2',ARRAY['KSA'],ARRAY['ALL'])`)
      await db.exec(`insert into test_caps values ('${id(28)}','scrap_approve')`)
      await assert.rejects(call(db, id(28), 'inv_approval_decide', { request_id: p.approval_request_id, decision: 'reject' }), code('22023'), 'a rejection needs a note')
      await call(db, id(28), 'inv_approval_decide', { request_id: p.approval_request_id, decision: 'reject', note: 'evidence missing' })
      assert.equal((await one(db, 'select investigation_status from tyre_custody_conflicts where id = $1', [C.EF2222222])).investigation_status, 'rejected')
      const again = await call(db, U2.pmv, 'inv_tyre_conflict_propose', { conflict_id: C.EF2222222, correction: { action: 'no_change', detail: 'photo attached' } })
      assert.equal(again.investigation_status, 'proposed')
    })

    await t.test('close records the decision; no tyre record or scrap mark changed', async () => {
      const c = await call(db, U2.pmv, 'inv_tyre_conflict_close', { conflict_id: C.EF1111111 })
      assert.equal(c.investigation_status, 'closed'); assert.equal(c.decision.action, 'clear_scrap_mark')
      const row = await one(db, 'select status, investigation_status, decided_correction from tyre_custody_conflicts where id = $1', [C.EF1111111])
      assert.deepEqual([row.status, row.investigation_status], ['resolved', 'closed'])
      assert.deepEqual(await one(db, TYRE_HASH), before, 'tyre_records and tyre_status_marks untouched')
      assert.equal((await one(db, "select count(*)::int n from tyre_item_events where event_type = 'conflict_resolved'")).n, 1)
      // a re-sync does not reopen or duplicate
      await call(db, U.reviewer, 'inv_tyre_item_sync', { country: 'KSA' })
      assert.equal((await one(db, "select count(*)::int n from tyre_custody_conflicts where serial = 'EF2222222'")).n, 1)
    })

    await t.test('case rows change only through the lifecycle (graph, no delete, no direct API write)', async () => {
      for (const uid of [U.admin, U.super]) {
        await assert.rejects(asUser(db, uid, () => db.exec(`update tyre_custody_conflicts set investigation_status = 'closed' where id = '${C.EF2222222}'`)), /permission denied/)
        await assert.rejects(asUser(db, uid, () => db.exec(`delete from tyre_custody_conflicts where id = '${C.EF2222222}'`)), /permission denied/)
      }
      await assert.rejects(db.exec(`update tyre_custody_conflicts set investigation_status = 'closed' where id = '${C.EF2222222}'`), /not allowed/)
      await assert.rejects(db.exec(`delete from tyre_custody_conflicts where id = '${C.EF2222222}'`), /never deleted/)
      await assert.rejects(db.exec(`update tyre_custody_conflicts set resolution_note = 'x' where id = '${C.EF1111111}'`), /final/)
    })
  } finally { await db.close() }
})

test('lifecycle mutability: approvals and cost reconciliations change only through their RPCs; ledgers append-only', async () => {
  const db = await buildDb()
  try {
    const L = (await call(db, U.admin, 'inv_location_upsert', { country: 'KSA', site: 'S1', location_type: 'warehouse', code: 'WH1' })).id
    const mv = await rpc(db, U.keeper, 'inv_post_movement', [JSON.stringify({ idempotency_key: 'lc-1', item_id: BRAKE, location_id: L, movement_type: 'receipt', qty_change: 2 })])
    const rec = (await one(db, "select id from inventory_cost_reconciliations where status = 'open'")).id
    await db.exec(`insert into test_caps values ('${U.approver}','financial_post')`)
    const rq = await call(db, U.reviewer, 'inv_request_approval', { entity_type: 'cost_reconciliation', entity_id: rec,
      proposal: { resolution: 'resolved', unit_cost: 5 }, evidence: [{ type: 'invoice', ref: 'I-1' }] })
    for (const uid of [U.reviewer, U.admin, U.super]) {
      for (const sql of [`update inventory_approval_requests set status = 'approved' where id = '${rq.id}'`,
        `delete from inventory_approval_requests where id = '${rq.id}'`,
        `update inventory_cost_reconciliations set status = 'written_off' where id = '${rec}'`,
        `delete from inventory_cost_reconciliations where id = '${rec}'`,
        `update stock_movements set qty_change = 0 where id = '${mv.movement_id}'`,
        `delete from stock_movements where id = '${mv.movement_id}'`,
        `delete from inventory_approval_decisions`]) {
        await assert.rejects(asUser(db, uid, () => db.exec(sql)), /permission denied|append-only/, `${uid}: ${sql}`)
      }
    }
    // even the table owner follows the graph
    await assert.rejects(db.exec(`update inventory_approval_requests set status = 'consumed' where id = '${rq.id}'`), /not allowed/)
    await assert.rejects(db.exec(`delete from inventory_approval_requests where id = '${rq.id}'`), /never deleted/)
    await assert.rejects(db.exec(`delete from inventory_cost_reconciliations where id = '${rec}'`), /never deleted/)
    await call(db, U.approver, 'inv_approval_decide', { request_id: rq.id, decision: 'approve' })
    await call(db, U.approver, 'inv_cost_reconcile', { reconciliation_id: rec })
    await assert.rejects(db.exec(`update inventory_cost_reconciliations set status = 'open' where id = '${rec}'`), /final/)
    await assert.rejects(db.exec(`update inventory_approval_requests set status = 'approved' where id = '${rq.id}'`), /final/)
  } finally { await db.close() }
})

test('the four pure helpers: no PUBLIC / anon EXECUTE; authenticated and the scrap trigger still work', async () => {
  const db = await buildDb()
  try {
    for (const sig of ['public._inv_posting_on()', 'public._inv_cap_for(text)', 'public.inv_movement_kind(text)', 'public.inv_canon_serial(text)']) {
      const r = await one(db, `select has_function_privilege('anon', $1::regprocedure, 'EXECUTE') a,
        has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') u,
        exists (select 1 from aclexplode((select proacl from pg_proc where oid = $1::regprocedure)) x where x.grantee = 0) pub`, [sig])
      assert.deepEqual([r.a, r.u, r.pub], [false, true, false], sig)
    }
    await assert.rejects(asUser(db, null, async () => { await db.exec('set role anon'); return db.query("select public.inv_canon_serial('a b')") }), /permission denied/)
    await db.exec("insert into tyre_status_marks(serial, mark_type, organisation_id, country) values ('ZZ7777777','scrap','" + ORG_A + "','KSA')")
    await asUser(db, U.admin, () => db.exec(`insert into tyre_records(organisation_id, country, serial_no, asset_no, tyre_position, status)
      values ('${ORG_A}','KSA','ZZ 7777777','TM9','LHF1','Active')`))
    assert.equal((await one(db, "select count(*)::int n from tyre_custody_conflicts where serial = 'ZZ7777777'")).n, 1, 'definer trigger still flags')
    assert.equal((await asUser(db, U.admin, () => one(db, "select public.inv_movement_kind('issue') k"))).k, 'out')
  } finally { await db.close() }
})

test('legacy procurement tables: company, country and site isolation hold after the policy replacement', async t => {
  const db = await buildDb()
  try {
    await db.exec(`insert into test_caps values ('${U.keeper}','procure'),('${U2.managerB ?? id(27)}','procure') on conflict do nothing`)
    await db.exec(`insert into profiles(id, organisation_id, org_id, role, full_name, country, sites) values ('${U2.managerB}','${ORG_B}','${ORG_B}','Manager','Manager B',ARRAY['KSA'],ARRAY['ALL']) on conflict do nothing`)
    await db.exec(`insert into test_caps values ('${U2.managerB}','procure'),('${U2.managerB}','receive') on conflict do nothing`)
    const A = {}
    A.po = (await one(db, `insert into purchase_orders(po_number, organisation_id, country, site) values ('PO-A','${ORG_A}','KSA','S1') returning id`)).id
    A.grn = (await one(db, `insert into goods_receipts(organisation_id, country, site, grn_no) values ('${ORG_A}','KSA','S1','GRN-A') returning id`)).id
    A.req = (await one(db, `insert into requisitions(organisation_id, country, site, item, created_by) values ('${ORG_A}','KSA','S1','x','${U.keeper}') returning id`)).id
    A.sup = id(200)
    A.mat = (await one(db, `insert into materials(organisation_id, country, name) values ('${ORG_A}','KSA','m') returning id`)).id
    const T = { purchase_orders: A.po, goods_receipts: A.grn, requisitions: A.req, suppliers: A.sup, materials: A.mat }
    const before = await one(db, `select md5(string_agg(x, ',' order by x)) h from (
      select 'po'||to_jsonb(p)::text x from purchase_orders p union all select 'gr'||to_jsonb(g)::text from goods_receipts g
      union all select 'rq'||to_jsonb(r)::text from requisitions r union all select 's'||to_jsonb(s)::text from suppliers s
      union all select 'm'||to_jsonb(m)::text from materials m) z`)

    await t.test('another company: SELECT sees nothing, INSERT for company A refused, UPDATE / DELETE touch nothing', async () => {
      for (const [tbl, rid] of Object.entries(T)) {
        const seen = await asUser(db, U2.managerB, () => q(db, `select id from ${tbl} where id = $1`, [rid]))
        assert.equal(seen.length, 0, `${tbl}: select`)
        const upd = await asUser(db, U2.managerB, () => q(db, `update ${tbl} set country = 'UAE' where id = $1 returning id`, [rid]).catch(() => []))
        assert.equal(upd.length, 0, `${tbl}: update`)
        const del = await asUser(db, U2.managerB, () => q(db, `delete from ${tbl} where id = $1 returning id`, [rid]).catch(() => []))
        assert.equal(del.length, 0, `${tbl}: delete`)
      }
      const ins = {
        purchase_orders: `insert into purchase_orders(po_number, organisation_id, country) values ('PO-X','${ORG_A}','KSA')`,
        goods_receipts: `insert into goods_receipts(organisation_id, country, grn_no) values ('${ORG_A}','KSA','G-X')`,
        requisitions: `insert into requisitions(organisation_id, country, item, created_by) values ('${ORG_A}','KSA','x','${U2.managerB}')`,
        suppliers: `insert into suppliers(supplier_name, organisation_id, country) values ('X','${ORG_A}','KSA')`,
        materials: `insert into materials(organisation_id, country, name) values ('${ORG_A}','KSA','x')`,
      }
      for (const [tbl, sql] of Object.entries(ins)) {
        await assert.rejects(asUser(db, U2.managerB, () => db.exec(sql)), /row-level security|permission denied/, `${tbl}: insert`)
      }
    })

    await t.test('same company, out of country / site scope: no write lands outside scope', async () => {
      // UAE-only keeper and site-2-only keeper (harness users) hold receive / issue
      await db.exec(`insert into test_caps values ('${U.uaeOnly}','procure'),('${U.site2Only}','procure') on conflict do nothing`)
      for (const uid of [U.uaeOnly, U.site2Only]) {
        for (const [tbl, rid] of Object.entries(T)) {
          const upd = await asUser(db, uid, () => q(db, `update ${tbl} set country = country where id = $1 returning id`, [rid]).catch(() => []))
          const del = await asUser(db, uid, () => q(db, `delete from ${tbl} where id = $1 returning id`, [rid]).catch(() => []))
          t.diagnostic(`${uid === U.uaeOnly ? 'UAE-only' : 'site-2-only'} ${tbl}: update ${upd.length}, delete ${del.length}`)
          assert.equal(del.length, 0, `${tbl}: an out-of-scope user deletes nothing`)
          // suppliers carry no site (live has no site policy on suppliers): a same-country user may edit them
          if (!(uid === U.site2Only && tbl === 'suppliers')) assert.equal(upd.length, 0, `${tbl}: out-of-scope update`)
        }
      }
    })

    assert.equal((await one(db, `select md5(string_agg(x, ',' order by x)) h from (
      select 'po'||to_jsonb(p)::text x from purchase_orders p union all select 'gr'||to_jsonb(g)::text from goods_receipts g
      union all select 'rq'||to_jsonb(r)::text from requisitions r union all select 's'||to_jsonb(s)::text from suppliers s
      union all select 'm'||to_jsonb(m)::text from materials m) z`)).h, before.h, 'company A rows untouched by company B')
  } finally { await db.close() }
})

test('cross-company id injection: every definer family refuses another company\'s record ids', async t => {
  const db = await buildDb()
  try {
    await seedPeople(db)
    // company B builds its own records
    const LB = (await call(db, U.adminB, 'inv_location_upsert', { country: 'KSA', site: 'S1', location_type: 'warehouse', code: 'WB1' })).id
    const LA = (await call(db, U.admin, 'inv_location_upsert', { country: 'KSA', site: 'S1', location_type: 'warehouse', code: 'WA1' })).id
    const mvB = await rpc(db, U.adminB, 'inv_post_movement', [JSON.stringify({ idempotency_key: 'b-1', item_id: id(103), location_id: LB, movement_type: 'receipt', qty_change: 5, unit_cost: 2 })])
    const stockB = mvB.stock_id
    const auditB = (await call(db, U.adminB, 'inv_audit_create', { country: 'KSA', site: 'S1', audit_type: 'partial', scope: { location_ids: [LB] } })).id
    const poB = (await one(db, `insert into purchase_orders(po_number, organisation_id, country, site) values ('PO-B','${ORG_B}','KSA','S1') returning id`)).id
    await db.exec(`insert into test_caps values ('${U.keeper}','procure'),('${U.admin}','procure') on conflict do nothing`)
    const recB = (await one(db, `select id from inventory_cost_reconciliations where organisation_id = '${ORG_B}' limit 1`))?.id
    const A = U.admin // company A super-capable user (Admin of A)
    const refused = /42501|P0002|not found|outside|Not authorised|permission|company|required|22023|23503|foreign key/i
    const cases = {
      ledger: () => rpc(db, A, 'inv_post_movement', [JSON.stringify({ idempotency_key: 'x1', stock_id: stockB, movement_type: 'issue', qty_change: -1 })]),
      ledger_location: () => rpc(db, A, 'inv_post_movement', [JSON.stringify({ idempotency_key: 'x2', item_id: id(100), location_id: LB, movement_type: 'receipt', qty_change: 1, unit_cost: 1 })]),
      reversal: () => call(db, A, 'inv_reverse_movement', { movement_id: mvB.movement_id, reason: 'x' }),
      reserve: () => call(db, A, 'inv_reserve', { stock_id: stockB, qty: 1 }),
      issue: () => call(db, A, 'inv_issue', { stock_id: stockB, qty: 1 }),
      issue_source_receipt: async () => {
        const a = await rpc(db, A, 'inv_post_movement', [JSON.stringify({ idempotency_key: 'x3', item_id: id(100), location_id: LA, movement_type: 'receipt', qty_change: 2, unit_cost: 1 })])
        return call(db, A, 'inv_issue', { stock_id: a.stock_id, qty: 1, source_receipt_movement_id: mvB.movement_id })
      },
      transfer: () => call(db, A, 'inv_transfer_dispatch', { from_location_id: LB, to_location_id: LA, lines: [{ stock_id: stockB, qty: 1 }] }),
      transfer_to_foreign: async () => {
        const a = await rpc(db, A, 'inv_post_movement', [JSON.stringify({ idempotency_key: 'x4', item_id: id(100), location_id: LA, movement_type: 'receipt', qty_change: 2, unit_cost: 1 })])
        return call(db, A, 'inv_transfer_dispatch', { from_location_id: LA, to_location_id: LB, lines: [{ stock_id: a.stock_id, qty: 1 }] })
      },
      audit_start: () => call(db, A, 'inv_audit_start', { audit_id: auditB }),
      audit_count: () => call(db, A, 'inv_count_submit', { audit_id: auditB, lines: [{ client_uuid: 'c-x', location_id: LB, item_id: id(103), counted_qty: 1 }] }),
      po_line: () => call(db, A, 'inv_po_add_line', { po_id: poB, item_id: id(100), qty_ordered: 1, unit_price: 1, location_id: LA }),
      receive_on_foreign_po: () => call(db, A, 'inv_receive_goods', { country: 'KSA', site: 'S1', po_id: poB, lines: [{ item_id: id(100), location_id: LA, qty_received: 1 }] }),
      approval_on_foreign_record: () => call(db, A, 'inv_request_approval', { entity_type: 'opening_balance_batch', entity_id: auditB }),
      tyre_case: () => call(db, A, 'inv_tyre_conflict_assign', { conflict_id: id(999), investigator_id: U.engineer }),
      location_parent: () => call(db, A, 'inv_location_upsert', { country: 'KSA', site: 'S1', location_type: 'bin', code: 'X1', parent_id: LB }),
      location_person: () => call(db, A, 'inv_location_upsert', { country: 'KSA', site: 'S1', location_type: 'bin', code: 'X2', responsible_user_id: U.adminB }),
      audit_reviewer: () => call(db, A, 'inv_audit_create', { country: 'KSA', site: 'S1', audit_type: 'partial', scope: { location_ids: [LA] }, reviewer_id: U.adminB }),
      audit_counter: async () => {
        const a = (await call(db, A, 'inv_audit_create', { country: 'KSA', site: 'S1', audit_type: 'partial', scope: { location_ids: [LA] } })).id
        return call(db, A, 'inv_audit_schedule', { audit_id: a, counter_id: U.adminB })
      },
      invoice_po: () => call(db, A, 'inv_supplier_invoice_create', { country: 'KSA', supplier_id: id(200), invoice_no: 'I-X', currency: 'SAR', po_id: poB, lines: [] }),
      invoice_item: () => call(db, A, 'inv_supplier_invoice_create', { country: 'KSA', supplier_id: id(200), invoice_no: 'I-Y', currency: 'SAR', lines: [{ item_id: id(103), qty: 1, unit_price: 1 }] }),
      receive_foreign_supplier: () => call(db, A, 'inv_receive_goods', { country: 'KSA', site: 'S1', supplier_id: id(201), lines: [{ item_id: id(100), location_id: LA, qty_received: 1, unit_cost: 1 }] }),
      // the client contract does not forward owner_supplier_id on create; a foreign id must not be stored
      opening_foreign_supplier: async () => {
        await call(db, A, 'inv_opening_batch_create', { country: 'KSA', site: 'S1', reference: 'OB-X', source: 'manual',
          lines: [{ item_id: id(100), location_id: LA, qty: 1, unit_cost: 1, ownership: 'consignment', owner_supplier_id: id(201) }] })
        if ((await q(db, `select 1 from opening_balance_lines where owner_supplier_id = '${id(201)}'`)).length) return 'stored'
        throw Object.assign(new Error('foreign supplier id not stored (not forwarded)'), { code: '42501' })
      },
      approval_limit_scope: () => call(db, A, 'inv_approval_limit_upsert', { entity_type: 'stock_adjustment', approver_role: 'Manager', country: 'UAE', max_value: 1 }),
    }
    if (recB) cases.cost_reconciliation = () => call(db, A, 'inv_cost_reconcile', { reconciliation_id: recB })
    const before = await one(db, `select (select md5(string_agg(to_jsonb(s)::text, ',' order by id)) from stock_records s where organisation_id = '${ORG_B}') s,
      (select count(*)::int from stock_movements where organisation_id = '${ORG_B}') m`)
    const leaks = []
    for (const [name, fn] of Object.entries(cases)) {
      try { await fn(); leaks.push(name) } catch (e) {
        if (!refused.test(`${e.code} ${e.message}`)) leaks.push(`${name}: unexpected ${e.message}`)
      }
      await db.exec('reset role').catch(() => {})
    }
    t.diagnostic(`families probed: ${Object.keys(cases).join(', ')}`)
    assert.deepEqual(leaks, [], 'no function accepted a company B id from a company A user')
    assert.deepEqual(await one(db, `select (select md5(string_agg(to_jsonb(s)::text, ',' order by id)) from stock_records s where organisation_id = '${ORG_B}') s,
      (select count(*)::int from stock_movements where organisation_id = '${ORG_B}') m`), before, 'company B data unchanged')
  } finally { await db.close() }
})
