/**
 * Predictive Maintenance page analytics: the pure presentation-layer rollups
 * that sit ON TOP of the prediction engines in `predictiveMaintenance.js`.
 *
 * The engines (buildPredictions / buildFailureRiskRows / buildCohortModels)
 * produce per-tyre rows; this module only buckets, filters and summarises
 * those rows for the page. No I/O, no React, and no clock read inside the
 * maths: every time-dependent function takes an injected `now`.
 *
 * Honesty rules:
 *   - A figure that cannot be measured is `null` (rendered N/A), never 0.
 *     An average over zero rows is null; a share of a zero total is null.
 *   - Money is summed only from `estimated_cost`, which the engine already
 *     resolves (own price, else asset mean, else fleet average). No cost is
 *     invented here.
 */

export const URGENT_DAYS = 30
export const SOON_DAYS = 90
export const YEAR_DAYS = 365

export const HORIZONS = [
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: '6mo', label: '6 months', days: 180 },
  { key: '12mo', label: '12 months', days: 365 },
]

export const RISK_BANDS = ['extreme', 'high', 'elevated', 'low']

/** Days covered by a horizon key; unknown keys fall back to 12 months. */
export function horizonDays(key) {
  return HORIZONS.find((h) => h.key === key)?.days ?? YEAR_DAYS
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function toDate(now) {
  const d = now instanceof Date ? new Date(now.getTime()) : new Date(now)
  return Number.isNaN(d.getTime()) ? new Date(0) : d
}

function addMonths(date, n) {
  const d = new Date(date.getTime())
  d.setMonth(d.getMonth() + n)
  return d
}

export function monthKey(date) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function mean(values) {
  const nums = (values || []).map(Number).filter(Number.isFinite)
  if (!nums.length) return null
  return nums.reduce((s, v) => s + v, 0) / nums.length
}

/** Case-insensitive free-text match across the given fields. */
export function matchesSearch(row, query, fields) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  return fields.some((f) => String(row?.[f] ?? '').toLowerCase().includes(q))
}

const FORECAST_SEARCH_FIELDS = ['asset_no', 'site', 'vehicle_type', 'position', 'brand', 'size']
const RISK_SEARCH_FIELDS = ['asset_no', 'site', 'position', 'brand', 'size']

/**
 * POPULATION scope for the forecast: site, vehicle type and search. The two
 * TIME filters (urgency, horizon) are held out on purpose: every forecast
 * surface plots days-to-replacement on its own axis, so applying them would
 * zero out the bands the reader is trying to compare.
 */
export function forecastBase(predictions, { site = 'all', vehicleType = 'all', search = '' } = {}) {
  return (predictions || []).filter((p) => {
    if (site !== 'all' && p.site !== site) return false
    if (vehicleType !== 'all' && p.vehicle_type !== vehicleType) return false
    return matchesSearch(p, search, FORECAST_SEARCH_FIELDS)
  })
}

/** Table scope: the forecast base narrowed further by urgency and horizon. */
export function filterPredictions(base, { urgency = 'all', horizon = '12mo' } = {}) {
  const maxDays = horizonDays(horizon)
  return (base || []).filter((p) => {
    if (urgency !== 'all' && p.urgency !== urgency) return false
    return num(p.days_away) <= maxDays
  })
}

export function filterRisk(rows, { site = 'all', band = 'all', search = '' } = {}) {
  return (rows || []).filter((r) => {
    if (site !== 'all' && r.site !== site) return false
    if (band !== 'all' && r.risk_band !== band) return false
    return matchesSearch(r, search, RISK_SEARCH_FIELDS)
  })
}

function costOf(rows) {
  return rows.reduce((s, p) => s + num(p.estimated_cost), 0)
}

/** Urgency-band KPIs over the forecast base (counts + cost per band). */
export function forecastKpis(base) {
  const rows = base || []
  const urgent = rows.filter((p) => p.urgency === 'Urgent')
  const soon = rows.filter((p) => p.urgency === 'Soon')
  const monitor = rows.filter((p) => p.urgency === 'Monitor' && num(p.days_away) <= YEAR_DAYS)
  const year = rows.filter((p) => num(p.days_away) <= YEAR_DAYS)
  return {
    urgentCount: urgent.length,
    soonCount: soon.length,
    monitorCount: monitor.length,
    yearCount: year.length,
    urgentCost: costOf(urgent),
    soonCost: costOf(soon),
    monitorCost: costOf(monitor),
    annualCost: costOf(year),
  }
}

/** Twelve monthly buckets starting at `now`, with forecast cost and count. */
export function buildMonthlyBudget(predictions, now) {
  const start = toDate(now)
  const buckets = new Map()
  for (let i = 0; i < 12; i++) {
    const m = addMonths(start, i)
    buckets.set(monthKey(m), { key: monthKey(m), date: m, cost: 0, count: 0 })
  }
  for (const p of predictions || []) {
    const b = buckets.get(monthKey(p.due_date))
    if (b) {
      b.cost += num(p.estimated_cost)
      b.count += 1
    }
  }
  return [...buckets.values()]
}

/** Q1 / Q2 / H2 / total from the 12 monthly buckets. */
export function quarterlyForecast(monthly) {
  const m = monthly || []
  const sum = (a, b) => m.slice(a, b).reduce((s, x) => s + num(x.cost), 0)
  const q1 = sum(0, 3)
  const q2 = sum(3, 6)
  const h2 = sum(6, 12)
  return { q1, q2, h2, total: q1 + q2 + h2 }
}

/**
 * Per-site demand for the next 12 months. `pctBudget` is the site's share of
 * the forecast total, or null when the total is zero (nothing to divide).
 */
export function buildSiteBreakdown(predictions) {
  const annual = (predictions || []).filter((p) => num(p.days_away) <= YEAR_DAYS)
  const total = costOf(annual)
  const sites = new Map()
  for (const p of annual) {
    const key = p.site || 'Unassigned'
    if (!sites.has(key)) sites.set(key, { site: key, due30: 0, due90: 0, due12mo: 0, cost: 0 })
    const s = sites.get(key)
    s.due12mo += 1
    s.cost += num(p.estimated_cost)
    if (num(p.days_away) <= URGENT_DAYS) s.due30 += 1
    if (num(p.days_away) <= SOON_DAYS) s.due90 += 1
  }
  return [...sites.values()]
    .sort((a, b) => b.cost - a.cost)
    .map((s) => ({ ...s, pctBudget: total > 0 ? Math.round((s.cost / total) * 1000) / 10 : null }))
}

export function recommendedAction(urgentCount) {
  if (urgentCount >= 3) return 'Schedule immediate full set replacement'
  if (urgentCount >= 1) return 'Urgent inspection and prioritise replacement'
  return 'Schedule within 90 days'
}

/** Top vehicles by urgent count, then soonest due, capped at `limit`. */
export function urgentVehicles(predictions, limit = 10) {
  const byAsset = new Map()
  for (const p of predictions || []) {
    const key = p.asset_no
    if (!key) continue
    if (!byAsset.has(key)) {
      byAsset.set(key, {
        asset_no: key, site: p.site, vehicle_type: p.vehicle_type,
        urgent_count: 0, soon_count: 0, total_cost: 0, min_days: num(p.days_away),
      })
    }
    const v = byAsset.get(key)
    v.total_cost += num(p.estimated_cost)
    if (p.urgency === 'Urgent') v.urgent_count += 1
    if (p.urgency === 'Soon') v.soon_count += 1
    if (num(p.days_away) < v.min_days) v.min_days = num(p.days_away)
  }
  return [...byAsset.values()]
    .filter((v) => v.urgent_count > 0 || v.min_days <= SOON_DAYS)
    .sort((a, b) => b.urgent_count - a.urgent_count || a.min_days - b.min_days)
    .slice(0, limit)
    .map((v, i) => ({ ...v, rank: i + 1, recommended_action: recommendedAction(v.urgent_count) }))
}

/** Risk-band KPIs. Averages are null over zero rows, never 0. */
export function riskKpis(rows) {
  const r = rows || []
  const count = (band) => r.filter((x) => x.risk_band === band).length
  return {
    total: r.length,
    extreme: count('extreme'),
    high: count('high'),
    elevated: count('elevated'),
    low: count('low'),
    unknown: r.filter((x) => !RISK_BANDS.includes(x.risk_band)).length,
    avgFailureProbPct: mean(r.map((x) => x.failure_prob_pct).filter((v) => v != null)),
    avgRiskScore: mean(r.map((x) => x.risk_score).filter((v) => v != null)),
  }
}

/** Flatten the cohort model map into display rows, most-sampled first. */
export function cohortRows(models) {
  const list = models instanceof Map ? [...models.values()] : Array.isArray(models) ? models : []
  const round = (v, dp) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10 ** dp) / 10 ** dp : null)
  return list
    .map((m) => ({
      id: `${m.brand}|${m.size}`,
      brand: m.brand,
      size: m.size,
      n: m.n,
      etaKm: round(m.eta, 0),
      beta: round(m.beta, 3),
      meanKm: round(m.mean, 0),
      cv: round(m.cv, 2),
      ciSpread: round(m.ciSpread, 1),
    }))
    .sort((a, b) => num(b.n) - num(a.n))
}

/** Sum of per-vehicle monthly tyre budgets, or null when none is recorded. */
export function monthlyFleetBudget(fleet) {
  const budgets = (fleet || []).map((f) => Number(f.monthly_tyre_budget)).filter((v) => Number.isFinite(v) && v > 0)
  return budgets.length ? budgets.reduce((s, v) => s + v, 0) : null
}

export function uniqueSorted(values) {
  return [...new Set((values || []).filter((v) => v && v !== '-'))].sort()
}
