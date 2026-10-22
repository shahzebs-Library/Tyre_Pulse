import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createWorkforceDb, asClient, asUser, createAssignment, transition, U, ORG_A, ORG_B } from './fixtures/workforce_harness.mjs'

// Permission matrix for workforce assignments over the REAL migrations (PGlite).
// Actors: employee (assignee), employee2 (same org, not assignee), supervisor (custom role
// 'Workshop Supervisor' - NOT a workforce manager today), manager, director, admin, and a
// manager/employee of another organisation.
const db = await createWorkforceDb()
after(() => db.close())

const denied = async (fn) => assert.rejects(fn, e => { assert.match(String(e.message), /permission denied|row-level security|violates|Invalid|immutable|may change|append-only|Managers only/i); return true })
const count = async (uid, sql, params = []) => asClient(db, uid, async () => (await db.query(sql, params)).rows.length)

let assignment // belongs to employee, org A
before(async () => { assignment = await createAssignment(db, U.manager, { task_type: 'tyre change', vehicle_type: 'TR-MIXER' }) })

// ---------------------------------------------------------------- create
test('create: managers, directors and admins may assign; employees and supervisors may not', async () => {
  for (const uid of [U.manager, U.director, U.admin]) assert.ok(await createAssignment(db, uid, { title: `by ${uid}` }))
  for (const uid of [U.employee, U.employee2, U.supervisor]) {
    await denied(() => createAssignment(db, uid, { title: 'nope', assigned_to: U.employee2 }))
  }
})

test('create: cross-organisation assignee and cross-organisation row are refused', async () => {
  // Regression: the policy used an unqualified column and compared profiles to itself.
  await denied(() => createAssignment(db, U.manager, { assigned_to: U.employeeB }))
  await denied(() => createAssignment(db, U.managerB, { assigned_to: U.employee }))
  await denied(() => asClient(db, U.manager, () => db.query(
    `insert into public.workforce_assignments(organisation_id, title, assigned_to, assigned_by)
     values ($1, 'forged org', $2, auth.uid())`, [ORG_B, U.employeeB])))
})

test('create: cannot be recorded as another person, and locked assignees are refused', async () => {
  await denied(() => asClient(db, U.manager, () => db.query(
    `insert into public.workforce_assignments(title, assigned_to, assigned_by) values ('x', $1, $2)`, [U.employee, U.admin])))
  await db.query(`update public.profiles set locked = true where id = $1`, [U.employee2])
  try { await denied(() => createAssignment(db, U.manager, { assigned_to: U.employee2 })) }
  finally { await db.query(`update public.profiles set locked = false where id = $1`, [U.employee2]) }
})

// ---------------------------------------------------------------- read
test('read: assignee sees own; other employees and supervisors see none of it', async () => {
  assert.equal(await count(U.employee, 'select 1 from public.workforce_assignments where id = $1', [assignment]), 1)
  for (const uid of [U.employee2, U.supervisor]) {
    assert.equal(await count(uid, 'select 1 from public.workforce_assignments where id = $1', [assignment]), 0)
  }
})

test('read: managers, directors and admins see the organisation; other organisations see nothing', async () => {
  for (const uid of [U.manager, U.director, U.admin]) {
    assert.equal(await count(uid, 'select 1 from public.workforce_assignments where id = $1', [assignment]), 1)
  }
  for (const uid of [U.managerB, U.employeeB]) {
    assert.equal(await count(uid, 'select 1 from public.workforce_assignments', []), 0)
  }
})

// ---------------------------------------------------------------- transitions
test('transition: only the assignee performs employee actions', async () => {
  const mine = await createAssignment(db, U.manager)
  assert.deepEqual(await transition(db, U.employee2, mine, 'accept'), { ok: false, result: 'rejected', reason: 'not_found' })
  assert.deepEqual(await transition(db, U.supervisor, mine, 'accept'), { ok: false, result: 'rejected', reason: 'not_found' })
  assert.deepEqual(await transition(db, U.employeeB, mine, 'accept'), { ok: false, result: 'rejected', reason: 'not_found' })
  assert.deepEqual(await transition(db, U.managerB, mine, 'accept'), { ok: false, result: 'rejected', reason: 'not_found' })
  // A manager can see it, so the refusal names the reason instead of hiding existence.
  assert.equal((await transition(db, U.manager, mine, 'accept')).reason, 'forbidden')
  assert.equal((await transition(db, U.employee, mine, 'accept')).result, 'applied')
})

test('transition: review actions need a manager role and never apply to oneself', async () => {
  const a = await createAssignment(db, U.manager)
  await transition(db, U.employee, a, 'start')
  await transition(db, U.employee, a, 'complete')
  for (const uid of [U.employee, U.employee2, U.supervisor, U.employeeB, U.managerB]) {
    assert.equal((await transition(db, uid, a, 'verify')).reason, 'not_found', `verify by ${uid}`)
  }
  // A manager who is also the assignee cannot verify their own work.
  const own = await createAssignment(db, U.director, { assigned_to: U.manager })
  await transition(db, U.manager, own, 'start')
  await transition(db, U.manager, own, 'complete')
  assert.equal((await transition(db, U.manager, own, 'verify')).reason, 'self_review')
  assert.equal((await transition(db, U.admin, own, 'verify')).result, 'applied')
  assert.equal((await transition(db, U.director, a, 'verify')).result, 'applied')
})

test('transition: notes are required for block, return and cancel', async () => {
  const a = await createAssignment(db, U.manager)
  await transition(db, U.employee, a, 'start')
  assert.equal((await transition(db, U.employee, a, 'block')).reason, 'note_required')
  assert.equal((await transition(db, U.employee, a, 'block', { note: '   ' })).reason, 'note_required')
  assert.equal((await transition(db, U.employee, a, 'block', { note: 'Waiting for the new valve' })).result, 'applied')
  assert.equal((await transition(db, U.manager, a, 'cancel')).reason, 'note_required')
})

test('transition: anonymous callers and bad input are refused', async () => {
  await assert.rejects(() => db.query(`select public.workforce_assignment_transition($1,'accept','anon-key-00001')`, [assignment]))
  await assert.rejects(() => asClient(db, U.employee, () => db.query(`select public.workforce_assignment_transition($1,'accept','short')`, [assignment])), /idempotency/i)
  await assert.rejects(() => asClient(db, U.employee, () => db.query(`select public.workforce_assignment_transition($1,'delete','long-enough-key')`, [assignment])), /Unknown assignment action/)
})

// ---------------------------------------------------------------- direct table writes
test('direct writes: employees cannot edit another person, skip states or touch instructions', async () => {
  const a = await createAssignment(db, U.manager)
  // another employee: policy hides the row, so nothing updates
  await asClient(db, U.employee2, async () => {
    const r = await db.query(`update public.workforce_assignments set status='acknowledged' where id=$1 returning id`, [a])
    assert.equal(r.rows.length, 0)
  })
  await denied(() => asClient(db, U.employee, () => db.query(`update public.workforce_assignments set status='submitted' where id=$1`, [a])))
  await denied(() => asClient(db, U.employee, () => db.query(`update public.workforce_assignments set instructions='do something else' where id=$1`, [a])))
  await denied(() => asClient(db, U.employee, () => db.query(`update public.workforce_assignments set task_type='forged' where id=$1`, [a])))
  await denied(() => asClient(db, U.employee, () => db.query(`update public.workforce_assignments set assignee_role='Admin' where id=$1`, [a])))
  await denied(() => asClient(db, U.employee, () => db.query(`update public.workforce_assignments set assigned_to=$2 where id=$1`, [a, U.employee2])))
})

test('direct writes: the transition ledger is append-only and not writable by clients', async () => {
  const a = await createAssignment(db, U.manager)
  await transition(db, U.employee, a, 'accept')
  await denied(() => asClient(db, U.employee, () => db.query(
    `insert into public.workforce_assignment_events(organisation_id, assignment_id, actor_id, action, from_status, to_status, idempotency_key)
     values ($1, $2, $3, 'complete', 'in_progress', 'submitted', 'forged-key-0001')`, [ORG_A, a, U.employee])))
  await denied(() => asClient(db, U.manager, () => db.query(`update public.workforce_assignment_events set note='x'`)))
  await denied(() => asUser(db, U.admin, () => db.query(`delete from public.workforce_assignment_events`)))
})

test('ledger visibility: assignee and managers read it; peers and other organisations do not', async () => {
  const a = await createAssignment(db, U.manager)
  await transition(db, U.employee, a, 'accept')
  const q = 'select 1 from public.workforce_assignment_events where assignment_id = $1'
  assert.equal(await count(U.employee, q, [a]), 1)
  assert.equal(await count(U.manager, q, [a]), 1)
  for (const uid of [U.employee2, U.supervisor, U.employeeB, U.managerB]) assert.equal(await count(uid, q, [a]), 0)
})

// ---------------------------------------------------------------- evidence
const objectPath = (org, uid, name) => `${org}/${uid}/${name}`
const evidenceReport = async (uid, date) => asClient(db, uid, async () => (await db.query(
  `insert into public.workforce_daily_reports(work_date, status) values ($1, 'draft') returning id`, [date])).rows[0].id)
const addEvidence = (uid, reportId, path) => asClient(db, uid, () => db.query(
  `insert into public.workforce_evidence(report_id, object_path, file_name, mime_type, byte_size)
   values ($1, $2, 'photo.jpg', 'image/jpeg', 1000)`, [reportId, path]))

test('evidence: only the owner attaches to their own editable report', async () => {
  const report = await evidenceReport(U.employee, '2026-10-20')
  await addEvidence(U.employee, report, objectPath(ORG_A, U.employee, 'own.jpg'))
  await denied(() => addEvidence(U.employee2, report, objectPath(ORG_A, U.employee2, 'foreign-report.jpg')))
  await denied(() => addEvidence(U.manager, report, objectPath(ORG_A, U.manager, 'manager.jpg')))
  await denied(() => addEvidence(U.employee, report, objectPath(ORG_A, U.employee2, 'wrong-folder.jpg')))
  await denied(() => addEvidence(U.employee, report, objectPath(ORG_B, U.employee, 'wrong-org.jpg')))
})

test('evidence: submitted reports are sealed; managers read org evidence; peers and other orgs cannot', async () => {
  const report = await evidenceReport(U.employee, '2026-10-21')
  await addEvidence(U.employee, report, objectPath(ORG_A, U.employee, 'a.jpg'))
  await db.query(`insert into public.workforce_daily_entries(report_id, organisation_id, employee_id, title, started_at, ended_at)
                  values ($1, $2, $3, 'work', '2026-10-21T08:00:00Z', '2026-10-21T09:00:00Z')`, [report, ORG_A, U.employee])
  await db.query(`update public.workforce_daily_reports set summary = 'done', status = 'submitted' where id = $1`, [report])
  await denied(() => addEvidence(U.employee, report, objectPath(ORG_A, U.employee, 'late.jpg')))
  const q = 'select 1 from public.workforce_evidence where report_id = $1'
  assert.equal(await count(U.employee, q, [report]), 1)
  for (const uid of [U.manager, U.director, U.admin]) assert.equal(await count(uid, q, [report]), 1, `manager-level ${uid}`)
  for (const uid of [U.employee2, U.supervisor, U.employeeB, U.managerB]) assert.equal(await count(uid, q, [report]), 0, `blocked ${uid}`)
})

test('evidence files: storage policies follow the evidence rows and folder ownership', async () => {
  const report = await evidenceReport(U.employee2, '2026-10-22')
  const path = objectPath(ORG_A, U.employee2, 'x.pdf')
  await addEvidence(U.employee2, report, path)
  const put = (uid, name) => asClient(db, uid, () => db.query(`insert into storage.objects(bucket_id, name) values ('workforce-evidence', $1)`, [name]))
  await put(U.employee2, path)
  await denied(() => put(U.employee, objectPath(ORG_A, U.employee2, 'someone-elses-folder.pdf')))
  await denied(() => put(U.employee2, objectPath(ORG_B, U.employee2, 'other-org-folder.pdf')))
  const q = `select 1 from storage.objects where bucket_id = 'workforce-evidence' and name = $1`
  assert.equal(await count(U.employee2, q, [path]), 1)
  // Regression: managers could read the evidence rows but not open the files (policy used admin only).
  for (const uid of [U.manager, U.director, U.admin]) assert.equal(await count(uid, q, [path]), 1, `file access ${uid}`)
  for (const uid of [U.employee, U.supervisor, U.employeeB, U.managerB]) assert.equal(await count(uid, q, [path]), 0)
})

test('supervisor role has employee-level access only (documented gap, not an accident)', async () => {
  const sup = await createAssignment(db, U.manager, { assigned_to: U.supervisor })
  assert.equal((await transition(db, U.supervisor, sup, 'start')).result, 'applied')
  const other = await createAssignment(db, U.manager)
  assert.equal(await count(U.supervisor, 'select 1 from public.workforce_assignments where id = $1', [other]), 0)
  assert.equal((await transition(db, U.supervisor, other, 'verify')).reason, 'not_found')
})
