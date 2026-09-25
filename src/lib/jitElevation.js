/**
 * Just-in-time (JIT) privilege elevation - pure rules (no I/O).
 *
 * MIRRORS supabase/migrations/20260924116000_jit_elevation.sql. The server is
 * the boundary (every rule below is re-checked there); this file exists so the
 * console can explain a refusal before the round trip and so the countdown and
 * status reading are tested once. CHANGE BOTH TOGETHER.
 *
 * An approved elevation is an EXPIRING row in user_access_grants. Every reader
 * of that table already ignores a row whose expires_at has passed, so an
 * elevation stops working at expiry even if the 5-minute sweep has not yet
 * flipped its status. `effectiveStatus` reflects that: an 'approved' row past
 * its expiry reads as 'expired' on screen, never as still active.
 */

export const MIN_MINUTES = 5
export const MAX_MINUTES = 480 // 8 hours
export const MIN_REASON = 10
export const MIN_DECISION_NOTE = 5
export const PENDING_LAPSE_HOURS = 24

/** 'delete' is deliberately absent: app_user_can refuses delete to every non-admin. */
export const JIT_CAPABILITIES = [
  { key: 'view', label: 'View' },
  { key: 'create', label: 'Create' },
  { key: 'edit', label: 'Edit' },
  { key: 'export', label: 'Export' },
  { key: 'approve', label: 'Approve' },
]
const CAP_KEYS = new Set(JIT_CAPABILITIES.map((c) => c.key))

export const DURATION_PRESETS = [15, 30, 60, 120, 240, 480]

export const STATUSES = ['pending', 'approved', 'denied', 'cancelled', 'revoked', 'expired', 'lapsed']

export const STATUS_META = {
  pending: { label: 'Waiting', tone: 'warning' },
  approved: { label: 'Active', tone: 'good' },
  denied: { label: 'Denied', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'quiet' },
  revoked: { label: 'Revoked early', tone: 'danger' },
  expired: { label: 'Expired', tone: 'quiet' },
  lapsed: { label: 'Lapsed (not decided)', tone: 'quiet' },
}

/** Allowed transitions (the server enforces the same machine). */
export const TRANSITIONS = {
  pending: ['approved', 'denied', 'cancelled', 'lapsed'],
  approved: ['revoked', 'expired'],
  denied: [],
  cancelled: [],
  revoked: [],
  expired: [],
  lapsed: [],
}

export const TERMINAL = new Set(['denied', 'cancelled', 'revoked', 'expired', 'lapsed'])

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to)
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Clamp to 5..480 whole minutes. Unreadable input returns null (never a guess). */
export function clampMinutes(value, max = MAX_MINUTES) {
  const n = num(value)
  if (n === null) return null
  const ceiling = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, num(max) ?? MAX_MINUTES))
  return Math.min(ceiling, Math.max(MIN_MINUTES, Math.round(n)))
}

export function durationError(value) {
  const n = num(value)
  if (n === null) return 'Enter a duration in minutes.'
  if (!Number.isInteger(n)) return 'Duration must be whole minutes.'
  if (n < MIN_MINUTES) return `Duration must be at least ${MIN_MINUTES} minutes.`
  if (n > MAX_MINUTES) return 'Duration cannot be longer than 8 hours.'
  return null
}

export function reasonError(reason, min = MIN_REASON) {
  const t = String(reason ?? '').trim()
  if (t.length < min) return `A reason of at least ${min} characters is required.`
  if (t.length > 1000) return 'Keep the reason under 1000 characters.'
  return null
}

export function capabilityError(cap) {
  return CAP_KEYS.has(cap) ? null : 'Choose view, create, edit, export or approve.'
}

/** Validates a direct-grant / request form. Returns { field: message } (empty = valid). */
export function validateRequest({ userId, moduleKey, capability, minutes, reason } = {}, { requireUser = true } = {}) {
  const errors = {}
  if (requireUser && !userId) errors.userId = 'Choose a user.'
  if (!moduleKey || !/^[a-z0-9_:-]{1,80}$/.test(String(moduleKey))) errors.moduleKey = 'Choose a module.'
  const c = capabilityError(capability); if (c) errors.capability = c
  const d = durationError(minutes); if (d) errors.minutes = d
  const r = reasonError(reason); if (r) errors.reason = r
  return errors
}

const toMs = (v) => {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/** Milliseconds left on an active elevation, 0 once past, null when not active. */
export function remainingMs(row, now = Date.now()) {
  if (!row || row.status !== 'approved') return null
  const exp = toMs(row.expires_at)
  if (exp === null) return null
  return Math.max(0, exp - now)
}

/** Status as the user should read it: an approved row past expiry is expired. */
export function effectiveStatus(row, now = Date.now()) {
  if (!row) return null
  if (row.status === 'approved') {
    const left = remainingMs(row, now)
    if (left === 0) return 'expired'
  }
  if (row.status === 'pending') {
    const created = toMs(row.created_at)
    if (created !== null && now - created > PENDING_LAPSE_HOURS * 3600000) return 'lapsed'
  }
  return row.status
}

/** "1h 05m", "12m 30s", "45s"; null input -> 'N/A'. */
export function formatRemaining(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return 'N/A'
  if (ms <= 0) return 'Expired'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

export function formatMinutes(min) {
  const n = num(min)
  if (n === null) return 'N/A'
  const h = Math.floor(n / 60)
  const m = n % 60
  if (!h) return `${m} min`
  return m ? `${h}h ${m}m` : `${h}h`
}

/** Share of the granted window already used, 0..100, or null. */
export function elapsedPct(row, now = Date.now()) {
  const start = toMs(row?.starts_at)
  const end = toMs(row?.expires_at)
  if (start === null || end === null || end <= start) return null
  return Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)))
}

/** Headline counts. Uses effectiveStatus so a lapsed-but-unswept row is not "active". */
export function summarize(rows = [], now = Date.now()) {
  const out = { total: 0, pending: 0, active: 0, denied: 0, revoked: 0, expired: 0, cancelled: 0, lapsed: 0, approvalRate: null, medianDecisionMinutes: null }
  const decisionMins = []
  let decided = 0; let approvedEver = 0
  for (const r of rows) {
    out.total += 1
    const s = effectiveStatus(r, now)
    if (s === 'pending') out.pending += 1
    else if (s === 'approved') out.active += 1
    else if (s in out) out[s] += 1
    // Direct grants (the super admin filed and approved it) have no wait, so
    // they are left out of the decision-time median rather than dragging it to 0.
    if (r.decided_at && r.requested_by !== r.decided_by) {
      const a = toMs(r.created_at); const b = toMs(r.decided_at)
      if (a !== null && b !== null && b >= a) decisionMins.push((b - a) / 60000)
    }
    if (['approved', 'revoked', 'expired', 'denied'].includes(r.status)) {
      decided += 1
      if (r.status !== 'denied') approvedEver += 1
    }
  }
  out.approvalRate = decided ? Math.round((approvedEver / decided) * 100) : null
  if (decisionMins.length) {
    const sorted = [...decisionMins].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    out.medianDecisionMinutes = Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2)
  }
  return out
}

/** Split into the three page sections. */
export function partition(rows = [], now = Date.now()) {
  const pending = []; const active = []; const history = []
  for (const r of rows) {
    const s = effectiveStatus(r, now)
    if (s === 'pending') pending.push(r)
    else if (s === 'approved') active.push(r)
    else history.push(r)
  }
  active.sort((a, b) => (toMs(a.expires_at) ?? 0) - (toMs(b.expires_at) ?? 0))
  pending.sort((a, b) => (toMs(a.created_at) ?? 0) - (toMs(b.created_at) ?? 0))
  return { pending, active, history }
}

export function filterRows(rows = [], { search = '', status = '' } = {}, now = Date.now()) {
  const q = String(search || '').trim().toLowerCase()
  return rows.filter((r) => {
    if (status && effectiveStatus(r, now) !== status) return false
    if (!q) return true
    return [r.target_name, r.requested_by_name, r.decided_by_name, r.module_key, r.capability, r.reason, r.organisation_name]
      .some((v) => String(v || '').toLowerCase().includes(q))
  })
}
