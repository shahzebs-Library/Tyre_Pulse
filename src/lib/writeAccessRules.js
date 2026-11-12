/**
 * Which roles the DATABASE lets write each table.
 *
 * This is a mirror of the live row level security policies, read from
 * pg_policies on 2026-11-12. It exists so a page can hide or disable a control
 * the database is going to refuse, and say why, instead of letting someone fill
 * a form and then meet a permission error. It is NOT a security boundary: the
 * policies are. When a policy changes, change this table in the same pull
 * request (src/test/writeAccessRules.test.js pins every row).
 *
 * Two ways a write is allowed, and a table can use either or both:
 *   roles      a role named in a role policy (compared in the normalised form
 *              the database uses: lower case, spaces as underscores)
 *   capability the module key the table's `*_cap_*` policy passes to
 *              app_user_can(). Admin and super admin always pass; anyone else
 *              needs the capability switched on for their role or granted to
 *              them in Access Control. The answer is asked of the server, never
 *              guessed here.
 * Deleting is Admin only on every table below (admin_only_delete_guard).
 */

export const normRole = (role) => String(role ?? '').trim().toLowerCase().replace(/\s+/g, '_')

export const WRITE_RULES = Object.freeze({
  // Capability only. Managers are NOT in a role policy today; the pending
  // migration 20261113130000 adds Admin, Manager and Director. The Work Orders
  // and Workshop Live pages ask the server (getWorkOrderAccess) so they are
  // right both before and after it is applied.
  work_orders: { capability: 'work_orders', create: [], edit: [] },
  vehicle_fleet: { capability: 'fleet_master', create: [], edit: [] },
  budgets: { capability: 'budgets', create: ['admin'], edit: ['admin'] },
  tyre_records: {
    capability: 'tyre_records',
    create: ['admin', 'manager', 'inspector', 'tyre_man'],
    edit: ['admin', 'manager'],
  },
  inspections: {
    capability: 'inspections',
    create: ['admin', 'manager', 'inspector', 'tyre_man'],
    edit: ['admin', 'manager', 'inspector'],
  },
  corrective_actions: {
    capability: 'corrective_actions',
    create: ['reporter', 'manager', 'admin'],
    edit: ['manager', 'admin'],
  },
  // Role policies only, no capability policy.
  sites: { capability: null, create: ['admin', 'manager'], edit: ['admin', 'manager'] },
  kpi_targets: { capability: null, create: ['manager', 'admin'], edit: ['manager', 'admin'] },
})

const ROLE_LABEL = {
  admin: 'Admin', manager: 'Manager', director: 'Director', inspector: 'Inspector',
  tyre_man: 'Tyre Man', reporter: 'Reporter',
}

/**
 * Resolve what this user may do on a table.
 *
 * @param {string} table  a key of WRITE_RULES
 * @param {{role?:string, isSuperAdmin?:boolean, serverCaps?:{create?:boolean|null, edit?:boolean|null}|null}} who
 *   serverCaps is the server's own app_user_can answer for the table's
 *   capability key. `null` (or a null member) means it could not be read.
 * @returns {{create:boolean, edit:boolean, delete:boolean, known:boolean}}
 *   `known` is false when a capability answer was needed and could not be read.
 *   In that case create/edit are TRUE: a control is never hidden on a guess,
 *   and the save path reports a refusal honestly if the database says no.
 */
export function resolveWriteAccess(table, { role, isSuperAdmin = false, serverCaps = null } = {}) {
  const rule = WRITE_RULES[table]
  if (!rule) return { create: true, edit: true, delete: false, known: false }
  const r = normRole(role)
  const admin = r === 'admin' || isSuperAdmin === true
  let known = true
  const one = (cap) => {
    if (rule[cap].includes(r)) return true
    if (!rule.capability) return false
    const server = serverCaps ? serverCaps[cap] : null
    if (server === true || server === false) return server
    // Admin always passes app_user_can; no need to wait for the server.
    if (admin) return true
    known = false
    return true
  }
  const create = one('create')
  const edit = one('edit')
  return { create, edit, delete: admin, known }
}

/** Plain sentence for a disabled control: who is allowed instead. */
export function writeRefusalReason(table, cap = 'edit') {
  const rule = WRITE_RULES[table]
  if (cap === 'delete' || !rule) return 'Only an Admin can delete this record.'
  const names = (rule[cap] || []).map((r) => ROLE_LABEL[r] || r)
  const verb = cap === 'create' ? 'add' : 'change'
  if (rule.capability) {
    const base = names.length ? `${joinNames(names)} can ${verb} this` : `Only an Admin can ${verb} this`
    return `${base}. An Admin can give your role or your account this right in Access Control.`
  }
  return `Only ${joinNames(names, 'or')} can ${verb} this.`
}

function joinNames(names, word = 'and') {
  if (names.length <= 1) return names[0] || 'Admin'
  return `${names.slice(0, -1).join(', ')} ${word} ${names[names.length - 1]}`
}
