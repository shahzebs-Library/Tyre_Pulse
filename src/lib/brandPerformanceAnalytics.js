/**
 * brandPerformanceAnalytics - pure engine behind the Brand Performance page.
 *
 * Reuses analyticsEngine.computeBrandMetrics for the per-brand grouping and the
 * top failure category, then REPLACES the figures that engine cannot state
 * honestly on this data set:
 *
 *   - failureRate / riskScore are measured over the RATED subset only (rows
 *     that carry a risk_level). computeBrandMetrics divides by every record and
 *     scores an unrated row as "Low", so a brand with no ratings read 0% failure
 *     and a clean risk score. Here an unrated brand reads null (N/A).
 *   - avgCost is divided by the PRICED rows only (cost_per_tyre > 0). Dividing
 *     by every record understated the average by counting unpriced tyres as free.
 *
 * No I/O, no clock reads. Everything that needs "now" takes it as an argument.
 */
import { computeBrandMetrics } from './analyticsEngine'

export const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical']

const RISK_WEIGHT = { critical: 4, high: 3, medium: 1.5, low: 1 }

function norm(v) {
  return v == null ? '' : String(v).trim()
}

function isRated(r) {
  return norm(r?.risk_level) !== ''
}

function isHighRisk(r) {
  const l = norm(r?.risk_level).toLowerCase()
  return l === 'high' || l === 'critical'
}

function lineCost(r) {
  const c = Number(r?.cost_per_tyre)
  if (!Number.isFinite(c) || c <= 0) return null
  const q = Number(r?.qty)
  return c * (Number.isFinite(q) && q > 0 ? q : 1)
}

/** Distinct, sorted, non-blank site names present in the rows. */
export function sitesOf(records = []) {
  const s = new Set()
  for (const r of records) { const v = norm(r?.site); if (v) s.add(v) }
  return [...s].sort((a, b) => a.localeCompare(b))
}

/**
 * Apply the site + risk-level filters (the period filter is applied upstream
 * by PeriodFilter). An empty selection means "all".
 */
export function filterBrandRecords(records = [], { sites = [], riskLevels = [] } = {}) {
  const siteSet = new Set(sites)
  const riskSet = new Set(riskLevels.map(l => String(l).toLowerCase()))
  return records.filter(r => {
    if (siteSet.size && !siteSet.has(norm(r?.site))) return false
    if (riskSet.size && !riskSet.has(norm(r?.risk_level).toLowerCase())) return false
    return true
  })
}

/**
 * Per-brand metrics with honest nulls. Sorted by record count (desc) and
 * carrying a stable 1-based `rank` in that order.
 */
export function buildBrandMetrics(records = []) {
  const base = computeBrandMetrics(records)
  const byBrand = new Map()
  for (const r of records) {
    const k = r?.brand || 'Unknown'
    if (!byBrand.has(k)) byBrand.set(k, [])
    byBrand.get(k).push(r)
  }
  return base.map((m, i) => {
    const recs = byBrand.get(m.brand) || []
    const rated = recs.filter(isRated)
    const high = rated.filter(isHighRisk).length
    const costs = recs.map(lineCost).filter(v => v != null)
    const totalCost = costs.reduce((s, v) => s + v, 0)
    const riskScore = rated.length
      ? rated.reduce((s, r) => s + (RISK_WEIGHT[norm(r.risk_level).toLowerCase()] || 1), 0) / rated.length
      : null
    const cats = recs.filter(r => norm(r?.category)).length
    return {
      rank: i + 1,
      brand: m.brand,
      count: m.count,
      ratedCount: rated.length,
      pricedCount: costs.length,
      highRiskCount: high,
      failureRate: rated.length ? (high / rated.length) * 100 : null,
      riskScore,
      totalCost: costs.length ? totalCost : null,
      avgCost: costs.length ? totalCost / costs.length : null,
      topCategory: cats ? m.topCategory : null,
    }
  })
}

/** Failure-rate band. null when the rate is not measurable. */
export function failureBand(rate) {
  if (rate == null || !Number.isFinite(rate)) return null
  if (rate > 30) return 'high'
  if (rate > 15) return 'elevated'
  return 'low'
}

export const FAILURE_BAND_LABEL = { high: 'High', elevated: 'Elevated', low: 'Low' }

/**
 * Headline KPIs. `fleetTyreCost` is the authoritative expense-grid total and
 * wins when present; otherwise the priced tyre-record sum is used and the
 * basis says so. Best/worst consider only brands with a measured failure rate
 * and at least `minRated` rated records.
 */
export function summarizeBrands(metrics = [], { fleetTyreCost = null, minRated = 1 } = {}) {
  const records = metrics.reduce((s, m) => s + (m.count || 0), 0)
  const rated = metrics.reduce((s, m) => s + (m.ratedCount || 0), 0)
  const priced = metrics.reduce((s, m) => s + (m.pricedCount || 0), 0)
  const recordCost = metrics.some(m => m.totalCost != null)
    ? metrics.reduce((s, m) => s + (m.totalCost || 0), 0)
    : null
  const measurable = metrics.filter(m => m.failureRate != null && (m.ratedCount || 0) >= minRated)
  const byRate = [...measurable].sort((a, b) => a.failureRate - b.failureRate || b.ratedCount - a.ratedCount)
  const best = byRate[0] || null
  const worst = byRate.length > 1 ? byRate[byRate.length - 1] : null
  const fleetFailureRate = rated
    ? (metrics.reduce((s, m) => s + (m.highRiskCount || 0), 0) / rated) * 100
    : null
  const hasGrid = fleetTyreCost != null && Number.isFinite(Number(fleetTyreCost))
  return {
    brandCount: metrics.length,
    records,
    ratedCount: rated,
    pricedCount: priced,
    ratedPct: records ? (rated / records) * 100 : null,
    pricedPct: records ? (priced / records) * 100 : null,
    totalCost: hasGrid ? Number(fleetTyreCost) : recordCost,
    costBasis: hasGrid ? 'grid' : (recordCost != null ? 'records' : null),
    fleetFailureRate,
    best,
    worst: worst && best && worst.brand !== best.brand ? worst : null,
  }
}

/** Category share for one brand's rows, largest first. */
export function categoryBreakdown(records = []) {
  const map = new Map()
  for (const r of records) {
    const c = norm(r?.category)
    if (c) map.set(c, (map.get(c) || 0) + 1)
  }
  const total = records.length
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count]) => ({ category, count, pct: total ? (count / total) * 100 : null }))
}

/** Flat rows for export of the brand ranking. */
export function brandExportRows(metrics = []) {
  const f = (v, d = 2) => (v == null ? 'N/A' : Number(v.toFixed(d)))
  return metrics.map(m => ({
    rank: m.rank,
    brand: m.brand,
    count: m.count,
    rated: m.ratedCount,
    priced: m.pricedCount,
    total_cost: f(m.totalCost),
    avg_cost: f(m.avgCost),
    failure_rate: f(m.failureRate, 1),
    risk_score: f(m.riskScore),
    top_category: m.topCategory || 'N/A',
  }))
}

export const BRAND_EXPORT_COLS = ['rank', 'brand', 'count', 'rated', 'priced', 'total_cost', 'avg_cost', 'failure_rate', 'risk_score', 'top_category']
export const BRAND_EXPORT_HEADERS = ['Rank', 'Brand', 'Records', 'Rated', 'Priced', 'Total cost', 'Avg per tyre', 'Failure rate %', 'Risk score', 'Top category']

/**
 * Flatten groupBySize() output into one row per (size, brand) so a single
 * sortable table can show every size.
 */
export function flattenSizeGroups(groups = []) {
  const out = []
  for (const g of groups) {
    for (const b of g.brands || []) {
      out.push({
        id: `${g.size}|${b.brand}`,
        size: g.size,
        currency: g.currency || '',
        thin: !!g.thin,
        brand: b.brand,
        tyres: b.tyres ?? null,
        avgPrice: b.avgPrice ?? null,
        medianPrice: b.medianPrice ?? null,
        avgLifeKm: b.avgLifeKm ?? null,
        cpk: b.cpk ?? null,
        cpkGapPct: b.cpkGapPct ?? null,
        isBestValue: !!b.isBestValue,
        isCheapest: !!b.isCheapest,
      })
    }
  }
  return out
}
