/**
 * Request history analytics for src/pages/RequestAccess.jsx (the requester side
 * of just-in-time elevation). Pure: every function takes an injectable `now`
 * and does no I/O. Status comes from requesterStatus (./requestAccess), which in
 * turn reads the mirrored server rules in ./jitElevation, so the tiles, the
 * filter and the export can never disagree about what a row means.
 *
 * Honesty rules:
 *  - An average with nothing to average is null, never 0 (0 reads as "instant").
 *  - A direct grant (the super admin filed and decided it) has no wait and is
 *    left out of the decision-time average, matching jitElevation.summarize.
 */
import { requesterStatus, REQUESTER_STATUS_META } from './requestAccess'
import { remainingMs, formatRemaining, formatMinutes } from './jitElevation'

const toMs = (v) => {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/** Statuses that mean a super admin approved the request at some point. */
const APPROVED_EVER = new Set(['active', 'expired', 'revoked'])

/** Minutes between request and decision, or null when it cannot be measured. */
export function decisionMinutes(row) {
  if (!row || !row.decided_at) return null
  if (row.requested_by && row.decided_by && row.requested_by === row.decided_by) return null
  const a = toMs(row.created_at)
  const b = toMs(row.decided_at)
  if (a === null || b === null || b < a) return null
  return (b - a) / 60000
}

/**
 * Headline KPIs over the requester's own history.
 * @returns {{total:number,pending:number,active:number,approved:number,denied:number,
 *   expired:number,revoked:number,closed:number,avgDecisionMinutes:number|null,
 *   decisionSample:number,approvalRate:number|null}}
 */
export function requestKpis(rows = [], now = Date.now()) {
  const out = {
    total: 0, pending: 0, active: 0, approved: 0, denied: 0, expired: 0, revoked: 0, closed: 0,
    avgDecisionMinutes: null, decisionSample: 0, approvalRate: null,
  }
  let decisionSum = 0
  for (const r of rows || []) {
    if (!r) continue
    out.total += 1
    const s = requesterStatus(r, now)
    if (s === 'pending') out.pending += 1
    else if (s === 'active') out.active += 1
    else if (s === 'denied') out.denied += 1
    else if (s === 'expired') out.expired += 1
    else if (s === 'revoked') out.revoked += 1
    else out.closed += 1 // cancelled / lapsed
    if (APPROVED_EVER.has(s)) out.approved += 1
    const m = decisionMinutes(r)
    if (m !== null) { decisionSum += m; out.decisionSample += 1 }
  }
  if (out.decisionSample) out.avgDecisionMinutes = Math.round(decisionSum / out.decisionSample)
  const decided = out.approved + out.denied
  out.approvalRate = decided ? Math.round((out.approved / decided) * 100) : null
  return out
}

/** "N/A" for null, otherwise a compact duration. */
export function formatDecisionTime(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return 'N/A'
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))} min`
  const h = Math.floor(minutes / 60)
  if (h < 48) {
    const m = Math.round(minutes % 60)
    return m ? `${h}h ${m}m` : `${h}h`
  }
  return `${Math.round(h / 24)} days`
}

/** Remaining time label for an active grant, or null when not active. */
export function remainingLabel(row, now = Date.now()) {
  if (requesterStatus(row, now) !== 'active') return null
  const ms = remainingMs(row, now)
  return ms === null ? null : formatRemaining(ms)
}

/**
 * Status + free-text filter. `labels` lets the caller search the human module and
 * capability names, not only the raw keys.
 */
export function filterRequests(rows = [], { status = '', search = '' } = {}, now = Date.now(), labels = {}) {
  const q = String(search || '').trim().toLowerCase()
  const moduleLabel = labels.moduleLabel || ((k) => k)
  const capLabel = labels.capLabel || ((k) => k)
  return (rows || []).filter((r) => {
    if (!r) return false
    if (status && requesterStatus(r, now) !== status) return false
    if (!q) return true
    return [r.module_key, moduleLabel(r.module_key), r.capability, capLabel(r.capability),
      r.reason, r.decision_note, r.revoke_reason]
      .some((v) => String(v || '').toLowerCase().includes(q))
  })
}

/** Count of rows per requester status, for filter chips. */
export function statusCounts(rows = [], now = Date.now()) {
  const out = {}
  for (const r of rows || []) {
    const s = requesterStatus(r, now)
    if (s) out[s] = (out[s] || 0) + 1
  }
  return out
}

export const EXPORT_COLUMNS = [
  'module', 'capability', 'duration', 'status', 'requested', 'decided', 'decision_time', 'expires', 'remaining', 'reason', 'note',
]
export const EXPORT_HEADERS = [
  'Module', 'Capability', 'Duration', 'Status', 'Requested', 'Decided', 'Decision time', 'Expires', 'Time left', 'Reason', 'Decision note',
]

const isoOrNA = (v) => (toMs(v) === null ? 'N/A' : new Date(v).toISOString().replace('T', ' ').slice(0, 16))

/** Flat rows for Excel. Every blank renders N/A, never an invented value. */
export function exportRows(rows = [], now = Date.now(), labels = {}) {
  const moduleLabel = labels.moduleLabel || ((k) => k)
  const capLabel = labels.capLabel || ((k) => k)
  return (rows || []).filter(Boolean).map((r) => {
    const s = requesterStatus(r, now)
    const dm = decisionMinutes(r)
    return {
      module: moduleLabel(r.module_key) || 'N/A',
      capability: capLabel(r.capability) || 'N/A',
      duration: formatMinutes(r.granted_minutes ?? r.requested_minutes),
      status: REQUESTER_STATUS_META[s]?.label || s || 'N/A',
      requested: isoOrNA(r.created_at),
      decided: isoOrNA(r.decided_at),
      decision_time: formatDecisionTime(dm),
      expires: isoOrNA(r.expires_at),
      remaining: remainingLabel(r, now) || 'N/A',
      reason: r.reason || 'N/A',
      note: r.revoke_reason ? `Revoked: ${r.revoke_reason}` : (r.decision_note || 'N/A'),
    }
  })
}
