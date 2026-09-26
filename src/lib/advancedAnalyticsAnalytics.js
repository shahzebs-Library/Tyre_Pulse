/**
 * Advanced Analytics engine (pure, no I/O).
 *
 * Every tab on /advanced-analytics is derived from the same tyre_records rows.
 * The maths used to live inline in the page's useMemo blocks; it lives here so
 * it can be tested and so the page only renders. `now` is injectable so the
 * date presets are deterministic under test.
 *
 * Honesty rules:
 *   - a rate over zero records is null (N/A), never 0
 *   - an average over zero measurable values is null, never 0
 *   - the per-month cost/failure shapes keep null for months with no records
 */
import {
  mean, stdDev, sum, groupBy, bucketByMonth, rollingAverage,
  linearRegression, computeSiteMetrics, computeBrandMetrics,
  computeAssetMetrics, computeSeasonalTrends, recordCost, recordCpk,
} from './analyticsEngine'

export const DATE_PRESETS = [
  { id: '3mo', label: 'Last 3 Mo' },
  { id: '6mo', label: 'Last 6 Mo' },
  { id: '1yr', label: 'Last 1 Yr' },
  { id: '2yr', label: 'Last 2 Yr' },
  { id: 'all', label: 'All Time' },
]

export const POSITIONS = ['All', 'Steer', 'Drive', 'Trailer', 'Other']

const PRESET_MONTHS = { '3mo': 3, '6mo': 6, '1yr': 12, '2yr': 24 }

/** High + Critical is the failure definition used everywhere in this app. */
export function isHighRisk(r) {
  return r?.risk_level === 'High' || r?.risk_level === 'Critical'
}

/** Local-calendar YYYY-MM-DD (toISOString is UTC and shifts the day). */
export function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Start date of a preset window, or null for 'all'. Unknown presets = 1 year. */
export function cutoffDate(preset, now = new Date()) {
  if (preset === 'all') return null
  const months = PRESET_MONTHS[preset] ?? 12
  const d = new Date(now)
  d.setMonth(d.getMonth() - months)
  return isoDay(d)
}

/** Distance run by one tyre (removal minus fitment), null when not measurable. */
export function kmLife(r) {
  const fit = r?.km_at_fitment || 0
  const rem = r?.km_at_removal || 0
  return fit >= 0 && rem > fit ? rem - fit : null
}

function avgOrNull(values) {
  const v = values.filter(x => x != null && Number.isFinite(x))
  return v.length ? mean(v) : null
}

function rateOrNull(part, whole) {
  return whole ? (part / whole) * 100 : null
}

function avgCpkOf(recs) {
  return avgOrNull(recs.map(r => recordCpk(r)))
}

function avgLifeOf(recs) {
  return avgOrNull(recs.map(kmLife))
}

function matchesPosition(r, positionFilter) {
  if (!positionFilter || positionFilter === 'all') return true
  const pos = (r.position || '').toLowerCase()
  if (positionFilter === 'Other') return !['steer', 'drive', 'trailer'].some(p => pos.includes(p))
  return pos.includes(positionFilter.toLowerCase())
}

function matchesSearch(r, term) {
  if (!term) return true
  const q = term.trim().toLowerCase()
  if (!q) return true
  return [r.asset_no, r.site, r.brand, r.category, r.position]
    .some(v => v != null && String(v).toLowerCase().includes(q))
}

/** Applies the page filters. Same predicates the page always used, plus search. */
export function filterRecords(records, { preset = '1yr', site = 'all', position = 'all', search = '' } = {}, now = new Date()) {
  const cutoff = cutoffDate(preset, now)
  return (records || []).filter(r => {
    if (cutoff && r.issue_date && r.issue_date < cutoff) return false
    if (site !== 'all' && r.site !== site) return false
    if (!matchesPosition(r, position)) return false
    return matchesSearch(r, search)
  })
}

export function uniqueSites(records) {
  return [...new Set((records || []).map(r => r.site).filter(Boolean))].sort()
}

/** Headline KPI strip for the current filter set. */
export function summarizeKpis(filtered) {
  const recs = filtered || []
  const count = recs.length
  const high = recs.filter(isHighRisk).length
  return {
    records: count,
    totalCost: count ? sum(recs.map(r => recordCost(r))) : null,
    avgCpk: avgCpkOf(recs),
    avgLife: avgLifeOf(recs),
    failureRate: rateOrNull(high, count),
    highRisk: high,
    sites: new Set(recs.map(r => r.site).filter(Boolean)).size,
    vehicles: new Set(recs.map(r => r.asset_no).filter(Boolean)).size,
  }
}

/** Linear forecast of the next `futureCount` points. Gaps count as 0 (as before). */
export function applyLR(values, futureCount = 3) {
  const lr = linearRegression(values.map((v, i) => [i, v ?? 0]))
  const forecast = []
  for (let i = 0; i < futureCount; i++) forecast.push(Math.max(0, lr.predict(values.length + i)))
  return { forecast, slope: lr.slope }
}

/** 'improving' | 'worsening' | 'stable' from a regression slope. */
export function trendDirection(slope) {
  if (slope > 0.001) return 'worsening'
  if (slope < -0.001) return 'improving'
  return 'stable'
}

export function addForecastMonthLabels(existing, count) {
  const last = existing[existing.length - 1]
  if (!last) return []
  const [yr, mo] = last.split('-').map(Number)
  const labels = []
  for (let i = 1; i <= count; i++) {
    const d = new Date(yr, mo - 1 + i, 1)
    labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')} (F)`)
  }
  return labels
}

// ── Tab builders ─────────────────────────────────────────────────────────────

export function buildTrend(filtered, forecastMonths = 3) {
  if (!filtered?.length) return null
  const last24 = bucketByMonth(filtered, r => r.issue_date, r => recordCost(r)).slice(-24)
  if (!last24.length) return null
  const labels = last24.map(b => b.month)
  const costVals = last24.map(b => b.total)
  const countVals = last24.map(b => b.count)
  const cpkVals = last24.map(b => avgCpkOf(b.items))
  const failRateVals = last24.map(b => rateOrNull(b.items.filter(isHighRisk).length, b.count) ?? 0)
  const movAvgCpk = rollingAverage(cpkVals.map(v => v ?? 0), 3)
  const cpkForecast = applyLR(cpkVals, forecastMonths)
  const failForecast = applyLR(failRateVals, forecastMonths)
  const countForecast = applyLR(countVals, forecastMonths)
  return {
    labels,
    fLabels: addForecastMonthLabels(labels, forecastMonths),
    costVals, countVals, cpkVals, failRateVals, movAvgCpk,
    cpkForecast, failForecast, countForecast,
    directions: {
      cpk: trendDirection(cpkForecast.slope),
      fail: trendDirection(failForecast.slope),
      count: trendDirection(countForecast.slope),
    },
  }
}

export function buildSeasonal(filtered) {
  if (!filtered?.length) return null
  const seasons = computeSeasonalTrends(filtered).map(s => ({
    ...s,
    failPct: s.count ? s.highRiskRate * 100 : null,
    avgCost: s.count ? s.cost / s.count : null,
  }))
  const cpkByMonth = Array.from({ length: 12 }, (_, i) => {
    const mo = String(i + 1).padStart(2, '0')
    return avgCpkOf(filtered.filter(r => r.issue_date && r.issue_date.substring(5, 7) === mo))
  })
  const maxCost = Math.max(...seasons.map(s => s.cost), 1)
  const countMax = Math.max(...seasons.map(s => s.count), 1)
  const worstCostMonth = seasons.reduce((best, s) => (s.cost > best.cost ? s : best), seasons[0])
  return { seasons, cpkByMonth, maxCost, countMax, worstCostMonth: worstCostMonth?.cost > 0 ? worstCostMonth : null }
}

export function buildGeo(filtered) {
  if (!filtered?.length) return null
  const sites = computeSiteMetrics(filtered)
  const allMonths = bucketByMonth(filtered, r => r.issue_date).slice(-12).map(b => b.month)
  const heatmap = sites.slice(0, 15).map(s => {
    const recs = filtered.filter(r => r.site === s.site)
    const row = allMonths.map(mo => {
      const m = recs.filter(r => r.issue_date && r.issue_date.startsWith(mo))
      return m.length ? (m.filter(isHighRisk).length / m.length) * 100 : null
    })
    return { site: s.site, row }
  })
  const heatVals = heatmap.flatMap(r => r.row).filter(v => v !== null)
  return {
    sites, allMonths, heatmap,
    heatMin: Math.min(...heatVals, 0),
    heatMax: Math.max(...heatVals, 1),
  }
}

export function buildCountry(filtered) {
  if (!filtered?.length) return null
  const byRegion = {}
  Object.entries(groupBy(filtered, r => r.site || 'Unknown')).forEach(([site, recs]) => {
    const region = site.split(/[\s\-_]/)[0] || site
    if (!byRegion[region]) byRegion[region] = []
    byRegion[region].push(...recs)
  })
  const regions = Object.entries(byRegion).map(([region, recs]) => {
    const sites = [...new Set(recs.map(r => r.site).filter(Boolean))]
    return {
      region,
      count: recs.length,
      totalCost: sum(recs.map(r => recordCost(r))),
      avgCpk: avgCpkOf(recs),
      failRate: rateOrNull(recs.filter(isHighRisk).length, recs.length),
      siteCount: sites.length,
      sites: sites.join(', '),
    }
  }).sort((a, b) => b.totalCost - a.totalCost)
  return { regions }
}

export function buildBranch(filtered) {
  if (!filtered?.length) return null
  const branches = computeSiteMetrics(filtered).map(s => {
    const recs = filtered.filter(r => r.site === s.site)
    return { ...s, avgCpk: avgCpkOf(recs), avgLife: avgLifeOf(recs), failRate: rateOrNull(s.highRiskCount, s.count) }
  })
  const maxCpk = Math.max(...branches.map(b => b.avgCpk ?? 0), 1)
  const maxFail = Math.max(...branches.map(b => b.failRate ?? 0), 1)
  const maxLife = Math.max(...branches.map(b => b.avgLife ?? 0), 1)
  // Composite: CPK 40% + failure 30% + life 30%. An unmeasured component takes
  // the midpoint so it neither rewards nor punishes the branch.
  const scored = branches.map(b => {
    const cpkScore = b.avgCpk != null ? (1 - b.avgCpk / maxCpk) * 40 : 20
    const failScore = b.failRate != null ? (1 - b.failRate / maxFail) * 30 : 15
    const lifeScore = b.avgLife != null ? (b.avgLife / maxLife) * 30 : 15
    return { ...b, compositeScore: Math.round(cpkScore + failScore + lifeScore) }
  }).sort((a, b) => b.compositeScore - a.compositeScore)
  return { branches: scored.map((b, i) => ({ ...b, rank: i + 1 })) }
}

export function buildVehicle(filtered) {
  if (!filtered?.length) return null
  const enhanced = computeAssetMetrics(filtered).map(a => {
    const recs = filtered.filter(r => r.asset_no === a.assetNo)
    return { ...a, avgCpk: avgCpkOf(recs), avgLife: avgLifeOf(recs), failCount: recs.filter(isHighRisk).length }
  })
  const allCpk = enhanced.map(v => v.avgCpk).filter(v => v !== null)
  const cpkMean = allCpk.length ? mean(allCpk) : null
  const cpkSd = allCpk.length ? stdDev(allCpk) : 0
  const outlierThreshold = cpkMean != null ? cpkMean + 2 * cpkSd : null
  const vehicles = enhanced.map(v => ({
    ...v,
    isOutlier: outlierThreshold != null && v.avgCpk != null && v.avgCpk > outlierThreshold,
  }))
  const top20Cost = [...vehicles].sort((a, b) => b.totalCost - a.totalCost).slice(0, 20)
  return { vehicles, top20Cost, cpkMean, outlierThreshold, outlierCount: vehicles.filter(v => v.isOutlier).length }
}

export function buildDriver(filtered, vehicleData) {
  if (!filtered?.length) return null
  const assets = vehicleData?.vehicles ?? []
  const worst10 = [...assets].sort((a, b) => b.totalCost - a.totalCost).slice(0, 10)
    .map((v, i) => ({ ...v, rank: i + 1 }))
  const best10 = [...assets].filter(a => a.totalCost > 0).sort((a, b) => a.totalCost - b.totalCost).slice(0, 10)
  const driverPatterns = filtered.map(r => r.findings || '')
    .filter(f => /driver|operator|[A-Z][a-z]+ [A-Z][a-z]+/i.test(f))
  return { worst10, best10, hasDriverData: driverPatterns.length > 5 }
}

export function buildBrand(filtered) {
  if (!filtered?.length) return null
  const enhanced = computeBrandMetrics(filtered).map(b => {
    const recs = filtered.filter(r => (r.brand || 'Unknown') === b.brand)
    const avgCpk = avgCpkOf(recs)
    const avgLife = avgLifeOf(recs)
    const scrapCount = recs.filter(r => {
      const c = (r.category || '').toLowerCase()
      return c.includes('scrap') || c.includes('discard')
    }).length
    const scrapRate = rateOrNull(scrapCount, b.count)
    const cpkScore = avgCpk != null ? Math.max(0, (1 - avgCpk / 0.05) * 40) : 20
    const lifeScore = avgLife != null ? Math.min(40, (avgLife / 100000) * 40) : 20
    const failScore = Math.max(0, (1 - (b.failureRate ?? 0) / 100) * 20)
    return { ...b, avgCpk, avgLife, scrapRate, score: Math.round(cpkScore + lifeScore + failScore) }
  })
  const brands = [...enhanced].sort((a, b) => b.score - a.score).map((b, i) => ({ ...b, rank: i + 1 }))
  const allMonths = bucketByMonth(filtered, r => r.issue_date).slice(-12).map(b => b.month)
  const brandMonthly = enhanced.slice(0, 6).map(b => {
    const recs = filtered.filter(r => (r.brand || 'Unknown') === b.brand)
    return {
      brand: b.brand,
      monthly: allMonths.map(mo => sum(recs.filter(r => r.issue_date && r.issue_date.startsWith(mo)).map(r => recordCost(r)))),
    }
  })
  const hasYoY = bucketByMonth(filtered, r => r.issue_date).length >= 24
  return { brands, allMonths, brandMonthly, hasYoY }
}

function failureRates(filtered, keyFn, minTotal) {
  const map = {}
  filtered.forEach(r => {
    const k = keyFn(r)
    if (!map[k]) map[k] = { total: 0, fail: 0 }
    map[k].total++
    if (isHighRisk(r)) map[k].fail++
  })
  return Object.entries(map)
    .map(([key, d]) => ({ key, rate: (d.fail / d.total) * 100, total: d.total }))
    .filter(x => x.total >= minTotal)
    .sort((a, b) => b.rate - a.rate)
}

export const KM_BUCKETS = [
  { label: '0-10K', min: 0, max: 10000 },
  { label: '10-30K', min: 10000, max: 30000 },
  { label: '30-60K', min: 30000, max: 60000 },
  { label: '60-100K', min: 60000, max: 100000 },
  { label: '100K+', min: 100000, max: Infinity },
]

export function buildFailure(filtered) {
  if (!filtered?.length) return null
  const catMap = {}
  filtered.filter(isHighRisk).forEach(r => {
    const k = r.category || 'Unknown'
    catMap[k] = (catMap[k] || 0) + 1
  })
  const catEntries = Object.entries(catMap).sort((a, b) => b[1] - a[1])
  const posRates = failureRates(filtered, r => r.position || 'Unknown', 3).map(x => ({ pos: x.key, rate: x.rate, total: x.total }))
  const brandRates = failureRates(filtered, r => r.brand || 'Unknown', 5).slice(0, 10).map(x => ({ brand: x.key, rate: x.rate, total: x.total }))
  const siteRates = failureRates(filtered, r => r.site || 'Unknown', 3).slice(0, 12).map(x => ({ site: x.key, rate: x.rate, total: x.total }))
  const kmCounts = KM_BUCKETS.map(b => ({
    ...b,
    count: filtered.filter(r => {
      const km = (r.km_at_removal ?? 0) - (r.km_at_fitment ?? 0)
      return km > 0 && km >= b.min && km < b.max
    }).length,
  }))
  const months = bucketByMonth(filtered, r => r.issue_date).slice(-12).map(b => b.month)
  const heatmap = catEntries.slice(0, 8).map(([cat]) => ({
    cat,
    row: months.map(mo => filtered.filter(r =>
      r.issue_date && r.issue_date.startsWith(mo) && (r.category || 'Unknown') === cat,
    ).length),
  }))
  const heatMax = Math.max(...heatmap.flatMap(r => r.row), 1)
  const totalFailures = catEntries.reduce((s, [, v]) => s + v, 0)
  return { catEntries, totalFailures, posRates, brandRates, siteRates, kmCounts, months, heatmap, heatMax }
}

/** Colour for a heat-map cell, 0.2..0.85 alpha from blue to red. */
export function heatColor(value, min, max) {
  if (max === min) return 'rgba(59,130,246,0.3)'
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)))
  const r = Math.round(239 * t + 59 * (1 - t))
  const g = Math.round(68 * t + 130 * (1 - t))
  const b = Math.round(68 * t + 246 * (1 - t))
  return `rgba(${r},${g},${b},${0.2 + t * 0.65})`
}
