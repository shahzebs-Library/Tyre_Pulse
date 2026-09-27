/**
 * workshopLiveAnalytics - presentation-side pure helpers for the Workshop Live
 * Control page. The productivity maths stay in `workshopLive.js`
 * (buildBoard / computeKpis / deriveAlerts / delayBreakdown); this module owns
 * what the page used to compute inline: formatting, kanban placement, site and
 * text filtering, and export shaping. No I/O; time always comes in as `now`.
 */
import { normalizeWoStatus, woKanbanColumn } from './workOrderStatus'

export const toTs = (v) => {
  if (v == null || v === '') return NaN
  if (typeof v === 'number') return v
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? NaN : t
}

/** minutes -> "1h 5m" / "45m" / "0m". */
export function fmtMins(m) {
  const n = Math.max(0, Math.round(Number(m) || 0))
  if (!n) return '0m'
  const h = Math.floor(n / 60)
  const mm = n % 60
  return h ? (mm ? `${h}h ${mm}m` : `${h}h`) : `${mm}m`
}

/** epoch ms -> "just now / 5m ago / 2h ago / 3d ago" relative to `now`. */
export function relTime(tsMs, now) {
  if (!tsMs || !Number.isFinite(Number(now))) return 'N/A'
  const s = Math.max(0, Math.round((now - tsMs) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : `${v}%`)

/** Kanban column a job belongs to (Overdue derived from target_completion). */
export function jobColumnKey(job, now) {
  const canonical = normalizeWoStatus(job?.status)
  const tgt = toTs(job?.target_completion)
  const overdue = canonical !== 'Completed' && canonical !== 'Cancelled' && Number.isFinite(tgt) && tgt < now
  return woKanbanColumn(canonical, { overdue })
}

/** Distinct sites across the board + jobs, 'All' first. */
export function siteOptions(board = [], jobs = []) {
  const s = new Set()
  for (const b of board) if (b?.site) s.add(b.site)
  for (const j of jobs) if (j?.site) s.add(j.site)
  return ['All', ...[...s].sort()]
}

const norm = (v) => String(v ?? '').toLowerCase()

/** Does a technician row match a free-text query (name, id, trade, site, current job)? */
export function techMatches(tech, query) {
  const q = norm(query).trim()
  if (!q) return true
  return [tech?.name, tech?.employeeId, tech?.trade, tech?.site, tech?.status, tech?.job?.no, tech?.job?.asset_no, tech?.job?.plate]
    .some((v) => norm(v).includes(q))
}

/** Does a job card match a free-text query (number, asset, plate, description, site)? */
export function jobMatches(job, query) {
  const q = norm(query).trim()
  if (!q) return true
  return [job?.work_order_no, job?.asset_no, job?.plate_number, job?.description, job?.site, job?.status, job?.priority]
    .some((v) => norm(v).includes(q))
}

/** Site + KPI predicate + text filter over the board. */
export function filterBoard(board = [], { site = 'All', pred = null, query = '' } = {}) {
  return board.filter((b) => (site === 'All' || b.site === site) && (!pred || pred(b)) && techMatches(b, query))
}

/** Site + KPI predicate/column + text filter over job cards. */
export function filterJobs(jobs = [], { site = 'All', pred = null, column = null, query = '', now } = {}) {
  return jobs.filter((j) => {
    if (site !== 'All' && j.site !== site) return false
    if (pred && !pred(j)) return false
    if (column && jobColumnKey(j, now) !== column) return false
    return jobMatches(j, query)
  })
}

/** Bucket jobs into kanban columns; unknown columns fall into `fallback`. */
export function bucketJobs(jobs = [], columnKeys = [], now, fallback = 'Awaiting Assignment') {
  const buckets = Object.fromEntries(columnKeys.map((k) => [k, []]))
  for (const j of jobs) {
    const key = jobColumnKey(j, now)
    ;(buckets[key] || buckets[fallback] || (buckets[fallback] = [])).push(j)
  }
  return buckets
}

/** Flat export rows for the technician board. Unmeasured utilisation stays N/A. */
export function boardExportRows(board = [], now) {
  return board.map((b) => ({
    name: b.name || 'Technician',
    employee_id: b.employeeId || 'N/A',
    trade: b.trade || 'N/A',
    site: b.site || 'N/A',
    status: b.status || 'N/A',
    current_job: b.job?.no || 'N/A',
    asset: b.job?.asset_no || 'N/A',
    productive: fmtMins(b.productiveMin),
    blocked: fmtMins(b.blockedMin),
    unassigned: fmtMins(b.unassignedMin),
    utilization: b.utilization == null ? 'N/A' : `${Math.round(b.utilization * 100)}%`,
    jobs_completed: b.jobsCompleted ?? 0,
    last_activity: relTime(b.lastActivityAt, now),
  }))
}

export const BOARD_EXPORT_KEYS = ['name', 'employee_id', 'trade', 'site', 'status', 'current_job', 'asset', 'productive', 'blocked', 'unassigned', 'utilization', 'jobs_completed', 'last_activity']
export const BOARD_EXPORT_HEADERS = ['Technician', 'Employee ID', 'Trade', 'Site', 'Status', 'Current Job', 'Asset', 'Productive', 'Blocked', 'Unassigned', 'Utilisation', 'Jobs Completed', 'Last Activity']

/** Totals row for the delay table: hours and cost, cost null when nothing costed. */
export function delayTotals(delays = []) {
  let hours = 0
  let cost = 0
  let costed = 0
  let jobs = 0
  for (const d of delays) {
    hours += Number(d.hoursLost) || 0
    jobs += Number(d.affectedJobs) || 0
    if (d.costImpact != null && Number.isFinite(Number(d.costImpact))) { cost += Number(d.costImpact); costed += 1 }
  }
  return {
    hours: Math.round(hours * 10) / 10,
    cost: costed ? Math.round(cost) : null,
    affectedJobs: jobs,
    causes: delays.length,
  }
}
