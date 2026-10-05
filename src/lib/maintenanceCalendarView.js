/**
 * Pure shaping for the Maintenance Calendar page (route /maintenance-calendar).
 *
 * The page reads three real sources: work orders with a target completion date,
 * at-risk tyres still on a vehicle, and active Preventive Maintenance plans with
 * a next due date. Everything here is deterministic (pass `today` in) and does
 * no I/O, so it can be tested without a database.
 *
 * Dates are calendar-day keys ("YYYY-MM-DD", browser-local). A key is never
 * derived with toISOString(), which is UTC and rolls the day for GCC users.
 */
import { calendarDateKey } from './calendarDate'
import { pmDueStatus } from './pmPrograms'

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Event type -> legend label + tone (a CSS modifier in MaintenanceCalendar.css). */
export const EVENT_TYPES = {
  work_order:         { label: 'Work order',      tone: 'blue' },
  overdue_work_order: { label: 'Overdue',         tone: 'red' },
  critical_tyre:      { label: 'Critical tyre',   tone: 'red' },
  high_risk_tyre:     { label: 'High risk tyre',  tone: 'orange' },
  pm_plan:            { label: 'PM plan',         tone: 'indigo' },
  overdue_pm:         { label: 'Overdue PM',      tone: 'red' },
}
export const LEGEND_ORDER = ['work_order', 'overdue_work_order', 'critical_tyre', 'high_risk_tyre', 'pm_plan', 'overdue_pm']

export const SOURCE_OPTIONS = [
  { value: 'All', label: 'All sources' },
  { value: 'work_order', label: 'Work orders' },
  { value: 'tyre', label: 'Tyre alerts' },
  { value: 'pm_plan', label: 'PM plans' },
]
export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low']
const PRIORITY_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 }

const CLOSED_WO = ['Completed', 'Closed', 'Cancelled']

// ── Date helpers ─────────────────────────────────────────────────────────────
export function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
export function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}
export function dayKey(d) { return calendarDateKey(d) }

function keyToDate(key) {
  if (!key) return null
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Day-first, e.g. "05 Oct 2026". */
export function fmtDay(key) {
  const d = typeof key === 'string' ? keyToDate(key) : key
  if (!d || Number.isNaN(d.getTime())) return 'N/A'
  return `${String(d.getDate()).padStart(2, '0')} ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`
}
/** Day-first long form, e.g. "Monday 05 October 2026". */
export function fmtDayLong(key) {
  const d = typeof key === 'string' ? keyToDate(key) : key
  if (!d || Number.isNaN(d.getTime())) return 'N/A'
  const wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]
  return `${wd} ${String(d.getDate()).padStart(2, '0')} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
}

// ── Event builders (logic carried over unchanged from the previous page) ────
export function buildWorkOrderEvents(orders, todayKey) {
  return (orders || [])
    .filter((o) => o.target_completion)
    .map((o) => {
      const date = calendarDateKey(o.target_completion)
      if (!date) return null
      const isOverdue = date < todayKey && !CLOSED_WO.includes(o.status)
      return {
        id: `wo-${o.id}`,
        date,
        type: isOverdue ? 'overdue_work_order' : 'work_order',
        priority: o.priority || 'Medium',
        title: o.work_order_no || 'Work order',
        subtitle: `${o.asset_no || 'No asset'} | ${o.work_type || 'No type'}`,
        asset: o.asset_no || null,
        site: o.site || null,
        description: o.description || o.work_type || null,
        status: o.status || null,
        isOverdue,
        raw: o,
        source: 'work_order',
      }
    })
    .filter(Boolean)
}

/**
 * At-risk tyres have no scheduled date in the data, so the replacement date is
 * an ESTIMATE from today: tread at or under 3 mm -> 3 days, Critical -> 7 days,
 * High -> 14 days. The event is flagged `estimated` so the page can say so.
 */
export function buildTyreEvents(tyres, today) {
  const base = startOfDay(today)
  return (tyres || [])
    .filter((t) => ['Critical', 'High'].includes(t.risk_level))
    .map((t) => {
      let offset = t.risk_level === 'Critical' ? 7 : 14
      const tread = parseFloat(t.tread_depth)
      if (Number.isFinite(tread) && tread <= 3) offset = 3
      const date = calendarDateKey(addDays(base, offset))
      const asset = t.asset_no || t.asset_number || null
      return {
        id: `tyre-${t.id}`,
        date,
        type: t.risk_level === 'Critical' ? 'critical_tyre' : 'high_risk_tyre',
        priority: t.risk_level === 'Critical' ? 'Critical' : 'High',
        title: asset || 'Tyre',
        subtitle: `${t.risk_level} risk | ${t.brand || 'No brand'}`,
        asset,
        site: t.site || null,
        description: `Tread ${t.tread_depth != null ? `${t.tread_depth} mm` : 'not recorded'} | Serial ${t.serial_no || 'not recorded'}`,
        status: 'Pending replacement',
        isOverdue: false,
        estimated: true,
        raw: t,
        source: 'tyre',
      }
    })
    .filter((e) => e.date)
}

/** One event per active PM plan carrying a next due date. */
export function buildPmEvents(programs, today) {
  return (programs || [])
    .filter((p) => p.status === 'active' && p.next_due)
    .map((p) => {
      const date = calendarDateKey(p.next_due)
      if (!date) return null
      const overdue = pmDueStatus(p, today) === 'overdue'
      const asset = p.asset_no || p.asset_type || null
      const interval = p.interval_value != null && p.interval_type
        ? `Every ${p.interval_value} ${p.interval_type}`
        : (p.interval_type || 'Preventive maintenance')
      return {
        id: `pm-${p.id}`,
        date,
        type: overdue ? 'overdue_pm' : 'pm_plan',
        priority: overdue ? 'Critical' : 'Medium',
        title: p.name || 'PM plan',
        subtitle: `${asset || 'No asset'} | ${interval}`,
        asset,
        site: p.site || null,
        description: p.notes || interval,
        status: overdue ? 'Overdue' : 'Scheduled',
        isOverdue: overdue,
        raw: p,
        source: 'pm_plan',
      }
    })
    .filter(Boolean)
}

export function buildEvents({ workOrders, tyres, pmPrograms, today }) {
  const todayKey = calendarDateKey(startOfDay(today))
  return [
    ...buildWorkOrderEvents(workOrders, todayKey),
    ...buildTyreEvents(tyres, today),
    ...buildPmEvents(pmPrograms, startOfDay(today)),
  ]
}

// ── Filtering and grouping ───────────────────────────────────────────────────
export function filterEvents(events, { source = 'All', priority = 'All', site = 'All', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (events || []).filter((e) => {
    if (source !== 'All' && e.source !== source) return false
    if (priority !== 'All' && e.priority !== priority) return false
    if (site !== 'All' && (e.site || '') !== site) return false
    if (q) {
      const hay = [e.title, e.subtitle, e.asset, e.site, e.description, e.status].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function activeFilterCount(f) {
  return ['source', 'priority', 'site'].filter((k) => f[k] && f[k] !== 'All').length + (String(f.search || '').trim() ? 1 : 0)
}

export function siteOptions(events) {
  return [...new Set((events || []).map((e) => e.site).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

export function sortByPriority(list) {
  return [...list].sort((a, b) =>
    (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3)
    || (b.isOverdue ? 1 : 0) - (a.isOverdue ? 1 : 0)
    || String(a.title).localeCompare(String(b.title)))
}

export function groupByDate(events) {
  const map = {}
  for (const e of events || []) {
    if (!e.date) continue
    if (!map[e.date]) map[e.date] = []
    map[e.date].push(e)
  }
  for (const k of Object.keys(map)) map[k] = sortByPriority(map[k])
  return map
}

/** Agenda: dated groups between two keys (inclusive), ascending. */
export function agendaGroups(events, fromKey, toKey) {
  const map = groupByDate((events || []).filter((e) => e.date >= fromKey && e.date <= toKey))
  return Object.keys(map).sort().map((date) => ({ date, events: map[date] }))
}

// ── KPIs ─────────────────────────────────────────────────────────────────────
/**
 * overdue: past due and not done. dueThisWeek: dated in the Sun-Sat week that
 * holds today. upcoming30: today through today + 30. thisMonth: in the month
 * on screen. criticalToday: Critical priority dated today.
 */
export function calendarKpis(events, today, monthAnchor) {
  const t0 = startOfDay(today)
  const todayKey = dayKey(t0)
  const weekStart = addDays(t0, -t0.getDay())
  const wsKey = dayKey(weekStart)
  const weKey = dayKey(addDays(weekStart, 6))
  const end30 = dayKey(addDays(t0, 30))
  const m = monthAnchor ? new Date(monthAnchor) : t0
  const monthPrefix = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-`
  let overdue = 0; let dueThisWeek = 0; let upcoming30 = 0; let thisMonth = 0; let criticalToday = 0
  for (const e of events || []) {
    if (e.isOverdue) overdue++
    if (e.date >= wsKey && e.date <= weKey) dueThisWeek++
    if (e.date >= todayKey && e.date <= end30) upcoming30++
    if (e.date && e.date.startsWith(monthPrefix)) thisMonth++
    if (e.date === todayKey && e.priority === 'Critical') criticalToday++
  }
  return { overdue, dueThisWeek, upcoming30, thisMonth, criticalToday }
}

export function sourceBreakdown(events) {
  const c = { work_order: 0, tyre: 0, pm_plan: 0 }
  for (const e of events || []) if (c[e.source] != null) c[e.source]++
  return c
}

// ── Grid geometry ────────────────────────────────────────────────────────────
/** 6 x 7 month grid, Sunday first. */
export function monthCells(anchor) {
  const y = anchor.getFullYear(); const m = anchor.getMonth()
  const startCol = new Date(y, m, 1).getDay()
  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m, 1 - startCol + i)
    cells.push({ date: d, key: dayKey(d), inMonth: d.getMonth() === m })
  }
  return cells
}

export function weekDays(anchor) {
  const d = startOfDay(anchor)
  const sun = addDays(d, -d.getDay())
  return Array.from({ length: 7 }, (_, i) => addDays(sun, i))
}

export function periodLabel(view, currentDate, selectedDay) {
  if (view === 'month') return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`
  if (view === 'week') {
    const days = weekDays(currentDate)
    return `${fmtDay(days[0])} to ${fmtDay(days[6])}`
  }
  if (view === 'agenda') {
    return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`
  }
  return fmtDayLong(selectedDay || currentDate)
}

/** Date range covered by the current view, as day keys. */
export function viewRange(view, currentDate, selectedDay) {
  if (view === 'week') {
    const d = weekDays(currentDate)
    return { from: dayKey(d[0]), to: dayKey(d[6]) }
  }
  if (view === 'day') {
    const k = dayKey(selectedDay || currentDate)
    return { from: k, to: k }
  }
  const y = currentDate.getFullYear(); const m = currentDate.getMonth()
  return { from: dayKey(new Date(y, m, 1)), to: dayKey(new Date(y, m + 1, 0)) }
}

// ── Export ───────────────────────────────────────────────────────────────────
export const EXPORT_COLUMNS = ['date', 'source', 'type', 'title', 'asset', 'site', 'priority', 'status', 'overdue', 'description']
export const EXPORT_HEADERS = ['Date', 'Source', 'Type', 'Title', 'Asset', 'Site', 'Priority', 'Status', 'Overdue', 'Details']
const SOURCE_LABEL = { work_order: 'Work order', tyre: 'Tyre alert (estimated date)', pm_plan: 'PM plan' }

export function exportRows(events) {
  return [...(events || [])].sort((a, b) => a.date.localeCompare(b.date)).map((e) => ({
    date: fmtDay(e.date),
    source: SOURCE_LABEL[e.source] || e.source,
    type: EVENT_TYPES[e.type]?.label || e.type,
    title: e.title,
    asset: e.asset || 'N/A',
    site: e.site || 'N/A',
    priority: e.priority,
    status: e.status || 'N/A',
    overdue: e.isOverdue ? 'Yes' : 'No',
    description: e.description || 'N/A',
  }))
}
