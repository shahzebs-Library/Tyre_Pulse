/**
 * correctiveActionsAnalytics - pure engine behind the Corrective Actions page.
 *
 * Every function that needs the current time takes `now` (a Date or epoch ms)
 * so results are deterministic and testable. No I/O.
 *
 * The page keeps its own `narrow()` predicate (the KPI hold-out rule pinned by
 * kpiFilterAwareness.test.js); this module supplies the maths it applies.
 */

export const STATUSES = ['Open', 'In Progress', 'Closed']
export const PRIORITIES = ['High', 'Medium', 'Low']
export const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 }

const DAY = 86_400_000
const toMs = (v) => {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v)
  return Number.isFinite(t) ? t : null
}
const nowMs = (now) => toMs(now ?? Date.now())

/** Whole days past due for an unclosed action, null when not overdue or no due date. */
export function overdueDays(dueDate, status, now) {
  if (status === 'Closed') return null
  const due = toMs(dueDate)
  if (due == null) return null
  const days = Math.floor((nowMs(now) - due) / DAY)
  return days > 0 ? days : null
}

/** Days from creation to close (or to now while open). null when created_at is unknown. */
export function daysOpen(createdAt, closedAt, now) {
  const start = toMs(createdAt)
  if (start == null) return null
  const end = toMs(closedAt) ?? nowMs(now)
  return Math.max(0, Math.floor((end - start) / DAY))
}

/** Mean days to close over actions that are closed with both timestamps. null when none. */
export function avgDaysToClose(actions = [], now) {
  const vals = actions
    .filter(a => a.status === 'Closed' && a.closed_at && a.created_at)
    .map(a => daysOpen(a.created_at, a.closed_at, now))
    .filter(v => v != null)
  if (!vals.length) return null
  return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
}

/** Case-insensitive search across the fields an operator types. */
export function matchesSearch(a, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  return ['title', 'assigned_to', 'asset_no', 'tyre_serial', 'site', 'root_cause', 'description']
    .some(k => String(a?.[k] ?? '').toLowerCase().includes(q))
}

export function statusCounts(actions = []) {
  const c = { Open: 0, 'In Progress': 0, Closed: 0 }
  for (const a of actions) if (c[a.status] !== undefined) c[a.status] += 1
  return c
}

/** Share of unclosed actions that are overdue. null when nothing is open. */
export function overdueRate(actions = [], now) {
  const open = actions.filter(a => a.status !== 'Closed')
  if (!open.length) return null
  const od = open.filter(a => overdueDays(a.due_date, a.status, now) != null).length
  return (od / open.length) * 100
}

/** Root cause frequency, largest first. */
export function rootCauseDistribution(actions = [], limit = 6) {
  const m = new Map()
  for (const a of actions) if (a.root_cause) m.set(a.root_cause, (m.get(a.root_cause) || 0) + 1)
  return [...m.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .slice(0, limit)
    .map(([cause, count]) => ({ cause, count }))
}

/** Actions per site with open and overdue counts, busiest first. */
export function siteBreakdown(actions = [], now) {
  const m = new Map()
  for (const a of actions) {
    const k = a.site || 'No site'
    if (!m.has(k)) m.set(k, { site: k, total: 0, open: 0, overdue: 0 })
    const r = m.get(k)
    r.total += 1
    if (a.status !== 'Closed') r.open += 1
    if (overdueDays(a.due_date, a.status, now) != null) r.overdue += 1
  }
  return [...m.values()].sort((x, y) => y.open - x.open || y.total - x.total || x.site.localeCompare(y.site))
}

/** Sort for the card view (the table sorts by column). Returns a new array. */
export function sortActions(actions = [], sortBy = 'created_at', now) {
  const arr = [...actions]
  if (sortBy === 'priority') return arr.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9))
  if (sortBy === 'due_date') return arr.sort((a, b) => String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999')))
  if (sortBy === 'overdue') {
    return arr.sort((a, b) => (overdueDays(b.due_date, b.status, now) ?? 0) - (overdueDays(a.due_date, a.status, now) ?? 0))
  }
  return arr.sort((a, b) => (toMs(b.created_at) ?? 0) - (toMs(a.created_at) ?? 0))
}

/** Table rows with derived fields attached once. */
export function actionRows(actions = [], now) {
  return actions.map(a => ({
    ...a,
    _overdue: overdueDays(a.due_date, a.status, now),
    _age: daysOpen(a.created_at, a.closed_at, now),
    _priorityRank: PRIORITY_RANK[a.priority] ?? null,
  }))
}

export const EXPORT_COLS = ['title', 'priority', 'status', 'site', 'assigned_to', 'asset_no', 'tyre_serial', 'root_cause', 'due_date', 'overdue_days', 'age_days', 'source', 'job', 'created_at']
export const EXPORT_HEADERS = ['Title', 'Priority', 'Status', 'Site', 'Assigned to', 'Asset no', 'Tyre serial', 'Root cause', 'Due date', 'Days overdue', 'Age (days)', 'Source', 'Job raised', 'Created']

export function actionExportRows(actions = [], now) {
  return actionRows(actions, now).map(a => ({
    title: a.title || 'N/A',
    priority: a.priority || 'N/A',
    status: a.status || 'N/A',
    site: a.site || 'N/A',
    assigned_to: a.assigned_to || 'N/A',
    asset_no: a.asset_no || 'N/A',
    tyre_serial: a.tyre_serial || 'N/A',
    root_cause: a.root_cause || 'N/A',
    due_date: a.due_date ? String(a.due_date).slice(0, 10) : 'N/A',
    overdue_days: a._overdue ?? '',
    age_days: a._age ?? 'N/A',
    source: a.source_type && a.source_type !== 'manual' ? `${a.source_type}${a.source_detail ? ` (${a.source_detail})` : ''}` : 'Manual',
    job: a.work_order_id ? 'Yes' : 'No',
    created_at: a.created_at ? String(a.created_at).slice(0, 10) : 'N/A',
  }))
}
