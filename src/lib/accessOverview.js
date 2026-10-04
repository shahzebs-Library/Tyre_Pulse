/**
 * accessOverview.js - pure helpers behind the console Access Control page
 * (/console/access). No I/O: every function takes already-loaded data.
 *
 * The page shows ONE matrix where each cell carries TWO switches: the web app
 * (a plain `module_permissions` row, role + module key) and the phone app (a
 * `mobile:<mobileKey>` row). The phone key is NOT the web key for most areas
 * (tyre_records -> records, inspections -> inspect), so WEB_TO_MOBILE_KEY maps
 * the areas that exist on both surfaces. An area with no entry is web only.
 *
 * Precedence mirrored here (read-only preview, the server stays the boundary):
 *   Admin always on | saved row wins | otherwise the built-in default.
 */
import { ACCESS_ROLES, ALL_MODULES, MODULE_LABEL } from './moduleCatalog'
import { defaultViewAccess } from './permissionMatrix'
import { MOBILE_MODULES, MOBILE_MODULE_BY_KEY, mobileModuleDefaultAllows } from './mobileModules'

export const MOBILE_PREFIX = 'mobile:'

/** Web module key -> mobile module key, only where both surfaces have the area. */
const RAW_WEB_TO_MOBILE = {
  tyre_records: 'records',
  inspections: 'inspect',
  fleet_master: 'vehicles',
  vehicle_washing: 'washing',
  accidents: 'accidents',
  work_orders: 'workorders',
  stock: 'stock',
  dashboard: 'overview',
  reports: 'reports',
  analytics: 'analytics',
  checklists: 'checklists',
  approvals: 'approvals',
  alerts: 'alerts',
  pm_programs: 'pm',
  serial_tracker: 'serial',
}

export const WEB_TO_MOBILE_KEY = Object.freeze(Object.fromEntries(
  Object.entries(RAW_WEB_TO_MOBILE).filter(([, m]) => Boolean(MOBILE_MODULE_BY_KEY[m])),
))

/** The phone key for a web area, or null when the area is web only. */
export function mobileKeyFor(webKey) {
  return WEB_TO_MOBILE_KEY[webKey] || null
}

const BUILTIN = new Set(ACCESS_ROLES)

/** Matrix columns: built-in roles first (catalog order), then active custom roles. */
export function matrixColumns(customRoles = []) {
  const custom = (customRoles || [])
    .filter((r) => r && r.name && r.active !== false && !BUILTIN.has(r.name))
    .map((r) => r.name)
  return [...ACCESS_ROLES.map((name) => ({ name, custom: false })), ...custom.map((name) => ({ name, custom: true }))]
}

function hasOwn(obj, key) {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key)
}

/**
 * One switch of one cell.
 * @returns {{ on: boolean, saved: boolean, locked: boolean }}
 *   saved = a real matrix row exists (false = the built-in default is used)
 */
export function webCell(permMap, role, webKey) {
  if (role === 'Admin') return { on: true, saved: false, locked: true }
  const row = permMap?.[role]
  if (hasOwn(row, webKey)) return { on: row[webKey] === true, saved: true, locked: false }
  return { on: defaultViewAccess(role, webKey), saved: false, locked: false }
}

export function phoneCell(permMap, role, mobileKey) {
  if (!mobileKey) return null
  if (role === 'Admin') return { on: true, saved: false, locked: true }
  const row = permMap?.[role]
  const k = MOBILE_PREFIX + mobileKey
  if (hasOwn(row, k)) return { on: row[k] === true, saved: true, locked: false }
  return { on: mobileModuleDefaultAllows(mobileKey, role), saved: false, locked: false }
}

/** Stable key for one staged change. */
export function stageKey(role, storedKey) {
  return `${role}|${storedKey}`
}

/** Plain-English label for a stored key (web key or mobile:key). */
export function areaLabel(storedKey) {
  const k = String(storedKey || '')
  if (k.startsWith(MOBILE_PREFIX)) {
    const m = k.slice(MOBILE_PREFIX.length)
    return MOBILE_MODULE_BY_KEY[m]?.label || m
  }
  if (k.includes(':')) {
    const [parent, child] = k.split(':')
    return `${MODULE_LABEL[parent] || parent} / ${child.replace(/_/g, ' ')}`
  }
  return MODULE_LABEL[k] || k.replace(/_/g, ' ')
}

export function surfaceOf(storedKey) {
  return String(storedKey || '').startsWith(MOBILE_PREFIX) ? 'phone' : 'web'
}

/**
 * Plain-English impact of one staged change.
 * @param {{ role:string, storedKey:string, enabled:boolean }} change
 * @param {Record<string, number>} peopleByRole
 */
export function describeChange(change, peopleByRole = {}) {
  const people = peopleByRole?.[change.role]
  const surface = surfaceOf(change.storedKey) === 'phone' ? 'on the phone' : 'on the web'
  const verb = change.enabled ? 'gains' : 'loses'
  const who = typeof people === 'number'
    ? `${people} ${people === 1 ? 'person' : 'people'}`
    : 'People count unknown'
  return {
    title: `${change.role} ${verb} ${areaLabel(change.storedKey)} ${surface}`,
    detail: `${who} with this role. ${change.enabled ? 'They see it' : 'It disappears'} ${surface} the next time their menu refreshes.`,
    people: typeof people === 'number' ? people : null,
  }
}

/** Total people touched by a staged set (each role counted once). */
export function stagedPeople(changes, peopleByRole = {}) {
  const roles = new Set((changes || []).map((c) => c.role))
  let total = 0
  let known = true
  for (const r of roles) {
    if (typeof peopleByRole?.[r] === 'number') total += peopleByRole[r]
    else known = false
  }
  return { total, roles: roles.size, known }
}

/** Count people per role from profile rows (approved only by default). */
export function peopleByRole(profiles, { approvedOnly = true } = {}) {
  const out = {}
  for (const p of profiles || []) {
    if (!p?.role) continue
    if (approvedOnly && p.approved === false) continue
    out[p.role] = (out[p.role] || 0) + 1
  }
  return out
}

/**
 * Areas no non-admin role has a saved rule for. Under the opt-in
 * `new_features_admin_only` policy these are Admin only until shared.
 *
 * Web: any catalog area with no module_permissions row for any role except
 * Admin. Phone: a mobile module whose built-in default reaches nobody AND that
 * has no `mobile:` row (a phone module with default roles is already shared).
 *
 * @param {Record<string, Record<string, boolean>>} permMap role -> key -> enabled
 * @param {{ key:string, label:string, group?:string }[]} webCatalog
 * @returns {{ key:string, storedKey:string, label:string, surface:'web'|'phone', seenByDefault:string[] }[]}
 */
export function newAndNotShared(permMap, webCatalog = ALL_MODULES, { includePhone = false } = {}) {
  const saved = new Set()
  for (const [role, row] of Object.entries(permMap || {})) {
    if (role === 'Admin') continue
    for (const k of Object.keys(row || {})) saved.add(k)
  }
  const out = []
  const seen = new Set()
  for (const m of webCatalog || []) {
    if (!m?.key || seen.has(m.key)) continue
    seen.add(m.key)
    if (saved.has(m.key)) continue
    out.push({
      key: m.key,
      storedKey: m.key,
      label: m.label || m.key,
      surface: 'web',
      seenByDefault: ACCESS_ROLES.filter((r) => r !== 'Admin' && defaultViewAccess(r, m.key)),
    })
  }
  // Phone modules with no default role are Admin only ON PURPOSE (heavy data
  // listings kept off field phones), so they are only listed when asked for.
  for (const m of includePhone ? MOBILE_MODULES : []) {
    const k = MOBILE_PREFIX + m.key
    if (saved.has(k)) continue
    if ((m.roles || []).length) continue
    out.push({ key: m.key, storedKey: k, label: m.label, surface: 'phone', seenByDefault: [] })
  }
  return out
}

/** Build the module_permissions rows a "Share with roles" dialog writes. */
export function buildShareChanges(item, roles, where = 'web') {
  const changes = []
  for (const role of roles || []) {
    if (!role || role === 'Admin') continue
    if (item.surface === 'phone') {
      changes.push({ role, module_key: item.storedKey, enabled: true })
      continue
    }
    if (where === 'web' || where === 'both') changes.push({ role, module_key: item.key, enabled: true })
    const mk = mobileKeyFor(item.key)
    if ((where === 'phone' || where === 'both') && mk) changes.push({ role, module_key: MOBILE_PREFIX + mk, enabled: true })
  }
  return changes
}

/** Classify a grant row for the People table. */
export function describeGrant(row, now = Date.now()) {
  const key = String(row?.module_key || '')
  const surface = surfaceOf(key)
  const base = surface === 'phone' ? key.slice(MOBILE_PREFIX.length) : key
  const exp = row?.expires_at ? Date.parse(row.expires_at) : null
  const expired = exp != null && Number.isFinite(exp) && exp <= now
  return {
    surface,
    baseKey: base,
    area: areaLabel(key),
    effectLabel: row?.effect === 'revoke' ? 'Block' : 'Allow',
    ends: exp != null && Number.isFinite(exp) ? new Date(exp).toISOString().slice(0, 10) : null,
    expired,
  }
}
