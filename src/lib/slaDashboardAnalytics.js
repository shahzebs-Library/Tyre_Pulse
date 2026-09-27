/**
 * SLA Dashboard analytics (pure, no I/O) behind /sla-dashboard.
 *
 * Builds on src/lib/slaRecords.js (breachStatus, hoursRemaining,
 * resolutionHours) so the breach rules have one home. Adds row decoration,
 * filters, the KPI strip, a per-type compliance table, a per-owner breach
 * table, the attention list and export rows.
 *
 * Honesty: summariseSla/byType in slaRecords report 0% compliance when nothing
 * has been decided yet. This engine reports null (N/A) instead, because 0%
 * reads as "every SLA was breached". `nowMs` is injectable for determinism.
 */
import { breachStatus, hoursRemaining, resolutionHours } from './slaRecords'

export const SLA_TYPES = [
  { value: 'work_order', label: 'Work Order' },
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'procurement', label: 'Procurement' },
  { value: 'support', label: 'Support' },
  { value: 'other', label: 'Other' },
]
export const SLA_TYPE_LABEL = Object.fromEntries(SLA_TYPES.map((t) => [t.value, t.label]))
export const SLA_PRIORITIES = ['low', 'medium', 'high', 'critical']
/** Stored statuses a user can set on the record. */
export const SLA_STORED_STATUSES = ['on_track', 'at_risk', 'breached', 'met', 'cancelled']
/** Derived statuses the dashboard shows. */
export const SLA_DERIVED_STATUSES = ['met', 'on_track', 'at_risk', 'breached', 'unknown']
export const SLA_STATUS_LABEL = {
  met: 'Met', on_track: 'On Track', at_risk: 'At Risk', breached: 'Breached', cancelled: 'Cancelled', unknown: 'No due date',
}
export const EMPTY_SLA_FILTERS = { search: '', type: '', status: '', priority: '', owner: '' }

const str = (v) => (v == null ? '' : String(v).trim())
const round1 = (n) => Math.round(n * 10) / 10
const rate = (met, breached) => (met + breached > 0 ? round1((met / (met + breached)) * 100) : null)

export const titleCase = (v) => (str(v) ? str(v).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'N/A')
export const typeLabel = (t) => SLA_TYPE_LABEL[t] || titleCase(t)

/** Decorate each row once with derived status, time remaining and resolution. */
export function decorateSla(rows = [], nowMs) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const status = breachStatus(r, nowMs)
    return {
      ...r,
      _status: status,
      _statusLabel: SLA_STATUS_LABEL[status] || titleCase(status),
      _remaining: hoursRemaining(r, nowMs),
      _resolution: resolutionHours(r),
      _typeLabel: typeLabel(r.sla_type),
      _open: status === 'on_track' || status === 'at_risk' || (status === 'breached' && !r.resolved_at),
    }
  })
}

export function ownerOptions(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => str(r?.owner)).filter(Boolean))].sort()
}

export function activeSlaFilterCount(f = EMPTY_SLA_FILTERS) {
  return ['search', 'type', 'status', 'priority', 'owner'].filter((k) => str(f[k])).length
}

export function filterSla(decorated = [], f = EMPTY_SLA_FILTERS) {
  const q = str(f.search).toLowerCase()
  return (Array.isArray(decorated) ? decorated : []).filter((r) => {
    if (f.type && r.sla_type !== f.type) return false
    if (f.status && r._status !== f.status) return false
    if (f.priority && r.priority !== f.priority) return false
    if (f.owner && str(r.owner) !== f.owner) return false
    if (q) {
      const hay = `${r.reference || ''} ${r.asset_no || ''} ${r.owner || ''} ${r.notes || ''} ${r._typeLabel || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function slaKpis(decorated = []) {
  const list = Array.isArray(decorated) ? decorated : []
  const byStatus = Object.fromEntries(SLA_DERIVED_STATUSES.map((s) => [s, 0]))
  let resSum = 0
  let resN = 0
  let openBreached = 0
  for (const r of list) {
    if (byStatus[r._status] != null) byStatus[r._status] += 1
    if (r._resolution != null) { resSum += r._resolution; resN += 1 }
    if (r._status === 'breached' && !r.resolved_at) openBreached += 1
  }
  return {
    total: list.length,
    byStatus,
    met: byStatus.met,
    breached: byStatus.breached,
    atRisk: byStatus.at_risk,
    openBreached,
    noDueDate: byStatus.unknown,
    decided: byStatus.met + byStatus.breached,
    complianceRate: rate(byStatus.met, byStatus.breached),
    avgResolutionHours: resN ? round1(resSum / resN) : null,
    resolutionSample: resN,
  }
}

/** Compliance per SLA type. Rate is null when nothing of that type is decided. Worst first. */
export function complianceByType(decorated = []) {
  const m = new Map()
  for (const r of Array.isArray(decorated) ? decorated : []) {
    const t = str(r.sla_type) || 'other'
    const b = m.get(t) || { sla_type: t, label: typeLabel(t), total: 0, met: 0, breached: 0, atRisk: 0 }
    b.total += 1
    if (r._status === 'met') b.met += 1
    else if (r._status === 'breached') b.breached += 1
    else if (r._status === 'at_risk') b.atRisk += 1
    m.set(t, b)
  }
  return [...m.values()]
    .map((b) => ({ ...b, complianceRate: rate(b.met, b.breached) }))
    .sort((a, b) => b.breached - a.breached || (a.complianceRate ?? 101) - (b.complianceRate ?? 101) || a.label.localeCompare(b.label))
}

/** Breaches per owner (blank owner is "Unowned"), worst first. Only owners with a decided SLA. */
export function breachesByOwner(decorated = []) {
  const m = new Map()
  for (const r of Array.isArray(decorated) ? decorated : []) {
    if (r._status !== 'met' && r._status !== 'breached') continue
    const o = str(r.owner) || 'Unowned'
    const b = m.get(o) || { owner: o, met: 0, breached: 0 }
    if (r._status === 'met') b.met += 1
    else b.breached += 1
    m.set(o, b)
  }
  return [...m.values()]
    .map((b) => ({ ...b, complianceRate: rate(b.met, b.breached) }))
    .sort((a, b) => b.breached - a.breached || a.owner.localeCompare(b.owner))
}

/** Every breached or at-risk record, breached first, then least time left. */
export function attentionList(decorated = []) {
  const rank = { breached: 0, at_risk: 1 }
  return (Array.isArray(decorated) ? decorated : [])
    .filter((r) => r._status === 'breached' || r._status === 'at_risk')
    .sort((a, b) => {
      if (rank[a._status] !== rank[b._status]) return rank[a._status] - rank[b._status]
      return (a._remaining ?? Infinity) - (b._remaining ?? Infinity)
    })
}

/** Human countdown string from signed hours remaining. */
export function fmtCountdown(hrs) {
  if (hrs == null) return 'N/A'
  const overdue = hrs < 0
  let mins = Math.round(Math.abs(hrs) * 60)
  const d = Math.floor(mins / 1440); mins -= d * 1440
  const h = Math.floor(mins / 60); mins -= h * 60
  const parts = []
  if (d) parts.push(`${d}d`)
  if (h) parts.push(`${h}h`)
  if (!d && mins) parts.push(`${mins}m`)
  if (!parts.length) parts.push('0m')
  const body = parts.join(' ')
  return overdue ? `${body} overdue` : `${body} left`
}

export const SLA_EXPORT_COLUMNS = [
  ['reference', 'Reference'], ['sla_type', 'Type'], ['asset_no', 'Asset'], ['priority', 'Priority'],
  ['status', 'Status'], ['target_hours', 'Target (h)'], ['due_at', 'Due at'], ['resolved_at', 'Resolved at'],
  ['time_remaining', 'Time remaining'], ['resolution_hours', 'Resolution (h)'], ['owner', 'Owner'],
]

export function slaExportRows(decorated = []) {
  return (Array.isArray(decorated) ? decorated : []).map((r) => ({
    reference: r.reference || '',
    sla_type: r._typeLabel,
    asset_no: r.asset_no || '',
    priority: titleCase(r.priority),
    status: r._statusLabel,
    target_hours: r.target_hours ?? '',
    due_at: r.due_at || '',
    resolved_at: r.resolved_at || '',
    time_remaining: r._open ? fmtCountdown(r._remaining) : 'N/A',
    resolution_hours: r._resolution == null ? 'N/A' : round1(r._resolution),
    owner: r.owner || '',
  }))
}
