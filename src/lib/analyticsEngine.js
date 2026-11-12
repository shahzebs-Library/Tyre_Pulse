// ─────────────────────────────────────────────────────────────────────────────
// analyticsEngine.js - Pure stats + aggregation engine (no AI tokens)
// All functions are stateless; pass data in, get results out.
//
// TYRE LIFE / PURCHASE COST / CPK are measured per PHYSICAL TYRE through the
// shared lifetime layer (src/lib/tyreLifetime.js): rows are collapsed with
// toLifetimeTyres() FIRST and the tyres are then grouped by the attribute of
// their latest fitment (brand / site / asset / country). Group CPK is WEIGHTED
// (total purchase cost / total tyre-km), never an average of per-row ratios.
// Money per row (cost trends, totals by row date) goes through
// withOnePricePerTyre() so a refit is never bought twice.
// EVENTS (records/fitments, removals, high-risk counts and rates, replacement
// intervals) stay per fitment row on purpose.
// ─────────────────────────────────────────────────────────────────────────────
import {
  toLifetimeTyres, withOnePricePerTyre, lifetimeSummary, lifetimeCpk, fitmentCpk,
  CPK_KIND, CPK_KIND_LABEL,
} from './tyreLifetime'

// ── Basic Statistics ──────────────────────────────────────────────────────────

export function mean(arr) {
  if (!arr.length) return 0
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

export function median(arr) {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

export function stdDev(arr) {
  if (arr.length < 2) return 0
  const m = mean(arr)
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length)
}

export function percentile(arr, p) {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo])
}

export function sum(arr) {
  return arr.reduce((s, v) => s + (v ?? 0), 0)
}

// ── Aggregation Helpers ───────────────────────────────────────────────────────

/** Group array by the value returned by keyFn */
export function groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const key = keyFn(item)
    if (!acc[key]) acc[key] = []
    acc[key].push(item)
    return acc
  }, {})
}

/** Count occurrences, sorted desc by count */
export function countBy(arr, keyFn) {
  const counts = {}
  arr.forEach(item => {
    const k = keyFn(item) ?? 'Unknown'
    counts[k] = (counts[k] || 0) + 1
  })
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([key, count]) => ({ key, count }))
}

/** Sum numeric field grouped by key */
export function sumBy(arr, keyFn, valFn) {
  const totals = {}
  arr.forEach(item => {
    const k = keyFn(item) ?? 'Unknown'
    totals[k] = (totals[k] || 0) + (valFn(item) || 0)
  })
  return Object.entries(totals)
    .sort(([, a], [, b]) => b - a)
    .map(([key, total]) => ({ key, total }))
}

// ── Time Series ───────────────────────────────────────────────────────────────

/**
 * Bucket records by YYYY-MM. Returns sorted array of { month, items, count, total }
 * @param {Array}    records
 * @param {Function} dateFn   r => Date|string
 * @param {Function} [valFn]  r => number (for total)
 */
export function bucketByMonth(records, dateFn, valFn = null) {
  const buckets = {}
  records.forEach(r => {
    const raw = dateFn(r)
    if (!raw) return
    const d = new Date(raw)
    if (isNaN(d)) return
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!buckets[key]) buckets[key] = { month: key, items: [], count: 0, total: 0 }
    buckets[key].items.push(r)
    buckets[key].count++
    if (valFn) buckets[key].total += valFn(r) || 0
  })
  return Object.values(buckets).sort((a, b) => a.month.localeCompare(b.month))
}

/**
 * Rolling average over a sorted numeric array
 * @param {number[]} values
 * @param {number}   window  number of periods
 */
export function rollingAverage(values, window = 3) {
  return values.map((_, i) => {
    if (i < window - 1) return null
    const slice = values.slice(i - window + 1, i + 1)
    return mean(slice)
  })
}

// ── Linear Regression ─────────────────────────────────────────────────────────

/**
 * Ordinary Least Squares linear regression
 * @param {Array<[number, number]>} points  [[x, y], ...]
 * @returns {{ slope, intercept, r2, predict(x) }}
 */
export function linearRegression(points) {
  const n = points.length
  if (n < 2) return { slope: 0, intercept: points[0]?.[1] ?? 0, r2: 0, predict: x => points[0]?.[1] ?? 0 }

  const sumX  = points.reduce((s, [x]) => s + x, 0)
  const sumY  = points.reduce((s, [, y]) => s + y, 0)
  const sumXY = points.reduce((s, [x, y]) => s + x * y, 0)
  const sumX2 = points.reduce((s, [x]) => s + x * x, 0)

  // Guard the zero denominator (all x equal) → flat line at the mean, no NaN/Infinity.
  const denom     = n * sumX2 - sumX ** 2
  const slope     = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n

  // R² coefficient of determination
  const yMean = sumY / n
  const ssTot = points.reduce((s, [, y]) => s + (y - yMean) ** 2, 0)
  const ssRes = points.reduce((s, [x, y]) => s + (y - (slope * x + intercept)) ** 2, 0)
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot)

  return { slope, intercept, r2, predict: x => slope * x + intercept }
}

/**
 * Forecast future monthly values using OLS
 * @param {{ month: string, count: number, total: number }[]} monthlyData sorted asc
 * @param {number} futureMonths how many months ahead to forecast
 * @param {'count'|'total'} field
 * @returns {{ month, value, isForecast }[]}
 */
export function forecastMonthly(monthlyData, futureMonths = 3, field = 'count') {
  if (monthlyData.length < 2) return []

  const points = monthlyData.map((d, i) => [i, d[field]])
  const { predict } = linearRegression(points)

  const result = monthlyData.map((d, i) => ({
    month: d.month,
    value: d[field],
    predicted: Math.max(0, Math.round(predict(i))),
    isForecast: false,
  }))

  const lastDate = new Date(monthlyData[monthlyData.length - 1].month + '-01')
  for (let f = 1; f <= futureMonths; f++) {
    const nextDate = new Date(lastDate)
    nextDate.setMonth(nextDate.getMonth() + f)
    const key = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`
    const xIdx = monthlyData.length + f - 1
    result.push({
      month: key,
      value: Math.max(0, Math.round(predict(xIdx))),
      predicted: Math.max(0, Math.round(predict(xIdx))),
      isForecast: true,
    })
  }

  return result
}

// ── Domain-Specific Metrics ───────────────────────────────────────────────────

/**
 * Cost for a single record using the record's own cost_per_tyre field.
 * Falls back to 0 if cost_per_tyre is absent. Per ROW: when summing rows, pass
 * them through withOnePricePerTyre() first so a refit is not bought twice
 * (rule T1). Fleet spend TOTALS come from the expense grid, not from this.
 */
export function recordCost(r) {
  return (r.cost_per_tyre || 0) * (r.qty || 1)
}

const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Collapse fitment rows into physical tyres ONCE, then group the tyres by
 * keyFn(tyre) (the tyre's LATEST fitment row). Returns Map<key, tyre[]>.
 * Never group rows first and collapse inside each group: one tyre refitted on
 * two sites would then be split across both.
 */
export function lifetimeGroups(records = [], keyFn = () => 'All') {
  const groups = new Map()
  for (const t of toLifetimeTyres(records || [])) {
    const k = keyFn(t) ?? 'Unknown'
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(t)
  }
  return groups
}

/**
 * Physical-tyre figures for a set of lifetime tyres (from toLifetimeTyres).
 *   tyres            physical tyres (sum of _qty)
 *   pricedTyres      physical tyres with a purchase price
 *   purchaseCost     purchase cost, each tyre ONCE (null when none priced)
 *   avgCostPerTyre   purchaseCost / pricedTyres (null when none priced)
 *   lifetimeCpk      WEIGHTED purchase CPK = total cost / total tyre-km (null when not measurable)
 *   avgLifeKm        mean lifetime km over physical tyres that have a measured life
 *                    (qty-weighted; null when none)
 *   lifeKmTyres      physical tyres behind avgLifeKm
 *   kmCoverage       { complete, partial, none } tyre counts
 *   provisionalTyres tyres still fitted or with incomplete km (figure not final)
 *   estimatedShare   share of the CPK cost that is an ESTIMATED price (null when none)
 *   cpkKind / cpkKindLabel  the KPI kind (fleet aggregate, weighted per tyre-km)
 */
export function lifetimeMetrics(tyres = []) {
  const s = lifetimeSummary(tyres)
  let count = 0; let pricedTyres = 0; let purchaseCost = 0; let lifeSum = 0; let lifeTyres = 0
  for (const t of tyres) {
    const q = t._qty || 1
    count += q
    const c = numOrNull(t._cost)
    if (c != null && c > 0) { pricedTyres += q; purchaseCost += c * q }
    const life = numOrNull(t._life_km)
    if (life != null && life > 0) { lifeSum += life * q; lifeTyres += q }
  }
  return {
    tyres: count,
    pricedTyres,
    purchaseCost: pricedTyres ? purchaseCost : null,
    avgCostPerTyre: pricedTyres ? purchaseCost / pricedTyres : null,
    lifetimeCpk: s.cpkPurchase,
    lifetimeCpkFull: s.cpkFull,
    avgLifeKm: lifeTyres ? lifeSum / lifeTyres : null,
    lifeKmTyres: lifeTyres,
    measurableTyres: s.measurable,
    kmCoverage: s.coverage,
    provisionalTyres: s.provisional,
    estimatedShare: s.estimatedShare,
    cpkKind: CPK_KIND.FLEET_AGGREGATE,
    cpkKindLabel: CPK_KIND_LABEL[CPK_KIND.FLEET_AGGREGATE],
  }
}

const EMPTY_LIFETIME = Object.freeze(lifetimeMetrics([]))

/** Row money with a refit never priced twice (rule T1). */
function oneCost(r) {
  return (numOrNull(r.cost_per_tyre) || 0) * (r.qty || 1)
}

// 'Critical' is a real persisted risk_level - tyreClassifier assigns it to the
// WORST failures (blowout, separation). It was missing from this map, so
// RISK_WEIGHT[r.risk_level] fell through to the `|| 1` default and scored a
// critical tyre below a Medium one (1.5). It must outrank High.
const RISK_WEIGHT = { Critical: 4, High: 3, Medium: 1.5, Low: 1, Unknown: 0.5 }

/**
 * High-risk test used by every failure-rate metric here.
 *
 * Failure rate is "High + Critical" (the definition kpiEngine.computeFailureRate
 * documents and uses). Several metrics in this file previously tested
 * `risk_level === 'High'` alone, which silently EXCLUDED the most severe
 * failures - a brand whose tyres all blew out reported a 0% failure rate - and
 * disagreed with the sibling metrics further down this same file.
 */
const isHighRisk = (r) => r?.risk_level === 'High' || r?.risk_level === 'Critical'

/**
 * Compute per-brand metrics from tyre_records
 * `count` = fitment rows (records) - an EVENT count, kept per row.
 * Money (totalCost) is per row with each physical tyre priced ONCE.
 * Lifetime keys (tyres, avgCostPerTyre, lifetimeCpk, avgLifeKm, kmCoverage,
 * cpkKind, cpkKindLabel ...) are per PHYSICAL tyre, grouped by the brand of the
 * tyre's latest fitment. `avgCost` = purchase cost per physical tyre (null when
 * no tyre of the brand is priced).
 * @returns {{ brand, count, fitments, totalCost, avgCost, highRiskCount, failureRate,
 *             topCategory, avgLifeDays, riskScore, rankScore, tyres, lifetimeCpk, avgLifeKm }[]}
 */
export function computeBrandMetrics(records, _defaultCost) {
  const byBrand = groupBy(withOnePricePerTyre(records || []), r => r.brand || 'Unknown')
  const tyreGroups = lifetimeGroups(records, t => t.brand || 'Unknown')

  return Object.entries(byBrand).map(([brand, recs]) => {
    const count      = recs.length
    const totalCost  = sum(recs.map(oneCost))
    const life       = tyreGroups.has(brand) ? lifetimeMetrics(tyreGroups.get(brand)) : EMPTY_LIFETIME
    const avgCost    = life.avgCostPerTyre
    const highRisk   = recs.filter(isHighRisk).length
    const failureRate = count ? (highRisk / count) * 100 : 0

    // Top failure category
    const catCounts = countBy(recs.filter(r => r.category), r => r.category)
    const topCategory = catCounts[0]?.key || 'Unknown'

    // Average days between fitments of the brand (a replacement-interval proxy,
    // per fitment EVENT; tyre life in km is avgLifeKm below).
    const dates = recs
      .map(r => r.issue_date ? new Date(r.issue_date) : null)
      .filter(Boolean)
      .sort((a, b) => a - b)
    const avgLifeDays = dates.length > 1
      ? (dates[dates.length - 1] - dates[0]) / (1000 * 86400) / dates.length
      : 0

    // Weighted risk score
    const riskScore = count
      ? recs.reduce((s, r) => s + (RISK_WEIGHT[r.risk_level] || 1), 0) / count
      : 0

    // rankScore: lower failure rate + lower risk + higher count = better
    const rankScore = (100 - failureRate) - riskScore * 10 + Math.log1p(count)

    return { ...life, brand, count, fitments: count, totalCost, avgCost, highRiskCount: highRisk,
             failureRate, topCategory, avgLifeDays, riskScore, rankScore }
  }).sort((a, b) => b.count - a.count)
}

/**
 * Compute per-site metrics
 * `count` = fitment rows (events). totalCost / monthlyTrend are per row with each
 * physical tyre priced once. Lifetime keys are per physical tyre grouped by the
 * site of the tyre's latest fitment; `avgCost` = purchase cost per physical tyre.
 * @returns {{ site, count, totalCost, avgCost, highRiskCount, riskScore,
 *             highRiskPct, topCategory, topBrand, monthlyTrend, tyres, lifetimeCpk }[]}
 */
export function computeSiteMetrics(records, _defaultCost) {
  const bySite = groupBy(withOnePricePerTyre(records || []), r => r.site || 'Unknown')
  const tyreGroups = lifetimeGroups(records, t => t.site || 'Unknown')

  return Object.entries(bySite).map(([site, recs]) => {
    const count     = recs.length
    const totalCost = sum(recs.map(oneCost))
    const life      = tyreGroups.has(site) ? lifetimeMetrics(tyreGroups.get(site)) : EMPTY_LIFETIME
    const avgCost   = life.avgCostPerTyre
    const highRisk  = recs.filter(isHighRisk).length
    const highRiskPct = count ? (highRisk / count) * 100 : 0

    const catCounts  = countBy(recs.filter(r => r.category), r => r.category)
    const brandCounts = countBy(recs.filter(r => r.brand), r => r.brand)

    const monthly = bucketByMonth(recs, r => r.issue_date, oneCost)

    const riskScore = count
      ? recs.reduce((s, r) => s + (RISK_WEIGHT[r.risk_level] || 1), 0) / count
      : 0

    return {
      ...life,
      site, count, fitments: count, totalCost, avgCost,
      highRiskCount: highRisk, highRiskPct,
      topCategory: catCounts[0]?.key || 'Unknown',
      topBrand: brandCounts[0]?.key || 'Unknown',
      monthlyTrend: monthly,
      riskScore,
    }
  }).sort((a, b) => b.totalCost - a.totalCost)
}

/**
 * Compute per-asset metrics
 * `count` / failureFreqPerMonth = fitment EVENTS on the asset. totalCost is per
 * row with each physical tyre priced once (the purchase sits on the vehicle it
 * was first fitted to). Lifetime keys are per physical tyre whose LATEST fitment
 * is on this asset.
 * @returns {{ assetNo, count, totalCost, highRiskCount, lastSeen,
 *             brands, sites, categories, failureFreqPerMonth, tyres, lifetimeCpk }[]}
 */
export function computeAssetMetrics(records, _defaultCost) {
  const byAsset = groupBy(withOnePricePerTyre(records || []), r => r.asset_no || 'Unknown')
  const tyreGroups = lifetimeGroups(records, t => t.asset_no || 'Unknown')

  return Object.entries(byAsset).map(([assetNo, recs]) => {
    const count     = recs.length
    const totalCost = sum(recs.map(oneCost))
    const highRisk  = recs.filter(isHighRisk).length
    const life      = tyreGroups.has(assetNo) ? lifetimeMetrics(tyreGroups.get(assetNo)) : EMPTY_LIFETIME

    const dates = recs
      .map(r => r.issue_date ? new Date(r.issue_date) : null)
      .filter(Boolean)
      .sort((a, b) => a - b)

    const lastSeen = dates[dates.length - 1]?.toISOString().split('T')[0] || null
    const firstSeen = dates[0]?.toISOString().split('T')[0] || null

    const spanMonths = dates.length > 1
      ? (dates[dates.length - 1] - dates[0]) / (1000 * 86400 * 30)
      : 1
    const failureFreqPerMonth = spanMonths > 0 ? count / spanMonths : count

    return {
      ...life,
      assetNo, count, fitments: count, totalCost,
      highRiskCount: highRisk,
      lastSeen, firstSeen,
      brands:     [...new Set(recs.map(r => r.brand).filter(Boolean))],
      sites:      [...new Set(recs.map(r => r.site).filter(Boolean))],
      categories: [...new Set(recs.map(r => r.category).filter(Boolean))],
      records:    recs.sort((a, b) => new Date(b.issue_date) - new Date(a.issue_date)),
      failureFreqPerMonth,
      spanMonths,
    }
  }).sort((a, b) => b.count - a.count)
}

/**
 * Monthly cost + count with forecasts. Count = fitment events; cost per row with
 * each physical tyre priced once (a refit adds no purchase).
 * @param {Array}  records
 * @param {number} forecastMonths
 */
export function monthlyTrendWithForecast(records, forecastMonths = 3, _defaultCost) {
  const buckets = bucketByMonth(
    withOnePricePerTyre(records || []),
    r => r.issue_date,
    oneCost
  )
  if (buckets.length < 2) return buckets.map(b => ({ ...b, isForecast: false }))
  return forecastMonthly(buckets, forecastMonths, 'total')
}

/**
 * KPI actuals: compute real values from records for a given month (YYYY-MM)
 * count / highRisk = fitment events in the month. totalCost = purchases in the
 * month with each physical tyre priced once (a refit is not a purchase).
 * avgCostPerTyre = totalCost / priced tyres in the month (qty honoured; null
 * when nothing in the month is priced).
 */
export function computeMonthlyKpiActuals(records, actions, month, _defaultCost) {
  const monthRecs = withOnePricePerTyre(records || []).filter(r => {
    if (!r.issue_date) return false
    const d = new Date(r.issue_date)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === month
  })

  const totalCost    = sum(monthRecs.map(oneCost))
  const highRiskCount = monthRecs.filter(isHighRisk).length
  const count        = monthRecs.length
  const pricedTyres  = sum(monthRecs.filter(r => (numOrNull(r.cost_per_tyre) || 0) > 0).map(r => r.qty || 1))

  const overdueActions = (actions || []).filter(a => {
    if (!a.due_date || a.status === 'Closed') return false
    return new Date(a.due_date) < new Date()
  }).length

  return {
    month,
    totalCost,
    count,
    highRiskCount,
    highRiskPct: count ? (highRiskCount / count) * 100 : 0,
    overdueActions,
    avgCostPerTyre: pricedTyres ? totalCost / pricedTyres : null,
    pricedTyres,
  }
}

/**
 * Weighted composite risk score for a set of records (0-100)
 * Used for site-level and overall risk dashboards
 */
export function weightedRiskScore(records) {
  if (!records.length) return 0
  const total = records.reduce((s, r) => s + (RISK_WEIGHT[r.risk_level] || 1), 0)
  const maxPossible = records.length * 3
  return Math.round((total / maxPossible) * 100)
}

/**
 * Detect risk spike: compare last N records to prior N records
 * Returns { isSpike, deltaPct, current, prior }
 */
export function detectRiskSpike(records, windowSize = 50) {
  if (records.length < windowSize * 2) return { isSpike: false, deltaPct: 0, current: 0, prior: 0 }
  const sorted = [...records].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  const recent = sorted.slice(0, windowSize)
  const prior  = sorted.slice(windowSize, windowSize * 2)

  const recentHR = recent.filter(isHighRisk).length / windowSize * 100
  const priorHR  = prior.filter(isHighRisk).length / windowSize * 100
  const deltaPct = priorHR === 0 ? recentHR : ((recentHR - priorHR) / priorHR) * 100

  return {
    isSpike: deltaPct > 25,
    deltaPct: Math.round(deltaPct),
    current: Math.round(recentHR),
    prior: Math.round(priorHR),
  }
}

/**
 * Build radar chart data for site comparison
 * Dimensions: Cost Efficiency, Risk Score, Volume, Freshness, Diversity
 */
export function buildSiteRadar(siteMetrics) {
  if (!siteMetrics.length) return { labels: [], datasets: [] }

  const allCosts  = siteMetrics.map(s => s.totalCost)
  const maxCost   = Math.max(...allCosts) || 1
  const allCounts = siteMetrics.map(s => s.count)
  const maxCount  = Math.max(...allCounts) || 1

  const COLORS = [
    'rgba(59,130,246,0.6)', 'rgba(16,185,129,0.6)', 'rgba(245,158,11,0.6)',
    'rgba(239,68,68,0.6)',  'rgba(139,92,246,0.6)', 'rgba(236,72,153,0.6)',
  ]

  const datasets = siteMetrics.map((s, i) => ({
    label: s.site,
    data: [
      Math.round((1 - s.totalCost / maxCost) * 100),   // Cost Efficiency (lower cost = higher score)
      Math.round((1 - s.highRiskPct / 100) * 100),     // Safety (lower high risk = higher score)
      Math.round((s.count / maxCount) * 100),           // Volume
      Math.round((1 - s.riskScore / 3) * 100),          // Risk Quality
      Math.min(100, Math.round((s.topCategory !== 'Unknown' ? 80 : 40))), // Data Quality
    ],
    backgroundColor: COLORS[i % COLORS.length],
    borderColor: COLORS[i % COLORS.length].replace('0.6', '1'),
    borderWidth: 2,
  }))

  return {
    labels: ['Cost Efficiency', 'Safety', 'Volume', 'Risk Quality', 'Data Quality'],
    datasets,
  }
}

/**
 * PER-FITMENT CPK (CPK_KIND.PER_FITMENT): one stint's cost / that stint's km.
 * Returns null if km data is missing or invalid. Legitimate ONLY where a screen
 * is explicitly about one fitment, and then the row should come from
 * withOnePricePerTyre() so a refit is not priced again. For tyre or fleet CPK use
 * the lifetime layer (lifetimeMetrics / weightedCpk), never an average of this.
 */
export function recordCpk(record) {
  // THE single per-fitment rule (tyreKm): placeholder "1" -> N/A, factory "0" ->
  // real km, over class cap -> N/A, null never 0. The old inline removal-minus-
  // fitment copy here dropped factory-0 fitments and priced placeholder "1" /
  // over-cap rows at a misleadingly low cost per km.
  return fitmentCpk(record)
}

/**
 * Compute per-country summary metrics.
 * `count` = fitment rows (events); totalCost = per row with each physical tyre
 * priced once. avgCpk is the WEIGHTED physical-tyre lifetime CPK of the country
 * (fleet aggregate, total purchase cost / total tyre-km; null when not
 * measurable); avgCostPerTyre = purchase cost per priced physical tyre. Each
 * country is its own currency, so nothing here is summed across countries.
 * Returns array sorted by totalCost desc.
 */
export function computeCountryMetrics(records, actions = [], _defaultCost) {
  const priced    = withOnePricePerTyre(records || [])
  const countries = [...new Set(priced.map(r => r.country || 'KSA'))]
  const tyreGroups = lifetimeGroups(records, t => t.country || 'KSA')

  return countries.map(country => {
    const recs      = priced.filter(r => (r.country || 'KSA') === country)
    const count     = recs.length
    const totalCost = sum(recs.map(oneCost))
    const highRisk  = recs.filter(isHighRisk).length
    const highRiskPct = count ? (highRisk / count) * 100 : 0
    const life      = tyreGroups.has(country) ? lifetimeMetrics(tyreGroups.get(country)) : EMPTY_LIFETIME

    const openActions = actions.filter(a =>
      (a.country || 'KSA') === country && a.status !== 'Closed'
    ).length

    const overdueActions = actions.filter(a =>
      (a.country || 'KSA') === country &&
      a.status !== 'Closed' &&
      a.due_date && new Date(a.due_date) < new Date()
    ).length

    const brands = [...new Set(recs.map(r => r.brand).filter(Boolean))]
    const sites  = [...new Set(recs.map(r => r.site).filter(Boolean))]

    return {
      ...life,
      country, count, fitments: count, totalCost, highRiskPct,
      avgCpk: life.lifetimeCpk, openActions, overdueActions,
      brandCount: brands.length, siteCount: sites.length,
      avgCostPerTyre: life.avgCostPerTyre,
    }
  }).sort((a, b) => b.totalCost - a.totalCost)
}

// ── Intelligence Functions ────────────────────────────────────────────────────

/**
 * Fleet and per-brand CPK over PHYSICAL tyres (rows collapsed first, tyres
 * grouped by the brand of their latest fitment). avgCpk / byBrand[].avgCpk are
 * WEIGHTED (total cost / total tyre-km); medianCpk is the median of per-tyre
 * lifetime CPK. validCount / count = measurable physical tyres. null when fewer
 * than 3 tyres are measurable.
 */
export function computeCpkAnalysis(records) {
  const tyres = toLifetimeTyres(records || []).filter(t => lifetimeCpk(t) != null)
  if (tyres.length < 3) return null
  const s = lifetimeSummary(tyres)
  const byBrand = new Map()
  tyres.forEach(t => {
    if (!t.brand) return
    if (!byBrand.has(t.brand)) byBrand.set(t.brand, [])
    byBrand.get(t.brand).push(t)
  })
  return {
    avgCpk: s.cpkPurchase,
    medianCpk: median(tyres.map(lifetimeCpk)),
    validCount: s.measurable,
    cpkKind: CPK_KIND.FLEET_AGGREGATE,
    cpkKindLabel: CPK_KIND_LABEL[CPK_KIND.FLEET_AGGREGATE],
    kmCoverage: s.coverage,
    byBrand: [...byBrand.entries()]
      .map(([brand, ts]) => ({ brand, avgCpk: lifetimeSummary(ts).cpkPurchase, count: ts.length }))
      .sort((a, b) => a.avgCpk - b.avgCpk),
  }
}

export function computeFleetHealthScore(records) {
  if (!records.length) return 0
  const highRiskRate = records.filter(isHighRisk).length / records.length
  const blowoutRate = records.filter(r => r.category==='Blowout').length / records.length
  return Math.max(0, Math.min(100, Math.round(100 - highRiskRate*40 - blowoutRate*30)))
}

/**
 * Per calendar month: count / highRisk / blowouts are fitment EVENTS; cost is
 * per row with each physical tyre priced once (a refit is not a purchase).
 */
export function computeSeasonalTrends(records) {
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const byMonth = {}
  withOnePricePerTyre(records || []).forEach(r => {
    if (!r.issue_date) return
    const m = r.issue_date.substring(5,7)
    if (!byMonth[m]) byMonth[m] = { count:0, cost:0, highRisk:0, blowouts:0 }
    byMonth[m].count++
    byMonth[m].cost += recordCost(r)
    if (isHighRisk(r)) byMonth[m].highRisk++
    if (r.category==='Blowout') byMonth[m].blowouts++
  })
  return Array.from({length:12},(_,i) => {
    const key = String(i+1).padStart(2,'0')
    const d = byMonth[key] || {count:0,cost:0,highRisk:0,blowouts:0}
    return { month:monthNames[i], key, ...d, highRiskRate: d.count ? d.highRisk/d.count : 0 }
  })
}

/**
 * Tyre life.
 *   avgLifeKm / medianLifeKm: PHYSICAL tyre lifetime km (sum of the tyre's
 *     non-overlapping fitments by the shared km rule), mean / median over tyres
 *     with a measured life, qty-weighted. null when none is measurable.
 *   avgLifeDays / medianLifeDays / shortLifeCount / totalSamples: days between
 *     successive fitments on the same asset - a replacement INTERVAL per fitment
 *     event, kept per row on purpose.
 */
export function computeTyreLifeAnalysis(records) {
  const byAsset = {}
  records.forEach(r => {
    if (!r.asset_no||!r.issue_date) return
    if (!byAsset[r.asset_no]) byAsset[r.asset_no] = []
    byAsset[r.asset_no].push(r)
  })
  const lifeDays = []
  Object.values(byAsset).forEach(recs => {
    const sorted = [...recs].sort((a,b)=>new Date(a.issue_date)-new Date(b.issue_date))
    for (let i=1;i<sorted.length;i++) {
      const d = (new Date(sorted[i].issue_date)-new Date(sorted[i-1].issue_date))/86400000
      if (d>0&&d<3650) lifeDays.push(d)
    }
  })
  const tyres = toLifetimeTyres(records)
  const kmLives = []
  tyres.forEach(t => {
    const life = numOrNull(t._life_km)
    if (life == null || life <= 0) return
    for (let q = 0; q < (t._qty || 1); q++) kmLives.push(life)
  })
  const s = lifetimeSummary(tyres)
  return {
    avgLifeDays: lifeDays.length ? Math.round(mean(lifeDays)) : null,
    medianLifeDays: lifeDays.length ? Math.round(median(lifeDays)) : null,
    avgLifeKm: kmLives.length ? Math.round(mean(kmLives)) : null,
    medianLifeKm: kmLives.length ? Math.round(median(kmLives)) : null,
    lifeKmTyres: kmLives.length,
    lifeKmBasis: 'physical_tyre',
    kmCoverage: s.coverage,
    provisionalTyres: s.provisional,
    shortLifeCount: lifeDays.filter(d=>d<30).length,
    totalSamples: lifeDays.length,
  }
}
