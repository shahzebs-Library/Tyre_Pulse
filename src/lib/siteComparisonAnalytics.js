/**
 * Site Comparison analytics - pure engine behind /site-comp.
 *
 * Builds on analyticsEngine.computeSiteMetrics (the shared per-site maths:
 * count, totalCost, highRiskPct, top brand / category) and adds the pieces the
 * page used to compute inline or never computed at all:
 *
 *  - period bucketing for the trend chart (monthly / quarterly / yearly);
 *  - an honest COVERAGE layer. Two tyre_records columns are thin in the live
 *    data: `cost_per_tyre` (a tyre with no price was silently summed as 0) and
 *    `risk_level` (unrated tyres were silently counted as "not high risk", so a
 *    site with no ratings at all read as 0% high risk, i.e. perfect). Each site
 *    now carries pricedCount / ratedCount, and a rate over an empty rated
 *    population is null (N/A), never 0%.
 *  - a ranked site register (cost share, cost index vs the scope average,
 *    risk band) plus search / band filters and export rows;
 *  - the headline KPI strip.
 *
 * NOTE: this page prices tyres from `cost_per_tyre`. The authoritative tyre
 * SPEND total lives in the expense grid (Expenses & CPK); the page says so.
 *
 * One tyre one price (rule T1): rows go through withOnePricePerTyre before any
 * money is summed, so a refitted tyre is not bought twice. A refit row still
 * counts toward the priced share (the tyre WAS priced, once) but adds no money.
 * avgCost = priced cost per priced PHYSICAL tyre (qty honoured). The register
 * also carries the per-site physical-tyre lifetime keys from computeSiteMetrics
 * (tyres, lifetimeCpk, avgLifeKm, kmCoverage, cpkKind, cpkKindLabel). Record
 * counts and risk ratings stay per fitment row (events).
 * No I/O; `now` is not needed (no clock-relative figures).
 */
import { computeSiteMetrics } from './analyticsEngine'
import { withOnePricePerTyre } from './tyreLifetime'

export const GRANULARITIES = ['Monthly', 'Quarterly', 'Yearly']

const HIGH_RISK = new Set(['High', 'Critical'])

export function periodKey(dateStr, granularity = 'Monthly') {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  if (granularity === 'Yearly') return String(y)
  if (granularity === 'Quarterly') return `${y} Q${Math.ceil((d.getMonth() + 1) / 3)}`
  return `${y}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function lineCost(r) {
  const c = Number(r?.cost_per_tyre)
  if (!Number.isFinite(c) || c <= 0) return null
  const q = Number(r?.qty)
  return c * (Number.isFinite(q) && q > 0 ? q : 1)
}

function qtyOf(r) {
  const q = Number(r?.qty)
  return Number.isFinite(q) && q > 0 ? q : 1
}

/** Sum priced cost per period; unpriced records count but add no money. */
export function buildPeriodBuckets(records = [], granularity = 'Monthly') {
  const map = new Map()
  for (const r of withOnePricePerTyre(records)) {
    const key = periodKey(r.issue_date, granularity)
    if (!key) continue
    const b = map.get(key) || { period: key, total: 0, count: 0, priced: 0 }
    const c = lineCost(r)
    if (c != null) { b.total += c; b.priced += 1 } else if (r._refit_price_dropped) b.priced += 1
    b.count += 1
    map.set(key, b)
  }
  return [...map.values()].sort((a, b) => a.period.localeCompare(b.period))
}

export function slicePeriods(buckets = [], granularity = 'Monthly') {
  if (granularity === 'Yearly') return buckets.slice(-5)
  if (granularity === 'Quarterly') return buckets.slice(-8)
  return buckets.slice(-12)
}

/** Trend series for the chosen sites over a shared period axis. */
export function trendSeries(records = [], sites = [], granularity = 'Monthly') {
  // One price per tyre across ALL sites first: a tyre bought at one site and
  // refitted at another must not be bought again at the second.
  const once = withOnePricePerTyre(records)
  const series = sites.map((site) => {
    const buckets = slicePeriods(buildPeriodBuckets(once.filter((r) => r.site === site), granularity), granularity)
    return { site, buckets }
  })
  const periods = [...new Set(series.flatMap((s) => s.buckets.map((b) => b.period)))].sort()
  return {
    periods,
    series: series.map((s) => ({
      site: s.site,
      values: periods.map((p) => {
        const hit = s.buckets.find((b) => b.period === p)
        return hit && hit.priced > 0 ? Math.round(hit.total) : null
      }),
    })),
  }
}

export function riskBand(pct) {
  if (pct == null) return 'Unrated'
  if (pct > 30) return 'High'
  if (pct > 15) return 'Elevated'
  return 'Normal'
}

export const RISK_BANDS = ['High', 'Elevated', 'Normal', 'Unrated']

/**
 * Per-site metrics with coverage and ranking.
 * Reuses computeSiteMetrics, then overlays priced/rated coverage and honest
 * rates computed over the rated population only.
 */
export function siteRegister(records = [], { selected = [] } = {}) {
  const base = computeSiteMetrics(records)
  const cover = new Map()
  for (const r of withOnePricePerTyre(records)) {
    const site = r.site || 'Unknown'
    const c = cover.get(site) || { priced: 0, pricedTyres: 0, rated: 0, high: 0, pricedCost: 0 }
    const lc = lineCost(r)
    if (lc != null) { c.priced += 1; c.pricedTyres += qtyOf(r); c.pricedCost += lc }
    else if (r._refit_price_dropped) c.priced += 1
    if (r.risk_level) {
      c.rated += 1
      if (HIGH_RISK.has(r.risk_level)) c.high += 1
    }
    cover.set(site, c)
  }
  const pricedTotal = [...cover.values()].reduce((s, c) => s + c.pricedCost, 0)
  const pricedSites = base.filter((s) => (cover.get(s.site)?.pricedTyres || 0) > 0)
  const avgSiteCost = pricedSites.length
    ? pricedSites.reduce((s, x) => s + (cover.get(x.site)?.pricedCost || 0), 0) / pricedSites.length
    : null
  const selectedSet = new Set(selected)

  return base.map((s, i) => {
    const c = cover.get(s.site) || { priced: 0, pricedTyres: 0, rated: 0, high: 0, pricedCost: 0 }
    const hasCost = c.pricedTyres > 0
    const highRiskPct = c.rated > 0 ? (c.high / c.rated) * 100 : null
    return {
      rank: i + 1,
      site: s.site,
      count: s.count,
      totalCost: hasCost ? c.pricedCost : null,
      avgCost: hasCost ? c.pricedCost / c.pricedTyres : null,
      pricedCount: c.priced,
      pricedTyres: c.pricedTyres,
      tyres: s.tyres ?? null,
      lifetimeCpk: s.lifetimeCpk ?? null,
      avgLifeKm: s.avgLifeKm ?? null,
      kmCoverage: s.kmCoverage ?? null,
      provisionalTyres: s.provisionalTyres ?? null,
      cpkKind: s.cpkKind ?? null,
      cpkKindLabel: s.cpkKindLabel ?? null,
      pricedPct: s.count ? Math.round((c.priced / s.count) * 100) : null,
      ratedCount: c.rated,
      ratedPct: s.count ? Math.round((c.rated / s.count) * 100) : null,
      highRiskCount: c.high,
      highRiskPct,
      riskBand: riskBand(highRiskPct),
      costShare: hasCost && pricedTotal > 0 ? (c.pricedCost / pricedTotal) * 100 : null,
      costIndex: hasCost && avgSiteCost ? Math.round((c.pricedCost / avgSiteCost) * 100) : null,
      topBrand: s.topBrand === 'Unknown' ? 'N/A' : s.topBrand,
      topCategory: s.topCategory === 'Unknown' ? 'N/A' : s.topCategory,
      selected: selectedSet.has(s.site),
    }
  })
}

/** Headline figures over the whole register (or the compared subset). */
export function summarizeSites(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const records = list.reduce((s, r) => s + (r.count || 0), 0)
  const priced = list.reduce((s, r) => s + (r.pricedCount || 0), 0)
  const pricedTyres = list.reduce((s, r) => s + (r.pricedTyres ?? r.pricedCount ?? 0), 0)
  const rated = list.reduce((s, r) => s + (r.ratedCount || 0), 0)
  const high = list.reduce((s, r) => s + (r.highRiskCount || 0), 0)
  const costed = list.filter((r) => r.totalCost != null)
  const totalCost = costed.length ? costed.reduce((s, r) => s + r.totalCost, 0) : null
  const top = costed.slice().sort((a, b) => b.totalCost - a.totalCost)[0] || null
  const low = costed.slice().sort((a, b) => a.totalCost - b.totalCost)[0] || null
  const riskiest = list.filter((r) => r.highRiskPct != null).sort((a, b) => b.highRiskPct - a.highRiskPct)[0] || null
  return {
    sites: list.length,
    records,
    totalCost,
    avgCostPerPriced: pricedTyres > 0 && totalCost != null ? totalCost / pricedTyres : null,
    pricedPct: records > 0 ? Math.round((priced / records) * 100) : null,
    ratedPct: records > 0 ? Math.round((rated / records) * 100) : null,
    highRiskPct: rated > 0 ? (high / rated) * 100 : null,
    topCostSite: top ? top.site : null,
    riskiestSite: riskiest ? riskiest.site : null,
    costSpread: top && low && low.totalCost > 0 && top !== low ? top.totalCost / low.totalCost : null,
  }
}

export function filterSites(rows = [], { search = '', band = 'all', scope = 'all' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return rows.filter((r) => {
    if (band !== 'all' && r.riskBand !== band) return false
    if (scope === 'selected' && !r.selected) return false
    if (q && ![r.site, r.topBrand, r.topCategory].some((v) => String(v || '').toLowerCase().includes(q))) return false
    return true
  })
}

export const SITE_EXPORT_COLUMNS = [
  { key: 'rank', header: 'Rank' },
  { key: 'site', header: 'Site' },
  { key: 'count', header: 'Records' },
  { key: 'pricedPct', header: 'Priced %' },
  { key: 'totalCost', header: 'Priced Cost' },
  { key: 'avgCost', header: 'Avg Cost' },
  { key: 'costShare', header: 'Cost Share %' },
  { key: 'costIndex', header: 'Cost Index' },
  { key: 'ratedPct', header: 'Risk Rated %' },
  { key: 'highRiskPct', header: 'High Risk %' },
  { key: 'riskBand', header: 'Risk Band' },
  { key: 'topBrand', header: 'Top Brand' },
  { key: 'topCategory', header: 'Top Category' },
]

const round1 = (v) => (v == null ? 'N/A' : Math.round(v * 10) / 10)

export function siteExportRows(rows = []) {
  return rows.map((r) => ({
    rank: r.rank,
    site: r.site,
    count: r.count,
    pricedPct: r.pricedPct == null ? 'N/A' : r.pricedPct,
    totalCost: r.totalCost == null ? 'N/A' : Math.round(r.totalCost),
    avgCost: r.avgCost == null ? 'N/A' : Math.round(r.avgCost),
    costShare: round1(r.costShare),
    costIndex: r.costIndex == null ? 'N/A' : r.costIndex,
    ratedPct: r.ratedPct == null ? 'N/A' : r.ratedPct,
    highRiskPct: round1(r.highRiskPct),
    riskBand: r.riskBand,
    topBrand: r.topBrand,
    topCategory: r.topCategory,
  }))
}
