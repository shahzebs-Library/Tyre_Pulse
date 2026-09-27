/**
 * tyreFailureCpkBoardAnalytics - page-level analytics for the Tyre Failure and
 * CPK board (/tyre-failure-cpk).
 *
 * The board figures come from `./tyreFailureBoard` (buildTyreFailureBoard) and
 * every CPK and tyre-life number from the shared `./kpiEngine`; nothing here
 * re-implements that maths. This module adds:
 *   - one filter predicate (date window, site, brand, status, search)
 *   - a currency guard: CPK and cost are money, and tyre_records across
 *     countries carry SAR, AED and EGP. On the All-countries scope money reads
 *     N/A instead of an addition of different currencies.
 *   - the full per-asset CPK ranking (not only the top 10) reconciled to the
 *     expense grid, and a removed-tyre register with life km and CPK per tyre
 *   - export shaping
 *
 * No I/O, no React.
 */
import { computeCpkByAsset, computeCpkFleet, computeAvgTyreLife } from './kpiEngine'
import { cleanRemovalReason } from './removalReason'

const lc = (v) => String(v ?? '').trim().toLowerCase()

/** String-safe 'YYYY-MM-DD' prefix range test. No range = every row passes. */
export function inDateRange(d, from, to) {
  const s = d ? String(d).slice(0, 10) : ''
  if (!s) return !(from || to)
  if (from && s < from) return false
  if (to && s > to) return false
  return true
}

/** Money (CPK, cost) is only comparable inside one country's currency. */
export function moneyComparable(activeCountry) {
  return !!activeCountry && activeCountry !== 'All'
}

export function filterBoardRecords(rows = [], f = {}) {
  const q = lc(f.search)
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if ((f.from || f.to) && !inDateRange(r.issue_date, f.from, f.to)) return false
    if (f.site && (r.site || '') !== f.site) return false
    if (f.brand && (r.brand || '') !== f.brand) return false
    if (f.status && lc(r.status) !== lc(f.status)) return false
    if (q) {
      const hay = [r.serial_no, r.asset_no, r.brand, r.site, r.size, r.position, r.removal_reason].map(lc).join(' ')
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/**
 * Every asset with a measurable CPK, worst first (from kpiEngine). When the
 * expense grid carries the asset, its authoritative tyre cost replaces the
 * tyre_records sum and `costSource` says so.
 */
export function assetRanking(rows = [], gridMap = null) {
  return computeCpkByAsset(rows).map((a) => {
    const key = String(a.asset_no ?? '').trim().toUpperCase()
    const fromGrid = gridMap && typeof gridMap.has === 'function' && gridMap.has(key)
    return {
      asset_no: a.asset_no,
      avgCpk: Number.isFinite(a.avgCpk) ? a.avgCpk : null,
      totalCost: fromGrid ? gridMap.get(key) : a.totalCost,
      costSource: fromGrid ? 'Expense grid' : 'Tyre records',
      count: a.count,
    }
  })
}

/** Removed tyres with life km and CPK per tyre (null when unmeasurable). */
export function removedRegister(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => lc(r.status) === 'removed')
    .map((r) => {
      const life = computeAvgTyreLife([r])
      const cpk = computeCpkFleet([r])
      return {
        id: r.id,
        serial_no: r.serial_no || null,
        asset_no: r.asset_no || null,
        brand: r.brand || null,
        size: r.size || null,
        site: r.site || null,
        position: r.position || r.tyre_position || null,
        reason: cleanRemovalReason(r.removal_reason) || null,
        removed_on: r.removal_date || null,
        lifeKm: life.validCount > 0 ? Math.round(life.avgKm) : null,
        cpk: cpk.validCount > 0 ? cpk.fleetAvgCpk : null,
      }
    })
}

/** Distinct option lists for the filter bar. */
export function filterOptions(rows = []) {
  const uniq = (k) => [...new Set((rows || []).map((r) => r[k]).filter(Boolean))].sort()
  return { sites: uniq('site'), brands: uniq('brand') }
}

export const ASSET_EXPORT_COLS = ['asset_no', 'avgCpk', 'totalCost', 'costSource', 'count']
export const ASSET_EXPORT_HEADERS = ['Asset', 'Avg CPK', 'Total cost', 'Cost source', 'Tyres']
export const REMOVED_EXPORT_COLS = ['serial_no', 'asset_no', 'brand', 'size', 'site', 'position', 'reason', 'removed_on', 'lifeKm', 'cpk']
export const REMOVED_EXPORT_HEADERS = ['Serial', 'Asset', 'Brand', 'Size', 'Site', 'Position', 'Removal reason', 'Removed on', 'Life (km)', 'CPK']

const na = (v) => (v == null || v === '' ? 'N/A' : v)

/** Export rows; money columns read N/A when the scope mixes currencies. */
export function assetExportRows(list = [], { money = true } = {}) {
  return (list || []).map((a) => ({
    asset_no: na(a.asset_no),
    avgCpk: money ? na(a.avgCpk == null ? null : Math.round(a.avgCpk * 1000) / 1000) : 'N/A',
    totalCost: money ? na(a.totalCost == null ? null : Math.round(a.totalCost * 100) / 100) : 'N/A',
    costSource: a.costSource,
    count: a.count,
  }))
}

export function removedExportRows(list = [], { money = true } = {}) {
  return (list || []).map((r) => ({
    serial_no: na(r.serial_no), asset_no: na(r.asset_no), brand: na(r.brand), size: na(r.size),
    site: na(r.site), position: na(r.position), reason: na(r.reason), removed_on: na(r.removed_on),
    lifeKm: na(r.lifeKm),
    cpk: money ? na(r.cpk == null ? null : Math.round(r.cpk * 1000) / 1000) : 'N/A',
  }))
}
