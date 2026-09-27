/**
 * assetManagementAnalytics - pure view logic for the Asset Management register
 * (/asset-management). No I/O, no React, `now` injected.
 *
 * The page keeps its URL-borne filter rule (applyAssetFilters, which the KPI
 * scope tests pin); this module owns everything else it used to compute inline:
 * enrichment against the per-asset overview, the register sort, the by-type
 * summary, chart breakdowns and the health lists.
 *
 * Honesty rules:
 *   - An asset with no tyre overview has NO health score (null), not 0. A
 *     zero would sort it as the worst machine in the fleet.
 *   - Averages divide only by the assets that carry the measurement, and are
 *     null when none do.
 *   - Blank values always sort last, in either direction (consoleTable rule).
 */
import { sortRows } from './consoleTable'

export const RISK_LEVELS = ['Critical', 'High', 'Medium', 'Low']
export const NO_RECENT_RECORD_DAYS = 60
const MS_DAY = 86_400_000

/** Map the overview rows by asset number. */
export function overviewIndex(overview) {
  const map = {}
  for (const o of Array.isArray(overview) ? overview : []) {
    if (o && o.asset_no) map[o.asset_no] = o
  }
  return map
}

/**
 * Attach the per-asset tyre overview to each register row.
 * `_healthScore` is null when the asset has no tyre data (never a fake 0).
 */
export function enrichAssets(assets, overview, { now = new Date() } = {}) {
  const map = overviewIndex(overview)
  const nowMs = now.getTime()
  return (Array.isArray(assets) ? assets : []).map((a) => {
    const o = map[a.asset_no]
    const latestDate = o?.latest_date ?? null
    const latestMs = latestDate ? new Date(latestDate).getTime() : NaN
    const cost = Number(o?.ytd_cost)
    const score = o?.health_score
    return {
      ...a,
      _hasTyreData: !!o,
      _activeCount: o?.active_tyres ?? 0,
      _totalCount: o?.total_tyres ?? 0,
      _worstRisk: o?.worst_risk ?? null,
      _ytdCost: Number.isFinite(cost) ? cost : 0,
      _latestDate: latestDate,
      _noRecentRecord: !latestDate || !Number.isFinite(latestMs) || (nowMs - latestMs) > NO_RECENT_RECORD_DAYS * MS_DAY,
      _healthScore: o && score != null && Number.isFinite(Number(score)) ? Number(score) : null,
    }
  })
}

// Sort accessors: a sort key maps onto the value it compares. A zero cost is
// a real "no spend", but a missing overview is unknown, so it sorts last.
const SORT_ACCESSORS = {
  _ytdCost: (a) => (a._hasTyreData ? a._ytdCost : null),
  _healthScore: (a) => a._healthScore,
  _worstRisk: (a) => (a._worstRisk ? RISK_LEVELS.length - RISK_LEVELS.indexOf(a._worstRisk) : null),
  _latestDate: (a) => a._latestDate,
  active: (a) => (a.active === false ? 'Inactive' : 'Active'),
  make: (a) => [a.make, a.model].filter(Boolean).join(' ') || null,
  current_km: (a) => (a.current_km === '' || a.current_km == null ? null : Number(a.current_km)),
  year: (a) => (a.year === '' || a.year == null ? null : Number(a.year)),
}

/** Stable register sort; blanks last in either direction. Never mutates. */
export function sortAssets(list, col, dir = 'asc') {
  if (!col) return Array.isArray(list) ? list.slice() : []
  return sortRows(list, { key: col, dir: dir === 'desc' ? 'desc' : 'asc' }, SORT_ACCESSORS)
}

/** Vehicle type counts for the doughnut: [{ label, count }] by count desc. */
export function typeCounts(assets) {
  const counts = new Map()
  for (const a of Array.isArray(assets) ? assets : []) {
    const t = a.vehicle_type || 'Unknown'
    counts.set(t, (counts.get(t) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label))
}

/** Assets per site split by worst risk: { sites, series: { Low: [], ... } }. */
export function siteRiskBreakdown(assets) {
  const list = Array.isArray(assets) ? assets : []
  const sites = [...new Set(list.map((a) => a.site).filter(Boolean))].sort()
  const series = {}
  for (const level of RISK_LEVELS) {
    series[level] = sites.map((s) => list.filter((a) => a.site === s && a._worstRisk === level).length)
  }
  return { sites, series }
}

/**
 * Fleet summary by vehicle type.
 *   avgCost    mean YTD cost over the assets that HAVE tyre data (null if none)
 *   avgHealth  mean health over the assets that HAVE a score (null if none)
 *   scored     how many assets the health average rests on
 */
export function summarizeByType(assets) {
  const groups = new Map()
  for (const a of Array.isArray(assets) ? assets : []) {
    const t = a.vehicle_type || 'Unknown'
    if (!groups.has(t)) groups.set(t, [])
    groups.get(t).push(a)
  }
  return [...groups.entries()].map(([type, group]) => {
    const withData = group.filter((a) => a._hasTyreData)
    const scored = group.filter((a) => a._healthScore != null)
    return {
      type,
      count: group.length,
      active: group.filter((a) => a.active !== false).length,
      atRisk: group.filter((a) => a._worstRisk === 'Critical' || a._worstRisk === 'High').length,
      avgCost: withData.length ? withData.reduce((s, a) => s + (a._ytdCost || 0), 0) / withData.length : null,
      avgHealth: scored.length ? scored.reduce((s, a) => s + a._healthScore, 0) / scored.length : null,
      scored: scored.length,
    }
  }).sort((x, y) => y.count - x.count || x.type.localeCompare(y.type))
}

/** Health band for a score; 'none' when there is no score. */
export function healthBand(score) {
  if (score == null) return 'none'
  if (score >= 80) return 'good'
  if (score >= 60) return 'fair'
  if (score >= 40) return 'poor'
  return 'critical'
}

/** Counts per health band over active assets. */
export function healthBands(assets) {
  const out = { good: 0, fair: 0, poor: 0, critical: 0, none: 0 }
  for (const a of Array.isArray(assets) ? assets : []) {
    if (a.active === false) continue
    out[healthBand(a._healthScore)] += 1
  }
  return out
}

/** Active assets for the health matrix: scored worst first, unscored last. */
export function healthMatrix(assets) {
  return (Array.isArray(assets) ? assets : [])
    .filter((a) => a.active !== false)
    .slice()
    .sort((a, b) => {
      const as = a._healthScore
      const bs = b._healthScore
      if (as == null && bs == null) return String(a.asset_no).localeCompare(String(b.asset_no))
      if (as == null) return 1
      if (bs == null) return -1
      return as - bs
    })
}

/** Active, scored assets below `threshold`, worst first, capped at `limit`. */
export function lowHealthAssets(assets, { threshold = 60, limit = 10 } = {}) {
  return healthMatrix(assets)
    .filter((a) => a._healthScore != null && a._healthScore < threshold)
    .slice(0, limit)
}
