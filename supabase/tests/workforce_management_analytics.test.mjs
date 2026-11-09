// Workforce management analytics (20261109180000): exact server-side figures over the whole visible
// dataset, honest NULLs where nothing was measured, and RLS-bound visibility.
import { test, after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createWorkforceDb, asClient, transition, U } from './fixtures/workforce_harness.mjs'

const db = await createWorkforceDb()
await db.exec(readFileSync(new URL('../migrations/20261109180000_workforce_management_analytics.sql', import.meta.url), 'utf8'))
after(() => db.close())

const BASE = Date.now() - 2 * 24 * 3600 * 1000
const at = min => new Date(BASE + min * 60000).toISOString()
const one = async (uid, sql, params = []) => asClient(db, uid, async () => (await db.query(sql, params)).rows[0])
const analytics = async (uid, from = null, to = null, site = null) =>
  (await one(uid, 'select public.workforce_team_analytics($1,$2,$3) r', [from, to, site])).r

async function make (assignedTo, site, est) {
  return (await one(U.manager, `insert into public.workforce_assignments(title,assigned_to,assigned_by,site,estimated_minutes,created_at)
    values ('Task',$1,auth.uid(),$2,$3,$4) returning id`, [assignedTo, site, est, at(-5)])).id
}
const step = async (uid, a, action, min, opts = {}) => {
  const r = await transition(db, uid, a, action, { clientAt: at(min), ...opts })
  assert.equal(r.ok, true, `${action} ${JSON.stringify(r)}`)
}
const ids = {}

before(async () => {
  // A1: employee, NHC, est 60. Active 10 + 30 + 20 = 60; blocked waiting_stock 30; one return.
  ids.a1 = await make(U.employee, 'nhc', 60)
  await step(U.employee, ids.a1, 'start', 0)
  await step(U.employee, ids.a1, 'block', 10, { note: 'No stock', reasonCode: 'waiting_stock' })
  await step(U.employee, ids.a1, 'resume', 40)
  await step(U.employee, ids.a1, 'complete', 70)
  await step(U.manager, ids.a1, 'return', 80, { note: 'Torque not recorded' })
  await step(U.employee, ids.a1, 'complete', 100)
  await step(U.manager, ids.a1, 'verify', 110)
  // A2: employee, NHC, est 30. Active 45.
  ids.a2 = await make(U.employee, 'NHC', 30)
  await step(U.employee, ids.a2, 'start', 0)
  await step(U.employee, ids.a2, 'complete', 45)
  await step(U.manager, ids.a2, 'verify', 50)
  // A5: employee, NHC, submitted and waiting for review.
  ids.a5 = await make(U.employee, 'NHC', null)
  await step(U.employee, ids.a5, 'start', 0)
  await step(U.employee, ids.a5, 'complete', 20)
  // A3: employee2, JED, blocked with no recorded cause and still blocked (open episode).
  ids.a3 = await make(U.employee2, 'JED', null)
  await step(U.employee2, ids.a3, 'start', 0)
  await step(U.employee2, ids.a3, 'block', 5, { note: 'Vehicle left', reasonCode: null })
  // A4: employee2, JED, safety hold 15 minutes then cancelled by the manager (cancel ends the block).
  ids.a4 = await make(U.employee2, 'JED', 20)
  await step(U.employee2, ids.a4, 'start', 0)
  await step(U.employee2, ids.a4, 'block', 0, { note: 'Unsafe jack', reasonCode: 'safety_hold' })
  await step(U.manager, ids.a4, 'cancel', 15, { note: 'Job withdrawn' })
  // A6: employee2, JED, verified through a legacy path with no events: untimed, never guessed.
  ids.a6 = await make(U.employee2, 'JED', 40)
  await db.exec("select set_config('workforce.via','transition',false)")
  await db.query("update public.workforce_assignments set status='verified' where id=$1", [ids.a6])
  await db.exec("select set_config('workforce.via','',false)")
})

test('totals, rework, estimate vs actual and coverage are exact', async () => {
  const r = await analytics(U.manager)
  assert.equal(r.totals.assigned, 6)
  assert.equal(r.totals.verified, 3)
  assert.equal(r.totals.submitted, 1)
  assert.equal(r.totals.rework_returns, 1)
  assert.equal(r.rework_rate, 0.25, '1 return / (3 verified + 1 return)')
  assert.deepEqual(r.totals.estimate_vs_actual, { n: 2, estimated_minutes: 90, actual_minutes: 105, actual_to_estimate: 1.167 })
  assert.deepEqual([r.coverage.verified, r.coverage.verified_timed, r.coverage.verified_untimed], [3, 2, 1])
  assert.equal(r.verification_queue.count, 1)
  assert.equal(r.verification_queue.aged_from_last_update, 0)
  assert.ok(r.verification_queue.oldest_age_hours > 40)
})

test('per employee: timed averages, and NULL (not 0) where nothing was measured', async () => {
  const r = await analytics(U.manager)
  const e1 = r.per_employee.find(x => x.profile_id === U.employee)
  assert.deepEqual([e1.assigned, e1.verified, e1.submitted, e1.timed_verified], [3, 2, 1, 2])
  assert.equal(e1.avg_active_minutes, 52.5)
  assert.equal(e1.median_active_minutes, 52.5)
  assert.equal(e1.rework_rate, 0.3333)
  assert.equal(e1.blocked_minutes_closed, 30)
  const e2 = r.per_employee.find(x => x.profile_id === U.employee2)
  assert.deepEqual([e2.assigned, e2.blocked, e2.cancelled, e2.verified, e2.verified_untimed], [3, 1, 1, 1, 1])
  assert.equal(e2.avg_active_minutes, null)
  assert.equal(e2.median_active_minutes, null)
  assert.deepEqual(e2.estimate_vs_actual, { n: 0, estimated_minutes: null, actual_minutes: null, actual_to_estimate: null })
  assert.equal(e2.rework_rate, 0)
  const nhc = r.per_site.find(x => x.site === 'NHC')
  assert.equal(nhc.assigned, 3, 'site grouping folds case')
  assert.equal(r.per_site.find(x => x.site === 'JED').assigned, 3)
})

test('blocked minutes by cause: closed and open episodes kept apart, missing cause is not_recorded', async () => {
  const r = await analytics(U.manager)
  const by = Object.fromEntries(r.blocker_minutes_by_reason.map(x => [x.reason, x]))
  assert.deepEqual([by.waiting_stock.closed_minutes, by.waiting_stock.open_episodes, by.waiting_stock.open_minutes], [30, 0, null])
  assert.equal(by.safety_hold.closed_minutes, 15, 'cancel ends the block')
  assert.deepEqual([by.not_recorded.closed_episodes, by.not_recorded.closed_minutes, by.not_recorded.open_episodes], [0, null, 1])
  assert.ok(by.not_recorded.open_minutes > 2000, 'open block counted up to now')
})

test('window and site filters, and visibility follow RLS', async () => {
  const future = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const none = await analytics(U.manager, future, null)
  assert.equal(none.totals.assigned, 0)
  assert.equal(none.rework_rate, null)
  assert.equal((await analytics(U.manager, null, null, ' jed ')).totals.assigned, 3)
  const other = await analytics(U.managerB)
  assert.equal(other.totals.assigned, 0)
  assert.equal(other.verification_queue.count, 0)
  const emp = await analytics(U.employee)
  assert.deepEqual(emp.per_employee.map(x => x.profile_id), [U.employee], 'an employee sees only own work')
  assert.equal(emp.totals.assigned, 3)
})

test('employee timeline: chronological with events; another employee sees nothing', async () => {
  const t = (await one(U.manager, 'select public.workforce_employee_timeline($1,null,null) r', [U.employee])).r
  assert.equal(t.total, 3)
  const a1 = t.assignments.find(x => x.id === ids.a1)
  assert.equal(Number(a1.active_minutes), 60)
  assert.deepEqual(a1.events.map(e => e.action), ['start', 'block', 'resume', 'complete', 'return', 'complete', 'verify'])
  assert.equal(a1.events[1].reason_code, 'waiting_stock')
  const peek = (await one(U.employee, 'select public.workforce_employee_timeline($1,null,null) r', [U.employee2])).r
  assert.equal(peek.total, 0)
})
