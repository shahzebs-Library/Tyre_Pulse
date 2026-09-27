/**
 * Approval delegation analytics: pure presentation engine for the Approval
 * Delegation page (/approval-delegations). Builds on the lifecycle primitives
 * in ./approvalDelegations (delegationStatus, summariseDelegations, toEpochMs)
 * and adds filter, KPI (ending soon / open-ended), scope labelling and export
 * shaping. No I/O; the clock is injected.
 */
import { summariseDelegations, delegationStatus, toEpochMs } from './approvalDelegations'

export { delegationStatus }

export const ENTITY_TYPE_OPTIONS = [
  { value: '', label: 'All approval types' },
  { value: 'purchase_order', label: 'Purchase Order' },
  { value: 'work_order', label: 'Work Order' },
  { value: 'accident', label: 'Accident' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'tyre_change', label: 'Tyre Change' },
]
export const STATUS_LABEL = { active: 'Active', upcoming: 'Upcoming', expired: 'Expired', inactive: 'Inactive' }

const DAY_MS = 86400000

export function scopeLabel(v) {
  return ENTITY_TYPE_OPTIONS.find((o) => o.value === (v || ''))?.label || v || 'All approval types'
}

/** Resolve a user id to a display name through a Map of profiles. */
export function personName(id, peopleById) {
  if (!id) return 'N/A'
  const p = peopleById?.get?.(id)
  if (!p) return id
  return p.full_name || p.username || p.email || id
}

export function filterDelegations(rows = [], { status = '', scope = '', search = '' } = {}, now = Date.now(), nameOf = (x) => x || '') {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (status && delegationStatus(r, now) !== status) return false
    if (scope && (r.entity_type || '') !== scope) return false
    if (q) {
      const hay = `${nameOf(r.delegator_id)} ${nameOf(r.delegate_id)} ${r.entity_type || ''} ${scopeLabel(r.entity_type)} ${r.reason || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/**
 * KPIs: lifecycle counts plus active delegations ending within `soonDays`
 * and active open-ended delegations (no end date, a governance risk).
 */
export function delegationKpis(rows = [], { now = Date.now(), soonDays = 7 } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const base = summariseDelegations(list, now)
  let endingSoon = 0
  let openEnded = 0
  for (const r of list) {
    if (delegationStatus(r, now) !== 'active') continue
    const end = toEpochMs(r.ends_at)
    if (end == null) openEnded += 1
    else if (end - now <= soonDays * DAY_MS) endingSoon += 1
  }
  return { ...base, endingSoon, openEnded, soonDays }
}

export const EXPORT_COLS = ['delegator', 'delegate', 'entity_type', 'status', 'starts_at', 'ends_at', 'reason']
export const EXPORT_HEADERS = ['Delegator', 'Delegate (acting)', 'Scope', 'Status', 'Starts', 'Ends', 'Reason']

export function delegationExportRows(rows = [], now = Date.now(), nameOf = (x) => x || '', fmt = (v) => String(v)) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    delegator: nameOf(r.delegator_id),
    delegate: nameOf(r.delegate_id),
    entity_type: r.entity_type ? scopeLabel(r.entity_type) : 'All types',
    status: STATUS_LABEL[delegationStatus(r, now)] || 'N/A',
    starts_at: r.starts_at ? fmt(r.starts_at) : 'Immediately',
    ends_at: r.ends_at ? fmt(r.ends_at) : 'Open-ended',
    reason: r.reason || '',
  }))
}
