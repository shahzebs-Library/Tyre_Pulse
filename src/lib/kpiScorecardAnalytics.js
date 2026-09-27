/**
 * kpiScorecardAnalytics - pure engine for the KPI Scorecard page (monthly
 * actuals against the org's kpi_targets).
 *
 * RULES THIS ENGINE ENFORCES
 *  - Monthly tyre COST comes from the classified expense grid (the governed
 *    cost split's byMonth), never a sum of tyre_records.cost_per_tyre, which
 *    is empty for whole countries and reported 0 spend as a pass.
 *  - A cost over more than one country is blended SAR+AED+EGP; it is refused
 *    (null) rather than rendered as one number.
 *  - High-risk % is measured over RATED tyres (risk_level recorded). With no
 *    tyre rated it is null, not a 0% that passes its target.
 *  - Pass/fail is null for an unmeasured actual.
 *
 * No I/O; the clock is injected (`now`).
 */

export const DEFAULT_TARGETS = {
  max_monthly_cost:    150000,
  max_high_risk_pct:   20,
  min_records_month:   10,
  max_overdue_actions: 5,
  max_avg_cost_tyre:   2000,
}

/** unit: 'currency' | '%' | ''. invert = lower is better. */
export const KPI_META = {
  max_monthly_cost:    { unit: 'currency', invert: true },
  max_high_risk_pct:   { unit: '%', invert: true },
  min_records_month:   { unit: '', invert: false },
  max_overdue_actions: { unit: '', invert: true },
  max_avg_cost_tyre:   { unit: 'currency', invert: true },
}

export function isMeasured(v) {
  return v != null && v !== '' && Number.isFinite(Number(v))
}

const pad = (n) => String(n).padStart(2, '0')
const monthKey = (y, m) => `${y}-${pad(m)}`

/**
 * The month axis. Default: the rolling 12 months ending at `now`. With a full
 * custom range (both dates, from <= to): the range's months clamped to the most
 * recent 24.
 */
export function monthWindow({ rangeFrom = '', rangeTo = '', now = new Date() } = {}) {
  const custom = Boolean(rangeFrom && rangeTo && rangeFrom <= rangeTo)
  if (custom) {
    const out = []
    let y = Number(rangeFrom.slice(0, 4))
    let m = Number(rangeFrom.slice(5, 7))
    const endKey = rangeTo.slice(0, 7)
    let key = monthKey(y, m)
    while (key <= endKey && out.length < 480) {
      out.push(key)
      m += 1
      if (m > 12) { m = 1; y += 1 }
      key = monthKey(y, m)
    }
    if (out.length > 24) return { months: out.slice(-24), clamped: true, custom }
    return { months: out, clamped: false, custom }
  }
  const out = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(monthKey(d.getFullYear(), d.getMonth() + 1))
  }
  return { months: out, clamped: false, custom }
}

/** Same months one year earlier. */
export function priorYearMonths(months) {
  return months.map(m => `${Number(m.slice(0, 4)) - 1}-${m.slice(5, 7)}`)
}

/** First and last calendar day covering a month list. */
export function monthsToDateRange(months) {
  if (!months?.length) return { from: null, to: null }
  const last = months[months.length - 1]
  const lastDay = new Date(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 0).getDate()
  return { from: `${months[0]}-01`, to: `${last}-${pad(lastDay)}` }
}

/** Map month -> tyre spend from a governed split. null when unusable (blended / missing). */
export function gridCostByMonth(split) {
  if (!split || split.blended || !Array.isArray(split.byMonth)) return null
  const m = new Map()
  for (const row of split.byMonth) m.set(row.month, Number(row.tyre) || 0)
  return m
}

const isRated = (r) => r?.risk_level != null && String(r.risk_level).trim() !== ''
const isHigh = (r) => r.risk_level === 'High' || r.risk_level === 'Critical'

/** Open actions whose due date has passed at `now`. */
export function overdueActionCount(actions = [], now = new Date()) {
  const t = now.getTime()
  return actions.filter(a => a?.due_date && a.status !== 'Closed' && new Date(a.due_date).getTime() < t).length
}

/** One row per month. `costMap` = gridCostByMonth(...) or null. */
export function monthlyActuals(records = [], months = [], costMap = null) {
  const byMonth = new Map(months.map(m => [m, []]))
  for (const r of records) {
    const k = r?.issue_date ? String(r.issue_date).slice(0, 7) : null
    if (k && byMonth.has(k)) byMonth.get(k).push(r)
  }
  return months.map(month => {
    const rows = byMonth.get(month)
    const rated = rows.filter(isRated)
    const highRisk = rated.filter(isHigh).length
    const totalCost = costMap ? (costMap.has(month) ? costMap.get(month) : 0) : null
    return {
      month,
      count: rows.length,
      rated: rated.length,
      highRiskCount: rated.length ? highRisk : null,
      highRiskPct: rated.length ? (highRisk / rated.length) * 100 : null,
      totalCost,
      avgCostPerTyre: totalCost != null && rows.length > 0 ? totalCost / rows.length : null,
    }
  })
}

/** Pass/fail against a target; null when the actual is unmeasured. */
export function passes(actual, target, invert) {
  if (!isMeasured(actual) || !isMeasured(target)) return null
  return invert ? Number(actual) <= Number(target) : Number(actual) >= Number(target)
}

/** Least-squares fit over the measured monthly costs, with r squared. */
export function costRegression(actuals = []) {
  const pts = actuals.map((a, i) => ({ x: i, y: a.totalCost })).filter(p => isMeasured(p.y))
  if (pts.length < 2) return null
  const n = pts.length
  const mx = pts.reduce((s, p) => s + p.x, 0) / n
  const my = pts.reduce((s, p) => s + p.y, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (const p of pts) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2 }
  const slope = sxx === 0 ? 0 : sxy / sxx
  const intercept = my - slope * mx
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy)
  return { slope, intercept, r2, predict: (x) => intercept + slope * x }
}

/** Current-month metrics over target by more than 20% (lower-is-better only). */
export function performanceAlerts(current, targets, overdueNow) {
  if (!current) return []
  const checks = [
    ['max_monthly_cost', current.totalCost],
    ['max_high_risk_pct', current.highRiskPct],
    ['max_overdue_actions', overdueNow],
    ['max_avg_cost_tyre', current.avgCostPerTyre],
  ]
  const out = []
  for (const [key, actual] of checks) {
    const target = targets?.[key]
    if (!isMeasured(actual) || !isMeasured(target) || Number(target) <= 0) continue
    const overage = (Number(actual) - Number(target)) / Number(target)
    if (overage > 0.2) out.push({ key, actual: Number(actual), target: Number(target), overage })
  }
  return out
}

/** Per-site view for one month: fitments, rated tyres and high-risk %. */
export function siteRows(records = [], month, targets = DEFAULT_TARGETS) {
  const bySite = new Map()
  for (const r of records) {
    const site = r?.site || 'Unknown site'
    if (!bySite.has(site)) bySite.set(site, { all: 0, monthRows: [] })
    const e = bySite.get(site)
    e.all += 1
    if (r.issue_date && String(r.issue_date).startsWith(month)) e.monthRows.push(r)
  }
  return [...bySite.entries()].map(([site, e]) => {
    const rated = e.monthRows.filter(isRated)
    const high = rated.filter(isHigh).length
    const highRiskPct = rated.length ? (high / rated.length) * 100 : null
    return {
      site,
      count: e.monthRows.length,
      windowCount: e.all,
      rated: rated.length,
      highRiskPct,
      recordsPass: passes(e.monthRows.length, targets.min_records_month, false),
      riskPass: passes(highRiskPct, targets.max_high_risk_pct, true),
    }
  }).sort((a, b) => b.count - a.count || a.site.localeCompare(b.site))
}

/** Change vs a comparison value; null when either side is unmeasured. */
export function deltaOf(actual, prev) {
  if (!isMeasured(actual) || !isMeasured(prev)) return null
  return Number(actual) - Number(prev)
}

/** Monthly rows for Excel/PDF, 'N/A' for unmeasured values. */
export function actualsExportRows(actuals, targets) {
  return actuals.map(a => ({
    month: a.month,
    count: a.count,
    rated: a.rated,
    totalCost: a.totalCost == null ? 'N/A' : Math.round(a.totalCost),
    costVsTarget: a.totalCost == null ? 'N/A' : passes(a.totalCost, targets.max_monthly_cost, true) ? 'On target' : 'Over target',
    highRiskPct: a.highRiskPct == null ? 'N/A' : Number(a.highRiskPct.toFixed(1)),
    avgCostPerTyre: a.avgCostPerTyre == null ? 'N/A' : Math.round(a.avgCostPerTyre),
  }))
}
