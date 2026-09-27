/**
 * driverManagementAnalytics - pure engine behind Driver Intelligence
 * (/driver-management). Moved out of the page so the ranking maths is testable
 * and cannot drift between the leaderboard, its KPIs and its exports.
 *
 * Honesty rules (same as kpiEngine.computeFailureRate):
 *  - `risk_level` is sparsely populated, so a failure rate is computed over the
 *    RATED records only and is null (N/A) when a driver has none rated. A flat
 *    0% for "nothing rated" would read as a perfect driver.
 *  - Tyre cost is the sum of PRICED records only; `pricedCount` travels with it
 *    and the total is null when nothing is priced.
 *  - The composite risk score only uses the components that are measurable for
 *    the population; a driver with neither CPK nor a rated failure is null
 *    ("Not rated"), never a fabricated rank.
 * No I/O. `now` is injectable for the date presets.
 */

export const DATE_PRESETS = [
  { label: '3mo', days: 90 },
  { label: '6mo', days: 180 },
  { label: '1yr', days: 365 },
  { label: 'All', days: null },
]

/** Resolve a preset to ISO date bounds relative to `now`. */
export function applyDatePreset(days, now = new Date()) {
  if (!days) return { from: '', to: '' }
  const to = new Date(now)
  const from = new Date(now)
  from.setDate(from.getDate() - days)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

const finite = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Cost per km for one tyre; null when the distance or cost is unmeasurable. */
export function calcCpk(cost, kmFit, kmRem) {
  const c = finite(cost)
  const a = finite(kmFit)
  const b = finite(kmRem)
  if (c == null || a == null || b == null) return null
  const dist = b - a
  if (dist <= 0) return null
  return c / dist
}

export function isRated(r) {
  return String(r?.risk_level ?? '').trim() !== ''
}

export function isHighRisk(r) {
  const rl = String(r?.risk_level ?? '').trim().toLowerCase()
  return rl === 'high' || rl === 'critical'
}

/** Performance band for a 0..100 risk score (lower is better); null = Not rated. */
export function performanceBand(score) {
  if (score == null || !Number.isFinite(score)) return { key: 'unrated', label: 'Not rated' }
  if (score <= 20) return { key: 'excellent', label: 'Excellent' }
  if (score <= 40) return { key: 'good', label: 'Good' }
  if (score <= 60) return { key: 'average', label: 'Average' }
  if (score <= 80) return { key: 'poor', label: 'Poor' }
  return { key: 'critical', label: 'Critical' }
}

/** Filter raw tyre records by site / country / issue-date window. */
export function filterDriverRecords(records = [], { site = 'all', country = 'all', from = '', to = '' } = {}) {
  return (Array.isArray(records) ? records : []).filter((r) => {
    if (site && site !== 'all' && r?.site !== site) return false
    if (country && country !== 'all' && r?.country !== country) return false
    const d = r?.issue_date ? String(r.issue_date).slice(0, 10) : ''
    if (from && d && d < from) return false
    if (to && d && d > to) return false
    return true
  })
}

const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null)
// Percentile rank 0..100 among a sorted list (0 = best).
const pctRank = (i, n) => (n <= 1 ? 0 : (i / (n - 1)) * 100)

/**
 * Aggregate records into a ranked driver list.
 * @returns {Array<object>} drivers sorted by risk score (best first, unrated last)
 */
export function aggregateDrivers(records = []) {
  const map = new Map()
  for (const r of Array.isArray(records) ? records : []) {
    const name = String(r?.driver_name ?? '').trim() || 'Unassigned'
    let d = map.get(name)
    if (!d) {
      d = { name, total: 0, rated: 0, high: 0, cost: 0, priced: 0, cpks: [], lives: [] }
      map.set(name, d)
    }
    d.total += 1
    if (isRated(r)) {
      d.rated += 1
      if (isHighRisk(r)) d.high += 1
    }
    const price = finite(r?.cost_per_tyre)
    if (price != null) {
      const qty = finite(r?.qty)
      d.cost += price * (qty && qty > 0 ? qty : 1)
      d.priced += 1
    }
    const cpk = calcCpk(r?.cost_per_tyre, r?.km_at_fitment, r?.km_at_removal)
    if (cpk != null && cpk > 0) d.cpks.push(cpk)
    const a = finite(r?.km_at_fitment)
    const b = finite(r?.km_at_removal)
    if (a != null && b != null && b - a > 0) d.lives.push(b - a)
  }

  const drivers = [...map.values()].map((d) => ({
    name: d.name,
    totalTyres: d.total,
    ratedTyres: d.rated,
    highRiskCount: d.high,
    pricedTyres: d.priced,
    totalCost: d.priced > 0 ? d.cost : null,
    avgCpk: mean(d.cpks),
    avgTyreLife: mean(d.lives),
    failureRate: d.rated > 0 ? (d.high / d.rated) * 100 : null,
  }))

  const byCpk = drivers.filter((d) => d.avgCpk != null).sort((a, b) => a.avgCpk - b.avgCpk)
  const cpkRank = new Map(byCpk.map((d, i) => [d.name, pctRank(i, byCpk.length)]))
  const byFail = drivers.filter((d) => d.failureRate != null).sort((a, b) => a.failureRate - b.failureRate)
  const failRank = new Map(byFail.map((d, i) => [d.name, pctRank(i, byFail.length)]))

  const scored = drivers.map((d) => {
    const c = cpkRank.get(d.name)
    const f = failRank.get(d.name)
    let riskScore = null
    if (c != null && f != null) riskScore = Math.round(c * 0.4 + f * 0.6)
    else if (c != null) riskScore = Math.round(c)
    else if (f != null) riskScore = Math.round(f)
    return { ...d, riskScore: riskScore == null ? null : Math.min(100, riskScore) }
  })

  scored.sort((a, b) => {
    if (a.riskScore == null && b.riskScore == null) return a.name.localeCompare(b.name)
    if (a.riskScore == null) return 1
    if (b.riskScore == null) return -1
    return a.riskScore - b.riskScore || a.name.localeCompare(b.name)
  })
  return scored.map((d, i) => ({ ...d, rank: d.riskScore == null ? null : i + 1 }))
}

/** Search + URL-driven default ordering (nulls always last). */
export function orderDrivers(drivers = [], { search = '', sort = 'riskScore', dir = 'asc' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  const list = q ? drivers.filter((d) => d.name.toLowerCase().includes(q)) : [...drivers]
  const sign = dir === 'desc' ? -1 : 1
  return list.sort((a, b) => {
    const va = a[sort]
    const vb = b[sort]
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    if (typeof va === 'string') return sign * va.localeCompare(String(vb))
    return sign * (va - vb)
  })
}

/** Headline figures for the KPI strip. */
export function driverKpis(drivers = [], recordCount = 0) {
  const withCpk = drivers.filter((d) => d.avgCpk != null)
  const rated = drivers.filter((d) => d.riskScore != null)
  const priced = drivers.filter((d) => d.totalCost != null)
  const ratedTyres = drivers.reduce((s, d) => s + d.ratedTyres, 0)
  const highTyres = drivers.reduce((s, d) => s + d.highRiskCount, 0)
  return {
    totalDrivers: drivers.length,
    recordCount,
    fleetAvgCpk: mean(withCpk.map((d) => d.avgCpk)),
    cpkCoverage: drivers.length ? withCpk.length : 0,
    highestCost: withCpk.length ? withCpk.reduce((p, c) => (c.avgCpk > p.avgCpk ? c : p)) : null,
    bestPerformer: withCpk.length ? withCpk.reduce((p, c) => (c.avgCpk < p.avgCpk ? c : p)) : null,
    fleetFailureRate: ratedTyres > 0 ? (highTyres / ratedTyres) * 100 : null,
    ratedTyres,
    totalCost: priced.length ? priced.reduce((s, d) => s + d.totalCost, 0) : null,
    highRiskDrivers: rated.filter((d) => d.riskScore >= 60).length,
    excellentDrivers: rated.filter((d) => d.riskScore <= 20).length,
    unratedDrivers: drivers.length - rated.length,
  }
}
