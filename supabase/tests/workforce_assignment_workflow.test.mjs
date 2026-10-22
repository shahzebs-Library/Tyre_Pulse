import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createWorkforceDb, asClient, createAssignment, transition, newKey, U } from './fixtures/workforce_harness.mjs'
import { computeActiveMinutes, tiersFromSamples, pickEstimate } from '../../src/lib/workforceEstimate.js'

const db = await createWorkforceDb()
after(() => db.close())

const DAY = 86400000
const BASE = Date.now() // fixed so minute offsets are exact
const at = (minutes, daysAgo = 2) => new Date(BASE - daysAgo * DAY + minutes * 60000).toISOString()
const daysAgo = n => new Date(Date.now() - n * DAY).toISOString()
const iso = r => ({ ...r, effective_at: r.effective_at.toISOString(), occurred_at: r.occurred_at.toISOString() })
const events = async id => (await db.query(
  'select action, from_status, to_status, note, actor_id, effective_at, occurred_at, id from public.workforce_assignment_events where assignment_id = $1 order by effective_at, occurred_at, id', [id])).rows.map(iso)
const status = async id => (await db.query('select status from public.workforce_assignments where id = $1', [id])).rows[0].status
const activeMinutes = async id => (await db.query('select active_minutes from public.workforce_assignment_durations where assignment_id = $1', [id])).rows[0]?.active_minutes

test('employee-to-supervisor workflow: assigned -> accepted -> started -> blocked -> resumed -> completed -> reviewed', async () => {
  const a = await createAssignment(db, U.manager, { title: 'Replace steer tyre', task_type: 'Tyre Change', vehicle_type: 'tr-mixer', created_at: daysAgo(3) })
  assert.equal(await status(a), 'assigned')

  const steps = [
    [U.employee, 'accept', 0, null, 'acknowledged'],
    [U.employee, 'start', 10, null, 'in_progress'],
    [U.employee, 'block', 40, 'Waiting for the replacement valve from stores', 'blocked'],
    [U.employee, 'resume', 100, 'Valve arrived', 'in_progress'],
    [U.employee, 'complete', 130, 'Tyre fitted, torque checked', 'submitted'],
  ]
  for (const [uid, action, minute, note, expected] of steps) {
    const r = await transition(db, uid, a, action, { note, clientAt: at(minute) })
    assert.deepEqual([r.ok, r.result, r.status], [true, 'applied', expected], action)
    assert.equal(await status(a), expected)
  }
  // Rework gates are not available to the employee, and a peer supervisor cannot review.
  assert.equal((await transition(db, U.supervisor, a, 'verify')).reason, 'not_found')
  assert.equal((await transition(db, U.employee, a, 'verify')).reason, 'not_found')

  const log = await events(a)
  assert.deepEqual(log.map(e => e.action), ['accept', 'start', 'block', 'resume', 'complete'])
  assert.equal(log[2].note, 'Waiting for the replacement valve from stores')
  assert.ok(log.every(e => e.actor_id === U.employee))

  // 30 min before the block + 30 min after resume; blocked time is not work time.
  assert.equal(Number(await activeMinutes(a)), 60)
  assert.equal(computeActiveMinutes(log), 60, 'JS mirror agrees with the SQL view')

  const review = await transition(db, U.manager, a, 'verify', { note: 'Checked on site' })
  assert.deepEqual([review.ok, review.result, review.status], [true, 'applied', 'verified'])
  assert.equal(await status(a), 'verified')
  assert.equal(Number(await activeMinutes(a)), 60, 'review waiting time never counts as work')

  // Closed assignments are final for everyone.
  assert.equal((await transition(db, U.employee, a, 'start')).reason, 'invalid_transition')
  await assert.rejects(() => asClient(db, U.manager, () => db.query(`update public.workforce_assignments set priority='high' where id=$1`, [a])), /Closed assignments are immutable/)
})

test('manager returns work for rework: active time includes the rework, review wait does not', async () => {
  const a = await createAssignment(db, U.manager, { task_type: 'tyre change', created_at: daysAgo(3) })
  await transition(db, U.employee, a, 'start', { clientAt: at(0) })
  await transition(db, U.employee, a, 'complete', { clientAt: at(20) })
  assert.equal((await transition(db, U.manager, a, 'return')).reason, 'note_required')
  const ret = await transition(db, U.manager, a, 'return', { note: 'Torque values missing', clientAt: at(120) })
  assert.equal(ret.status, 'in_progress')
  await transition(db, U.employee, a, 'complete', { clientAt: at(150) })
  assert.equal(await status(a), 'submitted')
  assert.equal(Number(await activeMinutes(a)), 50) // 20 + 30; the 100 minutes under review are excluded
  assert.equal(computeActiveMinutes(await events(a)), 50)
})

test('idempotency: a replayed key never creates a second event or changes state', async () => {
  const a = await createAssignment(db, U.manager)
  const key = newKey()
  const first = await transition(db, U.employee, a, 'accept', { key })
  assert.equal(first.result, 'applied')
  const replay = await transition(db, U.employee, a, 'accept', { key })
  assert.deepEqual([replay.ok, replay.result, replay.event_id], [true, 'replayed', first.event_id])
  await transition(db, U.employee, a, 'start')
  // The same key arriving after later transitions still replays (response lost, device retried).
  assert.equal((await transition(db, U.employee, a, 'accept', { key })).result, 'replayed')
  assert.equal((await events(a)).length, 2)
  // Re-using a key for a different action is refused, never silently applied.
  assert.equal((await transition(db, U.employee, a, 'block', { key, note: 'x' })).reason, 'key_reuse')
  // A key belongs to its actor; another user re-using the string is just a new key for them.
  const other = await createAssignment(db, U.manager, { assigned_to: U.employee2 })
  assert.equal((await transition(db, U.employee2, other, 'accept', { key })).result, 'applied')
})

test('offline reconciliation: stale or already-superseded actions are rejected or recognised, never forced', async () => {
  const a = await createAssignment(db, U.manager)
  // out-of-order replay: complete arrives before start
  const early = await transition(db, U.employee, a, 'complete')
  assert.deepEqual([early.ok, early.reason, early.current_status], [false, 'invalid_transition', 'assigned'])
  // accept replayed after the work already started elsewhere is recognised, not an error
  await transition(db, U.employee, a, 'start')
  assert.deepEqual(await transition(db, U.employee, a, 'accept'), { ok: true, result: 'already_applied', status: 'in_progress' })
  // same transition under a fresh key (second device) is also "already applied"
  assert.equal((await transition(db, U.employee, a, 'start')).result, 'already_applied')
  // manager cancels; queued employee updates must be rejected with the new truth
  assert.equal((await transition(db, U.manager, a, 'cancel', { note: 'Vehicle sold' })).status, 'cancelled')
  const late = await transition(db, U.employee, a, 'complete')
  assert.deepEqual([late.ok, late.reason, late.current_status], [false, 'invalid_transition', 'cancelled'])
  assert.equal((await events(a)).length, 2)
})

test('client clock is bounded: future and backdated timestamps cannot rewrite history', async () => {
  const a = await createAssignment(db, U.manager, { created_at: daysAgo(30) })
  await transition(db, U.employee, a, 'accept', { clientAt: daysAgo(90) }) // before the assignment existed and older than 14 days
  await transition(db, U.employee, a, 'start', { clientAt: new Date(Date.now() + 5 * DAY).toISOString() }) // future
  const [acc, start] = await events(a)
  const eff = e => new Date(e.effective_at).getTime()
  assert.ok(eff(acc) >= Date.now() - 14 * DAY - 60000, 'clamped to 14 days')
  assert.ok(eff(start) <= new Date(start.occurred_at).getTime(), 'never later than the server time')
  assert.ok(eff(start) >= eff(acc), 'events never run backwards')
})

// ---------------------------------------------------------------- estimation
async function completedJob ({ task, vehicle, assignee = U.employee, minutes, via = 'rpc' }) {
  const a = await createAssignment(db, U.manager, { assigned_to: assignee, task_type: task, vehicle_type: vehicle, created_at: daysAgo(5) })
  if (via === 'rpc') {
    await transition(db, assignee, a, 'start', { clientAt: at(0, 3) })
    await transition(db, assignee, a, 'complete', { clientAt: at(minutes, 3) })
  }
  return a
}

test('estimation: view and function aggregate completed work only, and agree with the JS engine', async () => {
  await db.query(`update public.profiles set role = 'Mechanic' where id = $1`, [U.employee2])
  const tyreMan = [30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85]
  for (const m of tyreMan) await completedJob({ task: 'valve replacement', vehicle: 'TR-MIXER', minutes: m })
  for (const m of [100, 110, 120]) await completedJob({ task: 'valve replacement', vehicle: 'TR-MIXER', assignee: U.employee2, minutes: m })
  for (const m of [20, 25, 30, 35, 40, 45]) await completedJob({ task: 'valve replacement', vehicle: 'PICKUP', assignee: U.employee2, minutes: m })
  await completedJob({ task: 'brake service', vehicle: 'TR-MIXER', minutes: 90 })
  // Noise that must never become a sample:
  const open = await completedJob({ task: 'valve replacement', vehicle: 'TR-MIXER', minutes: 10, via: 'none' })
  await transition(db, U.employee, open, 'start', { clientAt: at(0, 3) })
  const cancelled = await createAssignment(db, U.manager, { task_type: 'valve replacement', vehicle_type: 'TR-MIXER', created_at: daysAgo(5) })
  await transition(db, U.employee, cancelled, 'start', { clientAt: at(0, 3) })
  await transition(db, U.employee, cancelled, 'complete', { clientAt: at(500, 3) })
  await transition(db, U.manager, cancelled, 'cancel', { note: 'Duplicate order' })
  await completedJob({ task: 'valve replacement', vehicle: 'TR-MIXER', minutes: 0.2 }) // an accidental tap
  const legacy = await createAssignment(db, U.manager, { task_type: 'valve replacement', vehicle_type: 'TR-MIXER' })
  await asClient(db, U.employee, async () => {
    await db.query(`update public.workforce_assignments set status = 'in_progress' where id = $1`, [legacy])
    await db.query(`update public.workforce_assignments set status = 'submitted' where id = $1`, [legacy])
  }) // direct update: no events, so no trustworthy duration

  const query = { task_type: 'Valve Replacement', vehicle_type: 'tr-mixer', role: 'Tyre Man' }
  const result = await asClient(db, U.manager, async () => (await db.query(
    'select public.workforce_duration_estimate($1, $2, $3) r', [query.task_type, query.vehicle_type, query.role])).rows[0].r)
  const tier = name => result.tiers.find(t => t.tier === name)

  assert.equal(result.task_type, 'valve replacement')
  assert.equal(result.vehicle_type, 'TR-MIXER')
  assert.deepEqual([tier('task_vehicle_role').n, tier('task_vehicle').n, tier('task_role').n, tier('task').n], [12, 15, 12, 21])
  assert.equal(tier('task_vehicle_role').median, 57.5)

  // Same numbers from the raw view through the pure engine.
  const samples = (await asClient(db, U.manager, () => db.query(
    'select task_type, vehicle_type, assignee_role, active_minutes from public.workforce_assignment_durations'))).rows
  const js = tiersFromSamples(samples, query)
  for (const t of result.tiers) {
    const j = js.find(x => x.tier === t.tier)
    assert.deepEqual({ n: j.n, p25: j.p25, median: j.median, p75: j.p75, p90: j.p90 },
      { n: Number(t.n), p25: t.p25 === null ? null : Number(t.p25), median: t.median === null ? null : Number(t.median), p75: t.p75 === null ? null : Number(t.p75), p90: t.p90 === null ? null : Number(t.p90) }, t.tier)
  }

  const picked = pickEstimate(result)
  assert.equal(picked.status, 'estimated')
  assert.equal(picked.tier, 'task_vehicle_role')
  assert.equal(picked.confidence, 'medium')

  // Mechanic on a mixer has only 3 observations, so it falls back to the vehicle tier and says so.
  const mech = await asClient(db, U.manager, async () => (await db.query(
    `select public.workforce_duration_estimate('valve replacement', 'TR-MIXER', 'Mechanic') r`)).rows[0].r)
  const mechPick = pickEstimate(mech)
  assert.equal(mechPick.tier, 'task_vehicle')
  assert.equal(mechPick.sampleSize, 15)

  // Unknown task: honest "not enough history", no number.
  const none = pickEstimate(await asClient(db, U.manager, async () => (await db.query(
    `select public.workforce_duration_estimate('wheel alignment', 'TR-MIXER', 'Tyre Man') r`)).rows[0].r))
  assert.equal(none.status, 'insufficient')
  assert.equal(none.sampleSize, 0)
  // Too little history for the mixer brake service (1 sample).
  const brake = pickEstimate(await asClient(db, U.manager, async () => (await db.query(
    `select public.workforce_duration_estimate('brake service', 'TR-MIXER', 'Tyre Man') r`)).rows[0].r))
  assert.equal(brake.status, 'insufficient')
  assert.ok(!('medianMinutes' in brake))
})

test('estimation: employees and other organisations cannot read estimates or history', async () => {
  await assert.rejects(() => asClient(db, U.employee, () => db.query(`select public.workforce_duration_estimate('valve replacement')`)), /Managers only/)
  await assert.rejects(() => asClient(db, U.supervisor, () => db.query(`select public.workforce_duration_estimate('valve replacement')`)), /Managers only/)
  const other = await asClient(db, U.managerB, async () => (await db.query(`select public.workforce_duration_estimate('valve replacement', 'TR-MIXER', 'Tyre Man') r`)).rows[0].r)
  assert.ok(other.tiers.every(t => Number(t.n) === 0), 'another organisation sees none of this history')
  assert.equal((await asClient(db, U.employee, () => db.query('select 1 from public.workforce_assignment_durations'))).rows.length > 0, true, 'employee sees only their own rows')
  assert.equal((await asClient(db, U.employee2, () => db.query('select 1 from public.workforce_assignment_durations where assignee_role = $1', ['Tyre Man']))).rows.length, 0, 'and none of their colleagues')
  assert.equal((await asClient(db, U.managerB, () => db.query('select 1 from public.workforce_assignment_durations'))).rows.length, 0)
  const blank = await asClient(db, U.manager, async () => (await db.query(`select public.workforce_duration_estimate('   ') r`)).rows[0].r)
  assert.deepEqual(blank.tiers, [])
})
