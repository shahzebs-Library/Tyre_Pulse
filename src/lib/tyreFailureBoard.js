/**
 * tyreFailureBoard.js - PURE engine for the "Tyre Failure & CPK" board.
 *
 * No I/O, no React, no side effects. Reuses the shared CPK / tyre-life engine
 * (kpiEngine) so the maths is never re-implemented. Emits chart-data objects
 * WITHOUT colours (the page applies the shared reportColors palette via
 * stylize). Everything is honest: empty arrays / null when there is no data.
 * No em/en dashes in any string (ASCII only, "N/A" for missing).
 */
import {
  computeCpkFleet, computeCpkByBrand, computeCpkBySite, computeCpkByAsset,
  computeAvgTyreLife,
} from './kpiEngine'

/** Removed-status token (case-insensitive match). */
function isRemoved(r) {
  return String(r?.status || '').trim().toLowerCase() === 'removed'
}
function isActive(r) {
  return String(r?.status || '').trim().toLowerCase() === 'active'
}
function hasPrice(r) {
  const c = Number(r?.cost_per_tyre)
  return Number.isFinite(c) && c > 0
}

/** Round to n decimals, returning a finite number or 0. */
function round(v, n = 2) {
  const x = Number(v)
  if (!Number.isFinite(x)) return 0
  const f = 10 ** n
  return Math.round(x * f) / f
}

/** Count occurrences of keyFn(row) over rows -> [{ label, count }] sorted desc. */
function countBy(rows, keyFn) {
  const map = new Map()
  for (const r of rows) {
    const raw = keyFn(r)
    const key = raw == null || String(raw).trim() === '' ? 'Unknown' : String(raw).trim()
    map.set(key, (map.get(key) || 0) + 1)
  }
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
}

/** Build a single-dataset chart-data object (no colours). */
function chartData(labels, data, label) {
  return { labels, datasets: [{ label, data }] }
}

/**
 * Build the full Tyre Failure & CPK board from raw tyre_records rows.
 * @param {Object[]} records - tyre_records rows
 * @returns {{
 *   kpis: { totalCount:number, activeCount:number, removedCount:number,
 *           withPriceCount:number, fleetAvgCpk:(number|null),
 *           avgLifeKm:(number|null), failureRatePct:(number|null) },
 *   statusSplit: object, failureReasons: object, cpkByBrand: object,
 *   cpkBySite: object, lifeByBrand: object, byPosition: object,
 *   worstAssets: Array<{asset_no,avgCpk,totalCost,count}>
 * }}
 */
export function buildTyreFailureBoard(records = []) {
  const rows = Array.isArray(records) ? records : []

  const totalCount = rows.length
  const removed = rows.filter(isRemoved)
  const active = rows.filter(isActive)
  const removedCount = removed.length
  const activeCount = active.length
  const withPriceCount = rows.filter(hasPrice).length

  const cpkFleet = computeCpkFleet(rows)
  const life = computeAvgTyreLife(rows)

  const kpis = {
    totalCount,
    activeCount,
    removedCount,
    withPriceCount,
    fleetAvgCpk: cpkFleet.validCount > 0 ? round(cpkFleet.fleetAvgCpk, 3) : null,
    avgLifeKm: life.validCount > 0 ? Math.round(life.avgKm) : null,
    failureRatePct: totalCount > 0 ? round((removedCount / totalCount) * 100, 1) : null,
  }

  // Status split (Active vs Removed).
  const statusSplit = chartData(['Active', 'Removed'], [activeCount, removedCount], 'Tyres')

  // Failure reasons over removed tyres, sorted desc.
  const reasonRows = countBy(removed, (r) => r.removal_reason)
  const failureReasons = chartData(
    reasonRows.map((x) => x.label),
    reasonRows.map((x) => x.count),
    'Removed',
  )

  // CPK by brand / site (top ~12; brand ascending = best CPK first, site desc = worst first).
  const brandCpk = computeCpkByBrand(rows).slice(0, 12)
  const cpkByBrand = chartData(
    brandCpk.map((x) => x.brand),
    brandCpk.map((x) => round(x.avgCpk, 3)),
    'Avg CPK',
  )
  const siteCpk = computeCpkBySite(rows).slice(0, 12)
  const cpkBySite = chartData(
    siteCpk.map((x) => x.site),
    siteCpk.map((x) => round(x.avgCpk, 3)),
    'Avg CPK',
  )

  // Average tyre life by brand (top ~12 by km).
  const lifeBrand = (life.byBrand || []).slice(0, 12)
  const lifeByBrand = chartData(
    lifeBrand.map((x) => x.brand),
    lifeBrand.map((x) => Math.round(x.avgKm)),
    'Avg life km',
  )

  // Removed tyres grouped by position.
  const posRows = countBy(removed, (r) => r.position)
  const byPosition = chartData(
    posRows.map((x) => x.label),
    posRows.map((x) => x.count),
    'Removed',
  )

  // Worst assets by CPK (top 10).
  const worstAssets = computeCpkByAsset(rows).slice(0, 10).map((a) => ({
    asset_no: a.asset_no,
    avgCpk: round(a.avgCpk, 3),
    totalCost: round(a.totalCost, 2),
    count: a.count,
  }))

  return {
    kpis, statusSplit, failureReasons, cpkByBrand, cpkBySite,
    lifeByBrand, byPosition, worstAssets,
  }
}
