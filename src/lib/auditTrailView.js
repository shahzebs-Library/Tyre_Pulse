/**
 * Audit Trail view engine - pure shaping for the rebuilt /audit page.
 *
 * What audit_log_v2 really records (measured 2026-10-05): actions are the
 * trigger tokens db.insert / db.update / db.delete plus the app's LOGIN,
 * LOGOUT, tyre_scrap, tyre_unscrap, stock_movement, org_branding_update and a
 * handful of CREATE / UPDATE. ip_address, user_agent and site are empty on
 * every row, so the page shows no IP, device or site column. There is no
 * severity column either: the page shows the event TYPE, which is derived
 * from the action by the fixed rule below and never presented as a severity.
 *
 * No I/O, no clock unless passed in.
 */
import { changeDiff } from './auditTrailAnalytics'

/** Action groups offered in the filter. Each maps to the real stored tokens. */
export const ACTION_GROUPS = Object.freeze([
  { key: 'create', label: 'Create', actions: ['db.insert', 'CREATE'] },
  { key: 'update', label: 'Update', actions: ['db.update', 'UPDATE', 'EDIT'] },
  { key: 'delete', label: 'Delete', actions: ['db.delete', 'DELETE'] },
  { key: 'login', label: 'Sign in', actions: ['LOGIN'] },
  { key: 'logout', label: 'Sign out', actions: ['LOGOUT'] },
  { key: 'scrap', label: 'Tyre scrap / undo', actions: ['tyre_scrap', 'tyre_unscrap'] },
  { key: 'stock', label: 'Stock movement', actions: ['stock_movement'] },
  { key: 'branding', label: 'Branding change', actions: ['org_branding_update'] },
  { key: 'upload', label: 'Upload', actions: ['UPLOAD'] },
  { key: 'export', label: 'Export', actions: ['EXPORT'] },
])

export const SECURITY_ACTIONS = Object.freeze(['LOGIN', 'LOGOUT', 'org_branding_update'])
export const DATA_CHANGE_ACTIONS = Object.freeze(['db.insert', 'db.update', 'db.delete', 'CREATE', 'UPDATE', 'EDIT', 'DELETE'])
export const DELETE_ACTIONS = Object.freeze(['db.delete', 'DELETE'])

/** Tabs: each is a fixed slice of the same register (upload is its own table). */
export const AUDIT_TABS = Object.freeze([
  { key: 'audit', label: 'Audit log' },
  { key: 'upload', label: 'Upload history' },
  { key: 'security', label: 'Security' },
  { key: 'automation', label: 'Automation' },
])

/** Server filter for a tab, merged over the user's own filters. */
export function tabScope(tab) {
  if (tab === 'security') return { actions: [...SECURITY_ACTIONS] }
  if (tab === 'automation') return { actorType: 'service' }
  return {}
}

export function actionsForGroup(key) {
  return ACTION_GROUPS.find((g) => g.key === key)?.actions || null
}

const ACTION_LABEL = {
  'db.insert': 'Create', 'db.update': 'Update', 'db.delete': 'Delete',
  CREATE: 'Create', UPDATE: 'Update', EDIT: 'Update', DELETE: 'Delete',
  LOGIN: 'Sign in', LOGOUT: 'Sign out', UPLOAD: 'Upload', EXPORT: 'Export',
  tyre_scrap: 'Scrap tyre', tyre_unscrap: 'Undo scrap', stock_movement: 'Stock movement',
  org_branding_update: 'Branding change', PAGE_VIEW: 'Page view',
}

const titleCase = (s) => String(s || '')
  .replace(/[._]+/g, ' ').trim()
  .replace(/\s+/g, ' ')
  .replace(/^./, (c) => c.toUpperCase())

export function actionLabel(action) {
  if (!action) return 'N/A'
  return ACTION_LABEL[action] || titleCase(action)
}

/** Module the event touched, from the table name ("tyre_records" -> "Tyre records"). */
export function moduleLabel(row) {
  if (row?.table_name) return titleCase(row.table_name)
  if (SECURITY_ACTIONS.includes(row?.action)) return 'Sign-in'
  return 'N/A'
}

/** Short, readable record reference; uuids are cut to their first block. */
export function recordRef(row) {
  const id = row?.record_id
  if (id == null || id === '') return 'N/A'
  const s = String(id)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) ? s.slice(0, 8) : s
}

/** Event type by a fixed rule on the action and actor. Not a severity. */
export function eventType(row) {
  const a = row?.action
  if (SECURITY_ACTIONS.includes(a)) return { key: 'security', label: 'Security', tone: 'info' }
  if (DELETE_ACTIONS.includes(a)) return { key: 'removal', label: 'Removal', tone: 'bad' }
  if (row?.actor_type === 'service') return { key: 'automation', label: 'Automation', tone: 'muted' }
  if (DATA_CHANGE_ACTIONS.includes(a)) return { key: 'data', label: 'Data change', tone: 'good' }
  return { key: 'operation', label: 'Operation', tone: 'warn' }
}

/** Who did it: profile name, else the V499 actor typing, else stated plainly. */
export function actorLabel(row) {
  const name = row?.profiles?.full_name || row?.profiles?.username
  if (name) return name
  if (row?.actor_type === 'service') return row.actor_detail ? `System (${row.actor_detail})` : 'System'
  if (row?.actor_type === 'unknown') return 'Unknown'
  if (row?.user_email) return row.user_email
  if (row?.user_id) return 'Unknown user'
  return 'Not recorded'
}

/**
 * One-line headline for the selected event, built only from the stored
 * old/new values: "3 fields changed: status Active to Removed".
 */
export function changeHeadline(row) {
  if (!row) return ''
  const label = actionLabel(row.action)
  const where = `${moduleLabel(row)} ${recordRef(row) !== 'N/A' ? recordRef(row) : ''}`.trim()
  const { fields } = changeDiff(row)
  const changed = fields.filter((f) => f.changed)
  if (!changed.length) return `${label} on ${where}`
  const first = changed[0]
  const detail = DELETE_ACTIONS.includes(row.action)
    ? `${changed.length} field${changed.length === 1 ? '' : 's'} removed`
    : `${first.field} ${first.oldValue} to ${first.newValue}`
  const more = changed.length > 1 && !DELETE_ACTIONS.includes(row.action) ? ` and ${changed.length - 1} more` : ''
  return `${label} on ${where}: ${detail}${more}`
}

const iso = (d) => d.toISOString().slice(0, 10)

/** Default window: the last 30 days ending today. */
export function defaultRange(now = new Date()) {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const from = new Date(to); from.setUTCDate(from.getUTCDate() - 29)
  return { from: iso(from), to: iso(to) }
}

/** The equal-length window immediately before [from, to] (inclusive days). */
export function previousRange(from, to) {
  if (!from || !to) return null
  const f = new Date(`${from}T00:00:00Z`); const t = new Date(`${to}T00:00:00Z`)
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || t < f) return null
  const days = Math.round((t - f) / 86400000) + 1
  const pTo = new Date(f); pTo.setUTCDate(pTo.getUTCDate() - 1)
  const pFrom = new Date(pTo); pFrom.setUTCDate(pFrom.getUTCDate() - (days - 1))
  return { from: iso(pFrom), to: iso(pTo) }
}

/** Percent change; null when either side is unknown or the base is zero. */
export function trendPct(current, previous) {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

export function rangeLabel(from, to) {
  const f = (v) => {
    if (!v) return null
    const d = new Date(`${v}T00:00:00Z`)
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
  }
  if (f(from) && f(to)) return `${f(from)} to ${f(to)}`
  if (f(from)) return `From ${f(from)}`
  if (f(to)) return `Up to ${f(to)}`
  return 'All dates'
}

/** Roles that audit_log_v2 RLS lets read the register (plus super admins). */
export const AUDIT_READ_ROLES = Object.freeze(['Admin', 'Manager', 'Director'])
export function canReadAudit(profile, isSuperAdmin = false) {
  return Boolean(isSuperAdmin || profile?.is_super_admin || AUDIT_READ_ROLES.includes(profile?.role))
}

/** Review state chip for a flagged event. */
export const REVIEW_STATUSES = Object.freeze({
  open: { label: 'Flagged', tone: 'warn' },
  investigating: { label: 'Investigating', tone: 'info' },
  resolved: { label: 'Resolved', tone: 'good' },
})
