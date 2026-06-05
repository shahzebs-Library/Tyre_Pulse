// ─────────────────────────────────────────────────────────────────────────────
// analyticsEngine.js — Pure stats + aggregation engine (no AI tokens)
// All functions are stateless; pass data in, get results out.
// ─────────────────────────────────────────────────────────────────────────────

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

  const slope     = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX ** 2)
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
 * Falls back to 0 if cost_per_tyre is absent.
 */
export function recordCost(r) {
  return (r.cost_per_tyre || 0) * (r.qty || 1)
}

const RISK_WEIGHT = { High: 3, Medium: 1.5, Low: 1, Unknown: 0.5 }

/**
 * Compute per-brand metrics from tyre_records
 * @returns {{ brand, count, totalCost, avgCost, highRiskCount, failureRate,
 *             topCategory, avgLifeDays, riskScore, rankScore }[]}
 */
export function computeBrandMetrics(records, _defaultCost) {
  const byBrand = groupBy(records, r => r.brand || 'Unknown')

  return Object.entries(byBrand).map(([brand, recs]) => {
    const count      = recs.length
    const totalCost  = sum(recs.map(r => (r.cost_per_tyre || 0) * (r.qty || 1)))
    const avgCost    = count ? totalCost / count : 0
    const highRisk   = recs.filter(r => r.risk_level === 'High').length
    const failureRate = count ? (highRisk / count) * 100 : 0

    // Top failure category
    const catCounts = countBy(recs.filter(r => r.category), r => r.category)
    const topCategory = catCounts[0]?.key || 'Unknown'

    // Average life: days from issue_date range per brand (proxy for lifespan data)
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

    return { brand, count, totalCost, avgCost, highRiskCount: highRisk,
             failureRate, topCategory, avgLifeDays, riskScore, rankScore }
  }).sort((a, b) => b.count - a.count)
}

/**
 * Compute per-site metrics
 * @returns {{ site, count, totalCost, avgCost, highRiskCount, riskScore,
 *             highRiskPct, topCategory, topBrand, monthlyTrend }[]}
 */
export function computeSiteMetrics(records, _defaultCost) {
  const bySite = groupBy(records, r => r.site || 'Unknown')

  return Object.entries(bySite).map(([site, recs]) => {
    const count     = recs.length
    const totalCost = sum(recs.map(r => (r.cost_per_tyre || 0) * (r.qty || 1)))
    const avgCost   = count ? totalCost / count : 0
    const highRisk  = recs.filter(r => r.risk_level === 'High').length
    const highRiskPct = count ? (highRisk / count) * 100 : 0

    const catCounts  = countBy(recs.filter(r => r.category), r => r.category)
    const brandCounts = countBy(recs.filter(r => r.brand), r => r.brand)

    const monthly = bucketByMonth(recs, r => r.issue_date, r => (r.cost_per_tyre || 0) * (r.qty || 1))

    const riskScore = count
      ? recs.reduce((s, r) => s + (RISK_WEIGHT[r.risk_level] || 1), 0) / count
      : 0

    return {
      site, count, totalCost, avgCost,
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
 * @returns {{ assetNo, count, totalCost, highRiskCount, lastSeen,
 *             brands, sites, categories, failureFreqPerMonth }[]}
 */
export function computeAssetMetrics(records, _defaultCost) {
  const byAsset = groupBy(records, r => r.asset_no || 'Unknown')

  return Object.entries(byAsset).map(([assetNo, recs]) => {
    const count     = recs.length
    const totalCost = sum(recs.map(r => (r.cost_per_tyre || 0) * (r.qty || 1)))
    const highRisk  = recs.filter(r => r.risk_level === 'High').length

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
      assetNo, count, totalCost,
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
 * Monthly cost + count with forecasts
 * @param {Array}  records
 * @param {number} forecastMonths
 */
export function monthlyTrendWithForecast(records, forecastMonths = 3, _defaultCost) {
  const buckets = bucketByMonth(
    records,
    r => r.issue_date,
    r => (r.cost_per_tyre || 0) * (r.qty || 1)
  )
  if (buckets.length < 2) return buckets.map(b => ({ ...b, isForecast: false }))
  return forecastMonthly(buckets, forecastMonths, 'total')
}

/**
 * KPI actuals: compute real values from records for a given month (YYYY-MM)
 */
export function computeMonthlyKpiActuals(records, actions, month, _defaultCost) {
  const monthRecs = records.filter(r => {
    if (!r.issue_date) return false
    const d = new Date(r.issue_date)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === month
  })

  const totalCost    = sum(monthRecs.map(r => (r.cost_per_tyre || 0) * (r.qty || 1)))
  const highRiskCount = monthRecs.filter(r => r.risk_level === 'High').length
  const count        = monthRecs.length

  const overdueActions = actions.filter(a => {
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
    avgCostPerTyre: count ? totalCost / count : 0,
  }
}

/**
 * Weighted composite risk score for a set of records (0–100)
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

  const recentHR = recent.filter(r => r.risk_level === 'High').length / windowSize * 100
  const priorHR  = prior.filter(r => r.risk_level === 'High').length / windowSize * 100
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
 * Compute CPK (Cost Per Kilometre) for a single record.
 * Returns null if km data is missing or invalid.
 */
export function recordCpk(record) {
  const kmRun = (record.km_at_removal ?? 0) - (record.km_at_fitment ?? 0)
  if (kmRun <= 0 || !record.km_at_fitment || !record.km_at_removal) return null
  return (record.cost_per_tyre || 0) / kmRun
}

/**
 * Compute per-country summary metrics.
 * Returns array sorted by totalCost desc.
 */
export function computeCountryMetrics(records, actions = [], _defaultCost) {
  const countries = [...new Set(records.map(r => r.country || 'KSA'))]

  return countries.map(country => {
    const recs      = records.filter(r => (r.country || 'KSA') === country)
    const count     = recs.length
    const totalCost = sum(recs.map(r => (r.cost_per_tyre || 0) * (r.qty || 1)))
    const highRisk  = recs.filter(r => r.risk_level === 'High' || r.risk_level === 'Critical').length
    const highRiskPct = count ? (highRisk / count) * 100 : 0

    const cpkValues = recs.map(r => recordCpk(r)).filter(v => v !== null)
    const avgCpk    = cpkValues.length ? mean(cpkValues) : null

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
      country, count, totalCost, highRiskPct,
      avgCpk, openActions, overdueActions,
      brandCount: brands.length, siteCount: sites.length,
      avgCostPerTyre: count ? totalCost / count : 0,
    }
  }).sort((a, b) => b.totalCost - a.totalCost)
}

// ── Intelligence Functions ────────────────────────────────────────────────────

export function computeCpkAnalysis(records) {
  const valid = records.filter(r =>
    (r.cost_per_tyre||0) > 0 && (r.km_at_fitment||0) >= 0 && (r.km_at_removal||0) > (r.km_at_fitment||0)
  )
  if (valid.length < 3) return null
  const cpks = valid.map(r => r.cost_per_tyre / (r.km_at_removal - r.km_at_fitment))
  const avgCpk = mean(cpks)
  const byBrand = {}
  valid.forEach(r => {
    if (!r.brand) return
    if (!byBrand[r.brand]) byBrand[r.brand] = []
    byBrand[r.brand].push(r.cost_per_tyre / (r.km_at_removal - r.km_at_fitment))
  })
  return {
    avgCpk, medianCpk: median(cpks), validCount: valid.length,
    byBrand: Object.entries(byBrand)
      .map(([brand, vals]) => ({ brand, avgCpk: mean(vals), count: vals.length }))
      .sort((a, b) => a.avgCpk - b.avgCpk),
  }
}

export function computeFleetHealthScore(records) {
  if (!records.length) return 0
  const highRiskRate = records.filter(r => r.risk_level==='High'||r.risk_level==='Critical').length / records.length
  const blowoutRate = records.filter(r => r.category==='Blowout').length / records.length
  return Math.max(0, Math.min(100, Math.round(100 - highRiskRate*40 - blowoutRate*30)))
}

export function computeSeasonalTrends(records) {
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const byMonth = {}
  records.forEach(r => {
    if (!r.issue_date) return
    const m = r.issue_date.substring(5,7)
    if (!byMonth[m]) byMonth[m] = { count:0, cost:0, highRisk:0, blowouts:0 }
    byMonth[m].count++
    byMonth[m].cost += recordCost(r)
    if (r.risk_level==='High'||r.risk_level==='Critical') byMonth[m].highRisk++
    if (r.category==='Blowout') byMonth[m].blowouts++
  })
  return Array.from({length:12},(_,i) => {
    const key = String(i+1).padStart(2,'0')
    const d = byMonth[key] || {count:0,cost:0,highRisk:0,blowouts:0}
    return { month:monthNames[i], key, ...d, highRiskRate: d.count ? d.highRisk/d.count : 0 }
  })
}

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
  const kmLives = records
    .filter(r=>(r.km_at_fitment||0)>=0&&(r.km_at_removal||0)>(r.km_at_fitment||0))
    .map(r=>r.km_at_removal-r.km_at_fitment)
  return {
    avgLifeDays: lifeDays.length ? Math.round(mean(lifeDays)) : null,
    medianLifeDays: lifeDays.length ? Math.round(median(lifeDays)) : null,
    avgLifeKm: kmLives.length ? Math.round(mean(kmLives)) : null,
    shortLifeCount: lifeDays.filter(d=>d<30).length,
    totalSamples: lifeDays.length,
  }
}
