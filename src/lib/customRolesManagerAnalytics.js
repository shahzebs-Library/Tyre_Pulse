/**
 * customRolesManagerAnalytics - pure view-model engine for the Custom Roles
 * tab (CustomRolesManager). Joins the role list with the lazily-loaded module
 * and assigned-user counts, then provides search, filters, sorting (through
 * the shared consoleTable rules), the KPI strip and the export shape.
 *
 * A count that could not be read stays null (N/A): an unknown number of
 * assigned users is never shown as 0, because 0 is what unlocks delete.
 */
import { searchRows, sortRows, buildExport } from './consoleTable'

const known = (v) => typeof v === 'number' && Number.isFinite(v)

export function enrichRoles(roles = [], moduleCounts = {}, userCounts = {}) {
  return (Array.isArray(roles) ? roles : []).map((r) => ({
    ...r,
    _active: r.active !== false,
    _modules: known(moduleCounts[r.name]) ? moduleCounts[r.name] : null,
    _users: known(userCounts[r.name]) ? userCounts[r.name] : null,
  }))
}

export const ROLE_SORTS = {
  name: { key: 'name', dir: 'asc', label: 'Name (A to Z)' },
  users: { key: '_users', dir: 'desc', label: 'Most assigned users' },
  modules: { key: '_modules', dir: 'desc', label: 'Most modules' },
  newest: { key: 'created_at', dir: 'desc', label: 'Newest first' },
}

/**
 * status: '' | 'active' | 'inactive'
 * assignment: '' | 'assigned' | 'unassigned' | 'unknown'
 */
export function filterRoles(enriched = [], { search = '', status = '', assignment = '', sort = 'name' } = {}) {
  const list = enriched.filter((r) => {
    if (status === 'active' && !r._active) return false
    if (status === 'inactive' && r._active) return false
    if (assignment === 'assigned' && !(r._users > 0)) return false
    if (assignment === 'unassigned' && r._users !== 0) return false
    if (assignment === 'unknown' && r._users != null) return false
    return true
  })
  const searched = searchRows(list, search, ['name', 'description'])
  return sortRows(searched, ROLE_SORTS[sort] || ROLE_SORTS.name)
}

export function roleKpis(enriched = [], catalogSize = null) {
  const list = Array.isArray(enriched) ? enriched : []
  const users = list.filter((r) => r._users != null)
  const mods = list.filter((r) => r._modules != null)
  return {
    total: list.length,
    active: list.filter((r) => r._active).length,
    inactive: list.filter((r) => !r._active).length,
    assignedUsers: users.length ? users.reduce((a, r) => a + r._users, 0) : null,
    usersKnownFor: users.length,
    unassignedRoles: list.filter((r) => r._users === 0).length,
    avgModules: mods.length ? Math.round((mods.reduce((a, r) => a + r._modules, 0) / mods.length) * 10) / 10 : null,
    emptyRoles: list.filter((r) => r._modules === 0).length,
    catalogSize: known(catalogSize) ? catalogSize : null,
  }
}

/** Share of the module catalog a role can reach, or null when unknown. */
export function coveragePct(modules, catalogSize) {
  if (!known(modules) || !known(catalogSize) || catalogSize <= 0) return null
  return Math.round((modules / catalogSize) * 100)
}

export const ROLE_EXPORT_COLUMNS = [
  { key: 'name', header: 'Role' },
  { key: 'description', header: 'Description' },
  { key: 'status', header: 'Status', value: (r) => (r._active ? 'Active' : 'Inactive') },
  { key: 'modules', header: 'Modules', value: (r) => r._modules ?? 'N/A' },
  { key: 'users', header: 'Assigned users', value: (r) => r._users ?? 'N/A' },
  { key: 'created_at', header: 'Created' },
]

export function roleExport(rows = []) {
  return buildExport(rows, ROLE_EXPORT_COLUMNS)
}
