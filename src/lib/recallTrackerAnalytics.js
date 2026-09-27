/**
 * Recall Tracker analytics - pure helpers (no I/O, deterministic).
 *
 * The registry page (/recalls) used to run every one of these calculations
 * inline, and matched each recall against the whole tyre register once per
 * table row, once per KPI and once per chart bar. This module does the work
 * once and hands the page plain rows.
 *
 * Matching delegates to `matchRecallTyres` in recallDetailAnalytics.js so the
 * registry and the /recalls/:id detail page can never disagree about which
 * tyres a recall covers (brand is required, sizes and serial prefix narrow).
 *
 * HONESTY NOTES
 * - A batch is judged only on tyres that carry a risk rating. A tyre with no
 *   rating is not a "good" tyre, it is an unmeasured one, so an unrated batch
 *   reports `rated: 0` rather than a 0% failure rate.
 * - Averages over an empty set are null (N/A), never 0.
 * - Time-dependent functions take an injectable `now`.
 */
import { matchRecallTyres, isRemoved } from './recallDetailAnalytics'

const MS_PER_DAY = 86400000

export const RECALL_SEVERITIES = ['Critical', 'High', 'Medium', 'Low']
export const RECALL_STATUSES = ['Active', 'Monitoring', 'Closed']
export const RECALL_SOURCES = ['Manufacturer', 'Internal', 'Government', 'Insurance']

/** Ratings that count as a failure signal in the batch detector. */
export const FAILED_RISK_LEVELS = ['Critical', 'High']

function toMs(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v)
  const t = new Date(s.length === 10 ? `${s}T00:00:00Z` : s).getTime()
  return Number.isFinite(t) ? t : null
}

/** Whole days from a to b, or null when either end is missing/invalid. */
export function daysBetween(a, b) {
  const x = toMs(a)
  const y = toMs(b)
  if (x == null || y == null) return null
  return Math.round((y - x) / MS_PER_DAY)
}

/** Case-insensitive free-text match over the fields the search box names. */
export function recallMatchesSearch(r, query) {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return true
  if (!r) return false
  return Boolean(
    r.recall_number?.toLowerCase().includes(q)
    || r.brand?.toLowerCase().includes(q)
    || r.description?.toLowerCase().includes(q)
    || (Array.isArray(r.affected_sizes) && r.affected_sizes.some((sz) => String(sz).toLowerCase().includes(q))),
  )
}

/** Newest issue date first; a recall with no issue date sorts last. */
export function sortRecallsNewestFirst(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const x = toMs(a?.issue_date)
    const y = toMs(b?.issue_date)
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    return y - x
  })
}

/**
 * Match every recall against the tyre register ONCE.
 * Returns a Map keyed by recall id -> matched tyre rows.
 */
export function buildAffectedIndex(recalls, tyres) {
  const index = new Map()
  for (const r of Array.isArray(recalls) ? recalls : []) {
    if (!r) continue
    index.set(r.id, matchRecallTyres(r, tyres))
  }
  return index
}

/** Distinct tyre ids matched by a set of recalls. */
export function distinctAffected(recalls, index) {
  const ids = new Set()
  for (const r of Array.isArray(recalls) ? recalls : []) {
    for (const t of index?.get(r?.id) || []) ids.add(t.id)
  }
  return ids.size
}

/** One row per recall for the registry table and its exports. */
export function registryRows(recalls, index, now = Date.now()) {
  return (Array.isArray(recalls) ? recalls : []).map((r) => {
    const matched = index?.get(r.id) || []
    const fitted = matched.filter((t) => !isRemoved(t)).length
    const end = r.status === 'Closed' && r.closed_at ? r.closed_at : now
    return {
      ...r,
      sizes_label: (r.affected_sizes ?? []).join(', '),
      affected: matched.length,
      affected_fitted: fitted,
      days_open: daysBetween(r.issue_date, end),
    }
  })
}

/**
 * Batch failure detector. Groups tyres by brand + first `prefixLen` serial
 * characters and flags a batch when the failure rate over RATED tyres exceeds
 * `threshold` with at least `minBatch` rated tyres.
 *
 * Returns { batches, rated, total } so the page can say "cannot assess" when
 * nothing carries a rating, instead of "no suspicious batches".
 */
export function detectBatchFailures(tyres, { minBatch = 5, threshold = 0.3, prefixLen = 4 } = {}) {
  const groups = new Map()
  let rated = 0
  let total = 0
  for (const t of Array.isArray(tyres) ? tyres : []) {
    const serial = String(t?.serial_number ?? t?.serial_no ?? '').trim()
    const brand = String(t?.brand ?? '').trim()
    if (!serial || !brand) continue
    total += 1
    const isRated = t.risk_level != null && String(t.risk_level).trim() !== ''
    if (isRated) rated += 1
    const prefix = serial.slice(0, prefixLen).toUpperCase()
    const key = `${brand.toLowerCase()}__${prefix}`
    if (!groups.has(key)) groups.set(key, { brand, prefix, tyres: [], rated: 0, failed: 0 })
    const g = groups.get(key)
    g.tyres.push(t)
    if (isRated) {
      g.rated += 1
      if (FAILED_RISK_LEVELS.includes(t.risk_level)) g.failed += 1
    }
  }
  const batches = []
  for (const g of groups.values()) {
    if (g.rated < minBatch) continue
    const rate = g.failed / g.rated
    if (rate <= threshold) continue
    batches.push({
      brand: g.brand,
      prefix: g.prefix,
      total: g.tyres.length,
      rated: g.rated,
      failed: g.failed,
      rate: Math.round(rate * 100),
      severity: rate >= 0.6 ? 'High risk' : 'Potential issue',
      positions: [...new Set(g.tyres.map((t) => t.position).filter(Boolean))],
      sites: [...new Set(g.tyres.map((t) => t.site).filter(Boolean))],
      fitted: g.tyres.filter((t) => !isRemoved(t)).length,
    })
  }
  batches.sort((a, b) => b.rate - a.rate || b.failed - a.failed)
  return { batches, rated, total }
}

/**
 * Recall history per brand. The reliability score is the page's disclosed
 * heuristic: 100 - (active x 10 + critical x 5), floored at 0.
 */
export function brandRecallHistory(recalls) {
  const map = new Map()
  for (const r of Array.isArray(recalls) ? recalls : []) {
    const b = String(r?.brand ?? '').trim() || 'Unknown'
    if (!map.has(b)) map.set(b, { brand: b, total: 0, active: 0, critical: 0, closedDays: [] })
    const e = map.get(b)
    e.total += 1
    if (r.status === 'Active') e.active += 1
    if (r.severity === 'Critical') e.critical += 1
    if (r.status === 'Closed' && r.closed_at && r.issue_date) {
      const d = daysBetween(r.issue_date, r.closed_at)
      if (d != null) e.closedDays.push(d)
    }
  }
  return [...map.values()].map((b) => ({
    brand: b.brand,
    total: b.total,
    active: b.active,
    critical: b.critical,
    closedCount: b.closedDays.length,
    avgDaysToClose: b.closedDays.length
      ? Math.round(b.closedDays.reduce((s, d) => s + d, 0) / b.closedDays.length)
      : null,
    score: Math.max(0, 100 - b.active * 10 - b.critical * 5),
  })).sort((a, b) => a.score - b.score || b.total - a.total)
}

/** Counts behind the analytics charts. Months are sorted oldest first. */
export function recallBreakdowns(recalls) {
  const severity = Object.fromEntries(RECALL_SEVERITIES.map((s) => [s, 0]))
  const status = Object.fromEntries(RECALL_STATUSES.map((s) => [s, 0]))
  const source = {}
  const month = {}
  for (const r of Array.isArray(recalls) ? recalls : []) {
    if (r?.severity in severity) severity[r.severity] += 1
    if (r?.status in status) status[r.status] += 1
    const src = r?.source || 'Unrecorded'
    source[src] = (source[src] || 0) + 1
    const m = typeof r?.issue_date === 'string' ? r.issue_date.slice(0, 7) : null
    if (m && /^\d{4}-\d{2}$/.test(m)) month[m] = (month[m] || 0) + 1
  }
  const months = Object.keys(month).sort()
  return {
    severity,
    status,
    source,
    months,
    monthCounts: months.map((m) => month[m]),
  }
}

/** Average of whole days between issue and close over closed recalls, or null. */
export function avgDaysToClose(recalls) {
  const days = (Array.isArray(recalls) ? recalls : [])
    .filter((r) => r?.status === 'Closed' && r.closed_at && r.issue_date)
    .map((r) => daysBetween(r.issue_date, r.closed_at))
    .filter((d) => d != null)
  return days.length ? Math.round(days.reduce((s, d) => s + d, 0) / days.length) : null
}

/** Share of active recalls that matched at least one fleet tyre, or null. */
export function responseRate(activeRecalls, index) {
  const list = Array.isArray(activeRecalls) ? activeRecalls : []
  if (!list.length) return null
  const hit = list.filter((r) => (index?.get(r.id) || []).length > 0).length
  return Math.round((hit / list.length) * 100)
}
