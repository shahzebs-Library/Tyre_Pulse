/**
 * Forecasting Engine analytics - pure, I/O-free projections for the
 * `/forecasting` page (`src/pages/ForecastingEngine.jsx`).
 *
 * The page loads tyre_records + vehicle_fleet and hands the raw rows here.
 * Nothing in this module reads the clock: the anchor is derived from the data
 * (the newest issue_date) and `now` is only used as the fallback anchor when
 * there is no dated row at all.
 *
 * Honesty rules held here, and pinned by src/test/forecastingEngineAnalytics.test.js:
 *  - MONEY IS NEVER BLENDED ACROSS CURRENCIES. The caller says whether money is
 *    measurable (`moneyAllowed`, false on the All-countries view where SAR, AED
 *    and EGP would otherwise be added together). When it is not, every money
 *    figure is null (rendered N/A), never a number under a borrowed label.
 *  - A tyre with no price is UNPRICED, not free. Average cost per tyre is taken
 *    over priced units only, and the priced share is reported beside it.
 *  - A month with no records has no failure rate. It is null, not 0% - a zero
 *    there reads as "nothing failed", which is a measurement nobody took.
 *  - Demand is counted in tyres (qty, default 1), the same unit spend is priced
 *    in, so demand x average cost is a meaningful product.
 */

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Stock-status gap bands for the inventory table. */
export const STOCK_GAP = Object.freeze({ under: 20, monitor: 5, over: -5 })
/** Vendor priority bands on 12-month forecast units. */
export const VENDOR_PRIORITY = Object.freeze({ high: 50, medium: 20 })
/** Forecast failure-rate alert threshold, percent. */
export const FAILURE_ALERT_PCT = 20
/** Safety multiplier on 3-month demand for the recommended stock level. */
export const SAFETY_STOCK_FACTOR = 1.2
/** Buffer on the forecast for the recommended annual budget. */
export const BUDGET_BUFFER = 1.1
/** Symmetric confidence band drawn around the demand forecast. */
export const CONFIDENCE_BAND = 0.15

export function num(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Units on a record: qty when it is a positive number, otherwise 1. */
export function unitsOf(r) {
  const q = num(r?.qty)
  return q != null && q > 0 ? q : 1
}

/** Line cost (price x units), or null when the tyre carries no usable price. */
export function lineCost(r) {
  const p = num(r?.cost_per_tyre)
  if (p == null || p <= 0) return null
  return p * unitsOf(r)
}

/** 'YYYY-MM' from a date-ish string, or null. */
export function monthKey(v) {
  if (!v) return null
  const s = String(v)
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : null
}

const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/** The last `n` month keys ending at the anchor month (oldest first). */
export function monthKeysBack(anchor, n = 12) {
  const a = anchor instanceof Date ? anchor : new Date(anchor)
  if (Number.isNaN(a.getTime())) return []
  const keys = []
  for (let i = n - 1; i >= 0; i--) keys.push(keyOf(new Date(a.getFullYear(), a.getMonth() - i, 1)))
  return keys
}

/** 'Mon YYYY' labels for the `n` months after the anchor. */
export function nextMonthLabels(anchor, n) {
  const a = anchor instanceof Date ? anchor : new Date(anchor)
  if (Number.isNaN(a.getTime())) return []
  const out = []
  for (let i = 1; i <= n; i++) {
    const d = new Date(a.getFullYear(), a.getMonth() + i, 1)
    out.push(`${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`)
  }
  return out
}

/** 'Mon' label for a 'YYYY-MM' key. */
export function monthLabel(key) {
  const m = Number(String(key || '').slice(5, 7))
  return MONTH_SHORT[m - 1] || ''
}

/**
 * The newest issue_date in the rows as a local-midnight Date. Falls back to
 * `now` only when no row carries a date. Parsed from the string's own
 * components - `new Date('2026-08-01')` is UTC midnight and rolls the month
 * back west of UTC.
 */
export function dataAnchor(records = [], now = new Date()) {
  let max = null
  for (const r of records || []) {
    const d = r?.issue_date ? String(r.issue_date).slice(0, 10) : ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (!max || d > max)) max = d
  }
  if (!max) return now instanceof Date ? now : new Date(now)
  const [y, m, d] = max.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Least-squares line over (x, y) points. Accepts a plain series (index = x)
 * where null entries are SKIPPED rather than read as zero.
 */
export function linearRegression(series = []) {
  const pts = []
  series.forEach((y, x) => { const v = num(y); if (v != null) pts.push([x, v]) })
  const n = pts.length
  if (n === 0) return { slope: 0, intercept: 0, points: 0 }
  if (n === 1) return { slope: 0, intercept: pts[0][1], points: 1 }
  let sx = 0, sy = 0, sxy = 0, sx2 = 0
  for (const [x, y] of pts) { sx += x; sy += y; sxy += x * y; sx2 += x * x }
  const denom = n * sx2 - sx * sx
  if (!denom) return { slope: 0, intercept: sy / n, points: n }
  const slope = (n * sxy - sx * sy) / denom
  return { slope, intercept: (sy - slope * sx) / n, points: n }
}

/** Project `steps` values forward from a series, floored at zero. */
export function projectSeries(series = [], steps = 12) {
  const { slope, intercept, points } = linearRegression(series)
  if (!points) return Array.from({ length: steps }, () => null)
  return Array.from({ length: steps }, (_, i) => Math.max(0, intercept + slope * (series.length + i)))
}

const sum = (arr) => arr.reduce((s, v) => s + (num(v) || 0), 0)

/**
 * Model confidence from the last three months: 100 minus the mean absolute
 * percentage error of the fitted line, clamped to 0..100. Null with fewer than
 * six months of series (too little history to hold three back).
 */
export function modelConfidence(series = []) {
  if (series.length < 6) return null
  const { slope, intercept, points } = linearRegression(series)
  if (points < 6) return null
  const last3 = series.slice(-3)
  const errs = last3.map((a, i) => {
    const actual = num(a) || 0
    const predicted = Math.max(0, intercept + slope * (series.length - 3 + i))
    return Math.abs(actual - predicted) / Math.max(1, actual)
  })
  const mape = errs.reduce((s, e) => s + e, 0) / errs.length
  return Math.round((1 - Math.min(1, mape)) * 100)
}

/** Trend direction from a fitted slope, with a dead band so noise reads flat. */
export function trendDirection(slope) {
  if (slope > 0.5) return 'up'
  if (slope < -0.5) return 'down'
  return 'flat'
}

/** Inventory status for a recommended-minus-fitted gap. */
export function stockStatus(gap) {
  if (gap == null) return { key: 'unknown', label: 'N/A', tone: 'quiet' }
  if (gap > STOCK_GAP.under) return { key: 'under', label: 'Understocked', tone: 'danger' }
  if (gap > STOCK_GAP.monitor) return { key: 'monitor', label: 'Monitor', tone: 'warning' }
  if (gap < STOCK_GAP.over) return { key: 'over', label: 'Overstocked', tone: 'info' }
  return { key: 'ok', label: 'Adequate', tone: 'good' }
}

/** Vendor priority for 12-month forecast units. */
export function vendorPriority(units12) {
  if (units12 > VENDOR_PRIORITY.high) return 'High'
  if (units12 > VENDOR_PRIORITY.medium) return 'Medium'
  return 'Low'
}

const isFailure = (r) => r?.risk_level === 'High' || r?.risk_level === 'Critical'
  || r?.category === 'Failure' || r?.category === 'Damage'

/** Per-group rollup (brand or site) with a monthly unit series and priced cost. */
function groupForecast(rows, keyFn, keys, moneyAllowed) {
  const groups = new Map()
  for (const r of rows) {
    const k = keyFn(r)
    if (!k) continue
    const g = groups.get(k) || { units: 0, pricedUnits: 0, pricedCost: 0, monthly: {} }
    const u = unitsOf(r)
    g.units += u
    const c = lineCost(r)
    if (c != null) { g.pricedUnits += u; g.pricedCost += c }
    const mk = monthKey(r.issue_date)
    if (mk) g.monthly[mk] = (g.monthly[mk] || 0) + u
    groups.set(k, g)
  }
  return [...groups.entries()].map(([key, g]) => {
    const series = keys.map((k) => g.monthly[k] || 0)
    const fc = projectSeries(series, 12)
    const f3 = sum(fc.slice(0, 3))
    const f12 = sum(fc)
    const avgCost = moneyAllowed && g.pricedUnits > 0 ? g.pricedCost / g.pricedUnits : null
    const { slope } = linearRegression(series)
    return {
      key,
      actual12: g.units,
      forecast3: Math.round(f3),
      forecast12: Math.round(f12),
      forecast3Raw: f3,
      avgCostPerTyre: avgCost,
      estCost12: avgCost == null ? null : f12 * avgCost,
      pricedShare: g.units ? g.pricedUnits / g.units : null,
      slope,
      trend: trendDirection(slope),
    }
  }).sort((a, b) => b.forecast12 - a.forecast12 || String(a.key).localeCompare(String(b.key)))
}

/**
 * Build the whole forecast model.
 *
 * @param {object} p
 * @param {object[]} p.records   tyre_records rows
 * @param {object[]} p.fleet     vehicle_fleet rows
 * @param {string}   p.site      'all' or a site name
 * @param {number}   p.horizon   months ahead shown (3|6|12)
 * @param {boolean}  p.moneyAllowed  false when money would blend currencies
 * @param {Date}     p.now       fallback anchor when no row is dated
 */
export function buildForecastModel({
  records = [], fleet = [], site = 'all', horizon = 12, moneyAllowed = true, now = new Date(),
} = {}) {
  const anchor = dataAnchor(records, now)
  const keys12 = monthKeysBack(anchor, 12)
  const keys24 = monthKeysBack(anchor, 24)
  const set12 = new Set(keys12)
  const prevYear = new Set(keys24.slice(0, 12))

  const sites = [...new Set((records || []).map((r) => r?.site).filter(Boolean))].sort()
  const scoped = site === 'all' ? (records || []) : (records || []).filter((r) => r?.site === site)
  const hist12 = scoped.filter((r) => set12.has(monthKey(r.issue_date)))

  const demandByMonth = Object.fromEntries(keys12.map((k) => [k, 0]))
  const spendByMonth = Object.fromEntries(keys12.map((k) => [k, 0]))
  const failByMonth = Object.fromEntries(keys12.map((k) => [k, { n: 0, failed: 0 }]))
  let units12 = 0, pricedUnits12 = 0, pricedCost12 = 0
  for (const r of hist12) {
    const k = monthKey(r.issue_date)
    const u = unitsOf(r)
    demandByMonth[k] += u
    units12 += u
    const c = lineCost(r)
    if (c != null) { spendByMonth[k] += c; pricedUnits12 += u; pricedCost12 += c }
    failByMonth[k].n += 1
    if (isFailure(r)) failByMonth[k].failed += 1
  }
  const monthlyDemand = keys12.map((k) => demandByMonth[k])
  const monthlySpend = moneyAllowed ? keys12.map((k) => spendByMonth[k]) : keys12.map(() => null)
  const failureHistory = keys12.map((k) => (failByMonth[k].n ? (failByMonth[k].failed / failByMonth[k].n) * 100 : null))

  const demandForecast = projectSeries(monthlyDemand, 12)
  const budgetForecast = moneyAllowed && pricedUnits12 > 0 ? projectSeries(monthlySpend, 12) : keys12.map(() => null)
  const failureForecast = projectSeries(failureHistory, 12)

  const annualDemand = sum(demandForecast)
  const annualBudget = budgetForecast.every((v) => v == null) ? null : sum(budgetForecast)

  const fleetBudgetRaw = (fleet || []).reduce((s, v) => s + (num(v?.monthly_tyre_budget) || 0), 0)
  const fleetMonthlyBudgetTarget = moneyAllowed && fleetBudgetRaw > 0 ? fleetBudgetRaw : null

  let lastYearActual = null
  if (moneyAllowed) {
    let ly = 0, lyPriced = 0
    for (const r of scoped) {
      if (!prevYear.has(monthKey(r.issue_date))) continue
      const c = lineCost(r)
      if (c != null) { ly += c; lyPriced += 1 }
    }
    lastYearActual = lyPriced ? ly : null
  }
  const budgetChange = lastYearActual && annualBudget != null
    ? ((annualBudget - lastYearActual) / lastYearActual) * 100
    : null

  const horizonBudget = budgetForecast.slice(0, horizon)
  const monthsOverBudget = fleetMonthlyBudgetTarget == null || annualBudget == null
    ? null
    : horizonBudget.filter((m) => m != null && m > fleetMonthlyBudgetTarget).length

  const brands = groupForecast(hist12, (r) => r.brand, keys12, moneyAllowed)
    .map((b) => ({ ...b, brand: b.key, priority: vendorPriority(b.forecast12) }))

  const fitted = new Map()
  for (const r of scoped) {
    if (!r?.site || r.km_at_removal != null) continue
    fitted.set(r.site, (fitted.get(r.site) || 0) + unitsOf(r))
  }
  const siteRows = groupForecast(hist12, (r) => r.site, keys12, moneyAllowed)
  const siteKeys = new Set(siteRows.map((s) => s.key))
  // A site with fitted tyres but no replacement in the window still needs a row
  // in the inventory table - it has stock and zero projected demand.
  for (const [s] of fitted) {
    if (siteKeys.has(s)) continue
    siteRows.push({
      key: s, actual12: 0, forecast3: 0, forecast12: 0, forecast3Raw: 0,
      avgCostPerTyre: null, estCost12: null, pricedShare: null, slope: 0, trend: 'flat',
    })
  }
  const sitesOut = siteRows.map((s) => {
    const recommended = Math.ceil((s.forecast3Raw || 0) * SAFETY_STOCK_FACTOR)
    const current = fitted.get(s.key) || 0
    const gap = recommended - current
    return { ...s, site: s.key, recommendedStock: recommended, currentStock: current, stockGap: gap, status: stockStatus(gap) }
  })

  return {
    anchor,
    keys12,
    sites,
    scopedCount: scoped.length,
    hist12Count: hist12.length,
    monthlyDemand,
    monthlySpend,
    demandForecast,
    budgetForecast,
    failureHistory,
    failureForecast,
    annualDemand,
    annualBudget,
    monthlyAvgDemand: annualDemand / 12,
    monthlyAvgBudget: annualBudget == null ? null : annualBudget / 12,
    recommendedAnnualBudget: annualBudget == null ? null : annualBudget * BUDGET_BUFFER,
    confidence: modelConfidence(monthlyDemand),
    fleetMonthlyBudgetTarget,
    lastYearActual,
    budgetChange,
    monthsOverBudget,
    avgCostPerTyre: moneyAllowed && pricedUnits12 > 0 ? pricedCost12 / pricedUnits12 : null,
    pricedShare: units12 ? pricedUnits12 / units12 : null,
    brands,
    siteForecast: sitesOut,
    failureAlert: failureForecast.slice(0, horizon).some((r) => r != null && r > FAILURE_ALERT_PCT),
  }
}

/** Month-by-month export rows for the horizon. */
export function forecastExportRows(model, horizon, labels) {
  return (labels || []).slice(0, horizon).map((month, i) => ({
    month,
    demand_forecast: model.demandForecast[i] == null ? 'N/A' : Math.round(model.demandForecast[i]),
    budget_forecast: model.budgetForecast[i] == null ? 'N/A' : Math.round(model.budgetForecast[i]),
    failure_rate_forecast: model.failureForecast[i] == null ? 'N/A' : `${model.failureForecast[i].toFixed(1)}%`,
  }))
}
