/**
 * permissionMatrixAnalytics - pure helpers behind the Permission Matrix grid.
 *
 * The matrix itself (defaults, diffs, overrides) lives in permissionMatrix.js
 * and is not duplicated here. This file only turns a matrix into what the page
 * shows around it: one flat row per module, the headline counts, the shared
 * filter and the export rows. Admin is excluded from every count because Admin
 * always has full access and is not editable, so counting it would inflate
 * "view grants" with cells nobody decided. No I/O.
 */

/** One row per module, carrying its group label. */
export function flattenModules(groups) {
  const out = []
  for (const g of Array.isArray(groups) ? groups : []) {
    for (const m of g.modules || []) out.push({ key: m.key, label: m.label, group: g.group })
  }
  return out
}

const cellKey = (role, mod) => `${role}::${mod}`

/**
 * @param matrix  role -> module -> cap -> bool
 * @param roles   role names
 * @param modules flattenModules() rows
 * @param caps    CAPABILITIES
 * @param overridden Set of `role::module` deviating from defaults
 * @param unsaved    Set of `role::module` with unsaved edits
 */
export function matrixStats(matrix, roles, modules, caps, overridden = new Set(), unsaved = new Set()) {
  const editable = (roles || []).filter(r => r !== 'Admin')
  const stored = (caps || []).filter(c => !c.enforced)
  let viewGrants = 0
  let storedOn = 0
  let cells = 0
  const overriddenModules = new Set()
  const unsavedModules = new Set()
  const perRole = {}
  for (const r of editable) perRole[r] = 0
  for (const m of modules || []) {
    for (const r of editable) {
      const c = matrix?.[r]?.[m.key]
      cells += 1
      if (c?.view) { viewGrants += 1; perRole[r] += 1 }
      for (const s of stored) if (c?.[s.key]) storedOn += 1
      if (overridden.has(cellKey(r, m.key))) overriddenModules.add(m.key)
      if (unsaved.has(cellKey(r, m.key))) unsavedModules.add(m.key)
    }
  }
  return {
    modules: (modules || []).length,
    editableRoles: editable.length,
    cells,
    viewGrants,
    viewCoverage: cells ? Math.round((viewGrants / cells) * 1000) / 10 : null,
    storedOn,
    overriddenModules: overriddenModules.size,
    unsavedModules: unsavedModules.size,
    perRole,
  }
}

/**
 * Filter module rows by search text, group, and a state:
 *   'all' | 'overridden' | 'unsaved' | 'hidden' (no editable role can view)
 */
export function filterModules(rows, { search = '', group = '', state = 'all' } = {}, ctx = {}) {
  const q = String(search).trim().toLowerCase()
  const { matrix, roles = [], overridden = new Set(), unsaved = new Set() } = ctx
  const editable = roles.filter(r => r !== 'Admin')
  return (Array.isArray(rows) ? rows : []).filter(m => {
    if (q && !(m.label.toLowerCase().includes(q) || m.key.toLowerCase().includes(q))) return false
    if (group && m.group !== group) return false
    if (state === 'overridden' && !editable.some(r => overridden.has(cellKey(r, m.key)))) return false
    if (state === 'unsaved' && !editable.some(r => unsaved.has(cellKey(r, m.key)))) return false
    if (state === 'hidden' && editable.some(r => matrix?.[r]?.[m.key]?.view)) return false
    return true
  })
}

/** Human summary of one cell: "View, Create, Export" or "No access". */
export function cellSummary(matrix, role, mod, caps) {
  if (role === 'Admin') return 'Full access'
  const c = matrix?.[role]?.[mod]
  const on = (caps || []).filter(x => c?.[x.key]).map(x => x.label)
  return on.length ? on.join(', ') : 'No access'
}

/** Export rows: one per module, one column per role. */
export function matrixExportRows(rows, matrix, roles, caps) {
  return (Array.isArray(rows) ? rows : []).map(m => {
    const out = { group: m.group, module: m.label, key: m.key }
    for (const r of roles || []) out[r] = cellSummary(matrix, r, m.key, caps)
    return out
  })
}
