/**
 * policyView - pure shaping for the Policy Management page (/policies) in the
 * owner's mockup layout. No I/O; `now` is injected so every figure is
 * deterministic. Builds on policyAnalytics (expiry bands, portfolio summary)
 * rather than re-deriving them.
 *
 * Honesty rules:
 *  - `policies` is a document register with no acknowledgment, region,
 *    department, site, attachment, regulation or version-history columns. Those
 *    figures are null ("Not recorded"), never 0 and never invented.
 *  - The policy code is DERIVED from the row id (POL-XXXXXX), because the table
 *    has no policy number column. It is stable for a row but is not a number
 *    anyone typed.
 *  - No trend arrows: there is no prior-period snapshot of the register.
 */
import { policyExpiry, toDate, DEFAULT_WARN_DAYS } from './policyAnalytics'
import { POLICY_STATUS_META } from './policies'

const DAY_MS = 86_400_000
const text = (v) => (v == null ? '' : String(v).trim())

/** Stable derived code for a policy row ("POL-1A2B3C"), or "N/A". */
export function policyCode(row) {
  const id = text(row?.id).replace(/[^0-9a-f]/gi, '')
  return id ? `POL-${id.slice(0, 6).toUpperCase()}` : 'N/A'
}

export function statusLabel(status) {
  return POLICY_STATUS_META[status]?.label || text(status) || 'N/A'
}

/** Pill tone for a status (kit .cc-pill classes). */
export function statusTone(status) {
  return { active: 'good', under_review: 'warn', draft: 'muted', archived: 'muted' }[status] || 'muted'
}

/** Two-letter initials for an owner name, or "". */
export function ownerInitials(name) {
  const parts = text(name).split(/\s+/).filter(Boolean)
  if (!parts.length) return ''
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * Governance gaps of a single policy. Archived policies have none (they are
 * out of active governance). Each reason comes from a real empty or past field.
 */
export function policyGaps(row, now) {
  if (!row || row.status === 'archived') return []
  const gaps = []
  if (!text(row.owner)) gaps.push('No owner')
  if (!text(row.review_date)) gaps.push('No review date')
  else if (policyExpiry(row, now).expired) gaps.push('Review overdue')
  if (!text(row.effective_date)) gaps.push('No effective date')
  if (!text(row.body)) gaps.push('No policy text')
  return gaps
}

/** KPI strip in the mockup order. Counts are numbers; unmeasurable = null. */
export function policyKpis(rows, now, { warnDays = DEFAULT_WARN_DAYS } = {}) {
  const list = Array.isArray(rows) ? rows : []
  let active = 0
  let expiringSoon = 0
  let pendingReview = 0
  let withGaps = 0
  for (const r of list) {
    if (r?.status === 'active') active += 1
    if (r?.status === 'under_review') pendingReview += 1
    if (policyExpiry(r, now, { warnDays }).expiringSoon) expiringSoon += 1
    if (policyGaps(r, now).length) withGaps += 1
  }
  return {
    total: list.length,
    active,
    expiringSoon,
    pendingReview,
    withGaps,
    // No acknowledgment table exists, so the average cannot be measured.
    avgAcknowledgment: null,
  }
}

/** "in 3 months", "in 12 days", "today", "overdue by 5 days", or null. */
export function reviewDistance(reviewDate, now) {
  const d = toDate(reviewDate)
  const ref = toDate(now)
  if (!d || !ref) return null
  const days = Math.ceil((d.getTime() - ref.getTime()) / DAY_MS)
  if (days === 0) return 'today'
  const abs = Math.abs(days)
  const unit = abs >= 60 ? `${Math.round(abs / 30)} months` : `${abs} day${abs === 1 ? '' : 's'}`
  return days > 0 ? `in ${unit}` : `overdue by ${unit}`
}

/** Distinct sorted values of a field across rows. */
export function optionsOf(rows, key) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => text(r?.[key])).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/** Region label: the policy's country, or "All countries" when it has none. */
export function regionLabel(row) {
  return text(row?.country) || 'All countries'
}

/**
 * What the register can honestly say about a policy's history. The table keeps
 * only the current version, so there is at most a "current" entry (last saved)
 * and a "created" entry. `complete` is always false: earlier versions were not
 * kept and the UI must say so.
 */
export function versionLog(row) {
  if (!row) return { entries: [], complete: false }
  const entries = []
  const created = text(row.created_at)
  const updated = text(row.updated_at)
  if (updated) entries.push({ key: 'current', version: text(row.version) || 'N/A', at: updated, label: 'Current', note: 'Last saved version of this policy.' })
  if (created && created.slice(0, 19) !== updated.slice(0, 19)) {
    entries.push({ key: 'created', version: null, at: created, label: 'Created', note: 'Policy record created.' })
  }
  if (!entries.length && created) entries.push({ key: 'created', version: text(row.version) || 'N/A', at: created, label: 'Created', note: 'Policy record created.' })
  return { entries, complete: false }
}

/** Field/value rows for a single-policy PDF or Excel export. */
export function policyDetailRows(row, now) {
  if (!row) return []
  const gaps = policyGaps(row, now)
  return [
    ['Policy ID', policyCode(row)],
    ['Title', text(row.title) || 'N/A'],
    ['Category', text(row.category) || 'Not recorded'],
    ['Version', text(row.version) || 'Not recorded'],
    ['Owner', text(row.owner) || 'Not recorded'],
    ['Region', regionLabel(row)],
    ['Status', statusLabel(row.status)],
    ['Effective date', text(row.effective_date) || 'Not recorded'],
    ['Next review', text(row.review_date) || 'Not recorded'],
    ['Governance gaps', gaps.length ? gaps.join(', ') : 'None'],
    ['Policy text', text(row.body) || 'Not recorded'],
    ['Notes', text(row.notes) || 'None'],
  ].map(([field, value]) => ({ field, value }))
}

/** Count of policies per category, most first (null category = "Uncategorised"). */
export function categoryBreakdown(rows) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = text(r?.category) || 'Uncategorised'
    map.set(k, (map.get(k) || 0) + 1)
  }
  return [...map.entries()].map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/**
 * Acknowledgment legend in the mockup order. Every count is null because no
 * table records who has read and accepted a policy; the card shows the shape
 * with "Not recorded" rather than inventing rates.
 */
export const ACK_LEGEND = Object.freeze([
  { key: 'acknowledged', label: 'Acknowledged', color: 'var(--cc-green)', count: null },
  { key: 'pending', label: 'Pending', color: 'var(--cc-amber)', count: null },
  { key: 'overdue', label: 'Overdue', color: 'var(--cc-red)', count: null },
  { key: 'not_required', label: 'Not Required', color: 'var(--cc-ink-3)', count: null },
])

/** Rows picked in the register, kept in register order. */
export function pickedPolicies(rows, picked) {
  const set = picked instanceof Set ? picked : new Set(picked || [])
  return (Array.isArray(rows) ? rows : []).filter((r) => set.has(r.id))
}
