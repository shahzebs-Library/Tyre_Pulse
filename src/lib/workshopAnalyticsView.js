/**
 * workshopAnalyticsView - the presentation engine for the Workshop Analytics
 * page (`/workshop-analytics`).
 *
 * The productivity maths live in `workshopAnalytics.js` (which itself reuses the
 * live `workshopLive` engine) and are NOT re-derived here. This module only
 * shapes that result for the page: date windows, formatters, the KPI strip, the
 * leaderboard / delay register rows, their filters and the export rows.
 *
 * (Named `...View` because `workshopAnalytics.js`, the natural name, is already
 * the calculation engine this module sits on top of.)
 *
 * Pure: no I/O, `now` is injectable, and every date is built from LOCAL getters
 * (a `toISOString()` date is UTC and lands on the wrong day in the evening west
 * of UTC and in the early morning here).
 */

export const DEFAULT_WINDOW_DAYS = 14

const pad = (n) => String(n).padStart(2, '0')

/** YYYY-MM-DD for a Date, from its LOCAL calendar day. */
export function isoDay(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function toDate(now) {
  const d = now instanceof Date ? new Date(now.getTime()) : new Date(now ?? Date.now())
  return Number.isFinite(d.getTime()) ? d : new Date()
}

/** The day `n` days before `now`, as YYYY-MM-DD (local). */
export function daysAgo(n, now) {
  const d = toDate(now)
  d.setDate(d.getDate() - n)
  return isoDay(d)
}

/** Default filter window: the last 14 days to today, all sites. */
export function defaultFilters(now) {
  return { from: daysAgo(DEFAULT_WINDOW_DAYS, now), to: isoDay(toDate(now)), site: 'All' }
}

/** Quick-range presets. `This month` starts on the local first of the month. */
export function quickRanges(now) {
  const d = toDate(now)
  const today = isoDay(d)
  const first = isoDay(new Date(d.getFullYear(), d.getMonth(), 1))
  return [
    { id: '7', label: 'Last 7 days', from: daysAgo(7, d), to: today },
    { id: '14', label: 'Last 14 days', from: daysAgo(14, d), to: today },
    { id: '30', label: 'Last 30 days', from: daysAgo(30, d), to: today },
    { id: 'month', label: 'This month', from: first, to: today },
  ]
}

/** Which quick range (if any) the current filter window equals. */
export function activeQuickRange(filters, now) {
  const hit = quickRanges(now).find((q) => q.from === filters?.from && q.to === filters?.to)
  return hit ? hit.id : null
}

/** Count of filters differing from the default window. */
export function activeFilterCount(filters, now) {
  const def = defaultFilters(now)
  let n = 0
  if ((filters?.from || '') !== def.from || (filters?.to || '') !== def.to) n += 1
  if (filters?.site && filters.site !== 'All') n += 1
  return n
}

const finite = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null))

export function fmtNum(v) { const n = finite(v); return n == null ? 'N/A' : n.toLocaleString() }
export function fmtHours(v) { const n = finite(v); return n == null ? 'N/A' : `${n.toLocaleString()} h` }
export function fmtPct(v) { const n = finite(v); return n == null ? 'N/A' : `${Math.round(n)}%` }
export function fmtMin(v) { const n = finite(v); return n == null ? 'N/A' : `${Math.round(n)} min` }

export const REASON_LABEL = {
  parts: 'Parts', tools: 'Tools', approval: 'Approval',
  vehicle: 'Vehicle', vendor: 'Vendor', support: 'Support',
}
export function labelReason(r) {
  return REASON_LABEL[r] || (r ? String(r).replace(/_/g, ' ') : 'Other')
}

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 }
export function priorityRank(p) { return PRIORITY_RANK[String(p || '').toLowerCase()] || 0 }
export function priorityLabel(p) {
  const s = String(p || '').toLowerCase()
  return s ? s[0].toUpperCase() + s.slice(1) : 'N/A'
}

/**
 * The KPI strip. Every value is formatted from the engine summary; a metric with
 * no source data renders N/A. `ftf` is the first-time-fix block.
 */
export function buildKpis(summary = {}, ftf = {}, currency = '') {
  const s = summary || {}
  const rate = s.firstTimeFixRate == null ? null : s.firstTimeFixRate * 100
  return [
    { id: 'util', label: 'Avg Utilization', value: fmtPct(s.avgUtilization), sub: 'Productive / on-duty' },
    { id: 'prod', label: 'Productive Hours', value: fmtHours(s.totalProductiveHours), sub: 'Total in range' },
    { id: 'blocked', label: 'Blocked Hours', value: fmtHours(s.totalBlockedHours), sub: 'Waiting on a blocker' },
    { id: 'unassigned', label: 'Unassigned Hours', value: fmtHours(s.totalUnassignedHours), sub: 'On-duty, no job' },
    { id: 'jobs', label: 'Jobs Completed', value: fmtNum(s.jobsCompleted), sub: 'Work orders closed' },
    {
      id: 'ftf', label: 'First Time Fix', value: fmtPct(rate),
      sub: ftf?.completed ? `${fmtNum(ftf.firstTime)} of ${fmtNum(ftf.completed)}` : 'No completed jobs',
    },
    { id: 'task', label: 'Avg Task Time', value: fmtMin(s.avgTaskDurationMin), sub: 'Completed job duration' },
    { id: 'delay', label: 'Delay Cost', value: fmtNum(s.totalDelayCost), sub: `${currency || 'Value'} lost to blockers` },
  ]
}

/** Leaderboard rows with honest nulls (utilization N/A when unmeasurable). */
export function leaderboardRows(board) {
  return (board || []).map((t) => ({
    id: String(t.userId ?? t.name ?? t.rank),
    rank: finite(t.rank),
    name: t.name || 'Unknown technician',
    productiveHours: finite(t.productiveHours),
    utilization: finite(t.utilization),
    jobsCompleted: finite(t.jobsCompleted),
    blockedHours: finite(t.blockedHours),
  }))
}

/** Delay accountability rows, labelled and ranked by priority. */
export function delayRows(delays) {
  return (delays || []).map((d) => ({
    id: String(d.reason ?? 'other'),
    reason: d.reason,
    cause: labelReason(d.reason),
    hoursLost: finite(d.hoursLost),
    costImpact: finite(d.costImpact),
    responsibleDept: d.responsibleDept || 'N/A',
    suggestedAction: d.suggestedAction || 'N/A',
    priority: String(d.priority || '').toLowerCase() || null,
    priorityLabel: priorityLabel(d.priority),
    priorityRank: priorityRank(d.priority),
  }))
}

/** Totals over the delay register (null when nothing measurable). */
export function delayTotals(rows) {
  let hours = null
  let cost = null
  for (const r of rows || []) {
    if (r.hoursLost != null) hours = (hours ?? 0) + r.hoursLost
    if (r.costImpact != null) cost = (cost ?? 0) + r.costImpact
  }
  return { hours, cost, highPriority: (rows || []).filter((r) => r.priority === 'high').length }
}

export const LEADERBOARD_EXPORT = [
  ['rank', 'Rank'], ['name', 'Technician'], ['productiveHours', 'Productive (h)'],
  ['utilization', 'Utilization %'], ['jobsCompleted', 'Jobs Completed'], ['blockedHours', 'Blocked (h)'],
]

/** Export rows: blanks become N/A so a missing figure is never read as 0. */
export function leaderboardExportRows(rows) {
  return (rows || []).map((r) => {
    const o = {}
    for (const [k] of LEADERBOARD_EXPORT) o[k] = r[k] == null ? 'N/A' : r[k]
    return o
  })
}
