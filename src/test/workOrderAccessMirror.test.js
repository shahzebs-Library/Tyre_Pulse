// The work order rights the screen applies (src/lib/workOrderAccess.js) must be the same rules the
// database drafts enforce. This test READS the SQL drafts and fails when the two drift:
//   supabase/pending_migrations/20261115140000_wo_permission_resolver.sql
//   supabase/pending_migrations/20261115140500_wo_policies_and_guards.sql
//   supabase/pending_migrations/20261115141000_wo_supervisor_module_visibility.sql
// The behaviour cases below are the same ones the staging role matrix proves on the database
// (supabase/tests/staging_work_order_permissions.sql).
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  WO_ACTIONS, WO_ADMIN_ONLY_ACTIONS, WO_SCOPES, TYRE_WORK_TYPES, CLOSED_STATUS_KEYS, WO_COLUMN_CLASS,
  DEFAULT_ROLE_RULES, WO_REFUSAL, isTyreWorkOrder, isClosedWorkOrder, defaultScopeForRole,
  legacyWorkOrderAccess, serverWorkOrderAccess, canWorkOrder, requiredActionsForChange,
  checkWorkOrderChange, workOrderRefusalReason, workOrderRefusalFromError, creatableWorkTypes,
  CLOSING_STATUS_KEYS, TECHNICIAN_ROLES, isAssignedOnlyAccess, actionsForStatusMove, statusMoveRefusalReason,
} from '../lib/workOrderAccess'
import {
  isChecklistPathAllowed, supervisorWorkModuleKey, SUPERVISOR_WORK_PATHS,
} from '../lib/checklistAccess'

// The drafts live in pending_migrations until they are applied, then move to migrations.
const read = (name) => {
  const dir = ['supabase/pending_migrations', 'supabase/migrations']
    .find((d) => existsSync(resolve(process.cwd(), d, name)))
  if (!dir) throw new Error(`draft ${name} not found`)
  return readFileSync(resolve(process.cwd(), dir, name), 'utf8').replace(/\r\n/g, '\n')
}
const resolver = read('20261115140000_wo_permission_resolver.sql')
const guards = read('20261115140500_wo_policies_and_guards.sql')
const menu = read('20261115141000_wo_supervisor_module_visibility.sql')

const quoted = (text) => [...text.matchAll(/'([^']*)'/g)].map((m) => m[1])
const sqlArray = (sql, name) => {
  const m = sql.match(new RegExp(`${name}\\s+constant text\\[\\] := array\\[([^\\]]*)\\]`))
  if (!m) throw new Error(`constant ${name} not found in the guard`)
  return quoted(m[1])
}
const body = (sql, fn) => {
  const start = sql.indexOf(`create or replace function public.${fn}(`)
  if (start < 0) throw new Error(`function ${fn} not found`)
  return sql.slice(start, sql.indexOf('$function$;', start))
}

describe('constants mirror the SQL drafts', () => {
  it('seed rules are the same rows, in the same order', () => {
    const seed = resolver.slice(resolver.indexOf('from (values'), resolver.indexOf(') as v(role, actions, scope, qc_scope, cost_scope)'))
    const rows = [...seed.matchAll(/\('([^']+)',\s+array\[([^\]]*)\],\s*'(all|tyre|assigned)',\s*(null|'(?:all|tyre|assigned)'),\s*(null|'(?:all|tyre|assigned)')\)/g)]
      .map((m) => ({ role: m[1], actions: quoted(m[2]), scope: m[3], qcScope: m[4] === 'null' ? null : m[4].slice(1, -1), costScope: m[5] === 'null' ? null : m[5].slice(1, -1) }))
    expect(rows.length).toBe(31)
    expect(rows).toEqual(DEFAULT_ROLE_RULES.map((r) => ({ role: r.role, actions: [...r.actions], scope: r.scope, qcScope: r.qcScope, costScope: r.costScope })))
  })

  it('the technician roles that get the Work Orders menu switch are the seeded technicians', () => {
    expect(TECHNICIAN_ROLES.length).toBe(22)
    const rows = [...menu.matchAll(/\('([^']+)', 'work_orders', null, true\)/g)].map((m) => m[1])
    expect(rows.filter((r) => !['Workshop Supervisor', 'Maintenance Supervisor'].includes(r))).toEqual([...TECHNICIAN_ROLES])
    // Technicians are never given Workshop Live Control.
    const live = [...menu.matchAll(/\('([^']+)', 'workshop_live', null, true\)/g)].map((m) => m[1])
    for (const r of TECHNICIAN_ROLES) expect(live).not.toContain(r)
  })

  it('final closure: the closing statuses are the closed statuses, and the guard asks for close', () => {
    expect([...CLOSING_STATUS_KEYS]).toEqual([...CLOSED_STATUS_KEYS])
    const g = body(guards, 'wo_write_guard')
    expect(g).toContain("v_need_close := 'status' = any (v_keys) and public.work_order_is_closed(NEW.status::text);")
    expect(g).toContain("public.work_order_can('close', OLD.organisation_id")
    // A per-user grant never adds the quality check, assigning or closing.
    expect(body(resolver, 'work_order_scope')).toContain("if v_action in ('create', 'edit', 'progress') and exists (")
  })

  it('actions, scopes and the Admin-only actions', () => {
    const actions = resolver.match(/check \(actions <@ array\[([^\]]*)\]/)
    expect(quoted(actions[1])).toEqual([...WO_ACTIONS])
    const scopes = resolver.match(/check \(scope in \(([^)]*)\)\)/)
    expect(quoted(scopes[1])).toEqual([...WO_SCOPES])
    const adminOnly = body(resolver, 'work_order_can').match(/if v_action in \(([^)]*)\) then return false/)
    expect(quoted(adminOnly[1])).toEqual([...WO_ADMIN_ONLY_ACTIONS])
  })

  it('tyre job types and closed statuses', () => {
    const tyre = body(resolver, 'work_order_is_tyre').match(/in \(([^)]*)\)/)
    expect(quoted(tyre[1])).toEqual(TYRE_WORK_TYPES.map((t) => t.toLowerCase()))
    const closed = body(resolver, 'work_order_is_closed').match(/in \(([^)]*)\)/)
    expect(quoted(closed[1])).toEqual([...CLOSED_STATUS_KEYS])
  })

  it('column classes of the write guard', () => {
    expect(sqlArray(guards, 'c_ignore')).toEqual(WO_COLUMN_CLASS.ignore)
    expect(sqlArray(guards, 'c_admin')).toEqual(WO_COLUMN_CLASS.admin)
    expect(sqlArray(guards, 'c_baseline')).toEqual(WO_COLUMN_CLASS.baseline)
    expect(sqlArray(guards, 'c_cost')).toEqual(WO_COLUMN_CLASS.cost)
    expect(sqlArray(guards, 'c_assign')).toEqual(WO_COLUMN_CLASS.assign)
    expect(sqlArray(guards, 'c_qc')).toEqual(WO_COLUMN_CLASS.qc)
    expect(sqlArray(guards, 'c_progress')).toEqual(WO_COLUMN_CLASS.progress)
    for (const k of WO_COLUMN_CLASS.kept) expect(guards).toContain(`NEW.${k} := OLD.${k};`)
  })

  it('every sentence the guards raise is one the screen can show verbatim', () => {
    const raised = [...guards.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1])
    expect(raised.length).toBeGreaterThanOrEqual(9)
    const known = Object.values(WO_REFUSAL)
    for (const sentence of raised) expect(known).toContain(sentence)
  })

  it('refusals are 42501, never 40001 (a retry loop) and never a raw code to the user', () => {
    expect(guards).not.toMatch(/40001/)
    expect(resolver).not.toMatch(/40001/)
    const codes = [...guards.matchAll(/errcode = '([^']+)'/g)].map((m) => m[1])
    expect(new Set(codes)).toEqual(new Set(['42501']))
    for (const s of Object.values(WO_REFUSAL)) expect(s).not.toMatch(/[–—]/)
  })
})

// ── behaviour: the same cases the staging matrix proves on the database ─────────────────────────
const A = (o) => serverWorkOrderAccess(o)
const ALL = { create: 'all', edit: 'all', assign: 'all', progress: 'all', qc: 'all', close: 'all', cost: 'all', cost_approve: 'all' }
const manager = A(ALL)
const engineer = A({ create: 'tyre', edit: 'tyre', assign: 'tyre', progress: 'tyre', qc: 'tyre', close: 'tyre' })
const technician = A({ progress: 'assigned' })
const collector = A({ create: 'all', edit: 'all', progress: 'all', qc: 'assigned', cost: 'assigned' })
const nobody = A({})
const admin = A({ admin: true, ...ALL })
const open = { id: 'w1', status: 'In Progress', work_type: 'Repair' }
const closed = { id: 'w2', status: 'Completed', work_type: 'Repair' }
const legacyClosed = { id: 'w3', status: 'Closed' }
const tyreJob = { id: 'w4', status: 'New', work_type: 'Tyre Change' }
const mine = { id: 'w5', status: 'Assigned', assigned_owner_id: 'me' }
const ctx = { userId: 'me', assignedJobIds: new Set(['w6']) }

describe('canWorkOrder', () => {
  it('manager and supervisor: everything on an open job, nothing on a closed one, never delete', () => {
    for (const a of WO_ACTIONS) expect(canWorkOrder(a, manager, open)).toBe(true)
    // The cost ledger stays open on a closed job; everything else is locked.
    expect(canWorkOrder('cost', manager, closed)).toBe(true)
    for (const a of ['edit', 'assign', 'progress', 'qc', 'close']) {
      expect(canWorkOrder(a, manager, closed)).toBe(false)
      expect(canWorkOrder(a, manager, legacyClosed)).toBe(false)
    }
    for (const a of WO_ADMIN_ONLY_ACTIONS) expect(canWorkOrder(a, manager, open)).toBe(false)
  })

  it('admin: everything, including closed, approved cost and delete', () => {
    for (const a of [...WO_ACTIONS, ...WO_ADMIN_ONLY_ACTIONS]) expect(canWorkOrder(a, admin, closed)).toBe(true)
  })

  it('tyre engineer: tyre work only', () => {
    expect(canWorkOrder('edit', engineer, tyreJob)).toBe(true)
    expect(canWorkOrder('assign', engineer, tyreJob)).toBe(true)
    expect(canWorkOrder('edit', engineer, open)).toBe(false)
    expect(canWorkOrder('edit', engineer, { id: 'x', status: 'New', work_type: 'Repair', tyre_serial: 'S1' })).toBe(true)
    expect(canWorkOrder('create', engineer)).toBe(true)
    expect(creatableWorkTypes(engineer, ['Repair', 'Tyre Change', 'Other'])).toEqual(['Tyre Change'])
    expect(creatableWorkTypes(manager, ['Repair', 'Tyre Change'])).toEqual(['Repair', 'Tyre Change'])
  })

  it('technician: progress on an assigned job only', () => {
    expect(canWorkOrder('progress', technician, mine, ctx)).toBe(true)
    expect(canWorkOrder('progress', technician, { id: 'w6', status: 'New' }, ctx)).toBe(true)
    expect(canWorkOrder('progress', technician, open, ctx)).toBe(false)
    for (const a of ['create', 'edit', 'assign', 'qc', 'close', 'delete']) expect(canWorkOrder(a, technician, mine, ctx)).toBe(false)
    expect(canWorkOrder('progress', technician, { ...mine, status: 'Completed' }, ctx)).toBe(false)
  })

  it('Tyre Data Collector: create and update anywhere, quality check on assigned jobs, no assign, close or delete', () => {
    expect(canWorkOrder('create', collector)).toBe(true)
    expect(canWorkOrder('edit', collector, open)).toBe(true)
    expect(canWorkOrder('progress', collector, open)).toBe(true)
    expect(canWorkOrder('assign', collector, open)).toBe(false)
    expect(canWorkOrder('qc', collector, open, ctx)).toBe(false)
    expect(canWorkOrder('qc', collector, mine, ctx)).toBe(true)
    expect(canWorkOrder('close', collector, mine, ctx)).toBe(false)
    expect(canWorkOrder('delete', collector, mine, ctx)).toBe(false)
    expect(canWorkOrder('approved_cost', collector, mine, ctx)).toBe(false)
    expect(checkWorkOrderChange(collector, mine, ['status', 'qc_status'], { newStatus: 'Completed', ctx }))
      .toEqual({ ok: false, reason: WO_REFUSAL.close })
    expect(checkWorkOrderChange(collector, mine, ['qc_status'], { ctx }).ok).toBe(true)
    expect(checkWorkOrderChange(collector, open, ['qc_status'], { ctx })).toEqual({ ok: false, reason: WO_REFUSAL.qcAssignedOnly })
    expect(checkWorkOrderChange(collector, open, ['status'], { newStatus: 'Cancelled', ctx }).ok).toBe(false)
    expect(checkWorkOrderChange(collector, open, ['status'], { newStatus: 'Quality Inspection', ctx }).ok).toBe(true)
    expect(defaultScopeForRole('Tyre Data Collector', 'qc')).toBe('assigned')
    expect(defaultScopeForRole('Tyre Data Collector', 'close')).toBe(null)
    // Costs: draft entries on assigned work only; never approval; never the stored parts cost.
    expect(canWorkOrder('cost', collector, mine, ctx)).toBe(true)
    expect(canWorkOrder('cost', collector, open, ctx)).toBe(false)
    expect(canWorkOrder('cost_approve', collector, mine, ctx)).toBe(false)
    expect(defaultScopeForRole('Tyre Data Collector', 'cost')).toBe('assigned')
    expect(defaultScopeForRole('Workshop Supervisor', 'cost_approve')).toBe(null)
    expect(defaultScopeForRole('Manager', 'cost_approve')).toBe('all')
    expect(checkWorkOrderChange(manager, open, ['parts_cost'])).toEqual({ ok: false, reason: WO_REFUSAL.baseline })
  })

  it('closure, cost approval and assigning never come from the generic Access Control switches', () => {
    const scope = body(resolver, 'work_order_scope')
    expect(scope).toContain("if v_action in ('create', 'edit', 'progress') and exists (")
    expect(scope).toContain("if v_action in ('create', 'edit', 'progress', 'qc', 'cost') and public.app_user_can('work_orders', v_cap) then")
    // Before the drafts are applied there is no ledger: nobody has a cost right from the old rules.
    const old = legacyWorkOrderAccess({ role: 'Manager', serverCaps: { create: true, edit: true } })
    expect(old.cost).toBe(null)
    expect(old.cost_approve).toBe(null)
    expect(canWorkOrder('cost', old, open)).toBe(false)
    for (const a of WO_ACTIONS) expect(canWorkOrder(a, nobody, open)).toBe(false)
  })

  it('unknown is never a guess', () => {
    expect(canWorkOrder('edit', null, open)).toBe(null)
    const unread = legacyWorkOrderAccess({ role: 'Manager', serverCaps: null })
    expect(canWorkOrder('edit', unread, open)).toBe(null)
    expect(canWorkOrder('assign', unread, open)).toBe(true)
  })
})

describe('before the drafts are applied the screen mirrors today', () => {
  it('create and edit follow app_user_can, assigning follows the elevated roles, no closed lock', () => {
    const mgr = legacyWorkOrderAccess({ role: 'Manager', serverCaps: { create: false, edit: false } })
    expect(canWorkOrder('create', mgr)).toBe(false)
    expect(canWorkOrder('edit', mgr, open)).toBe(false)
    expect(canWorkOrder('assign', mgr, open)).toBe(true)
    const col = legacyWorkOrderAccess({ role: 'Tyre Data Collector', serverCaps: { create: true, edit: true } })
    expect(canWorkOrder('edit', col, closed)).toBe(true)
    expect(canWorkOrder('assign', col, open)).toBe(false)
    const adm = legacyWorkOrderAccess({ role: 'Admin' })
    expect(canWorkOrder('delete', adm, closed)).toBe(true)
    expect(canWorkOrder('delete', mgr, open)).toBe(false)
  })
})

describe('what a change needs', () => {
  it('classifies columns the way the guard does', () => {
    expect(requiredActionsForChange(['notes', 'status'], { newStatus: 'In Progress' }))
      .toMatchObject({ progress: true, edit: false, assign: false, qc: false })
    expect(requiredActionsForChange(['status'], { newStatus: 'Cancelled' })).toMatchObject({ edit: true })
    expect(requiredActionsForChange(['assigned_owner_id', 'technician_name', 'status'], { newStatus: 'Assigned' }))
      .toMatchObject({ assign: true, progress: false, edit: false })
    expect(requiredActionsForChange(['assigned_owner_id', 'status'], { newStatus: 'In Progress' }))
      .toMatchObject({ assign: true, progress: true })
    expect(requiredActionsForChange(['qc_status', 'status'], { newStatus: 'Completed' }))
      .toMatchObject({ qc: true, progress: true, edit: false, close: true })
    expect(requiredActionsForChange(['status'], { newStatus: 'Closed' })).toMatchObject({ close: true, edit: false })
    expect(requiredActionsForChange(['status'], { newStatus: 'Cancelled' })).toMatchObject({ close: true, edit: true })
    expect(requiredActionsForChange(['status'], { newStatus: 'Quality Inspection' })).toMatchObject({ close: false, progress: true })
    expect(requiredActionsForChange(['parts_cost'])).toMatchObject({ cost: true, edit: true })
    expect(requiredActionsForChange(['priority', 'site'])).toMatchObject({ edit: true })
    expect(requiredActionsForChange(['organisation_id'])).toMatchObject({ adminOnly: true })
    expect(requiredActionsForChange(['updated_at', 'created_by', 'total_cost']))
      .toEqual({ adminOnly: false, baseline: false, cost: false, edit: false, assign: false, qc: false, progress: false, close: false })
  })

  it('checks a whole change with a plain reason', () => {
    expect(checkWorkOrderChange(manager, closed, ['notes'])).toEqual({ ok: false, reason: WO_REFUSAL.closed })
    expect(checkWorkOrderChange(manager, { ...open, execution_approval_id: 'e1' }, ['labour_cost']))
      .toEqual({ ok: false, reason: WO_REFUSAL.approvedCost })
    expect(checkWorkOrderChange(manager, { ...open, execution_approval_id: 'e1' }, ['description']).ok).toBe(true)
    expect(checkWorkOrderChange(manager, open, ['labour_cost']).ok).toBe(true)
    expect(checkWorkOrderChange(technician, mine, ['status', 'notes'], { newStatus: 'Quality Inspection', ctx }).ok).toBe(true)
    expect(checkWorkOrderChange(technician, mine, ['status', 'notes'], { newStatus: 'Completed', ctx }))
      .toEqual({ ok: false, reason: WO_REFUSAL.close })
    expect(checkWorkOrderChange(technician, mine, ['priority'], { ctx }).ok).toBe(false)
    expect(checkWorkOrderChange(technician, mine, ['assigned_owner_id'], { ctx })).toEqual({ ok: false, reason: WO_REFUSAL.assign })
    expect(checkWorkOrderChange(collector, open, ['assigned_owner_id']).ok).toBe(false)
    expect(checkWorkOrderChange(admin, closed, ['parts_cost', 'organisation_id']).ok).toBe(true)
    expect(checkWorkOrderChange(null, open, ['notes']).ok).toBe(null)
  })

  it('reasons are plain sentences, empty when allowed', () => {
    expect(workOrderRefusalReason('edit', manager, open)).toBe('')
    expect(workOrderRefusalReason('edit', manager, closed)).toBe(WO_REFUSAL.closed)
    expect(workOrderRefusalReason('delete', manager, open)).toBe(WO_REFUSAL.delete)
    expect(workOrderRefusalReason('edit', engineer, open)).toBe(WO_REFUSAL.tyreOnly)
    expect(workOrderRefusalReason('progress', technician, open, ctx)).toBe(WO_REFUSAL.assignedOnly)
    expect(workOrderRefusalReason('create', nobody)).toBe(WO_REFUSAL.create)
    expect(workOrderRefusalReason('assign', collector, open)).toBe(WO_REFUSAL.assign)
    // W8: a technician on somebody else's job is told it is not theirs, not "you can record progress".
    expect(workOrderRefusalReason('edit', technician, open, ctx)).toBe(WO_REFUSAL.assignedOnly)
    expect(workOrderRefusalReason('edit', technician, mine, ctx)).toBe(WO_REFUSAL.edit)
    expect(workOrderRefusalReason('qc', collector, open, ctx)).toBe(WO_REFUSAL.qcAssignedOnly)
  })

  it('status moves: which rights, and the reason shown on a disabled button', () => {
    expect(actionsForStatusMove('In Progress')).toEqual(['progress'])
    expect(actionsForStatusMove('Completed')).toEqual(['progress', 'close'])
    expect(actionsForStatusMove('Cancelled')).toEqual(['edit', 'close'])
    expect(statusMoveRefusalReason('In Progress', technician, mine, ctx)).toBe('')
    expect(statusMoveRefusalReason('Completed', technician, mine, ctx)).toBe(WO_REFUSAL.close)
    expect(statusMoveRefusalReason('In Progress', technician, open, ctx)).toBe(WO_REFUSAL.assignedOnly)
    expect(statusMoveRefusalReason('Completed', manager, open)).toBe('')
    expect(statusMoveRefusalReason('Completed', collector, open)).toBe(WO_REFUSAL.close)
    expect(statusMoveRefusalReason('Completed', null, open)).toBe('')
  })

  it('assigned-only people are recognised only from a server answer', () => {
    expect(isAssignedOnlyAccess(technician)).toBe(true)
    expect(isAssignedOnlyAccess(collector)).toBe(false)
    expect(isAssignedOnlyAccess(manager)).toBe(false)
    expect(isAssignedOnlyAccess(admin)).toBe(false)
    expect(isAssignedOnlyAccess(nobody)).toBe(false)
    expect(isAssignedOnlyAccess(null)).toBe(false)
    expect(isAssignedOnlyAccess(legacyWorkOrderAccess({ role: 'Tyre Man', serverCaps: { create: false, edit: false } }))).toBe(false)
  })

  it('only our own sentences pass through from a database error', () => {
    const err = Object.assign(new Error('You do not have permission to do that.'), {
      cause: { code: '42501', message: WO_REFUSAL.closed },
    })
    expect(workOrderRefusalFromError(err)).toBe(WO_REFUSAL.closed)
    expect(workOrderRefusalFromError(Object.assign(new Error('x'), {
      cause: { message: 'new row violates row-level security policy for table "work_orders"' },
    }))).toBe('')
    expect(workOrderRefusalFromError(null)).toBe('')
  })
})

describe('helpers', () => {
  it('tyre and closed detection', () => {
    expect(isTyreWorkOrder({ work_type: ' rotation ' })).toBe(true)
    expect(isTyreWorkOrder({ work_type: 'Repair', tyre_position: 'LHF1' })).toBe(true)
    expect(isTyreWorkOrder({ work_type: 'Inspection' })).toBe(false)
    expect(isTyreWorkOrder(null)).toBe(false)
    for (const s of ['Completed', 'closed', ' Cancelled ']) expect(isClosedWorkOrder({ status: s })).toBe(true)
    for (const s of ['New', 'In Progress', 'Quality Inspection', '', null]) expect(isClosedWorkOrder({ status: s })).toBe(false)
  })

  it('built-in defaults by role', () => {
    expect(defaultScopeForRole('Manager', 'assign')).toBe('all')
    expect(defaultScopeForRole('workshop supervisor', 'create')).toBe('all')
    expect(defaultScopeForRole('Tire Planning Engineer', 'edit')).toBe('tyre')
    expect(defaultScopeForRole('Tyre Man', 'progress')).toBe('assigned')
    expect(defaultScopeForRole('Tyre Man', 'create')).toBe(null)
    expect(defaultScopeForRole('Tyre Data Collector', 'edit')).toBe('all')
    expect(defaultScopeForRole('Data Monitor Officer', 'edit')).toBe(null)
    expect(defaultScopeForRole('Driver', 'progress')).toBe(null)
  })

  it('server answer is normalised, junk scopes become not allowed', () => {
    expect(serverWorkOrderAccess({ admin: true, create: 'all', edit: 'everything', all_sites: true }))
      .toEqual({ provisioned: true, admin: true, create: 'all', edit: null, assign: null, progress: null, qc: null, close: null, cost: null, cost_approve: null, all_sites: true })
  })
})

describe('supervisor routes open only when the module is switched on', () => {
  const on = (k) => k === 'work_orders'
  it('work paths need their module; checklist paths never did', () => {
    expect(Object.keys(SUPERVISOR_WORK_PATHS)).toEqual(['/work-orders', '/workshop-live'])
    expect(supervisorWorkModuleKey('/work-orders/123')).toBe('work_orders')
    expect(supervisorWorkModuleKey('/workshop-live')).toBe('workshop_live')
    expect(supervisorWorkModuleKey('/workshop-settings')).toBe(null)
    expect(isChecklistPathAllowed('/work-orders')).toBe(false)
    expect(isChecklistPathAllowed('/work-orders', on)).toBe(true)
    expect(isChecklistPathAllowed('/workshop-live', on)).toBe(false)
    expect(isChecklistPathAllowed('/checklists', () => false)).toBe(true)
    expect(isChecklistPathAllowed('/fleet-master', () => true)).toBe(false)
  })
})
