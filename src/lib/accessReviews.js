/**
 * Access Review (periodic access recertification) - pure helpers.
 *
 * No I/O. The service in src/lib/api/accessReviews.js reads the campaign
 * snapshot; these functions summarise, flag and filter it so the page, the
 * Excel evidence and the tests all agree.
 */

export const DECISIONS = ['pending', 'keep', 'revoke', 'modify']
export const DECISION_LABEL = { pending: 'Pending', keep: 'Keep', revoke: 'Revoke', modify: 'Modify' }
export const DORMANT_DAYS = 90

const DAY_MS = 86400000

/** Whole days since a timestamp, or null when there is no usable value. */
export function daysSince(value, now = new Date()) {
  if (!value) return null
  const t = new Date(value).getTime()
  if (!Number.isFinite(t)) return null
  const n = now instanceof Date ? now.getTime() : new Date(now).getTime()
  return Math.max(0, Math.floor((n - t) / DAY_MS))
}

/**
 * Dormant = has not signed in for `days` or more, OR has never signed in.
 * "Never" is reported separately so a reviewer can tell a stale account from
 * one that was provisioned and never used.
 */
export function dormancy(item, now = new Date(), days = DORMANT_DAYS) {
  const d = daysSince(item?.last_sign_in_at, now)
  if (d === null) return { dormant: true, never: true, days: null }
  return { dormant: d >= days, never: false, days: d }
}

export function isDormant(item, now = new Date(), days = DORMANT_DAYS) {
  return dormancy(item, now, days).dormant
}

export function grantCount(item) {
  return Array.isArray(item?.grants) ? item.grants.length : 0
}

/** Counts per decision plus completion. pct is null for an empty campaign. */
export function reviewProgress(items = [], now = new Date()) {
  const out = { total: 0, pending: 0, keep: 0, revoke: 0, modify: 0, decided: 0, pct: null, dormant: 0, superAdmins: 0 }
  for (const it of items || []) {
    out.total += 1
    const d = DECISIONS.includes(it?.decision) ? it.decision : 'pending'
    out[d] += 1
    if (isDormant(it, now)) out.dormant += 1
    if (it?.is_super_admin) out.superAdmins += 1
  }
  out.decided = out.total - out.pending
  out.pct = out.total ? Math.round((out.decided / out.total) * 100) : null
  return out
}

function textOf(item) {
  return [
    item?.full_name, item?.user_email, item?.role,
    ...(Array.isArray(item?.country) ? item.country : []),
    ...(Array.isArray(item?.sites) ? item.sites : []),
  ].filter(Boolean).join(' ').toLowerCase()
}

/**
 * Filter review items. All criteria are optional; 'all' or '' means no filter.
 * { search, decision, role, flag: 'all'|'dormant'|'super'|'grants' }
 */
export function filterItems(items = [], { search = '', decision = 'all', role = '', flag = 'all' } = {}, now = new Date()) {
  const q = String(search || '').trim().toLowerCase()
  return (items || []).filter((it) => {
    if (decision && decision !== 'all' && (it?.decision || 'pending') !== decision) return false
    if (role && it?.role !== role) return false
    if (flag === 'dormant' && !isDormant(it, now)) return false
    if (flag === 'super' && !it?.is_super_admin) return false
    if (flag === 'grants' && grantCount(it) === 0) return false
    if (q && !textOf(it).includes(q)) return false
    return true
  })
}

/** Distinct roles in the snapshot, sorted, for the role filter. */
export function rolesIn(items = []) {
  return [...new Set((items || []).map((i) => i?.role).filter(Boolean))].sort()
}

/** Items a bulk "keep" may touch: only still-pending ones, never overwriting a decision. */
export function bulkKeepCandidates(items = []) {
  return (items || []).filter((i) => (i?.decision || 'pending') === 'pending')
}

function listText(v) {
  return Array.isArray(v) && v.length ? v.join(', ') : 'None'
}

/** Rows for the Excel evidence export (keys match EVIDENCE_COLUMNS). */
export const EVIDENCE_COLUMNS = [
  ['full_name', 'Name'], ['user_email', 'Email'], ['role', 'Role'], ['super_admin', 'Super admin'],
  ['countries', 'Countries'], ['sites', 'Sites'], ['grants', 'Per user grants'], ['locked_at_snapshot', 'Locked at snapshot'],
  ['last_sign_in', 'Last sign in'], ['dormant', 'Dormant (90+ days)'], ['decision', 'Decision'], ['note', 'Reason'],
  ['reviewer', 'Reviewer'], ['decided_at', 'Decided at'], ['apply_result', 'Apply result'], ['applied_at', 'Applied at'],
]

export function evidenceRows(items = [], now = new Date()) {
  return (items || []).map((it) => {
    const dm = dormancy(it, now)
    return {
      full_name: it.full_name || 'N/A',
      user_email: it.user_email || 'N/A',
      role: it.role || 'N/A',
      super_admin: it.is_super_admin ? 'Yes' : 'No',
      countries: listText(it.country),
      sites: listText(it.sites),
      grants: grantCount(it) ? it.grants.map((g) => `${g.effect || 'grant'} ${g.module_key}${g.capability ? ` (${g.capability})` : ''}`).join('; ') : 'None',
      locked_at_snapshot: it.locked ? 'Yes' : 'No',
      last_sign_in: it.last_sign_in_at || 'Never',
      dormant: dm.dormant ? (dm.never ? 'Yes (never signed in)' : `Yes (${dm.days} days)`) : 'No',
      decision: DECISION_LABEL[it.decision] || 'Pending',
      note: it.decision_note || '',
      reviewer: it.decided_by_email || '',
      decided_at: it.decided_at || '',
      apply_result: it.apply_result || '',
      applied_at: it.applied_at || '',
    }
  })
}

/** True when a campaign past its due date is still open. */
export function isOverdue(campaign, now = new Date()) {
  if (!campaign?.due_at || campaign.status === 'closed') return false
  return new Date(campaign.due_at).getTime() < (now instanceof Date ? now.getTime() : new Date(now).getTime())
}
