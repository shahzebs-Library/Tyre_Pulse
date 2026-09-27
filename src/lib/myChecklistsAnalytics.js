/**
 * myChecklistsAnalytics.js - pure logic behind "My Checklists"
 * (src/pages/MyChecklists.jsx).
 *
 * Owns the due-date arithmetic, the derived status (a pending assignment whose
 * due date has passed is overdue even before the nightly generator restamps it),
 * the urgency ordering, the KPI roll-up, the status tabs and the search / site /
 * checklist filters. No I/O, no React; `now` is injectable so the date maths is
 * deterministic in tests.
 *
 * Honesty rules: a missing due date is "No due date", never "due today"; the
 * completion rate is null when nothing has been decided yet (never 0% or 100%).
 */

const MS_DAY = 86400000

function startOfDay(d) {
  const x = new Date(d)
  if (Number.isNaN(x.getTime())) return null
  x.setHours(0, 0, 0, 0)
  return x
}

/** Whole-day delta between a due date and `now`. Negative means overdue. Null-safe. */
export function dueDeltaDays(due, now = new Date()) {
  if (!due) return null
  const d = startOfDay(due)
  const today = startOfDay(now)
  if (!d || !today) return null
  return Math.round((d.getTime() - today.getTime()) / MS_DAY)
}

/** Human relative hint for a due date: { text, tone }. */
export function dueHint(due, status, now = new Date()) {
  if (status === 'completed') return { text: 'Completed', tone: 'green' }
  if (status === 'skipped') return { text: 'Skipped', tone: 'muted' }
  const delta = dueDeltaDays(due, now)
  if (delta == null) return { text: 'No due date', tone: 'muted' }
  if (delta < 0) {
    const n = Math.abs(delta)
    return { text: `${n} day${n === 1 ? '' : 's'} overdue`, tone: 'red' }
  }
  if (delta === 0) return { text: 'Due today', tone: 'amber' }
  if (delta === 1) return { text: 'Due tomorrow', tone: 'amber' }
  return { text: `Due in ${delta} days`, tone: 'muted' }
}

/** Derived status: pending past its due date reads as overdue. */
export function effectiveStatus(a, now = new Date()) {
  const s = String(a?.status || 'pending').toLowerCase()
  if (s === 'pending') {
    const delta = dueDeltaDays(a?.due_date, now)
    if (delta != null && delta < 0) return 'overdue'
  }
  return s
}

const RANK = { overdue: 0, pending: 1, completed: 2, skipped: 3 }

/**
 * Decorate each assignment with `_status` and `_delta` and order it by urgency:
 * overdue, pending, completed, skipped; oldest due date first within a status,
 * undated last. Never mutates the input.
 */
export function decorateAssignments(rows, now = new Date()) {
  const list = Array.isArray(rows) ? rows : []
  return list
    .map((a) => ({ ...a, _status: effectiveStatus(a, now), _delta: dueDeltaDays(a?.due_date, now) }))
    .sort((x, y) => {
      const r = (RANK[x._status] ?? 9) - (RANK[y._status] ?? 9)
      if (r !== 0) return r
      const dx = x.due_date ? new Date(x.due_date).getTime() : Infinity
      const dy = y.due_date ? new Date(y.due_date).getTime() : Infinity
      return (Number.isNaN(dx) ? Infinity : dx) - (Number.isNaN(dy) ? Infinity : dy)
    })
}

/**
 * KPI roll-up over decorated rows. `completionRate` = completed over every
 * assignment that reached a decision or is due (completed + skipped + overdue),
 * null when there is nothing to measure. `dueThisWeek` counts open rows due in
 * the next 7 days (today included).
 */
export function checklistKpis(decorated) {
  let overdue = 0, pending = 0, completed = 0, skipped = 0, dueThisWeek = 0
  for (const a of decorated || []) {
    if (a._status === 'overdue') overdue++
    else if (a._status === 'pending') {
      pending++
      if (a._delta != null && a._delta >= 0 && a._delta <= 6) dueThisWeek++
    } else if (a._status === 'completed') completed++
    else if (a._status === 'skipped') skipped++
  }
  const measured = completed + skipped + overdue
  return {
    overdue, pending, completed, skipped, dueThisWeek,
    todo: overdue + pending,
    total: (decorated || []).length,
    completionRate: measured > 0 ? Math.round((completed / measured) * 1000) / 10 : null,
  }
}

export const TABS = Object.freeze([
  { key: 'todo', label: 'To do' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'pending', label: 'Pending' },
  { key: 'completed', label: 'Completed' },
  { key: 'skipped', label: 'Skipped' },
  { key: 'all', label: 'All' },
])

/** Count for a tab from the KPI roll-up. */
export function tabCount(key, kpis) {
  if (!kpis) return 0
  if (key === 'todo') return kpis.todo
  if (key === 'all') return kpis.total
  return kpis[key] ?? 0
}

/** Rows for a status tab. */
export function filterByTab(decorated, tab) {
  const list = decorated || []
  switch (tab) {
    case 'overdue': return list.filter((a) => a._status === 'overdue')
    case 'pending': return list.filter((a) => a._status === 'pending')
    case 'completed': return list.filter((a) => a._status === 'completed')
    case 'skipped': return list.filter((a) => a._status === 'skipped')
    case 'all': return list
    case 'todo':
    default: return list.filter((a) => a._status === 'overdue' || a._status === 'pending')
  }
}

/** Search (checklist, role, site, asset) + exact site + exact checklist name. */
export function filterAssignments(rows, { q = '', site = '', template = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase()
  return (rows || []).filter((a) => {
    if (site && String(a.site || '') !== site) return false
    if (template && String(a.template_name || '') !== template) return false
    if (!needle) return true
    return `${a.template_name || ''} ${a.assignee_role || ''} ${a.site || ''} ${a.asset_no || ''}`
      .toLowerCase().includes(needle)
  })
}

/** Distinct non-blank values of a field, sorted. */
export function distinctValues(rows, field) {
  return [...new Set((rows || []).map((r) => r?.[field]).filter((v) => v != null && String(v).trim() !== '').map(String))]
    .sort((a, b) => a.localeCompare(b))
}

export function prettyStatus(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Flat rows for Excel/PDF over the whole filtered set. */
export function assignmentExportRows(rows, now = new Date()) {
  return (rows || []).map((a) => ({
    checklist: a.template_name || 'Checklist',
    role: a.assignee_role || '',
    site: a.site || '',
    asset: a.asset_no || '',
    due_date: a.due_date ? String(a.due_date).slice(0, 10) : '',
    due: dueHint(a.due_date, a._status, now).text,
    status: prettyStatus(a._status),
  }))
}
