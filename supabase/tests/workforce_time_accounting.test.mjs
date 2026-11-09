// Workforce time accounting (20261109170000): interval integrity across reports, impossible-interval
// refusals, the Riyadh work-date window, assignment links and authorised, append-only corrections.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createWorkforceDb, asClient, asUser, createAssignment, U } from './fixtures/workforce_harness.mjs'

const db = await createWorkforceDb()
await db.exec(readFileSync(new URL('../migrations/20261109170000_workforce_time_accounting.sql', import.meta.url), 'utf8'))
after(() => db.close())

const q = (uid, sql, params = []) => asClient(db, uid, async () => (await db.query(sql, params)).rows)
const one = async (uid, sql, params = []) => (await q(uid, sql, params))[0]
const rejects = (fn, re) => assert.rejects(fn, e => { assert.match(String(e.message), re); return true })

// Work dates are in the past so the "no future activity" rule never interferes.
const DAY = 86400000
const isoDay = offsetDays => new Date(Date.now() - offsetDays * DAY).toISOString().slice(0, 10)
const D1 = isoDay(10); const D2 = isoDay(9); const D3 = isoDay(20)
// Riyadh local time -> instant (fixed +03:00).
const at = (date, hhmm) => `${date}T${hhmm}:00+03:00`

async function report (uid, date) {
  return (await one(uid, 'insert into public.workforce_daily_reports(work_date) values ($1) returning id', [date])).id
}
async function entry (uid, reportId, from, to, over = {}) {
  return one(uid, `insert into public.workforce_daily_entries(report_id,title,category,started_at,ended_at,blocked_reason,assignment_id)
    values ($1,$2,$3,$4,$5,$6,$7) returning *`,
  [reportId, over.title || 'Work', over.category || 'productive', from, to, over.blocked_reason ?? null, over.assignment_id ?? null])
}
async function submit (uid, reportId) {
  await q(uid, `update public.workforce_daily_reports set summary='Done', status='submitted', submitted_at=now() where id=$1`, [reportId])
}
const correct = (uid, entryId, patch, reason = 'Times entered wrong by the employee', key = `corr-${Math.random().toString(36).slice(2, 12)}`) =>
  one(uid, 'select public.workforce_correct_daily_entry($1,$2::jsonb,$3,$4) r', [entryId, JSON.stringify(patch), reason, key]).then(x => x.r)

const R1 = await report(U.employee, D1)

test('new categories are accepted; unknown ones are refused', async () => {
  for (const [i, c] of ['travel', 'waiting_stock', 'waiting_equipment', 'vehicle_unavailable', 'safety_hold'].entries()) {
    const h = String(1 + i).padStart(2, '0')
    await entry(U.employee, R1, at(D1, `${h}:00`), at(D1, `${h}:30`), { category: c })
  }
  await rejects(() => entry(U.employee, R1, at(D1, '07:00'), at(D1, '07:10'), { category: 'idle' }), /check constraint|category/)
  await rejects(() => entry(U.employee, R1, at(D1, '07:00'), at(D1, '07:10'), { category: 'blocked' }), /reason/)
})

test('overlap refused, back-to-back allowed', async () => {
  await entry(U.employee, R1, at(D1, '08:00'), at(D1, '10:00'))
  await entry(U.employee, R1, at(D1, '10:00'), at(D1, '11:00'), { title: 'Back to back' })
  await rejects(() => entry(U.employee, R1, at(D1, '09:59'), at(D1, '10:30')), /Overlapping activity/)
  await rejects(() => entry(U.employee, R1, at(D1, '08:00'), at(D1, '10:00'), { title: 'Duplicate timer' }), /Overlapping activity/)
  // Same instant written in a different offset is still the same minute.
  await rejects(() => entry(U.employee, R1, `${D1}T06:30:00Z`, `${D1}T06:45:00Z`), /Overlapping activity/)
  // A different employee may record the same minutes.
  const r2 = await report(U.employee2, D1)
  await entry(U.employee2, r2, at(D1, '08:00'), at(D1, '10:00'))
})

test('overlap is refused across reports (a night entry on one day vs the next day report)', async () => {
  const rA = await report(U.employee, D3)
  await entry(U.employee, rA, at(D3, '22:00'), `${isoDay(19)}T02:00:00+03:00`, { title: 'Night shift' })
  const rB = await report(U.employee, isoDay(19))
  await rejects(() => entry(U.employee, rB, `${isoDay(19)}T01:00:00+03:00`, `${isoDay(19)}T03:00:00+03:00`), /Overlapping activity/)
  await entry(U.employee, rB, `${isoDay(19)}T02:00:00+03:00`, `${isoDay(19)}T03:00:00+03:00`)
})

test('impossible intervals are refused', async () => {
  const r = await report(U.employee, D2)
  await rejects(() => entry(U.employee, r, at(D2, '12:00'), at(D2, '12:00')), /end after it starts/)
  await rejects(() => entry(U.employee, r, at(D2, '12:00'), at(D2, '11:00')), /end after it starts/)
  await rejects(() => entry(U.employee, r, at(D2, '01:00'), at(D2, '17:30')), /16 hours/)
  const future = new Date(Date.now() + 3600000).toISOString()
  const fr = await report(U.employee, isoDay(0))
  await rejects(() => entry(U.employee, fr, new Date(Date.now() - 600000).toISOString(), future), /future/)
  // Riyadh window: D2-2 is outside work_date +/- 1 day.
  await rejects(() => entry(U.employee, r, at(isoDay(11), '08:00'), at(isoDay(11), '09:00')), /does not belong to workday/)
  // 23:30 UTC on D2-2 is 02:30 Riyadh on D2-1: inside the window (proves the +03:00 rule, not UTC).
  await entry(U.employee, r, `${isoDay(11)}T23:30:00Z`, `${isoDay(11)}T23:50:00Z`, { title: 'Early start' })
})

test('assignment link: own assignment ok, someone else\'s refused', async () => {
  const mine = await createAssignment(db, U.manager, { assigned_to: U.employee })
  const theirs = await createAssignment(db, U.manager, { assigned_to: U.employee2 })
  const e = await entry(U.employee, R1, at(D1, '12:00'), at(D1, '13:00'), { assignment_id: mine })
  assert.equal(e.assignment_id, mine)
  await rejects(() => entry(U.employee, R1, at(D1, '13:00'), at(D1, '13:30'), { assignment_id: theirs }), /assigned to this employee/)
})

test('employee cannot forge correction stamps or edit a submitted report', async () => {
  const r = await report(U.employee, isoDay(30))
  const e = await entry(U.employee, r, at(isoDay(30), '08:00'), at(isoDay(30), '09:00'))
  await rejects(() => q(U.employee, 'update public.workforce_daily_entries set correction_count=1 where id=$1', [e.id]), /authorised correction/)
  await submit(U.employee, r)
  await rejects(() => q(U.employee, `update public.workforce_daily_entries set title='edit' where id=$1`, [e.id]), /cannot be edited/)
  await rejects(() => q(U.employee, 'insert into public.workforce_daily_entry_corrections(organisation_id) values (null)'), /permission denied/)
})

test('correction keeps the original, re-runs the guard, and is append-only', async () => {
  const d = isoDay(40)
  const r = await report(U.employee, d)
  const e = await entry(U.employee, r, at(d, '08:00'), at(d, '10:00'), { title: 'Fitted tyres' })
  await entry(U.employee, r, at(d, '11:00'), at(d, '12:00'), { title: 'Other' })
  await submit(U.employee, r)

  // Correcting into an overlap is refused and leaves nothing behind.
  await rejects(() => correct(U.manager, e.id, { ended_at: at(d, '11:30') }), /Overlapping activity/)
  assert.equal((await asUser(db, U.admin, () => db.query('select count(*)::int n from public.workforce_daily_entry_corrections where entry_id=$1', [e.id]))).rows[0].n, 0)
  await rejects(() => correct(U.manager, e.id, { category: 'idle' }), /check constraint|category/)
  await rejects(() => correct(U.manager, e.id, { employee_id: U.employee2 }), /cannot be corrected: employee_id/)
  await rejects(() => correct(U.manager, e.id, { ended_at: at(d, '09:00') }, 'x'), /reason is required/)

  const res = await correct(U.manager, e.id, { ended_at: at(d, '09:00'), category: 'waiting_stock' }, 'Parts arrived late, logged as waiting')
  assert.equal(res.ok, true)
  assert.equal(res.replayed, false)
  const now = await one(U.manager, 'select * from public.workforce_daily_entries where id=$1', [e.id])
  assert.equal(now.category, 'waiting_stock')
  assert.equal(now.correction_count, 1)
  assert.equal(now.last_corrected_by, U.manager)
  assert.equal(new Date(now.ended_at).toISOString(), new Date(at(d, '09:00')).toISOString())

  // A second correction stacks; the very first ledger row still holds the original.
  await correct(U.manager, e.id, { title: 'Fitted tyres (corrected)' }, 'Clarified the activity title')
  const ledger = await q(U.employee, 'select original, reason from public.workforce_daily_entry_corrections where entry_id=$1 order by corrected_at, id', [e.id])
  assert.equal(ledger.length, 2, 'employee can read corrections of their own entries')
  assert.equal(ledger[0].original.category, 'productive')
  assert.equal(ledger[0].original.title, 'Fitted tyres')
  assert.equal(new Date(ledger[0].original.ended_at).toISOString(), new Date(at(d, '10:00')).toISOString())

  // The correction bypass is scoped to its own transaction: a past correction does not unlock the entry.
  await rejects(() => q(U.employee, `update public.workforce_daily_entries set title='sneaky' where id=$1`, [e.id]), /cannot be edited/)
  await rejects(() => asUser(db, U.admin, () => db.query('update public.workforce_daily_entry_corrections set reason=$1', ['tamper'])), /append-only/)
  await rejects(() => asUser(db, U.admin, () => db.query('delete from public.workforce_daily_entry_corrections')), /append-only/)
})

test('only managers, never on their own entries, never on drafts or verified reports', async () => {
  const d = isoDay(50)
  const r = await report(U.employee, d)
  const e = await entry(U.employee, r, at(d, '08:00'), at(d, '09:00'))
  await rejects(() => correct(U.manager, e.id, { title: 'x y z' }), /submitted or returned/)
  await submit(U.employee, r)
  await rejects(() => correct(U.employee, e.id, { title: 'Self fix' }), /Only a manager/)
  await rejects(() => correct(U.employee2, e.id, { title: 'Peer fix' }), /Only a manager/)
  await rejects(() => correct(U.managerB, e.id, { title: 'Other org' }), /not found/)

  const mr = await report(U.manager, d)
  const me = await entry(U.manager, mr, at(d, '08:00'), at(d, '09:00'))
  await submit(U.manager, mr)
  await rejects(() => correct(U.manager, me.id, { title: 'Own fix' }), /your own/)
  // Director can correct the manager's entry.
  assert.equal((await correct(U.director, me.id, { title: 'Director fix' })).ok, true)

  await q(U.manager, `update public.workforce_daily_reports set status='verified', reviewed_by=auth.uid(), reviewed_at=now() where id=$1`, [r])
  await rejects(() => correct(U.director, e.id, { title: 'Too late' }), /submitted or returned/)
})

test('idempotent replay: same key + patch returns the same correction once; key reuse with another patch refused', async () => {
  const d = isoDay(60)
  const r = await report(U.employee, d)
  const e = await entry(U.employee, r, at(d, '08:00'), at(d, '09:00'))
  await submit(U.employee, r)
  const key = 'replay-key-0001'
  const a = await correct(U.manager, e.id, { title: 'Corrected once' }, 'Wrong title recorded', key)
  const b = await correct(U.manager, e.id, { title: 'Corrected once' }, 'Wrong title recorded', key)
  assert.equal(b.replayed, true)
  assert.equal(b.correction_id, a.correction_id)
  const row = await one(U.manager, 'select correction_count from public.workforce_daily_entries where id=$1', [e.id])
  assert.equal(row.correction_count, 1)
  await rejects(() => correct(U.manager, e.id, { title: 'Different' }, 'Wrong title recorded', key), /different correction/)
  await rejects(() => correct(U.manager, e.id, { title: 'Short key' }, 'Wrong title recorded', 'short'), /idempotency key/)
})

test('anon cannot execute the correction RPC', async () => {
  const r = (await db.query(`select has_function_privilege('anon','public.workforce_correct_daily_entry(uuid,jsonb,text,text)','EXECUTE') a,
    has_function_privilege('authenticated','public.workforce_correct_daily_entry(uuid,jsonb,text,text)','EXECUTE') b`)).rows[0]
  assert.equal(r.a, false)
  assert.equal(r.b, true)
})
