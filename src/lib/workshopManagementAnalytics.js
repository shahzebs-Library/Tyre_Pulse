/**
 * workshopManagementAnalytics - pure engine behind the Workshop Management page.
 *
 * Every figure the page shows (KPI strip, site and technician scorecards, the
 * 12-month series, the cost split) is computed here from the loaded job rows so
 * the page renders and the PDF/Excel exports write the SAME numbers.
 *
 * No I/O. `now` is injectable for deterministic tests. Status always goes
 * through workOrderStatus.js (the single status vocabulary).
 *
 * Honest nulls: a rate with no denominator is null (the page prints N/A), never
 * a fabricated 0 or 100.
 */
import { WO_STATUSES, normalizeWoStatus, isClosedWoStatus } from './workOrderStatus'

/** Canonical non-terminal statuses. Blank / unknown values are NOT open. */
export const OPEN_STATUSES = Object.freeze(WO_STATUSES.filter((s) => !isClosedWoStatus(s)))
const OPEN_SET = new Set(OPEN_STATUSES)

export const WORK_TYPES = Object.freeze(['Tyre Change', 'Inspection', 'Repair', 'Rotation', 'Balancing', 'Alignment', 'Retread', 'Other'])

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)
const isCompleted = (o) => normalizeWoStatus(o?.status) === 'Completed'

/** True when a job is in a canonical non-terminal (still open) state. */
export function isOpenJob(o) {
  return OPEN_SET.has(normalizeWoStatus(o?.status))
}

/** YYYY-MM for a date-ish value, else null. */
export function monthKey(d) {
  if (!d) return null
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return null
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}

/** 'Jan 2026' for a YYYY-MM key. */
export function monthLabel(key) {
  if (!key) return ''
  const [y, m] = String(key).split('-')
  const name = MONTHS[parseInt(m, 10) - 1]
  return name ? `${name} ${y}` : String(key)
}

/** The last `n` month keys ending with the month of `now`, oldest first. */
export function lastMonths(n = 12, now = new Date()) {
  const keys = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

/** Hours from created to completed; null when either end is missing or reversed. */
export function turnaroundHours(row) {
  if (!row?.created_at || !row?.completed_at) return null
  const diff = new Date(row.completed_at) - new Date(row.created_at)
  if (!Number.isFinite(diff) || diff < 0) return null
  return diff / 3_600_000
}

/** True/false when a completed job has a target date; null when unmeasurable. */
export function isOnTime(row) {
  if (!row?.completed_at || !row?.scheduled_date) return null
  return new Date(row.completed_at) <= new Date(row.scheduled_date)
}

/** Client-side job filter (status on the canonical value, technician, free text). */
export function filterJobs(orders, { status = '', techSearch = '', search = '' } = {}) {
  const tech = String(techSearch || '').trim().toLowerCase()
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(orders) ? orders : []).filter((o) => {
    if (status && normalizeWoStatus(o.status) !== status) return false
    if (tech && !String(o.assigned_to || '').toLowerCase().includes(tech)) return false
    if (q) {
      return [o.work_order_no, o.asset_no, o.site, o.assigned_to, o.work_type, o.description]
        .some((v) => String(v || '').toLowerCase().includes(q))
    }
    return true
  })
}

/** Headline KPIs over the loaded (filtered) rows. */
export function workshopKpis(orders, now = new Date()) {
  const src = Array.isArray(orders) ? orders : []
  const thisMonth = monthKey(now)
  const completed = src.filter(isCompleted)
  const withTarget = completed.filter((o) => o.scheduled_date && o.completed_at)
  const onTime = withTarget.filter((o) => isOnTime(o) === true).length
  return {
    total: src.length,
    totalThisMonth: src.filter((o) => monthKey(o.created_at) === thisMonth).length,
    completedCount: completed.length,
    avgTA: mean(completed.map(turnaroundHours).filter((h) => h != null)),
    completionRate: src.length ? (completed.length / src.length) * 100 : null,
    totalCost: src.reduce((s, o) => s + num(o.total_cost), 0),
    openJobs: src.filter(isOpenJob).length,
    onTimePct: withTarget.length ? (onTime / withTarget.length) * 100 : null,
  }
}

/** Per-site scorecard (score 0-100: completion 40, turnaround 30, on-time 30). */
export function sitePerformance(orders, now = new Date()) {
  const src = Array.isArray(orders) ? orders : []
  const thisMonth = monthKey(now)
  const map = new Map()
  for (const o of src) {
    const s = o.site || 'Unknown'
    if (!map.has(s)) map.set(s, { site: s, total: 0, thisMonth: 0, completed: 0, openJobs: 0, taTimes: [], onTime: [], totalCost: 0, labourCost: 0, partsCost: 0 })
    const m = map.get(s)
    m.total += 1
    if (monthKey(o.created_at) === thisMonth) m.thisMonth += 1
    if (isCompleted(o)) {
      m.completed += 1
      const ta = turnaroundHours(o)
      if (ta != null) m.taTimes.push(ta)
      const ot = isOnTime(o)
      if (ot != null) m.onTime.push(ot)
    }
    if (isOpenJob(o)) m.openJobs += 1
    m.totalCost += num(o.total_cost)
    m.labourCost += num(o.labour_cost)
    m.partsCost += num(o.parts_cost)
  }
  const sites = [...map.values()]
  const maxTA = Math.max(1, ...sites.map((x) => mean(x.taTimes) || 0))
  return sites.map((m) => {
    const avgTA = mean(m.taTimes)
    const compRate = m.total ? (m.completed / m.total) * 100 : null
    const otRate = m.onTime.length ? (m.onTime.filter(Boolean).length / m.onTime.length) * 100 : null
    const taNorm = avgTA != null ? Math.min(avgTA / maxTA, 1) : 0.5
    const score = Math.round((compRate ?? 0) * 0.4 + (1 - taNorm) * 30 + (otRate ?? 0) * 0.3)
    const { taTimes, onTime, ...rest } = m
    return {
      ...rest,
      avgTA,
      compRate,
      otRate,
      score,
      avgPerJob: m.total ? m.totalCost / m.total : null,
      labourPct: m.totalCost > 0 ? (m.labourCost / m.totalCost) * 100 : null,
    }
  }).sort((a, b) => b.score - a.score || a.site.localeCompare(b.site))
}

/** Rating band for a technician completion rate. */
export function ratingFor(rate) {
  if (rate == null) return { label: 'Not rated', tone: 'quiet' }
  if (rate >= 95) return { label: 'Excellent', tone: 'good' }
  if (rate >= 85) return { label: 'Good', tone: 'info' }
  if (rate >= 70) return { label: 'Average', tone: 'warning' }
  return { label: 'Needs Improvement', tone: 'danger' }
}

/** Per-technician scorecard. */
export function technicianPerformance(orders) {
  const map = new Map()
  for (const o of Array.isArray(orders) ? orders : []) {
    const t = o.assigned_to || 'Unassigned'
    if (!map.has(t)) map.set(t, { tech: t, total: 0, completed: 0, taTimes: [], labourCost: 0 })
    const m = map.get(t)
    m.total += 1
    if (isCompleted(o)) {
      m.completed += 1
      const ta = turnaroundHours(o)
      if (ta != null) m.taTimes.push(ta)
    }
    m.labourCost += num(o.labour_cost)
  }
  return [...map.values()].map(({ taTimes, ...m }) => {
    const compRate = m.total ? (m.completed / m.total) * 100 : null
    return { ...m, compRate, avgTA: mean(taTimes), rating: ratingFor(compRate) }
  }).sort((a, b) => (b.compRate ?? -1) - (a.compRate ?? -1) || a.tech.localeCompare(b.tech))
}

/** Job count per work type (unknown types fold into Other); zero types dropped. */
export function workTypeCounts(orders) {
  const counts = Object.fromEntries(WORK_TYPES.map((t) => [t, 0]))
  for (const o of Array.isArray(orders) ? orders : []) {
    const t = WORK_TYPES.includes(o.work_type) ? o.work_type : 'Other'
    counts[t] += 1
  }
  return WORK_TYPES.filter((t) => counts[t] > 0).map((t) => ({ type: t, count: counts[t] }))
}

/**
 * The 12-month series the charts read: completed jobs per top site, average
 * turnaround (null for a month with no measurable job), labour and parts cost.
 */
export function monthlySeries(orders, { now = new Date(), months = 12, topSites = 5 } = {}) {
  const src = Array.isArray(orders) ? orders : []
  const keys = lastMonths(months, now)
  const siteCounts = new Map()
  for (const o of src) if (o.site) siteCounts.set(o.site, (siteCounts.get(o.site) || 0) + 1)
  const sites = [...siteCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, topSites).map(([s]) => s)

  const completedBySite = Object.fromEntries(sites.map((s) => [s, keys.map(() => 0)]))
  const taBuckets = keys.map(() => [])
  const labour = keys.map(() => 0)
  const parts = keys.map(() => 0)
  const idx = new Map(keys.map((k, i) => [k, i]))
  for (const o of src) {
    const ci = idx.get(monthKey(o.created_at))
    if (ci != null) { labour[ci] += num(o.labour_cost); parts[ci] += num(o.parts_cost) }
    if (isCompleted(o)) {
      const di = idx.get(monthKey(o.completed_at))
      if (di != null) {
        if (completedBySite[o.site]) completedBySite[o.site][di] += 1
        const ta = turnaroundHours(o)
        if (ta != null) taBuckets[di].push(ta)
      }
    }
  }
  return {
    keys,
    labels: keys.map(monthLabel),
    sites,
    completedBySite,
    avgTurnaround: taBuckets.map(mean),
    labour,
    parts,
    hasCost: labour.some((v) => v > 0) || parts.some((v) => v > 0),
    hasTurnaround: taBuckets.some((b) => b.length > 0),
  }
}

/** Labour / parts / total split with shares (null share when total is 0). */
export function costSplit(orders) {
  let labour = 0; let parts = 0; let total = 0
  for (const o of Array.isArray(orders) ? orders : []) {
    labour += num(o.labour_cost)
    parts += num(o.parts_cost)
    total += num(o.total_cost)
  }
  return {
    labour,
    parts,
    total,
    labourPct: total > 0 ? (labour / total) * 100 : null,
    partsPct: total > 0 ? (parts / total) * 100 : null,
  }
}
