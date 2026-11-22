// Tyre custody derived from tyre_records/tyre_status_marks (read-only), the scrap guard
// that flags but never blocks, and OEM compatibility approval (PGlite, synthetic data).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDb, call, q, one, id, U, ORG_A, code } from './inventory_harness.test.mjs'

const FILTER = id(100)
const HASH = "select md5(string_agg(to_jsonb(t)::text, ',' order by id)) as h, count(*)::int as n from public.tyre_records t"

async function seedTyres (db) {
  await db.exec(`insert into public.tyre_records(organisation_id, country, site, serial_no, asset_no, tyre_position, status,
      issue_date, removal_date, cost_per_tyre, brand, size, created_at) values
    ('${ORG_A}','KSA','S1','AB 1234567','TM100','LHF1','Active','2026-01-10',null,1200,'Brand A','315/80R22.5','2026-01-10'),
    ('${ORG_A}','KSA','S1','CD7654321','TM101','RHF1','Removed','2025-06-01','2026-02-01',900,'Brand B','315/80R22.5','2025-06-01'),
    ('${ORG_A}','KSA','S1','EF1111111','TM102','LHF1','Active','2026-03-01',null,1000,'Brand A','315/80R22.5','2026-03-01'),
    ('${ORG_A}','KSA','S1','GH2222222','TM103','LHF1','Active','2026-03-01',null,null,'Brand C','385/65R22.5','2026-03-01'),
    ('${ORG_A}','KSA','S1','GH2222222','TM104','RHF1','Active','2026-03-02',null,null,'Brand C','385/65R22.5','2026-03-02'),
    ('${ORG_A}','KSA','S1','1','TM105','LHF1','Active','2026-03-01',null,null,null,null,'2026-03-01')`)
  // a scrap mark on a serial that is still active = conflict, never auto-corrected
  await db.exec(`insert into public.tyre_status_marks(serial, mark_type, organisation_id, country, reason, created_at)
    values ('EF1111111','scrap','${ORG_A}','KSA','sidewall cut','2026-02-15')`)
}

test('tyre custody derivation, conflicts with evidence, read-only on tyre_records', async () => {
  const db = await buildDb()
  await seedTyres(db)
  const before = await one(db, HASH)

  await assert.rejects(call(db, U.viewer, 'inv_tyre_item_sync', {}), code('42501'))
  const r = await call(db, U.reviewer, 'inv_tyre_item_sync', { country: 'KSA' })
  assert.equal(r.tyre_records_written, 0)
  assert.equal(r.weak_serial_rows, 1, 'serial "1" is a placeholder and is not tracked individually')

  const items = Object.fromEntries((await q(db, 'select serial, custody_state, basis, asset_no, purchase_cost from public.tyre_items')).map(x => [x.serial, x]))
  assert.equal(items.AB1234567.custody_state, 'fitted', 'whitespace-canonicalised serial')
  assert.equal(items.AB1234567.asset_no, 'TM100')
  assert.equal(Number(items.AB1234567.purchase_cost), 1200, 'a tyre is valued at its own cost, not an average')
  assert.equal(items.CD7654321.custody_state, 'removed_pending', 'no disposition = removed pending, never assumed reusable')
  assert.equal(items.EF1111111.custody_state, 'unknown')
  assert.equal(items.EF1111111.basis, 'conflict')
  assert.equal(items.GH2222222.basis, 'conflict')
  assert.equal(items.GH2222222.purchase_cost, null, 'no price = no value, never 0')

  const conf = await q(db, 'select serial, conflict_type, status, evidence from public.tyre_custody_conflicts order by serial')
  assert.deepEqual(conf.map(c => [c.serial, c.conflict_type, c.status]),
    [['EF1111111', 'scrapped_but_active', 'open'], ['GH2222222', 'serial_on_two_assets', 'open']])
  assert.equal(conf[0].evidence.scrapMarks[0].reason, 'sidewall cut')
  assert.equal(conf[0].evidence.activeRows[0].asset_no, 'TM102')

  assert.deepEqual(await one(db, HASH), before, 'derivation writes nothing to tyre_records')

  const again = await call(db, U.reviewer, 'inv_tyre_item_sync', { country: 'KSA' })
  assert.equal(again.new_conflicts, 0, 're-run does not duplicate open conflicts')
  assert.equal(again.state_changes, 0)

  // a disposition is a recorded human decision; it then drives the derived state
  await assert.rejects(call(db, U.keeper, 'inv_tyre_disposition_record', { serial_no: 'CD7654321', country: 'KSA', state: 'scrapped', reason: 'x' }), code('42501'))
  await call(db, U.reviewer, 'inv_tyre_disposition_record', { serial_no: 'CD7654321', country: 'KSA', state: 'reusable', reason: 'tread 9mm, inspected' })
  await call(db, U.reviewer, 'inv_tyre_item_sync', { country: 'KSA' })
  assert.equal((await one(db, "select custody_state from public.tyre_items where serial='CD7654321'")).custody_state, 'reusable')

  // a conflict is closed by a person with a reason; the source rows are never edited
  const c = (await q(db, "select id from public.tyre_custody_conflicts where serial='GH2222222'"))[0]
  await assert.rejects(call(db, U.reviewer, 'inv_tyre_conflict_decide', { conflict_id: c.id, status: 'resolved' }), code('22023'))
  await call(db, U.reviewer, 'inv_tyre_conflict_decide', { conflict_id: c.id, status: 'resolved', note: 'TM103 row was a typo, checked on the vehicle' })
  assert.equal((await one(db, "select count(*)::int as n from public.tyre_records where serial_no='GH2222222' and status='Active'")).n, 2)
  assert.deepEqual(await one(db, HASH), before)

  await db.close()
})

test('scrap guard flags a new Active row for a scrapped serial and never blocks the write', async () => {
  const db = await buildDb()
  await db.exec(`insert into public.tyre_status_marks(serial, mark_type, organisation_id, country, reason)
    values ('ZZ9999999','scrap','${ORG_A}','KSA','burst')`)
  await db.exec(`insert into public.tyre_records(organisation_id, country, site, serial_no, asset_no, tyre_position, status)
    values ('${ORG_A}','KSA','S1','ZZ 9999999','TM200','LHF1','Active')`)
  assert.equal((await one(db, "select count(*)::int as n from public.tyre_records where asset_no='TM200'")).n, 1, 'the load is not blocked')
  const f = await one(db, "select conflict_type, detected_by, evidence from public.tyre_custody_conflicts where serial='ZZ9999999'")
  assert.equal(f.conflict_type, 'scrapped_but_active')
  assert.equal(f.detected_by, 'guard')
  assert.equal(f.evidence.scrapMarks[0].reason, 'burst')
  await db.exec(`insert into public.tyre_records(organisation_id, country, site, serial_no, asset_no, tyre_position, status)
    values ('${ORG_A}','KSA','S1','ZZ9999999','TM201','LHF1','Active')`)
  assert.equal((await one(db, "select count(*)::int as n from public.tyre_custody_conflicts where serial='ZZ9999999' and status='open'")).n, 1)
  await db.close()
})

test('OEM / fitment compatibility needs evidence and engineering approval by someone else', async () => {
  const db = await buildDb()
  await assert.rejects(call(db, U.approver, 'inv_compat_propose', { kind: 'oem', item_id: FILTER, oem_part_no: 'X-1', source: 'manual' }), code('22023'))
  await assert.rejects(call(db, U.viewer, 'inv_compat_propose', { kind: 'oem', item_id: FILTER, oem_part_no: 'X-1', source: 'manual', evidence: [{ page: 4 }] }), code('42501'))
  const oem = (await call(db, U.approver, 'inv_compat_propose', { kind: 'oem', country: 'KSA', item_id: FILTER, oem_part_no: 'MB-A0001', manufacturer: 'Mercedes', source: 'parts manual 2024', evidence: [{ page: 112 }] })).id
  const fit = (await call(db, U.engineer, 'inv_compat_propose', { kind: 'fitment', country: 'KSA', item_id: FILTER, make: 'Mercedes', model: 'Actros', source: 'workshop test', evidence: [{ wo: 'GCKR/1' }] })).id

  assert.equal((await one(db, 'select count(*)::int as n from public.v_validated_compatibility')).n, 0, 'nothing counts until approved')
  await assert.rejects(call(db, U.approver, 'inv_compat_decide', { kind: 'oem', id: oem, decision: 'approve' }), code('42501'))
  await assert.rejects(call(db, U.engineer, 'inv_compat_decide', { kind: 'fitment', id: fit, decision: 'approve' }), code('42501'))
  await call(db, U.engineer, 'inv_compat_decide', { kind: 'oem', id: oem, decision: 'approve' })
  assert.equal((await one(db, 'select count(*)::int as n from public.v_validated_compatibility')).n, 1)
  await db.close()
})
