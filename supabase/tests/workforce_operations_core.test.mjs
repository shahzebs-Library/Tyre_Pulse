// Workforce operations core (20261109160000): employee records, qualification-gated assignment,
// audited reassignment, operational-record linking, evidence gates and the board summary.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createWorkforceDb, asClient, asUser, createAssignment, transition, newKey, U, ORG_A, ORG_B, id } from './fixtures/workforce_harness.mjs'

const db = await createWorkforceDb()
after(() => db.close())

const q = (uid, sql, params = []) => asClient(db, uid, async () => (await db.query(sql, params)).rows)
const one = async (uid, sql, params = []) => (await q(uid, sql, params))[0]
const rejects = (fn, re) => assert.rejects(fn, e => { assert.match(String(e.message), re); return true })
const status = async a => (await db.query('select status from public.workforce_assignments where id=$1', [a])).rows[0].status

async function insertAssignment (uid, v) {
  return (await one(uid, `insert into public.workforce_assignments(title,assigned_to,assigned_by,task_type,site,asset_no,override_reason,supporting_employee_ids)
    values ($1,$2,auth.uid(),$3,$4,$5,$6,coalesce($7::uuid[],'{}')) returning id, qualification, override_reason, overridden_by, operational_record_table, asset_no`,
  [v.title || 'Task', v.assigned_to, v.task_type ?? null, v.site ?? null, v.asset_no ?? null, v.override ?? null, v.supporting ?? null]))
}

test('employee records: org-bound, loop-free, and every change is kept in append-only history', async () => {
  await q(U.manager, `insert into public.workforce_employees(profile_id,designation,supervisor_id,sites) values ($1,'Tyre Technician',$2,'{ nhc , riy-met}')`, [U.employee, U.supervisor])
  await q(U.manager, `insert into public.workforce_employees(profile_id,designation,supervisor_id) values ($1,'Workshop Supervisor',$2)`, [U.supervisor, U.manager])
  const e = await one(U.manager, 'select sites, designation from public.workforce_employees where profile_id=$1', [U.employee])
  assert.deepEqual(e.sites, ['NHC', 'RIY-MET'])
  // Manager -> supervisor would make supervisor report (indirectly) to themselves.
  await rejects(() => q(U.manager, `insert into public.workforce_employees(profile_id,designation,supervisor_id) values ($1,'Manager',$2)`, [U.manager, U.employee]), /reporting loop/)
  await rejects(() => q(U.manager, `insert into public.workforce_employees(profile_id,designation) values ($1,'X')`, [U.employeeB]), /organisation|row-level/)
  await rejects(() => q(U.employee, `insert into public.workforce_employees(profile_id,designation) values ($1,'Self promoted')`, [U.employee2]), /row-level/)
  await q(U.manager, `update public.workforce_employees set designation='Senior Tyre Technician' where profile_id=$1`, [U.employee])
  const hist = await q(U.manager, 'select old_values->>$2 o, new_values->>$2 n from public.workforce_employee_history where profile_id=$1 order by changed_at', [U.employee, 'designation'])
  assert.deepEqual(hist.map(h => [h.o, h.n]), [[null, 'Tyre Technician'], ['Tyre Technician', 'Senior Tyre Technician']])
  await rejects(() => asUser(db, U.admin, () => db.query('delete from public.workforce_employee_history')), /append-only/)
  // Supervisor sees the report; a peer employee does not.
  assert.equal((await q(U.supervisor, 'select 1 from public.workforce_employees where profile_id=$1', [U.employee])).length, 1)
  assert.equal((await q(U.employee2, 'select 1 from public.workforce_employees where profile_id=$1', [U.employee])).length, 0)
})

test('safety-critical work: an unqualified employee is refused and no override can bypass it', async () => {
  await q(U.manager, `insert into public.workforce_task_types(task_type,required_skill_id,min_skill_level,required_cert_type,safety_critical,evidence_required,operational_record_table)
    values ('Tyre Change','tyre_change',2,'Wheel Safety',true,true,'tyre_records')`)
  await rejects(() => insertAssignment(U.manager, { assigned_to: U.employee2, task_type: 'tyre change', override: 'Short of staff today' }), /safety-critical.*skill_missing.*certification_invalid/)
  const rec = await one(U.manager, `select * from public.workforce_recommend_assignees('Tyre Change','NHC',now(),10) where profile_id=$1`, [U.employee2])
  assert.equal(rec.safety_blocked, true)
  assert.deepEqual(rec.reasons, ['skill_missing', 'certification_invalid'])
  // Qualify employee one: skill level 2 + a valid certificate. An expired one would not count.
  await db.query(`insert into public.technician_skills(organisation_id,user_id,skill_id,level) values ($1,$2,'tyre_change',2)`, [ORG_A, U.employee])
  await q(U.manager, `insert into public.workforce_employee_certifications(profile_id,cert_type,issued_on,expires_on) values ($1,'wheel safety',current_date-400,current_date-1)`, [U.employee])
  await rejects(() => insertAssignment(U.manager, { assigned_to: U.employee, task_type: 'Tyre Change', site: 'NHC' }), /certification_invalid/)
  await q(U.manager, `insert into public.workforce_employee_certifications(profile_id,cert_type,issued_on,expires_on) values ($1,'Wheel  Safety',current_date-10,current_date+300)`, [U.employee])
  const a = await insertAssignment(U.manager, { assigned_to: U.employee, task_type: 'Tyre Change', site: 'nhc', asset_no: ' tm 514 ' })
  assert.equal(a.qualification.qualified, true)
  assert.equal(a.operational_record_table, 'tyre_records', 'requirement snapshotted onto the assignment')
  assert.equal(a.asset_no, 'TM514')
})

test('soft gaps (site, availability) need a recorded manager override, stamped with who overrode', async () => {
  await rejects(() => insertAssignment(U.manager, { assigned_to: U.employee, task_type: 'Tyre Change', site: 'JED' }), /override reason is required: site_not_assigned/)
  const a = await insertAssignment(U.manager, { assigned_to: U.employee, task_type: 'Tyre Change', site: 'JED', override: 'Cover for JED technician on leave' })
  assert.equal(a.overridden_by, U.manager)
  assert.deepEqual(a.qualification.soft, ['site_not_assigned'])
  await q(U.manager, `update public.workforce_employees set employment_status='inactive' where profile_id=$1`, [U.supervisor])
  await rejects(() => insertAssignment(U.manager, { assigned_to: U.supervisor, override: 'Anyway' }), /not active/)
})

test('status changes only through the audited transition, for managers too', async () => {
  const a = await createAssignment(db, U.manager, {})
  await rejects(() => q(U.manager, `update public.workforce_assignments set status='verified' where id=$1`, [a]), /audited transition/)
  await rejects(() => q(U.employee, `update public.workforce_assignments set status='acknowledged' where id=$1`, [a]), /audited transition/)
  assert.equal(await status(a), 'assigned')
  const noReason = await transition(db, U.employee, a, 'start')
  assert.equal(noReason.ok, true)
  const ok = await transition(db, U.employee, a, 'block', { note: 'No 315/80 in stores', reasonCode: 'waiting_stock' })
  assert.equal(ok.result, 'applied')
  const ev = await one(U.manager, `select reason_code from public.workforce_assignment_events where assignment_id=$1 and action='block'`, [a])
  assert.equal(ev.reason_code, 'waiting_stock')
  await rejects(() => transition(db, U.employee, a, 'resume', { reasonCode: 'made_up' }), /Unknown blocker reason/)
  // An installed field build sends no cause: accepted, recorded as not recorded rather than guessed.
  await transition(db, U.employee, a, 'resume')
  const legacy = await transition(db, U.employee, a, 'block', { note: 'Vehicle left site', reasonCode: null })
  assert.equal(legacy.result, 'applied')
})

test('tyre task: evidence before completion, the real tyre record before verification, and the asset must match', async () => {
  const a = (await insertAssignment(U.manager, { assigned_to: U.employee, task_type: 'Tyre Change', site: 'NHC', asset_no: 'TM514' })).id
  await transition(db, U.employee, a, 'start')
  assert.equal((await transition(db, U.employee, a, 'complete')).reason, 'evidence_required')
  await q(U.employee, `insert into public.workforce_assignment_evidence(assignment_id,object_path,file_name,mime_type,byte_size) values ($1,$2,'fitted.jpg','image/jpeg',2048)`, [a, `${ORG_A}/assignments/${a}/fitted.jpg`])
  await rejects(() => q(U.employee2, `insert into public.workforce_assignment_evidence(assignment_id,object_path,file_name,mime_type,byte_size) values ($1,$2,'x.jpg','image/jpeg',1)`, [a, `${ORG_A}/assignments/${a}/x.jpg`]), /row-level/)
  assert.equal((await transition(db, U.employee, a, 'complete')).result, 'applied')
  assert.equal((await transition(db, U.manager, a, 'verify')).reason, 'record_required')

  const wrongAsset = id(5001), foreign = id(5002), right = id(5003)
  await db.query(`insert into public.tyre_records(id,organisation_id,asset_no) values ($1,$4,'TM600'),($2,$5,'TM514'),($3,$4,'tm 514')`, [wrongAsset, foreign, right, ORG_A, ORG_B])
  const link = (uid, rec) => one(uid, `select public.workforce_link_operational_record($1,'tyre_records',$2,$3) r`, [a, rec, newKey()])
  assert.equal((await link(U.employee, wrongAsset)).r.reason, 'asset_mismatch')
  assert.equal((await link(U.employee, foreign)).r.reason, 'record_not_found', 'another organisation\'s record is invisible')
  assert.equal((await link(U.employee2, right)).r.reason, 'not_found', 'only the assignee or a manager may link')
  await rejects(() => q(U.manager, `update public.workforce_assignments set operational_record_id=$2 where id=$1`, [a, right]), /audited link/)
  assert.equal((await link(U.employee, right)).r.result, 'applied')
  assert.equal((await transition(db, U.manager, a, 'verify', { note: 'Serial and torque checked' })).result, 'applied')

  // The same tyre record cannot back a second piece of work.
  const b = (await insertAssignment(U.manager, { assigned_to: U.employee, task_type: 'Tyre Change', site: 'NHC', asset_no: 'TM514' })).id
  await transition(db, U.employee, b, 'start')
  assert.equal((await one(U.employee, `select public.workforce_link_operational_record($1,'tyre_records',$2,$3) r`, [b, right, newKey()])).r.reason, 'record_already_linked')
})

test('reassignment: re-qualified, audited with previous and new assignee, idempotent; supporters cannot self-review', async () => {
  const a = await createAssignment(db, U.manager, {})
  const key = newKey()
  const r = await one(U.manager, 'select public.workforce_reassign($1,$2,$3,$4) r', [a, U.employee2, 'Shift handover to night crew', key])
  assert.equal(r.r.result, 'applied')
  assert.equal((await one(U.manager, 'select public.workforce_reassign($1,$2,$3,$4) r', [a, U.employee2, 'Shift handover to night crew', key])).r.result, 'replayed')
  const ev = await one(U.manager, `select from_assignee,to_assignee from public.workforce_assignment_events where assignment_id=$1 and action='reassign'`, [a])
  assert.deepEqual([ev.from_assignee, ev.to_assignee], [U.employee, U.employee2])
  assert.equal((await one(U.employee, 'select public.workforce_reassign($1,$2,$3,$4) r', [a, U.employee, 'take back', newKey()])).r.reason, 'not_found')
  await rejects(() => q(U.manager, `update public.workforce_assignments set assigned_to=$2 where id=$1`, [a, U.employee]), /immutable/)

  const s = (await insertAssignment(U.manager, { assigned_to: U.employee, supporting: [U.director, U.employee] })).id
  await transition(db, U.employee, s, 'start'); await transition(db, U.employee, s, 'complete')
  assert.equal((await transition(db, U.director, s, 'verify')).reason, 'self_review')
})

test('board summary counts the whole visible dataset and never another organisation', async () => {
  const mgr = (await one(U.manager, 'select public.workforce_board_summary(null,null,null) s')).s
  const total = Number((await db.query('select count(*) n from public.workforce_assignments where organisation_id=$1', [ORG_A])).rows[0].n)
  assert.equal(mgr.total, total)
  assert.ok(mgr.blocked_by_reason.waiting_stock >= 1)
  const other = (await one(U.managerB, 'select public.workforce_board_summary(null,null,null) s')).s
  assert.equal(other.total, 0)
  const emp = (await one(U.employee2, 'select public.workforce_board_summary(null,null,null) s')).s
  const own = Number((await db.query('select count(*) n from public.workforce_assignments where assigned_to=$1', [U.employee2])).rows[0].n)
  assert.equal(emp.total, own, 'an employee sees only their own work')
})
