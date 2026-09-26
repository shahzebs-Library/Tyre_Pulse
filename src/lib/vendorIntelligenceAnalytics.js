/**
 * vendorIntelligenceAnalytics - pure shaping for /vendor-intelligence.
 *
 * The per-brand and per-site maths (CPK, life, failure, scrap, score) is the
 * kpiEngine's (computeVendorPerformance / computeWorkshopPerformance /
 * computeCpkByBrand / computeAvgTyreLife). This module only ranks, enriches,
 * sorts and summarises what those engines return, plus the recommendation list.
 *
 * COST RULE. The fleet tyre spend is NEVER a sum of tyre_records.cost_per_tyre
 * (36%+ of tyres carry no price, and UAE/Egypt carry none at all). It comes
 * from the classified expense grid (loadGovernedCostSplit -> loadCostSplit) and
 * is passed in as `fleetTyreCost`. When that read is missing, or the scope
 * blends currencies (All countries), the figure is null and the page says so.
 * Per-brand / per-site cost stays on tyre_records with a note, as the grid
 * cannot attribute cost to a brand.
 */

/** Filter tyre records by site and normalised position group. */
export function filterVendorRecords(records = [], { site = 'all', position = 'all' } = {}, normalizePosition = (p) => p) {
  return (records || []).filter((r) => {
    if (site !== 'all' && r.site !== site) return false
    if (position !== 'all' && normalizePosition(r.position) !== position) return false
    return true
  })
}

/** Distinct sorted non-blank sites. */
export function uniqueSites(records = []) {
  return [...new Set((records || []).map((r) => r.site).filter(Boolean))].sort()
}

/**
 * Apply the minimum-volume threshold and assign rank + a 0-100 display score
 * relative to the best entry. `countKey` is 'count' for vendors and
 * 'recordCount' for workshops. Input order (the engine's score order) is kept.
 */
export function rankByScore(list = [], minRecords = 1, countKey = 'count') {
  const kept = (list || []).filter((v) => (v[countKey] ?? 0) >= minRecords)
  const maxScore = Math.max(...kept.map((v) => v.score || 0), 1)
  return kept.map((v, i) => ({
    ...v,
    rank: i + 1,
    displayScore: maxScore > 0 ? ((v.score || 0) / maxScore) * 100 : 0,
  }))
}

/** Attach median/min/max CPK and average life to each ranked vendor. */
export function enrichVendors(vendors = [], cpkByBrand = [], avgTyreLife = { byBrand: [] }) {
  const cpkMap = new Map((cpkByBrand || []).map((b) => [b.brand, b]))
  const lifeMap = new Map((avgTyreLife?.byBrand || []).map((b) => [b.brand, b]))
  return (vendors || []).map((v) => ({
    ...v,
    medianCpk: cpkMap.get(v.brand)?.medianCpk ?? null,
    minCpk: cpkMap.get(v.brand)?.minCpk ?? null,
    maxCpk: cpkMap.get(v.brand)?.maxCpk ?? null,
    avgLifeKm: lifeMap.get(v.brand)?.avgKm ?? v.avgLife ?? null,
  }))
}

/** Corrective actions raised per site. */
export function actionsBySite(actions = []) {
  const m = new Map()
  for (const a of actions || []) {
    if (!a?.site) continue
    m.set(a.site, (m.get(a.site) || 0) + 1)
  }
  return m
}

/** Measured km across records that have a valid fit to removal run. */
export function measuredKm(records = []) {
  return (records || [])
    .filter((r) => r.km_at_fitment != null && r.km_at_removal != null && Number(r.km_at_removal) > Number(r.km_at_fitment))
    .reduce((s, r) => s + (Number(r.km_at_removal) - Number(r.km_at_fitment)), 0)
}

/**
 * Executive summary. Best / worst brand by average CPK among brands with at
 * least `minForRanking` records. The saving is (worst CPK minus best CPK) times
 * measured km, and is null (not 0) when it cannot be computed.
 */
export function buildExecSummary({ vendors = [], workshops = [], records = [], fleetTyreCost = null, minForRanking = 10 } = {}) {
  const withCpk = (vendors || []).filter((v) => v.avgCpk != null && Number.isFinite(v.avgCpk))
  const qualified = withCpk.filter((v) => v.count >= minForRanking)
  const pool = qualified.length ? qualified : withCpk
  const bestBrand = pool.length ? pool.reduce((a, b) => (b.avgCpk < a.avgCpk ? b : a)) : null
  const worstBrand = pool.length > 1 ? pool.reduce((a, b) => (b.avgCpk > a.avgCpk ? b : a)) : null

  const bestSite = workshops.length > 0 ? workshops[0] : null
  const worstSite = workshops.length > 1 ? workshops[workshops.length - 1] : null

  let estAnnualSaving = null
  if (bestBrand && worstBrand && bestBrand.brand !== worstBrand.brand) {
    const km = measuredKm(records)
    if (km > 0) estAnnualSaving = (worstBrand.avgCpk - bestBrand.avgCpk) * km
  }

  const pricedRecords = (records || []).filter((r) => Number(r.cost_per_tyre) > 0).length

  return {
    bestBrand,
    worstBrand,
    bestSite,
    worstSite,
    estAnnualSaving,
    fleetTyreCost: fleetTyreCost == null || !Number.isFinite(Number(fleetTyreCost)) ? null : Number(fleetTyreCost),
    pricedRecords,
  }
}

/**
 * Procurement recommendations as translation descriptors. The page resolves
 * `key` with its i18n `t()` after formatting `vars` for display.
 * vars carry raw numbers; `format` names how each should render.
 */
export function buildRecommendations(vendors = [], workshops = []) {
  const recs = []
  if (vendors.length >= 2) {
    const worst = vendors[vendors.length - 1]
    const best = vendors[0]
    if (worst && worst.avgCpk != null && worst.avgCpk > 2.0) {
      recs.push({ priority: 'Critical', icon: 'cost', key: 'highestCpk', vars: { brand: worst.brand, cpk: worst.avgCpk }, format: { cpk: 'cpk' } })
    }
    if (best && best.avgCpk != null && best.avgCpk <= 1.0 && best.count >= 5) {
      recs.push({ priority: 'High', icon: 'value', key: 'bestValue', vars: { brand: best.brand, cpk: best.avgCpk, count: best.count }, format: { cpk: 'cpk' } })
    }
  }
  vendors.filter((v) => v.failureRate > 0.25 && v.count >= 5).slice(0, 2).forEach((v) => {
    recs.push({ priority: 'High', icon: 'failure', key: 'highFailure', vars: { brand: v.brand, pct: v.failureRate }, format: { pct: 'ratio' } })
  })
  vendors.filter((v) => v.scrapRate > 0.20 && v.count >= 5).slice(0, 1).forEach((v) => {
    recs.push({ priority: 'High', icon: 'scrap', key: 'highScrap', vars: { brand: v.brand, pct: v.scrapRate }, format: { pct: 'ratio' } })
  })
  if (workshops.length > 0) {
    const worstSite = [...workshops].sort((a, b) => b.highRiskPct - a.highRiskPct)[0]
    if (worstSite && worstSite.highRiskPct > 25) {
      recs.push({ priority: 'Critical', icon: 'site', key: 'worstSiteRisk', vars: { site: worstSite.site, pct: worstSite.highRiskPct }, format: { pct: 'number' } })
    }
    workshops.filter((w) => w.actionCloseRate === 0 && w.recordCount >= 5).slice(0, 2).forEach((w) => {
      recs.push({ priority: 'Critical', icon: 'action', key: 'zeroCloseRate', vars: { site: w.site }, format: {} })
    })
    workshops.filter((w) => w.actionCloseRate > 0 && w.actionCloseRate < 0.3).slice(0, 1).forEach((w) => {
      recs.push({ priority: 'Medium', icon: 'action', key: 'slowCloseRate', vars: { site: w.site, pct: w.actionCloseRate }, format: { pct: 'ratio' } })
    })
  }
  if (vendors.length >= 3) {
    const lifeSorted = [...vendors].filter((v) => v.avgLifeKm).sort((a, b) => b.avgLifeKm - a.avgLifeKm)
    if (lifeSorted.length > 0) {
      recs.push({ priority: 'Medium', icon: 'life', key: 'longestLife', vars: { brand: lifeSorted[0].brand, km: lifeSorted[0].avgLifeKm }, format: { km: 'km' } })
    }
  }
  return recs.slice(0, 8)
}

/** KPI strip values. Null means "not measurable" and must render as N/A. */
export function vendorKpis({ records = [], vendors = [], workshops = [], exec } = {}) {
  const withCpk = vendors.filter((v) => v.avgCpk != null && Number.isFinite(v.avgCpk))
  const fleetCpk = withCpk.length
    ? withCpk.reduce((s, v) => s + v.avgCpk * (v.validCount || 1), 0) / withCpk.reduce((s, v) => s + (v.validCount || 1), 0)
    : null
  return {
    records: records.length,
    brands: vendors.length,
    sites: workshops.length,
    weightedCpk: fleetCpk,
    fleetTyreCost: exec?.fleetTyreCost ?? null,
    estAnnualSaving: exec?.estAnnualSaving ?? null,
  }
}

/** Radar shaping for the top five brands (0-100 per axis). */
export function radarSeries(vendors = []) {
  const top5 = vendors.slice(0, 5)
  if (!top5.length) return []
  const maxKm = Math.max(...top5.map((v) => v.avgLifeKm ?? 0), 1)
  const maxCount = Math.max(...top5.map((v) => v.count), 1)
  const maxCpk = Math.max(...top5.map((v) => v.avgCpk ?? 0), 0.001)
  return top5.map((v) => ({
    brand: v.brand,
    values: [
      v.avgCpk != null ? Math.max(0, 1 - v.avgCpk / maxCpk) * 100 : 0,
      (1 - (v.failureRate ?? 0)) * 100,
      maxKm > 0 ? ((v.avgLifeKm ?? 0) / maxKm) * 100 : 0,
      (1 - (v.scrapRate ?? 0)) * 100,
      (v.count / maxCount) * 100,
    ],
  }))
}
