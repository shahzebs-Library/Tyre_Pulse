/**
 * Dual control (four-eyes approval) - pure helpers.
 *
 * The rules themselves live in the database (console_approval_requests and the
 * admin_*_approval RPCs, migration 20260924110000_dual_control.sql). This file
 * only shapes what the console shows, and mirrors the server's canonical
 * payload so a request built here matches the later execution exactly.
 */

/** The actions the server can gate. Keys are the gated RPC names. */
export const APPROVAL_ACTIONS = Object.freeze({
  admin_data_cleanup_run: { label: 'Data cleanup', short: 'Cleanup', risk: 'Deletes old records permanently.' },
  backup_restore_missing: { label: 'Backup restore', short: 'Restore', risk: 'Re-inserts rows from a snapshot.' },
  admin_bulk_set_role: { label: 'Bulk role change', short: 'Role change', risk: 'Changes what many people can do.' },
  dual_control_disable: { label: 'Turn off dual control', short: 'Disable', risk: 'Removes the second approval for everything above.' },
})

/** Actions a person can raise from the Approvals page. */
export const REQUESTABLE_ACTIONS = Object.freeze([
  'admin_data_cleanup_run', 'backup_restore_missing', 'admin_bulk_set_role',
])

export const STATUS_META = Object.freeze({
  pending: { label: 'Waiting', tone: 'warning' },
  approved: { label: 'Approved, ready to run', tone: 'good' },
  executed: { label: 'Used', tone: 'info' },
  rejected: { label: 'Rejected', tone: 'danger' },
  expired: { label: 'Expired', tone: 'quiet' },
  cancelled: { label: 'Cancelled', tone: 'quiet' },
})

export const APPROVAL_REQUIRED_MESSAGE =
  'This action needs a second super admin to approve it first. Request approval in Console, Approvals, then run it again.'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v.trim())
}

/**
 * True when an error (raw Supabase error, ServiceError with `.cause`, or a
 * plain Error) is the server saying "this needs an approval first". The server
 * raises it with hint `dual_control_required`; the message is a fallback.
 */
export function isApprovalRequiredError(err) {
  if (!err) return false
  const candidates = [err, err.cause, err.error]
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue
    if (c.hint === 'dual_control_required') return true
    if (typeof c.message === 'string' && c.message.includes('needs a second super admin')) return true
  }
  return false
}

/** Parse user ids typed or pasted as a list (commas, spaces or new lines). */
export function parseUserIds(text) {
  const parts = String(text || '').split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
  const ids = [...new Set(parts.filter(isUuid))].sort()
  const invalid = parts.filter((p) => !isUuid(p))
  return { ids, invalid }
}

/**
 * Mirror of the server's _approval_canonical(). Throws a plain Error with a
 * readable message when a required field is missing, so the form can say why.
 */
export function canonicalPayload(action, payload = {}) {
  const p = payload || {}
  if (action === 'admin_data_cleanup_run') {
    const key = String(p.key || '').trim()
    const before = String(p.before || '').trim().slice(0, 10)
    if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(before)) throw new Error('Pick a cleanup target and a cutoff date.')
    return { key, before }
  }
  if (action === 'backup_restore_missing') {
    const snapshot = String(p.snapshot_id || '').trim().toLowerCase()
    const table = String(p.table || '').trim()
    if (!isUuid(snapshot) || !table) throw new Error('Give a valid snapshot id and a table name.')
    return { snapshot_id: snapshot, table }
  }
  if (action === 'admin_bulk_set_role') {
    const role = String(p.role || '').trim()
    const list = Array.isArray(p.user_ids) ? p.user_ids : parseUserIds(p.user_ids).ids
    const ids = [...new Set(list.map((x) => String(x).trim().toLowerCase()).filter(isUuid))].sort()
    if (!role || !ids.length) throw new Error('Give a role and at least one valid user id.')
    return { role, user_ids: ids }
  }
  if (action === 'dual_control_disable') return {}
  throw new Error('This action cannot be sent for approval.')
}

/** One plain-English line describing what a request will do. */
export function describePayload(action, payload = {}) {
  const p = payload || {}
  switch (action) {
    case 'admin_data_cleanup_run':
      return `Delete ${p.key || 'records'} older than ${p.before || 'N/A'}`
    case 'backup_restore_missing':
      return `Restore missing rows of ${p.table || 'N/A'} from snapshot ${String(p.snapshot_id || '').slice(0, 8) || 'N/A'}`
    case 'admin_bulk_set_role': {
      const n = Array.isArray(p.user_ids) ? p.user_ids.length : 0
      return `Set role ${p.role || 'N/A'} for ${n} user${n === 1 ? '' : 's'}`
    }
    case 'dual_control_disable':
      return 'Switch dual control off'
    default:
      return action || 'N/A'
  }
}

/** Whether the viewer may approve or reject this row. Never their own. */
export function canDecide(row, now = new Date()) {
  if (!row || row.status !== 'pending' || row.is_mine) return false
  const exp = row.expires_at ? new Date(row.expires_at) : null
  return !exp || exp > now
}

/** Whether the viewer may withdraw this row. Only their own open request. */
export function canCancel(row) {
  return !!row && !!row.is_mine && (row.status === 'pending' || row.status === 'approved')
}

/** "5h 12m left", "Expired", or "N/A". */
export function timeLeft(expiresAt, now = new Date()) {
  if (!expiresAt) return 'N/A'
  const ms = new Date(expiresAt).getTime() - now.getTime()
  if (Number.isNaN(ms)) return 'N/A'
  if (ms <= 0) return 'Expired'
  const mins = Math.floor(ms / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`
}

/** Headline counts for the tiles. */
export function summarizeApprovals(rows = []) {
  const out = {
    total: 0, pending: 0, awaitingMe: 0, readyToRun: 0, executed: 0, rejected: 0,
    expired: 0, cancelled: 0, approved: 0, byStatus: {}, byAction: {},
  }
  for (const r of rows || []) {
    out.total += 1
    out.byStatus[r.status] = (out.byStatus[r.status] || 0) + 1
    out.byAction[r.action] = (out.byAction[r.action] || 0) + 1
    if (r.status in out) out[r.status] += 1
    if (r.status === 'pending' && !r.is_mine) out.awaitingMe += 1
    if (r.status === 'approved' && r.is_mine) out.readyToRun += 1
  }
  return out
}

/**
 * The exact sentences the dual-control RPCs raise on purpose. Only these are
 * shown verbatim; anything else goes through the generic sanitiser, so a raw
 * database message can never reach the screen by this route.
 */
const OWN_MESSAGES = [
  /^Give a reason of at least 5 characters\.$/,
  /^You cannot decide your own request\. A second super admin must do it\.$/,
  /^Only the person who asked can cancel a request\.$/,
  /^This request (has already been|is already) (pending|approved|rejected|executed|expired|cancelled)\.$/,
  /^Approval request not found\.$/,
  /^Say why you are rejecting it\.$/,
  /^You already have an open request for exactly this action\.$/,
  /^Dual control is already off\.$/,
  /^Dual control needs at least two active super admins\. Add a second one first\.$/,
  /^Dual control can only be changed from Console, Approvals\.$/,
  /^A (cleanup|restore|role-change) approval needs [a-z ,]+\.$/,
  /^This action cannot be sent for approval\.$/,
]

export function readableServerMessage(err) {
  const msg = err && typeof err.message === 'string' ? err.message.trim() : ''
  if (!msg) return null
  return OWN_MESSAGES.some((re) => re.test(msg)) ? msg : null
}
