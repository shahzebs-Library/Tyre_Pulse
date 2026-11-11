import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createCostAuditDb, asClient, asUser, ORG_A, U } from './fixtures/tyre_cost_harness.mjs'

// The tyre cost audit, end to end against the REAL migrations 20261112106000 + 107000:
// scan (dry then persist) -> decide -> apply (Admin only) -> undo (super admin), plus the
// security invariants Codex flagged on PR #484: a foreign-tenant admin cannot apply a finding
// against our tyre, and a finding cannot be hand-inserted already decided/applied (tcaf_insert).
// Fixtures seeded as the DB owner (RLS off) so the test exercises the RPCs, not the seed.

const TID = '00000000-0000-0000-0000-00000000aa01'
const LID = '00000000-0000-0000-0000-00000000bb01'

async function seedUnpricedTyre(db) {
  // A KSA tyre in org A with no cost, and the matching tyre store-issue line on its job card:
  // same month, same item code, unit price 900 (1800 / 2) -> a recoverable price.
  await db.exec(`
    insert into public.tyre_records (id, organisation_id, country, cost_per_tyre, job_card, issue_date, size, brand, serial_no, asset_no)
      values ('${TID}', '${ORG_A}', 'KSA', null, 'GCKR/JC/1', '2026-03-10', '315/80R22.5', 'TRIANGLE', 'YMY0001', 'TM001');
    insert into public.parts_consumption (id, organisation_id, country, work_order_no, item_code, event_date, item_description, qty_n, line_cost, cost_category)
      values ('${LID}', '${ORG_A}', 'KSA', 'GCKR/JC/1', '310100-O', '2026-03-10', 'TYRE 315/80R22.5 TRIANGLE TR691', 2, 1800, 'tyre');`)
}

async function firstFindingId(db) {
  const r = await db.query(`select id, class, proposed_cost from public.tyre_cost_audit_findings where tyre_id = '${TID}' order by first_seen limit 1`)
  return r.rows[0]
}

test('scan is a dry run first, then persists a proposed finding for a recoverable price', async () => {
  const db = await createCostAuditDb()
  await seedUnpricedTyre(db)

  const dry = await asClient(db, U.manager, () =>
    db.query(`select public.tyre_cost_audit_scan('KSA', '2025-01-01', '2026-12-31', true) v`))
  const d = dry.rows[0].v
  assert.equal(d.ok, true)
  assert.equal(d.dry_run, true)
  assert.equal(d.new_findings, null, 'a dry run never persists')
  assert.ok(d.checked >= 1)

  const persist = await asClient(db, U.manager, () =>
    db.query(`select public.tyre_cost_audit_scan('KSA', '2025-01-01', '2026-12-31', false) v`))
  assert.ok(persist.rows[0].v.new_findings >= 1, 'a non-dry scan persists findings')

  const f = await firstFindingId(db)
  assert.ok(['exact_match', 'same_month_item_match'].includes(f.class), `recoverable class, got ${f.class}`)
  assert.equal(Number(f.proposed_cost), 900)
  const s = await db.query(`select status from public.tyre_cost_audit_findings where id = '${f.id}'`)
  assert.equal(s.rows[0].status, 'proposed')
  await db.close?.()
})

test('decide then apply prices the tyre, logs a correction, and undo restores it', async () => {
  const db = await createCostAuditDb()
  await seedUnpricedTyre(db)
  await asClient(db, U.manager, () => db.query(`select public.tyre_cost_audit_scan('KSA','2025-01-01','2026-12-31',false)`))
  const f = await firstFindingId(db)

  // A Manager may decide but only an Admin may apply a financial correction.
  const decided = await asClient(db, U.manager, () =>
    db.query(`select public.tyre_cost_audit_decide(array['${f.id}']::uuid[], 'approved', null) v`))
  assert.equal(decided.rows[0].v.decided, 1)

  await assert.rejects(
    asClient(db, U.manager, () => db.query(`select public.tyre_cost_audit_apply(array['${f.id}']::uuid[])`)),
    /Only an Admin/, 'a Manager cannot apply')

  const applied = await asClient(db, U.admin, () =>
    db.query(`select public.tyre_cost_audit_apply(array['${f.id}']::uuid[]) v`))
  const res = applied.rows[0].v
  assert.equal(res.applied, 1)
  const batch = res.batch

  const priced = await db.query(`select cost_per_tyre from public.tyre_records where id = '${TID}'`)
  assert.equal(Number(priced.rows[0].cost_per_tyre), 900)
  const corr = await db.query(`select count(*)::int n from public.tyre_cost_corrections where batch_id = '${batch}'`)
  assert.equal(corr.rows[0].n, 1)
  const st = await db.query(`select status from public.tyre_cost_audit_findings where id = '${f.id}'`)
  assert.equal(st.rows[0].status, 'applied')

  // Undo is super-admin only and restores the exact prior value (NULL here).
  const undone = await asUser(db, U.superadmin, () =>
    db.query(`select public.tyre_cost_correction_undo('${batch}') v`))
  assert.equal(undone.rows[0].v.restored, 1)
  const back = await db.query(`select cost_per_tyre from public.tyre_records where id = '${TID}'`)
  assert.equal(back.rows[0].cost_per_tyre, null)
  await db.close?.()
})

test('a foreign-tenant admin cannot apply a finding against our tyre (org check is load-bearing)', async () => {
  const db = await createCostAuditDb()
  await seedUnpricedTyre(db)
  await asClient(db, U.manager, () => db.query(`select public.tyre_cost_audit_scan('KSA','2025-01-01','2026-12-31',false)`))
  const f = await firstFindingId(db)
  await asClient(db, U.manager, () => db.query(`select public.tyre_cost_audit_decide(array['${f.id}']::uuid[],'approved',null)`))

  // adminB belongs to ORG_B; apply must touch nothing (the todo CTE requires f.org = app_current_org()).
  const applied = await asClient(db, U.adminB, () =>
    db.query(`select public.tyre_cost_audit_apply(array['${f.id}']::uuid[]) v`))
  assert.equal(applied.rows[0].v.applied, 0, 'foreign-org apply touches 0 rows')
  const cost = await db.query(`select cost_per_tyre from public.tyre_records where id = '${TID}'`)
  assert.equal(cost.rows[0].cost_per_tyre, null, 'our tyre is untouched')
  await db.close?.()
})

test('tcaf_insert refuses a finding that is already decided or applied', async () => {
  const db = await createCostAuditDb()
  await seedUnpricedTyre(db)
  // An elevated caller may insert a PROPOSED finding, but not one pre-marked applied/approved.
  await assert.rejects(
    asClient(db, U.manager, () => db.query(`
      insert into public.tyre_cost_audit_findings (organisation_id, tyre_id, country, class, status, dedupe_key, applied_batch, applied_at)
      values ('${ORG_A}', '${TID}', 'KSA', 'exact_match', 'applied', 'hand|exact_match|900|x', gen_random_uuid(), now())`)),
    /row-level security/, 'a hand-inserted applied finding is refused')
  await db.close?.()
})

test('the shared fixture: SQL tyre_cost_line_kind mirrors JS lineKind on every row', async () => {
  const db = await createCostAuditDb()
  const { cases } = JSON.parse(readFileSync(new URL('../../src/test/fixtures/tyreCostLineKinds.json', import.meta.url), 'utf8'))
  const wrong = []
  for (const c of cases) {
    const r = await db.query('select public.tyre_cost_line_kind($1) k', [c.description])
    if (r.rows[0].k !== c.kind) wrong.push({ description: c.description, expected: c.kind, got: r.rows[0].k })
  }
  assert.deepEqual(wrong, [], 'every fixture line classifies as declared')
  assert.ok(cases.length >= 40)
  await db.close?.()
})
