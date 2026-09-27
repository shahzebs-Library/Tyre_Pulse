/**
 * Service Requests analytics (pure, no I/O) behind /service-requests.
 *
 * Builds on src/lib/serviceRequests.js (resolutionHours, CLOSED_STATUSES).
 * Adds per-request enrichment (open age, response target by priority, overdue
 * flag), filters, the KPI strip, a monthly intake vs resolved series, a
 * category breakdown and export rows.
 *
 * Response targets are the page's own triage guide (urgent 4 h, high 24 h,
 * medium 72 h, low 168 h). They are labelled as targets on screen; nothing
 * here claims a contractual SLA.
 *
 * Honesty: an average with nothing to average is null (N/A). A request with no
 * requested_at has no age, not an age of 0. `now` is injectable.
 */
import { resolutionHours, CLOSED_STATUSES } from './serviceRequests'

export const SR_CATEGORIES = ['tyre', 'mechanical', 'electrical', 'bodywork', 'inspection', 'breakdown', 'other']
export const SR_PRIORITIES = ['low', 'medium', 'high', 'urgent']
export const SR_STATUSES = ['new', 'triaged', 'in_progress', 'resolved', 'closed', 'cancelled']
export const SR_STATUS_LABEL = {
  new: 'New', triaged: 'Triaged', in_progress: 'In progress',
  resolved: 'Resolved', closed: 'Closed', cancelled: 'Cancelled',
}
/** Triage response target, in hours, per priority. */
export const RESPONSE_TARGET_HOURS = { urgent: 4, high: 24, medium: 72, low: 168 }

export const EMPTY_SR_FILTERS = { search: '', status: '', priority: '', category: '', assignee: '', openOnly: false, overdueOnly: false }

const HOUR_MS = 3600000
const str = (v) => (v == null ? '' : String(v).trim())
const lc = (v) => str(v).toLowerCase()
const round1 = (n) => Math.round(n * 10) / 10
const pct = (num, den) => (den > 0 ? round1((num / den) * 100) : null)
const nowMsOf = (now) => (now instanceof Date ? now.getTime() : Number.isFinite(Number(now)) ? Number(now) : Date.now())
const timeOf = (v) => {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

export const cap = (s) => (str(s) ? str(s).charAt(0).toUpperCase() + str(s).slice(1) : 'N/A')
export const statusLabel = (s) => SR_STATUS_LABEL[lc(s)] || cap(s)

export function isOpenRequest(r) {
  return !CLOSED_STATUSES.includes(lc(r?.status))
}

/** Hours an open request has been waiting, or null when unknown / closed. */
export function openAgeHours(r, now = new Date()) {
  if (!isOpenRequest(r)) return null
  const t = timeOf(r?.requested_at) ?? timeOf(r?.created_at)
  if (t == null) return null
  const h = (nowMsOf(now) - t) / HOUR_MS
  return h < 0 ? 0 : round1(h)
}

export function enrichRequest(r = {}, now = new Date()) {
  const open = isOpenRequest(r)
  const age = openAgeHours(r, now)
  const target = RESPONSE_TARGET_HOURS[lc(r.priority)] ?? null
  return {
    ...r,
    _open: open,
    _age: age,
    _target: target,
    _overdue: Boolean(open && age != null && target != null && age > target),
    _resolution: resolutionHours(r),
    _statusLabel: statusLabel(r.status),
  }
}

export function enrichRequests(rows = [], now = new Date()) {
  return (Array.isArray(rows) ? rows : []).map((r) => enrichRequest(r, now))
}

export function assigneeOptions(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => str(r?.assigned_to)).filter(Boolean))].sort()
}

export function activeSrFilterCount(f = EMPTY_SR_FILTERS) {
  let n = ['search', 'status', 'priority', 'category', 'assignee'].filter((k) => str(f[k])).length
  if (f.openOnly) n++
  if (f.overdueOnly) n++
  return n
}

export function filterRequests(enriched = [], f = EMPTY_SR_FILTERS) {
  const q = lc(f.search)
  return (Array.isArray(enriched) ? enriched : []).filter((r) => {
    if (f.status && lc(r.status) !== f.status) return false
    if (f.priority && lc(r.priority) !== f.priority) return false
    if (f.category && lc(r.category) !== f.category) return false
    if (f.assignee === '__none' ? str(r.assigned_to) : (f.assignee && str(r.assigned_to) !== f.assignee)) return false
    if (f.openOnly && !r._open) return false
    if (f.overdueOnly && !r._overdue) return false
    if (q) {
      const hay = `${r.request_no || ''} ${r.subject || ''} ${r.asset_no || ''} ${r.requester_name || ''} ${r.assigned_to || ''} ${r.description || ''} ${r.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function srKpis(enriched = []) {
  const list = Array.isArray(enriched) ? enriched : []
  let open = 0
  let urgentOpen = 0
  let overdue = 0
  let unassignedOpen = 0
  let resolved = 0
  let resSum = 0
  let resN = 0
  let ageSum = 0
  let ageN = 0
  const byStatus = Object.fromEntries(SR_STATUSES.map((s) => [s, 0]))
  for (const r of list) {
    const s = lc(r.status)
    if (byStatus[s] != null) byStatus[s] += 1
    if (s === 'resolved' || s === 'closed') resolved += 1
    if (r._open) {
      open += 1
      if (lc(r.priority) === 'urgent') urgentOpen += 1
      if (r._overdue) overdue += 1
      if (!str(r.assigned_to)) unassignedOpen += 1
      if (r._age != null) { ageSum += r._age; ageN += 1 }
    }
    if (r._resolution != null) { resSum += r._resolution; resN += 1 }
  }
  return {
    total: list.length,
    byStatus,
    open,
    urgentOpen,
    overdue,
    unassignedOpen,
    resolved,
    resolvedPct: pct(resolved, list.length),
    avgResolutionHours: resN ? round1(resSum / resN) : null,
    resolutionSample: resN,
    avgOpenAgeHours: ageN ? round1(ageSum / ageN) : null,
  }
}

/** Requests raised vs resolved per month (YYYY-MM), oldest first. */
export function monthlyFlow(enriched = []) {
  const m = new Map()
  const bucket = (key) => {
    const b = m.get(key) || { month: key, raised: 0, resolved: 0 }
    m.set(key, b)
    return b
  }
  for (const r of Array.isArray(enriched) ? enriched : []) {
    const raised = timeOf(r.requested_at) ?? timeOf(r.created_at)
    if (raised != null) bucket(new Date(raised).toISOString().slice(0, 7)).raised += 1
    const done = timeOf(r.resolved_at)
    if (done != null) bucket(new Date(done).toISOString().slice(0, 7)).resolved += 1
  }
  return [...m.values()].sort((a, b) => a.month.localeCompare(b.month))
}

/** Count per category, largest first. Blank categories are ignored. */
export function categoryMix(enriched = []) {
  const m = new Map()
  for (const r of Array.isArray(enriched) ? enriched : []) {
    const c = lc(r.category)
    if (!c) continue
    m.set(c, (m.get(c) || 0) + 1)
  }
  return [...m.entries()].map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
}

export const SR_EXPORT_COLUMNS = [
  ['request_no', 'Request #'], ['subject', 'Subject'], ['asset_no', 'Asset'], ['category', 'Category'],
  ['priority', 'Priority'], ['status', 'Status'], ['requester_name', 'Requester'], ['assigned_to', 'Assigned to'],
  ['requested_at', 'Requested at'], ['resolved_at', 'Resolved at'], ['open_age_h', 'Open age (h)'],
  ['overdue', 'Past response target'], ['resolution_h', 'Resolution (h)'],
]

export function srExportRows(enriched = []) {
  return (Array.isArray(enriched) ? enriched : []).map((r) => ({
    request_no: r.request_no || '',
    subject: r.subject || '',
    asset_no: r.asset_no || '',
    category: cap(r.category),
    priority: cap(r.priority),
    status: r._statusLabel,
    requester_name: r.requester_name || '',
    assigned_to: r.assigned_to || '',
    requested_at: r.requested_at || '',
    resolved_at: r.resolved_at || '',
    open_age_h: r._age == null ? 'N/A' : r._age,
    overdue: r._open ? (r._overdue ? 'Yes' : 'No') : 'N/A',
    resolution_h: r._resolution == null ? 'N/A' : r._resolution,
  }))
}
