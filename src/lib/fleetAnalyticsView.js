/**
 * fleetAnalyticsView - the presentation engine for the Fleet Analytics page
 * (`/fleet-analytics`).
 *
 * Per-asset metrics come from the `report_asset_metrics` RPC; the monthly
 * buckets and trend line come from `analyticsEngine` (bucketByMonth,
 * linearRegression, recordCost) and are REUSED, not re-derived. This module
 * holds the rest of the page's logic: the expense-grid cost overlay, the
 * filters, the KPI strip, the drill-down serial lifecycle and the export rows.
 *
 * (Named `...View` because the natural `fleetAnalyticsAnalytics` reads as a
 * typo; there is no other fleet-analytics engine to collide with.)
 *
 * THE COST RULE: a per-asset tyre cost TOTAL comes from the expense grid
 * (`loadGridTyreByAsset`), never from summing `cost_per_tyre`. The tyre-record
 * sum is kept only as the fallback for an asset the grid does not carry, and
 * each row says which basis it used.
 *
 * Pure: no I/O, no Date.now(). Unmeasurable values are null (N/A), never 0.
 */
import { bucketByMonth, linearRegression, recordCost } from './analyticsEngine'

const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null))
export const HIGH_FREQ_PER_MONTH = 2

/** Canonical asset key: trimmed, upper-case (the grid map's key). */
export function assetKey(assetNo) {
  return String(assetNo ?? '').trim().toUpperCase()
}

/**
 * Overlay the grid tyre cost onto each asset. `gridMap` is a Map keyed by
 * `assetKey`; null means the grid was unavailable, so every asset keeps its
 * tyre-record total. `costBasis` names which one each row carries.
 */
export function withGridCost(metrics, gridMap) {
  return (metrics || []).map((a) => {
    const key = assetKey(a.assetNo)
    if (gridMap && typeof gridMap.has === 'function' && gridMap.has(key)) {
      return { ...a, totalCost: num(gridMap.get(key)), costBasis: 'grid' }
    }
    return { ...a, totalCost: num(a.totalCost), costBasis: 'records' }
  })
}

/** Normalised asset rows for the register (arrays and numbers made safe). */
export function assetRows(metrics) {
  return (metrics || []).map((a) => ({
    ...a,
    id: String(a.assetNo ?? ''),
    assetNo: String(a.assetNo ?? ''),
    count: num(a.count) ?? 0,
    highRiskCount: num(a.highRiskCount) ?? 0,
    failureFreqPerMonth: num(a.failureFreqPerMonth),
    sites: Array.isArray(a.sites) ? a.sites : [],
    brands: Array.isArray(a.brands) ? a.brands : [],
    lastSeen: a.lastSeen || null,
    firstSeen: a.firstSeen || null,
  }))
}

/** Every site any asset has worked at, sorted. */
export function siteOptions(rows) {
  return [...new Set((rows || []).flatMap((a) => a.sites || []))].filter(Boolean).sort()
}

/** Every brand any asset carries, sorted. */
export function brandOptions(rows) {
  return [...new Set((rows || []).flatMap((a) => a.brands || []))].filter(Boolean).sort()
}

/**
 * Apply the page filters. Dates compare against the asset's last activity; an
 * asset with no recorded activity is kept (we cannot say it is out of range).
 * `risk` = 'high' keeps assets with any high-risk record, 'frequent' keeps
 * assets above HIGH_FREQ_PER_MONTH failures per month.
 */
export function filterAssets(rows, f = {}) {
  const q = String(f.search || '').trim().toLowerCase()
  return (rows || []).filter((a) => {
    if (q && !a.assetNo.toLowerCase().includes(q)) return false
    if (f.from && a.lastSeen && a.lastSeen < f.from) return false
    if (f.to && a.lastSeen && a.lastSeen > f.to) return false
    if (f.site && !(a.sites || []).includes(f.site)) return false
    if (f.brand && !(a.brands || []).includes(f.brand)) return false
    if (f.risk === 'high' && !(a.highRiskCount > 0)) return false
    if (f.risk === 'frequent' && !((a.failureFreqPerMonth ?? 0) > HIGH_FREQ_PER_MONTH)) return false
    return true
  })
}

/** Number of active filters (search excluded). */
export function activeFilterCount(f = {}) {
  return ['from', 'to', 'site', 'brand', 'risk'].filter((k) => f[k]).length
}

/**
 * KPI strip over a set of assets. Average cost is over assets with a known
 * cost and is null when none has one - never an average of zeros.
 */
export function fleetKpis(rows) {
  const list = rows || []
  const records = list.reduce((s, a) => s + (num(a.count) ?? 0), 0)
  const costed = list.filter((a) => num(a.totalCost) != null)
  const totalCost = costed.length ? costed.reduce((s, a) => s + num(a.totalCost), 0) : null
  return {
    assets: list.length,
    records,
    highFreq: list.filter((a) => (num(a.failureFreqPerMonth) ?? 0) > HIGH_FREQ_PER_MONTH).length,
    highRiskAssets: list.filter((a) => (num(a.highRiskCount) ?? 0) > 0).length,
    totalCost,
    avgCost: costed.length ? totalCost / costed.length : null,
    gridCosted: list.filter((a) => a.costBasis === 'grid').length,
  }
}

/** Monthly cost/count buckets + trend for one asset's records. */
export function assetTrend(records) {
  const monthly = bucketByMonth(records || [], (r) => r.issue_date, (r) => recordCost(r))
  const points = monthly.map((d, i) => [i, d.count])
  const reg = points.length >= 2 ? linearRegression(points) : null
  return { monthly, reg }
}

/** Plain-language trend line: "R2 0.42 | rising 0.35 per month". */
export function trendNote(reg) {
  if (!reg) return null
  const dir = reg.slope > 0 ? 'rising' : reg.slope < 0 ? 'falling' : 'flat'
  return `R2 ${reg.r2.toFixed(2)} | ${dir} ${Math.abs(reg.slope).toFixed(2)} per month`
}

/**
 * Per-serial lifecycle for one asset: newest event first, with the latest
 * record's risk / brand / category and the event count. Records with no
 * serial are left out (they cannot be followed as one tyre).
 */
export function serialLifecycle(records) {
  const by = new Map()
  for (const r of records || []) {
    if (!r.serial_no) continue
    if (!by.has(r.serial_no)) by.set(r.serial_no, [])
    by.get(r.serial_no).push(r)
  }
  const out = []
  for (const [serial, recs] of by) {
    const sorted = [...recs].sort((a, b) => String(b.issue_date || '').localeCompare(String(a.issue_date || '')))
    const latest = sorted[0]
    out.push({
      id: serial,
      serial,
      events: recs.length,
      risk: latest.risk_level || null,
      brand: latest.brand || null,
      category: latest.category || null,
      latestDate: latest.issue_date || null,
      firstDate: sorted[sorted.length - 1].issue_date || null,
    })
  }
  return out.sort((a, b) => String(b.latestDate || '').localeCompare(String(a.latestDate || '')))
}

export const EXPORT_COLUMNS = [
  ['asset_no', 'Asset No'], ['records', 'Records'], ['total_cost', 'Tyre Cost'], ['cost_basis', 'Cost Basis'],
  ['high_risk', 'High Risk'], ['fail_per_month', 'Fail/Mo'], ['sites', 'Sites'], ['brands', 'Brands'], ['last_seen', 'Last Seen'],
]

/** Export rows for every filtered asset (no row cap). */
export function exportRows(rows) {
  return (rows || []).map((a) => ({
    asset_no: a.assetNo,
    records: a.count,
    total_cost: num(a.totalCost) == null ? 'N/A' : num(a.totalCost),
    cost_basis: a.costBasis === 'grid' ? 'Expense grid' : 'Tyre records',
    high_risk: a.highRiskCount,
    fail_per_month: num(a.failureFreqPerMonth) == null ? 'N/A' : Number(a.failureFreqPerMonth).toFixed(1),
    sites: (a.sites || []).join(', '),
    brands: (a.brands || []).join(', '),
    last_seen: a.lastSeen || 'N/A',
  }))
}
