/**
 * fleetIntelligenceAnalytics - pure, no-I/O engine behind /fleet-intelligence.
 *
 * Turns tyre_records (+ the vehicle_fleet master and inspections) into the
 * per-vehicle register, the fleet KPI strip, the availability timeline, the
 * site cost split, the cost trend with a least-squares projection, the
 * "needs attention" list and the CPK benchmarks.
 *
 * Every function takes an explicit `now` (Date) where time matters so the maths
 * is deterministic in tests. Honesty rules:
 *   - a figure with no measurable basis is null (rendered N/A), never 0,
 *   - availability counts only vehicles that appear in the window,
 *   - the savings estimate uses measured tyre km only, never an assumed mileage.
 */

export const HOURS_PER_CHANGE = 2
export const ATTENTION_WINDOW_DAYS = 30
export const DAYS_PER_MONTH = 30.44
export const BEST_CPK_MIN_CHANGES = 5
const DAY_MS = 86400000

const isHighRisk = (r) => r?.risk_level === 'High' || r?.risk_level === 'Critical'
const qtyOf = (r) => (Number(r?.qty) > 0 ? Number(r.qty) : 1)
const costOf = (r) => (Number(r?.cost_per_tyre) || 0) * qtyOf(r)
const dateOf = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}
const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null)

export function monthKey(date) {
  const d = typeof date === 'string' ? new Date(date) : date
  if (!d || Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Months between two ISO dates (min 1), or null when either is missing. */
export function monthsBetween(first, last) {
  const a = dateOf(first)
  const b = dateOf(last)
  if (!a || !b) return null
  return Math.max(1, (b - a) / (DAY_MS * DAYS_PER_MONTH))
}

/** Least-squares line through {x,y} points. */
export function linearRegression(points = []) {
  const n = points.length
  if (n < 2) return { slope: 0, intercept: n === 1 ? points[0].y : 0 }
  const sumX = points.reduce((s, p) => s + p.x, 0)
  const sumY = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x ** 2, 0)
  const denom = n * sumX2 - sumX ** 2
  if (denom === 0) return { slope: 0, intercept: sumY / n }
  const slope = (n * sumXY - sumX * sumY) / denom
  return { slope, intercept: (sumY - slope * sumX) / n }
}

/** Latest issue_date in the records (the window anchor), else `now`. */
export function dataAnchorDate(records = [], now = new Date()) {
  let max = null
  for (const r of records) {
    if (!r?.issue_date) continue
    const iso = String(r.issue_date).slice(0, 10)
    if (!max || iso > max) max = iso
  }
  const d = max ? new Date(max) : now
  return Number.isNaN(d.getTime()) ? now : d
}

/** A tyre life is measurable when removal km > fitment km > 0 and it has a price. */
function measuredLife(r) {
  const fit = Number(r?.km_at_fitment)
  const rem = Number(r?.km_at_removal)
  const cost = Number(r?.cost_per_tyre)
  if (!(Number.isFinite(fit) && fit > 0 && Number.isFinite(rem) && rem > fit && Number.isFinite(cost) && cost > 0)) return null
  return { km: rem - fit, cpk: cost / (rem - fit) }
}

/** asset_no -> master row. */
export function indexFleetMaster(fleetMaster = []) {
  const m = {}
  for (const f of fleetMaster || []) if (f?.asset_no) m[f.asset_no] = f
  return m
}

/**
 * One row per asset with tyre activity in the window.
 * @param {Array<object>} records  period-filtered tyre_records
 * @param {Record<string,object>} masterMap
 * @param {{now?:Date}} [opts]
 */
export function buildVehicleMetrics(records = [], masterMap = {}, { now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - ATTENTION_WINDOW_DAYS * DAY_MS)
  const byAsset = new Map()
  for (const r of records || []) {
    if (!r?.asset_no) continue
    if (!byAsset.has(r.asset_no)) byAsset.set(r.asset_no, [])
    byAsset.get(r.asset_no).push(r)
  }
  return [...byAsset.entries()].map(([asset_no, recs]) => {
    const master = masterMap[asset_no] || null
    const lives = recs.map(measuredLife).filter(Boolean)
    const dates = recs.map((r) => r.issue_date).filter(Boolean).map((d) => String(d).slice(0, 10)).sort()
    const first = dates[0] || null
    const last = dates[dates.length - 1] || null
    const totalCost = recs.reduce((s, r) => s + costOf(r), 0)
    const months = first && last && first !== last ? monthsBetween(first, last) : null
    const recentCritical = recs.some((r) => {
      if (!isHighRisk(r)) return false
      const d = dateOf(r.issue_date)
      return !!d && d >= cutoff && d <= now
    })
    return {
      asset_no,
      site: master?.site || recs.find((r) => r.site)?.site || null,
      vehicle_type: master?.vehicle_type || null,
      total_tyre_changes: recs.length,
      total_tyre_cost: totalCost,
      avg_cpk: mean(lives.map((l) => l.cpk)),
      avg_km_per_tyre: mean(lives.map((l) => l.km)),
      measured_km: lives.reduce((s, l) => s + l.km, 0),
      measured_lives: lives.length,
      high_risk_count: recs.filter(isHighRisk).length,
      downtime_hours: recs.length * HOURS_PER_CHANGE,
      last_change_date: last,
      first_change_date: first,
      monthly_cost: months ? totalCost / months : totalCost,
      availability_status: recentCritical ? 'Critical' : 'Available',
    }
  })
}

/** Fleet KPI strip. Ratios are null when there is nothing to divide by. */
export function fleetAggregates(metrics = [], records = []) {
  const size = metrics.length
  const available = metrics.filter((v) => v.availability_status === 'Available').length
  const totalCost = metrics.reduce((s, v) => s + (v.total_tyre_cost || 0), 0)
  const dates = (records || []).map((r) => r.issue_date).filter(Boolean).map((d) => String(d).slice(0, 10)).sort()
  const span = dates.length >= 2 ? monthsBetween(dates[0], dates[dates.length - 1]) : (dates.length ? 1 : null)
  const withCpk = metrics.filter((v) => v.avg_cpk != null && Number.isFinite(v.avg_cpk))
  const worst = [...withCpk].sort((a, b) => b.avg_cpk - a.avg_cpk)[0] || null
  const best = withCpk.filter((v) => v.total_tyre_changes >= BEST_CPK_MIN_CHANGES)
    .sort((a, b) => a.avg_cpk - b.avg_cpk)[0] || null
  return {
    fleet_size: size,
    available_count: available,
    critical_count: size - available,
    availability_pct: size ? (available / size) * 100 : null,
    total_downtime_hours: metrics.reduce((s, v) => s + v.downtime_hours, 0),
    total_fleet_cost: totalCost,
    months_span: span,
    monthly_fleet_cost: span ? totalCost / span : null,
    avg_cost_per_vehicle: size ? totalCost / size : null,
    worst_vehicle_cpk: worst,
    best_vehicle_cpk: best,
    fleetAvgCpk: mean(withCpk.map((v) => v.avg_cpk)),
    cpk_measured: withCpk.length,
  }
}

/** Last 12 months availability (share of active assets with no High/Critical tyre). */
export function availabilityTimeline(records = [], { now = new Date() } = {}) {
  const anchor = dataAnchorDate(records, now)
  const out = []
  for (let i = 11; i >= 0; i--) {
    const start = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1)
    const end = new Date(anchor.getFullYear(), anchor.getMonth() - i + 1, 0, 23, 59, 59)
    const monthRecs = records.filter((r) => {
      const d = dateOf(r.issue_date)
      return d && d >= start && d <= end
    })
    const assets = new Set(monthRecs.map((r) => r.asset_no).filter(Boolean))
    const crit = new Set(monthRecs.filter(isHighRisk).map((r) => r.asset_no).filter(Boolean))
    out.push({
      month: monthKey(start),
      pct: assets.size ? Math.max(0, Math.min(100, ((assets.size - crit.size) / assets.size) * 100)) : null,
      assets: assets.size,
    })
  }
  return out
}

/** Tyre cost by site, split by vehicle type from the master (top 12 sites). */
export function costBySite(records = [], masterMap = {}, limit = 12) {
  const siteMap = {}
  for (const r of records || []) {
    const site = r.site || 'Unknown'
    const vt = masterMap[r.asset_no]?.vehicle_type || 'Unknown'
    if (!siteMap[site]) siteMap[site] = {}
    siteMap[site][vt] = (siteMap[site][vt] || 0) + costOf(r)
  }
  const sites = Object.entries(siteMap)
    .map(([site, byType]) => ({ site, total: Object.values(byType).reduce((s, v) => s + v, 0), byType }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
  const types = [...new Set(sites.flatMap((s) => Object.keys(s.byType)))].filter((t) => t !== 'Unknown')
  if (sites.some((s) => 'Unknown' in s.byType)) types.push('Unknown')
  return { sites, vtypes: types }
}

/** 13-month tyre cost series plus a one-month least-squares projection. */
export function costTrend(records = [], { now = new Date() } = {}) {
  const anchor = dataAnchorDate(records, now)
  const start = new Date(anchor.getFullYear(), anchor.getMonth() - 12, 1)
  const keys = []
  for (let i = 12; i >= 0; i--) keys.push(monthKey(new Date(anchor.getFullYear(), anchor.getMonth() - i, 1)))
  const monthMap = {}
  for (const r of records || []) {
    const d = dateOf(r.issue_date)
    if (!d || d < start) continue
    const mk = monthKey(d)
    monthMap[mk] = (monthMap[mk] || 0) + costOf(r)
  }
  const points = keys.map((k) => ({ key: k, cost: monthMap[k] || 0 }))
  const { slope, intercept } = linearRegression(points.map((p, i) => ({ x: i, y: p.cost })))
  const hasData = points.some((p) => p.cost > 0)
  return {
    keys,
    actual: points.map((p) => p.cost),
    regression: points.map((_, i) => Math.max(0, intercept + slope * i)),
    forecastKey: monthKey(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1)),
    forecastCost: hasData ? Math.max(0, intercept + slope * points.length) : null,
    slope,
    direction: !hasData ? 'none' : slope > 50 ? 'worsening' : slope < -50 ? 'improving' : 'stable',
  }
}

/** Assets with a High/Critical tyre in the last 30 days, Critical first. */
export function attentionVehicles(records = [], { now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - ATTENTION_WINDOW_DAYS * DAY_MS)
  const byAsset = {}
  for (const r of records || []) {
    if (!r?.asset_no || !isHighRisk(r)) continue
    const d = dateOf(r.issue_date)
    if (!d || d < cutoff || d > now) continue
    ;(byAsset[r.asset_no] = byAsset[r.asset_no] || []).push(r)
  }
  const order = { Critical: 0, High: 1 }
  return Object.entries(byAsset)
    .map(([asset_no, recs]) => {
      const latest = [...recs].sort((a, b) => String(b.issue_date).localeCompare(String(a.issue_date)))[0]
      return {
        asset_no,
        site: latest.site || null,
        risk_level: latest.risk_level,
        issue_date: latest.issue_date,
        position: latest.position || null,
        brand: latest.brand || null,
        count: recs.length,
      }
    })
    .sort((a, b) => (order[a.risk_level] ?? 2) - (order[b.risk_level] ?? 2) || String(b.issue_date).localeCompare(String(a.issue_date)))
}

/**
 * CPK benchmarks. The savings estimate is what the worst 10% of vehicles by CPK
 * would have cost at the fleet average CPK over the tyre km actually measured on
 * them, annualised over the window. Null when it cannot be measured.
 */
export function cpkBenchmarks(metrics = [], aggs = {}) {
  const avg = aggs.fleetAvgCpk
  const withCpk = metrics.filter((v) => v.avg_cpk != null && Number.isFinite(v.avg_cpk))
  const worst10 = [...withCpk].sort((a, b) => b.avg_cpk - a.avg_cpk)
    .slice(0, Math.max(1, Math.ceil(withCpk.length * 0.1)))
  let savings = null
  if (avg != null && withCpk.length && aggs.months_span) {
    const periodSavings = worst10.reduce((s, v) => s + Math.max(0, (v.avg_cpk - avg) * (v.measured_km || 0)), 0)
    savings = (periodSavings / aggs.months_span) * 12
  }
  return {
    worst: aggs.worst_vehicle_cpk || null,
    best: aggs.best_vehicle_cpk || null,
    annualSavings: savings,
    fleetAvgCpk: avg ?? null,
    worstCohort: withCpk.length ? worst10.length : 0,
  }
}

/** Register filter: site / type / availability / free-text asset search. */
export function filterRegister(metrics = [], { site = 'all', type = 'all', avail = 'all', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return metrics.filter((v) => {
    if (site !== 'all' && v.site !== site) return false
    if (type !== 'all' && v.vehicle_type !== type) return false
    if (avail !== 'all' && v.availability_status !== avail) return false
    if (q && !String(v.asset_no).toLowerCase().includes(q) && !String(v.site || '').toLowerCase().includes(q)) return false
    return true
  })
}

export const REGISTER_EXPORT_COLS = [
  'asset_no', 'site', 'vehicle_type', 'total_tyre_changes', 'total_tyre_cost', 'avg_cpk', 'high_risk_count',
  'availability_status', 'monthly_cost', 'avg_km_per_tyre', 'downtime_hours', 'last_change_date',
]
export const REGISTER_EXPORT_HEADERS = [
  'Asset No', 'Site', 'Vehicle Type', 'Total Changes', 'Total Cost', 'Avg CPK', 'High Risk Count',
  'Availability', 'Monthly Cost', 'Avg KM/Tyre', 'Downtime Hrs', 'Last Change',
]

/** Export rows: raw numbers, N/A for unmeasured values. */
export function registerExportRows(metrics = []) {
  const na = (v, dec) => (v == null || !Number.isFinite(Number(v)) ? 'N/A' : (dec == null ? Number(v) : Number(Number(v).toFixed(dec))))
  return metrics.map((v) => ({
    asset_no: v.asset_no,
    site: v.site || 'N/A',
    vehicle_type: v.vehicle_type || 'N/A',
    total_tyre_changes: v.total_tyre_changes,
    total_tyre_cost: na(v.total_tyre_cost, 2),
    avg_cpk: na(v.avg_cpk, 4),
    high_risk_count: v.high_risk_count,
    availability_status: v.availability_status,
    monthly_cost: na(v.monthly_cost, 2),
    avg_km_per_tyre: na(v.avg_km_per_tyre, 0),
    downtime_hours: v.downtime_hours,
    last_change_date: v.last_change_date || 'N/A',
  }))
}
