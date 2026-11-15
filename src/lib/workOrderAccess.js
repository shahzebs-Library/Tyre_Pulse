/**
 * Work order rights, as the screen needs them.
 *
 * This is the MIRROR of the database resolver drafted in
 *   supabase/pending_migrations/20261115160000_wo_permission_resolver.sql   (work_order_can, seed)
 *   supabase/pending_migrations/20261115160500_wo_policies_and_guards.sql   (wo_write_guard)
 * It exists so a control the database is going to refuse is disabled with the
 * reason beside it. It is NOT a security boundary: the policies and the guard
 * are. Change the SQL and this file together; src/test/workOrderAccessMirror.test.js
 * reads the SQL and fails when the two drift.
 *
 * The person's own answer comes from the server (work_order_my_access): a scope
 * per action. This file only applies that answer to a row:
 *   'all'       every work order the person can see
 *   'tyre'      tyre work only
 *   'assigned'  only work orders assigned to the person
 *   null        not allowed
 */

/** Actions a company can give a role. */
export const WO_ACTIONS = Object.freeze(['create', 'edit', 'assign', 'progress', 'qc'])

/** Never configurable: Admin and super admin only. */
export const WO_ADMIN_ONLY_ACTIONS = Object.freeze(['delete', 'override_closed', 'approved_cost'])

export const WO_SCOPES = Object.freeze(['all', 'tyre', 'assigned'])

/** Tyre job types. MIRROR of public.work_order_is_tyre(). */
export const TYRE_WORK_TYPES = Object.freeze([
  'Tyre Change', 'Rotation', 'Balancing', 'Alignment', 'Retread', 'Puncture Repair', 'Pressure Check',
])

/** Closed statuses, lower case. MIRROR of public.work_order_is_closed(). */
export const CLOSED_STATUS_KEYS = Object.freeze(['completed', 'closed', 'cancelled', 'canceled'])

/** Which right a changed column needs. MIRROR of the constants in public.wo_write_guard(). */
export const WO_COLUMN_CLASS = Object.freeze({
  ignore: ['updated_at', 'total_cost', 'execution_approval_id'],
  // Kept as stored by the guard for everyone but an Admin (never a refusal).
  kept: ['created_by', 'created_at'],
  admin: ['id', 'organisation_id', 'source_row', 'client_uuid'],
  cost: ['labour_cost', 'parts_cost', 'tyre_cost', 'lubricant_cost', 'outside_repair_cost', 'labour_rate'],
  assign: ['assigned_owner_id', 'technician_name'],
  qc: ['qc_status'],
  progress: ['status', 'started_at', 'completed_at', 'notes', 'labour_hours', 'manpower_hours',
    'waiting_parts_hours', 'waiting_manpower_hours', 'odometer', 'vor', 'vor_since', 'parts_used'],
})

const ALL_FIVE = ['create', 'edit', 'assign', 'progress', 'qc']
const TECH = ['progress']
const rule = (role, actions, scope) => Object.freeze({ role, actions: Object.freeze(actions), scope })

/**
 * The built-in defaults every company starts from (owner decision 2026-11-15).
 * MIRROR of the seed in 20261115160000. A company can replace any row for
 * itself in work_order_role_rules; the server answer always wins over this list.
 */
export const DEFAULT_ROLE_RULES = Object.freeze([
  rule('Manager', ALL_FIVE, 'all'),
  rule('Director', ALL_FIVE, 'all'),
  rule('Workshop Supervisor', ALL_FIVE, 'all'),
  rule('Maintenance Supervisor', ALL_FIVE, 'all'),
  rule('Workshop Area Manager', ALL_FIVE, 'all'),
  rule('Workshop Maintenance Area Manager', ALL_FIVE, 'all'),
  rule('Tire Planning Engineer', ALL_FIVE, 'tyre'),
  rule('Tyre Engineer', ALL_FIVE, 'tyre'),
  rule('Tyre Man', TECH, 'assigned'),
  rule('Mechanic', TECH, 'assigned'),
  rule('Electrician', TECH, 'assigned'),
  rule('Diesel Mechanic', TECH, 'assigned'),
  rule('Plant Mechanic', TECH, 'assigned'),
  rule('Assistant Plant Mechanic', TECH, 'assigned'),
  rule('Hydraulic Mechanic', TECH, 'assigned'),
  rule('Auto Electrician', TECH, 'assigned'),
  rule('Plant Electrician', TECH, 'assigned'),
  rule('Senior Technician', TECH, 'assigned'),
  rule('Senior Plant Technician', TECH, 'assigned'),
  rule('Senior Plant & Chiller Technician', TECH, 'assigned'),
  rule('Ice Plant Technician', TECH, 'assigned'),
  rule('Welder', TECH, 'assigned'),
  rule('Welder Cum Fabricator', TECH, 'assigned'),
  rule('Painter', TECH, 'assigned'),
  rule('Denter', TECH, 'assigned'),
  rule('Concrete Breaker', TECH, 'assigned'),
  rule('Helper Workshop', TECH, 'assigned'),
  rule('Helper Plant', TECH, 'assigned'),
  rule('Helper PMV', TECH, 'assigned'),
  rule('Helper Ice Plant', TECH, 'assigned'),
])

const norm = (v) => String(v ?? '').trim().toLowerCase()
const blank = (v) => String(v ?? '').trim() === ''

/** A tyre job: a tyre job type, or a job that names a tyre. */
export function isTyreWorkOrder(row) {
  if (!row) return false
  return TYRE_WORK_TYPES.some((t) => norm(t) === norm(row.work_type))
    || !blank(row.tyre_serial) || !blank(row.tyre_position)
}

/** A closed work order (Completed, Closed, Cancelled). */
export function isClosedWorkOrder(row) {
  return !!row && CLOSED_STATUS_KEYS.includes(norm(row.status))
}

/** The built-in default scope a role has for an action (no company override, no grant). */
export function defaultScopeForRole(role, action, rules = DEFAULT_ROLE_RULES) {
  const r = rules.find((x) => norm(x.role) === norm(role))
  if (!r) return null
  return r.actions.includes(action) ? r.scope : null
}

/**
 * The access object used before the resolver exists on the database (the drafts
 * are not applied yet). It mirrors TODAY's policies: create and edit come from
 * app_user_can, assigning from the three elevated roles, deleting from Admin,
 * and there is no closed or approved-cost lock.
 *
 * @param {{role?:string, isSuperAdmin?:boolean, serverCaps?:{create?:boolean|null, edit?:boolean|null}|null}} who
 */
export function legacyWorkOrderAccess({ role, isSuperAdmin = false, serverCaps = null } = {}) {
  const r = norm(role).replace(/\s+/g, '_')
  const admin = isSuperAdmin === true || r === 'admin'
  const cap = (k) => {
    if (admin) return 'all'
    const v = serverCaps ? serverCaps[k] : null
    if (v === true) return 'all'
    if (v === false) return null
    return undefined   // could not be read: unknown, never a guess
  }
  const edit = cap('edit')
  return {
    provisioned: false,
    admin,
    create: cap('create'),
    edit,
    progress: edit,
    qc: edit,
    assign: admin || r === 'manager' || r === 'director' ? 'all' : null,
    all_sites: true,
  }
}

/** Normalise the server's work_order_my_access() answer. */
export function serverWorkOrderAccess(json) {
  const scope = (v) => (WO_SCOPES.includes(v) ? v : null)
  return {
    provisioned: true,
    admin: json?.admin === true,
    create: scope(json?.create),
    edit: scope(json?.edit),
    assign: scope(json?.assign),
    progress: scope(json?.progress),
    qc: scope(json?.qc),
    all_sites: json?.all_sites === true,
  }
}

function scopeAllows(scope, row, ctx) {
  if (scope === 'all') return true
  if (scope === 'tyre') return row ? isTyreWorkOrder(row) : true
  if (scope === 'assigned') {
    if (!row) return false
    if (ctx?.userId && row.assigned_owner_id === ctx.userId) return true
    return !!(ctx?.assignedJobIds && typeof ctx.assignedJobIds.has === 'function' && ctx.assignedJobIds.has(row.id))
  }
  return false
}

/**
 * May this person do `action` on `row`?
 *
 * @param {string} action  create | edit | assign | progress | qc | delete | override_closed | approved_cost
 * @param {object|null} access  from serverWorkOrderAccess / legacyWorkOrderAccess; null = not loaded
 * @param {object} [row]  the work order (omit for "may I create at all")
 * @param {{userId?:string, assignedJobIds?:Set<string>}} [ctx]
 * @returns {boolean|null}  null = unknown (not loaded or unreadable). A control is never
 *   hidden on null; the save reports a refusal honestly.
 */
export function canWorkOrder(action, access, row, ctx) {
  if (!access) return null
  if (access.admin) return true
  if (WO_ADMIN_ONLY_ACTIONS.includes(action)) return false
  if (!WO_ACTIONS.includes(action)) return false
  if (access.provisioned && action !== 'create' && isClosedWorkOrder(row)) return false
  // The guard lets a person with the right to edit also record progress.
  const scopes = action === 'progress' ? [access.progress, access.edit] : [access[action]]
  if (scopes.every((s) => s === undefined)) return null
  return scopes.some((s) => scopeAllows(s, row, ctx))
}

/**
 * Which rights a change needs, from the columns it touches.
 * MIRROR of the decision in public.wo_write_guard().
 *
 * @param {string[]} changedKeys
 * @param {{newStatus?:string}} [opts]
 * @returns {{adminOnly:boolean, cost:boolean, edit:boolean, assign:boolean, qc:boolean, progress:boolean}}
 */
export function requiredActionsForChange(changedKeys, { newStatus } = {}) {
  const C = WO_COLUMN_CLASS
  const keys = (changedKeys || []).filter((k) => !C.ignore.includes(k) && !C.kept.includes(k))
  const has = (list) => keys.some((k) => list.includes(k))
  const assign = has(C.assign)
  const statusKey = norm(newStatus)
  const statusIsAssigning = assign && keys.includes('status')
    && ['assigned', 'awaiting assignment'].includes(statusKey)
  const progress = keys.some((k) => C.progress.includes(k) && !(k === 'status' && statusIsAssigning))
  const edit = keys.some((k) => !C.progress.includes(k) && !C.assign.includes(k) && !C.qc.includes(k))
    || (keys.includes('status') && ['cancelled', 'canceled'].includes(statusKey))
  return { adminOnly: has(C.admin), cost: has(C.cost), edit, assign, qc: has(C.qc), progress }
}

export const WO_REFUSAL = Object.freeze({
  closed: 'This work order is closed. Only an Admin can change a closed work order.',
  approvedCost: 'The cost of this work order was approved. Only an Admin can change an approved cost.',
  adminOnly: 'Only an Admin can change the company or import reference of a work order.',
  delete: 'Only an Admin can delete a work order.',
  create: 'Your role cannot create work orders. An Admin can change this for your role or your account.',
  createTyreOnly: 'Your role can create tyre work orders only.',
  edit: 'You can record progress on this work order but not change its details. Ask a supervisor or an Admin.',
  assign: 'You are not allowed to assign this work order.',
  qc: 'You are not allowed to record the quality check for this work order.',
  progress: 'You are not allowed to record progress on this work order.',
  tyreOnly: 'Your role manages tyre work orders only.',
  assignedOnly: 'You can update work orders assigned to you only.',
  taskStatusOnly: 'You can update the status of your task only. Ask a supervisor to change the task itself.',
})

/** Plain sentence for a disabled control. Empty string when the action is allowed or unknown. */
export function workOrderRefusalReason(action, access, row, ctx) {
  const ok = canWorkOrder(action, access, row, ctx)
  if (ok !== false) return ''
  if (action === 'delete') return WO_REFUSAL.delete
  if (action === 'approved_cost') return WO_REFUSAL.approvedCost
  if (access?.provisioned && action !== 'create' && isClosedWorkOrder(row)) return WO_REFUSAL.closed
  const scope = action === 'progress' ? (access?.progress || access?.edit) : access?.[action]
  if (scope === 'tyre') return action === 'create' ? WO_REFUSAL.createTyreOnly : WO_REFUSAL.tyreOnly
  if (scope === 'assigned') return WO_REFUSAL.assignedOnly
  return WO_REFUSAL[action] || WO_REFUSAL.edit
}

/**
 * Check a whole change (an edit form save, a status move) before sending it.
 *
 * @returns {{ok:boolean|null, reason:string}}  ok null = unknown, send it and let the server answer
 */
export function checkWorkOrderChange(access, row, changedKeys, { newStatus, ctx } = {}) {
  if (!access) return { ok: null, reason: '' }
  if (access.admin) return { ok: true, reason: '' }
  const need = requiredActionsForChange(changedKeys, { newStatus })
  if (access.provisioned) {
    if (isClosedWorkOrder(row)) return { ok: false, reason: WO_REFUSAL.closed }
    if (need.adminOnly) return { ok: false, reason: WO_REFUSAL.adminOnly }
    if (need.cost && row?.execution_approval_id) return { ok: false, reason: WO_REFUSAL.approvedCost }
  }
  let unknown = false
  for (const action of ['edit', 'assign', 'qc', 'progress']) {
    if (!need[action]) continue
    const ok = canWorkOrder(action, access, row, ctx)
    if (ok === false) return { ok: false, reason: workOrderRefusalReason(action, access, row, ctx) }
    if (ok === null) unknown = true
  }
  return { ok: unknown ? null : true, reason: '' }
}

/** Job types the person may pick when creating (tyre scope narrows the list). */
export function creatableWorkTypes(access, allTypes) {
  if (access && !access.admin && access.create === 'tyre') {
    return allTypes.filter((t) => TYRE_WORK_TYPES.some((x) => norm(x) === norm(t)))
  }
  return allTypes
}

/**
 * The plain sentence the database guard raised, when the error carries one of
 * ours. Only the exact sentences in WO_REFUSAL are ever returned, so no raw
 * database text can reach the screen through this.
 *
 * @param {unknown} err  an error from the service layer (the original is on `.cause`)
 * @returns {string}  '' when the error is not one of the guard's refusals
 */
export function workOrderRefusalFromError(err) {
  const texts = [err?.cause?.message, err?.message, err?.cause?.details].filter((x) => typeof x === 'string')
  for (const sentence of Object.values(WO_REFUSAL)) {
    if (texts.some((x) => x.includes(sentence))) return sentence
  }
  return ''
}
