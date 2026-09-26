/**
 * costCenterAnalytics - pure engine behind the Cost Center page.
 *
 * Everything the page used to compute inline lives here so it can be tested
 * without a browser: per-record normalisation, the record-level groupings
 * (site / brand / vehicle / month), the CPK fleet average, anomaly detection,
 * the ROI what-if and the period arithmetic.
 *
 * TWO RULES THIS FILE ENFORCES, both from PROJECT_MEMORY:
 *
 * 1. `cost_per_tyre` is NEVER summed into a headline spend total. The
 *    authoritative tyre spend comes from the expense grid via
 *    loadGovernedCostSplit. The record-level sums here are labelled
 *    "priced tyre records" and exist only to rank dimensions (brand, vehicle,
 *    site, month) that the grid cannot attribute.
 *
 * 2. Currencies are never blended. Each record carries its own country
 *    currency; a group that spans more than one currency reports its money as
 *    `null` (rendered N/A) and `mixedCurrency: true`, never a SAR+AED+EGP sum.
 *
 * No I/O. Anything time-dependent takes an injectable `now`.
 */
import { currencyForCountry, MIXED_CURRENCY } from './governedCost'

export const INDUSTRY_BENCHMARK_CPK = 1.5
export const SAVINGS_OPPORTUNITY_PCT = 0.15
export const ANOMALY_LIMIT = 12
/** The anomaly feed scans the 50 most expensive assets, as it always has. */
export const ANOMALY_VEHICLE_POPULATION = 50

const DAY_MS = 24 * 60 * 60 * 1000
const AVG_MONTH_DAYS = 30.44
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const toNum = (v) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)

/** Cost per km for one tyre, or null when either side is not measurable. */
export function calcCpk(cost, kmFit, kmRem) {
  const c = toNum(cost)
  const f = toNum(kmFit) ?? 0
  const r = toNum(kmRem)
  if (c == null || c <= 0 || r == null) return null
  const km = r - f
  if (km <= 0) return null
  return c / km
}

/** YYYY-MM from a date-ish value, or 'Unknown'. */
export function monthKey(dateStr) {
  if (!dateStr) return 'Unknown'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return 'Unknown'
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(key) {
  if (!key || key === 'Unknown') return key || 'Unknown'
  const [y, m] = String(key).split('-')
  const idx = parseInt(m, 10) - 1
  return MONTHS[idx] ? `${MONTHS[idx]} ${y}` : key
}

export function movingAvg(arr, n = 3) {
  return (arr || []).map((_, i) => {
    const slice = arr.slice(Math.max(0, i - n + 1), i + 1).filter((v) => Number.isFinite(v))
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null
  })
}

/** One tyre_records row reshaped for analysis. */
export function normaliseRecord(r = {}) {
  const cost = toNum(r.cost_per_tyre)
  const priced = cost != null && cost > 0
  return {
    ...r,
    asset: r.asset_no || r.asset_number || 'Unknown',
    pos: r.tyre_position || r.position || 'Unknown',
    siteKey: r.site || 'Unknown',
    brandKey: r.brand || 'Unknown',
    cost: priced ? cost : 0,
    priced,
    currency: currencyForCountry(r.country) || null,
    cpk: calcCpk(r.cost_per_tyre, r.km_at_fitment, r.km_at_removal),
    failed: /fail|burst|damage|scrap/i.test(r.removal_reason || ''),
    highRisk: /high|critical/i.test(r.risk_level || ''),
  }
}

export function normaliseRecords(records = []) {
  return (records || []).map(normaliseRecord)
}

/**
 * The single currency a set of normalised records is expressed in, the
 * MIXED sentinel when it spans several, or `fallback` when no record names a
 * known country (a legacy row): the page's active currency then applies.
 */
export function scopeCurrency(rows, fallback = null) {
  const set = new Set()
  for (const r of rows || []) if (r.currency) set.add(r.currency)
  if (set.size > 1) return MIXED_CURRENCY
  if (set.size === 1) return [...set][0]
  return fallback
}

/** Filter normalised records by the page's search / site / brand controls. */
export function filterRecords(rows, { q = '', site = '', brand = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase()
  return (rows || []).filter((r) => {
    if (site && r.siteKey !== site) return false
    if (brand && r.brandKey !== brand) return false
    if (!needle) return true
    return [r.asset, r.siteKey, r.brandKey, r.pos, r.removal_reason, r.country]
      .some((v) => String(v ?? '').toLowerCase().includes(needle))
  })
}

export function optionsFrom(rows, key) {
  return [...new Set((rows || []).map((r) => r[key]).filter((v) => v && v !== 'Unknown'))]
    .sort((a, b) => String(a).localeCompare(String(b)))
}

/** Money + CPK roll-up for one group, currency-safe. */
function finishGroup(g, fallbackCurrency) {
  const cur = g.currencies.size > 1 ? MIXED_CURRENCY : (g.currencies.size === 1 ? [...g.currencies][0] : fallbackCurrency)
  const mixed = cur === MIXED_CURRENCY
  const totalCost = mixed || g.priced === 0 ? null : g.cost
  return {
    count: g.count,
    priced: g.priced,
    currency: cur,
    mixedCurrency: mixed,
    totalCost,
    avgCost: totalCost == null ? null : totalCost / g.priced,
    avgCpk: mixed ? null : mean(g.cpks),
    cpkCount: g.cpks.length,
  }
}

function groupBy(rows, keyFn, extra, fallbackCurrency) {
  const map = new Map()
  for (const r of rows || []) {
    const key = keyFn(r)
    let g = map.get(key)
    if (!g) {
      g = { key, count: 0, priced: 0, cost: 0, cpks: [], currencies: new Set(), failures: 0, risks: 0, positions: {} }
      map.set(key, g)
    }
    g.count += 1
    if (r.priced) { g.priced += 1; g.cost += r.cost }
    if (r.cpk != null) g.cpks.push(r.cpk)
    if (r.currency && r.priced) g.currencies.add(r.currency)
    if (r.failed) g.failures += 1
    if (r.highRisk) g.risks += 1
    g.positions[r.pos] = (g.positions[r.pos] || 0) + 1
  }
  return [...map.values()].map((g) => ({ ...finishGroup(g, fallbackCurrency), ...extra(g) }))
}

/** Sort money descending with unknown (null) last. */
const byCostDesc = (a, b) => {
  if (a.totalCost == null && b.totalCost == null) return b.count - a.count
  if (a.totalCost == null) return 1
  if (b.totalCost == null) return -1
  return b.totalCost - a.totalCost
}

export function groupBySite(rows, { fallbackCurrency = null } = {}) {
  return groupBy(rows, (r) => r.siteKey, (g) => ({ site: g.key }), fallbackCurrency).sort(byCostDesc)
}

export function groupByBrand(rows, { fallbackCurrency = null } = {}) {
  return groupBy(rows, (r) => r.brandKey, (g) => ({
    brand: g.key,
    failures: g.failures,
    failureRate: g.count > 0 ? (g.failures / g.count) * 100 : null,
    bestPosition: Object.entries(g.positions).sort((a, z) => z[1] - a[1])[0]?.[0] ?? 'N/A',
  }), fallbackCurrency)
    .sort((a, b) => {
      if (a.avgCpk == null && b.avgCpk == null) return b.count - a.count
      if (a.avgCpk == null) return 1
      if (b.avgCpk == null) return -1
      return a.avgCpk - b.avgCpk
    })
    .map((b, i) => ({ ...b, rank: i + 1 }))
}

export function groupByVehicle(rows, { fleetAvgCpk = null, fallbackCurrency = null } = {}) {
  return groupBy(rows, (r) => r.asset, (g) => ({ asset: g.key, riskScore: g.risks }), fallbackCurrency)
    .map((v) => ({
      ...v,
      trend: v.avgCpk != null && fleetAvgCpk != null
        ? (v.avgCpk > fleetAvgCpk * 1.2 ? 'up' : v.avgCpk < fleetAvgCpk * 0.8 ? 'down' : 'flat')
        : 'unknown',
    }))
    .sort(byCostDesc)
}

/** Last `limit` months, oldest first. */
export function groupByMonth(rows, { limit = 12, fallbackCurrency = null } = {}) {
  return groupBy(rows, (r) => monthKey(r.created_at), (g) => ({ month: g.key }), fallbackCurrency)
    .filter((m) => m.month !== 'Unknown')
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-limit)
}

/**
 * Whole months covered by a from/to window. When no start is set the window
 * is open, so the span is measured from the first month that has data
 * (`firstMonth`, 'YYYY-MM'); with neither it is unmeasurable (null).
 */
export function periodMonths({ from, to, now = new Date(), firstMonth } = {}) {
  const end = to ? new Date(to) : new Date(now)
  let start = from ? new Date(from) : (firstMonth ? new Date(`${firstMonth}-01`) : null)
  if (!start || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  const days = (end - start) / DAY_MS
  if (days < 0) return null
  return Math.max(1, days / AVG_MONTH_DAYS)
}

/** Record-level fleet figures. Spend is NOT here - it comes from the grid. */
export function buildRecordKpis(rows, { fallbackCurrency = null } = {}) {
  const list = rows || []
  const currency = scopeCurrency(list.filter((r) => r.priced), fallbackCurrency)
  const cpks = list.filter((r) => r.cpk != null).map((r) => r.cpk)
  const priced = list.filter((r) => r.priced).length
  return {
    records: list.length,
    priced,
    pricedPct: list.length ? (priced / list.length) * 100 : null,
    cpkCount: cpks.length,
    currency,
    mixedCurrency: currency === MIXED_CURRENCY,
    fleetAvgCpk: currency === MIXED_CURRENCY ? null : mean(cpks),
    highRisk: list.filter((r) => r.highRisk).length,
  }
}

/**
 * Headline spend figures from a governed split (loadGovernedCostSplit).
 * Returns null money when the scope blends currencies or the period is
 * unmeasurable - never a fabricated 0.
 */
export function buildSpendKpis(split, { from, to, now = new Date(), fleetAvgCpk = null, mode = 'tyres' } = {}) {
  if (!split) return { spend: null, monthlyBurn: null, annualized: null, savings: null, months: null, blended: false }
  const blended = Boolean(split.blended)
  const amount = mode === 'maintenance'
    ? toNum(split.maintenance)
    : mode === 'combined' ? (toNum(split.tyre) ?? 0) + (toNum(split.maintenance) ?? 0) : toNum(split.tyre)
  const firstMonth = (split.byMonth || []).map((m) => m.month).filter(Boolean).sort()[0]
  const months = periodMonths({ from: from || split.window?.from, to: to || split.window?.to, now, firstMonth })
  const spend = blended ? null : amount
  const monthlyBurn = spend != null && months ? spend / months : null
  const annualized = monthlyBurn != null ? monthlyBurn * 12 : null
  const overBenchmark = fleetAvgCpk != null && fleetAvgCpk > INDUSTRY_BENCHMARK_CPK
  let savings = null
  if (annualized != null && fleetAvgCpk != null) savings = overBenchmark ? annualized * SAVINGS_OPPORTUNITY_PCT : 0
  return { spend, monthlyBurn, annualized, savings, months, blended, overBenchmark }
}

/** CPK vs the fleet average: { pct, direction } or null. */
export function cpkDelta(cpk, fleetAvg) {
  if (cpk == null || fleetAvg == null || fleetAvg === 0 || !Number.isFinite(cpk) || !Number.isFinite(fleetAvg)) return null
  const pct = ((cpk - fleetAvg) / fleetAvg) * 100
  if (Math.abs(pct) < 5) return { pct, direction: 'flat' }
  return { pct, direction: pct > 0 ? 'up' : 'down' }
}

/**
 * Anomaly feed. `vehicles` must be the population the caller chooses (the page
 * passes the top 50 by cost). Items carry raw numbers; wording is the page's.
 */
export function buildAnomalies({ vehicles = [], sites = [], brands = [], fleetAvgCpk = null, limit = ANOMALY_LIMIT } = {}) {
  const items = []
  if (fleetAvgCpk != null && fleetAvgCpk > 0) {
    for (const v of vehicles) {
      if (v.avgCpk != null && v.avgCpk > fleetAvgCpk * 2) {
        items.push({ type: 'vehicle', id: v.asset, severity: 'Critical', value: v.avgCpk, pct: (v.avgCpk / fleetAvgCpk - 1) * 100, currency: v.currency })
      }
    }
    for (const s of sites) {
      if (s.avgCpk != null && s.avgCpk > fleetAvgCpk * 1.3) {
        items.push({ type: 'site', id: s.site, severity: 'High', value: s.avgCpk, pct: (s.avgCpk / fleetAvgCpk - 1) * 100, currency: s.currency })
      }
    }
  }
  for (const b of brands) {
    if (b.failureRate != null && b.failureRate > 20) {
      items.push({ type: 'brand', id: b.brand, severity: 'High', value: b.failureRate, failures: b.failures, count: b.count })
    }
  }
  return items.slice(0, limit)
}

/** ROI what-if: `improvementPct` off the monthly burn. Null when burn is unknown. */
export function roiFor(improvementPct, monthlyBurn) {
  if (monthlyBurn == null || !Number.isFinite(monthlyBurn) || monthlyBurn <= 0) {
    return { monthlySavings: null, annualSavings: null, paybackMonths: null }
  }
  const improvement = improvementPct / 100
  const monthlySavings = monthlyBurn * improvement
  const annualSavings = monthlySavings * 12
  const investmentProxy = monthlyBurn * 0.05
  const paybackMonths = monthlySavings > 0 ? investmentProxy / monthlySavings : null
  return { monthlySavings, annualSavings, paybackMonths }
}

/** Share of a dimension's priced value held by its top `n` rows (concentration). */
export function topShare(groups, n = 5) {
  const valued = (groups || []).filter((g) => g.totalCost != null)
  const total = valued.reduce((s, g) => s + g.totalCost, 0)
  if (!total) return null
  const top = [...valued].sort((a, b) => b.totalCost - a.totalCost).slice(0, n).reduce((s, g) => s + g.totalCost, 0)
  return (top / total) * 100
}

/** Production (m3) list summary for the cost-per-unit panel. */
export function productionSummary(rows = []) {
  const list = rows || []
  const m3 = list.reduce((s, r) => s + (toNum(r.m3) ?? 0), 0)
  const sites = new Set(list.map((r) => r.site).filter(Boolean)).size
  return { entries: list.length, m3, sites }
}
