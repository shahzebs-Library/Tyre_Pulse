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

// ── Registry redesign helpers (2026-09-28) ────────────────────────────────────
// Everything below feeds the redesigned register: conditions, at-risk, the
// health x utilisation grid, composition, compliance and inspection status.
// Same honesty rules as above: unknown stays unknown, never a flattering zero.

const upperCode = (v) => String(v ?? '').trim().toUpperCase()
const finite = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Condition from the health score: good >= 80, monitor 50 to 79, critical
 * below 50, 'none' when the asset has no score.
 */
export function conditionBand(score) {
  const s = finite(score)
  if (s == null) return 'none'
  if (s >= 80) return 'good'
  if (s >= 50) return 'monitor'
  return 'critical'
}

export const CONDITION_META = {
  good: { label: 'Good', tone: 'good' },
  monitor: { label: 'Monitor', tone: 'warn' },
  critical: { label: 'Critical', tone: 'bad' },
  none: { label: 'Not measured', tone: 'muted' },
}

/** At risk: health below 50, or the worst fitted tyre is High or Critical. */
export function isAtRisk(a) {
  if (!a) return false
  if (a._worstRisk === 'Critical' || a._worstRisk === 'High') return true
  return a._healthScore != null && a._healthScore < 50
}

/** Mean health over the assets that carry a score; null when none do. */
export function averageHealth(assets) {
  const scored = (Array.isArray(assets) ? assets : []).filter((a) => a && a._healthScore != null)
  if (!scored.length) return null
  return Math.round(scored.reduce((s, a) => s + a._healthScore, 0) / scored.length)
}

/** Share of assets with make, model, site and vehicle type all recorded. */
export function completenessPct(assets) {
  const list = Array.isArray(assets) ? assets : []
  if (!list.length) return null
  const ok = list.filter((a) => a && a.make && a.model && a.site && a.vehicle_type).length
  return Math.round((ok / list.length) * 100)
}

/**
 * Latest utilisation reading per asset. Keyed by asset code AND country:
 * the same code in two countries is a different machine, so a KSA reading
 * never lands on a UAE asset. A reading with no country matches on code alone.
 */
export function utilizationIndex(rows) {
  const byKey = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const pct = finite(r?.utilization_pct)
    const code = upperCode(r?.asset_no)
    if (pct == null || !code) continue
    const key = `${code}|${r.country || ''}`
    const prev = byKey.get(key)
    const at = String(r.captured_at || r.created_at || '')
    if (!prev || at > prev.at) byKey.set(key, { pct, at })
  }
  return byKey
}

/** The utilisation % for one asset from utilizationIndex, or null. */
export function utilizationFor(index, asset) {
  if (!index || !asset) return null
  const code = upperCode(asset.asset_no)
  const hit = index.get(`${code}|${asset.country || ''}`) || index.get(`${code}|`)
  return hit ? hit.pct : null
}

/** Utilisation band on the mockup scale: low 0 to 30, medium 31 to 70, high above 70. */
export function utilizationBand(pct) {
  const p = finite(pct)
  if (p == null) return null
  if (p <= 30) return 'low'
  if (p <= 70) return 'medium'
  return 'high'
}

/** Health row of the grid: high 80 to 100, medium 50 to 79, low 0 to 49. */
export function healthRow(score) {
  const b = conditionBand(score)
  return b === 'good' ? 'high' : b === 'monitor' ? 'medium' : b === 'critical' ? 'low' : null
}

export const GRID_ROWS = ['high', 'medium', 'low']
export const GRID_COLS = ['low', 'medium', 'high']

/**
 * Health x utilisation counts. An asset lacking either measure is NOT placed
 * in the grid; it is counted in `noHealth` / `noUtil` so the card can say so.
 * `utilOf(asset)` returns the asset's utilisation % or null.
 */
export function healthUtilGrid(assets, utilOf) {
  const cells = {}
  for (const r of GRID_ROWS) for (const c of GRID_COLS) cells[`${r}:${c}`] = 0
  let placed = 0; let noHealth = 0; let noUtil = 0
  for (const a of Array.isArray(assets) ? assets : []) {
    const r = healthRow(a?._healthScore)
    const c = utilizationBand(utilOf ? utilOf(a) : null)
    if (!r) noHealth += 1
    if (!c) noUtil += 1
    if (r && c) { cells[`${r}:${c}`] += 1; placed += 1 }
  }
  return { cells, placed, noHealth, noUtil, unplaced: (Array.isArray(assets) ? assets.length : 0) - placed }
}

/** Does an asset sit in grid cell 'row:col'? */
export function inGridCell(asset, cell, utilOf) {
  if (!cell) return true
  const [r, c] = String(cell).split(':')
  return healthRow(asset?._healthScore) === r && utilizationBand(utilOf ? utilOf(asset) : null) === c
}

/**
 * Composition segments by category label. The top `max - 1` categories keep
 * their own slice; the rest (and anything unknown) fold into "Other".
 * `categoryOf(asset)` returns a label.
 */
export function compositionSegments(assets, categoryOf, { max = 6 } = {}) {
  const counts = new Map()
  for (const a of Array.isArray(assets) ? assets : []) {
    const label = categoryOf(a) || 'Other'
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  const sorted = [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label))
  const named = sorted.filter((s) => s.label !== 'Other')
  const keep = named.slice(0, Math.max(1, max - 1))
  const rest = named.slice(keep.length)
  const otherCount = rest.reduce((s, x) => s + x.count, 0) + (counts.get('Other') || 0)
  const out = keep.map((s) => ({ ...s, members: [s.label] }))
  if (otherCount > 0) out.push({ label: 'Other', count: otherCount, members: ['Other', ...rest.map((r) => r.label)] })
  return out
}

export const COMPLIANCE_FIELDS = [
  { key: 'insurance_expiry', label: 'Insurance' },
  { key: 'mvip_expiry', label: 'MVIP' },
  { key: 'operating_card_expiry', label: 'Operating card' },
]
export const EXPIRING_DAYS = 30

/**
 * Compliance from the recorded expiry dates: 'expired' when any recorded date
 * has passed, 'expiring' when any falls within 30 days, 'compliant' when every
 * recorded date is further out, 'none' when no expiry date is recorded at all.
 */
export function complianceStatus(asset, now = new Date()) {
  const nowMs = now.getTime()
  let recorded = 0; let expired = false; let expiring = false
  for (const f of COMPLIANCE_FIELDS) {
    const v = asset?.[f.key]
    if (!v) continue
    const t = new Date(v).getTime()
    if (!Number.isFinite(t)) continue
    recorded += 1
    if (t < nowMs) expired = true
    else if (t - nowMs <= EXPIRING_DAYS * MS_DAY) expiring = true
  }
  if (!recorded) return 'none'
  if (expired) return 'expired'
  if (expiring) return 'expiring'
  return 'compliant'
}

export const INSPECTION_OVERDUE_DAYS = 30

/** 'on_schedule' when inspected within 30 days, 'overdue' when older, null when never. */
export function inspectionStatus(date, now = new Date()) {
  if (!date) return null
  const t = new Date(date).getTime()
  if (!Number.isFinite(t)) return null
  return now.getTime() - t > INSPECTION_OVERDUE_DAYS * MS_DAY ? 'overdue' : 'on_schedule'
}

/**
 * Latest inspection date per asset, keyed code|country (the same code in two
 * countries is a different machine). A row with no country keys on code alone.
 */
export function latestInspectionIndex(rows) {
  const out = {}
  for (const r of Array.isArray(rows) ? rows : []) {
    const code = upperCode(r?.asset_no)
    const d = r?.inspection_date || r?.completed_date || null
    if (!code || !d) continue
    const key = `${code}|${r.country || ''}`
    if (!out[key] || String(d) > String(out[key])) out[key] = d
  }
  return out
}

/** The latest inspection date for one asset from latestInspectionIndex, or null. */
export function latestInspectionFor(index, asset) {
  if (!index || !asset) return null
  const code = upperCode(asset.asset_no)
  return index[`${code}|${asset.country || ''}`] || index[`${code}|`] || null
}
