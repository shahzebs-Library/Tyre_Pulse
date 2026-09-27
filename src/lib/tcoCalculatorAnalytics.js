/**
 * tcoCalculatorAnalytics - pure page-side logic for /tco-calculator. Zero I/O.
 *
 * The TCO models live in src/lib/tco.js (computeTco what-if projection and
 * computeFleetActuals real-data rollup) and the canonical fleet CPK in
 * kpiEngine.computeCpkFleet; all are REUSED, never re-derived. This module owns
 * the page's filtering / KPI / export logic and the honesty layer over those
 * engines:
 *
 *  - computeTco returns 0 for cost-per-km / per-vehicle / per-year when the
 *    denominator is 0. `honestWhatIf` turns those into null ("N/A").
 *  - The savings model falls back to an ASSUMED average tyre cost when no
 *    recorded price exists. `savingsView` says so, returns per-vehicle null
 *    when there is no vehicle, and never divides a bar width by a fabricated 1.
 */
import { recordKm, CPK_BANDS } from './tco'

export const CPK_BAND_ORDER = ['excellent', 'good', 'average', 'poor', 'critical']
export const BAND_LABEL = {
  excellent: 'Excellent', good: 'Good', average: 'Average', poor: 'Poor', critical: 'Critical',
}

/** Null-safe what-if outputs: a ratio with a zero denominator is null, not 0. */
export function honestWhatIf(r) {
  if (!r) return null
  const hasKm = r.fleetLifetimeKm > 0
  const hasVehicles = r.vehicles > 0
  const hasYears = r.ownershipYears > 0
  return {
    ...r,
    costPerKm: hasKm ? r.costPerKm : null,
    costPerVehicleKm: r.kmPerVehicleLifetime > 0 ? r.costPerVehicleKm : null,
    tcoPerVehicle: hasVehicles ? r.tcoPerVehicle : null,
    tcoPerYear: hasYears ? r.tcoPerYear : null,
    fleetLifetimeKm: hasKm ? r.fleetLifetimeKm : null,
  }
}

/** Whether ANY record carries a real (positive) tyre price. */
export function hasMeasuredTyreCost(records = []) {
  return (records || []).some((r) => {
    const n = Number(r?.cost_per_tyre)
    return Number.isFinite(n) && n > 0
  })
}

/**
 * Savings view with honest denominators. `measuredCost` says whether the avg
 * tyre cost is from recorded prices (true) or the model's assumption (false).
 * Each initiative gets a `sharePct` of the largest one; null when all are 0.
 */
export function savingsView(savings, { measuredCost = true } = {}) {
  const list = Array.isArray(savings?.initiatives) ? savings.initiatives : []
  const max = list.reduce((m, i) => Math.max(m, Number(i.annual) || 0), 0)
  return {
    ...savings,
    measuredCost,
    perVehicle: savings?.vehicleCount > 0 ? savings.perVehicle : null,
    initiatives: list.map((i) => ({
      ...i,
      sharePct: max > 0 ? Math.round(((Number(i.annual) || 0) / max) * 100) : null,
    })),
  }
}

/** Per-asset filter: search (asset / vehicle type), band, vehicle type, km coverage. */
export function filterAssets(assets = [], { search = '', band = 'all', vehicleType = '', km = 'all' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (assets || []).filter((a) => {
    if (!a) return false
    if (band === 'none' && a.band) return false
    if (band !== 'all' && band !== 'none' && a.band !== band) return false
    if (vehicleType && (a.vehicle_type || '') !== vehicleType) return false
    if (km === 'with' && !(a.km > 0)) return false
    if (km === 'without' && a.km > 0) return false
    if (q && !`${a.asset_no || ''} ${a.vehicle_type || ''}`.toLowerCase().includes(q)) return false
    return true
  })
}

export function vehicleTypeOptions(assets = []) {
  return [...new Set((assets || []).map((a) => a?.vehicle_type).filter(Boolean))].sort()
}

/** Band counts + km coverage across per-asset rows. */
export function assetKpis(assets = []) {
  const list = (assets || []).filter(Boolean)
  const bands = Object.fromEntries(CPK_BAND_ORDER.map((b) => [b, 0]))
  let withKm = 0
  for (const a of list) {
    if (a.band && bands[a.band] != null) bands[a.band] += 1
    if (a.km > 0) withKm += 1
  }
  const total = list.length
  return {
    total,
    withKm,
    withoutKm: total - withKm,
    kmCoveragePct: total > 0 ? Math.round((withKm / total) * 100) : null,
    bands,
    atRisk: bands.poor + bands.critical,
  }
}

/** Share of records whose km could be measured (null when there are no records). */
export function recordKmCoverage(records = []) {
  const list = (records || []).filter(Boolean)
  if (!list.length) return null
  const measured = list.filter((r) => recordKm(r) > 0).length
  return Math.round((measured / list.length) * 100)
}

/** The CPK ratio ceiling for each band, for an on-page legend. */
export function bandLegend() {
  return CPK_BANDS.map(([band, ceiling]) => ({ band, label: BAND_LABEL[band], ceiling }))
    .concat([{ band: 'critical', label: BAND_LABEL.critical, ceiling: null }])
}

export const ASSET_EXPORT_COLUMNS = [
  { key: 'asset_no', header: 'Asset' },
  { key: 'vehicle_type', header: 'Vehicle Type' },
  { key: 'tyre_procurement', header: 'Tyre Spend' },
  { key: 'km', header: 'Km' },
  { key: 'cost_per_km', header: 'Cost/km' },
  { key: 'percentile', header: 'Percentile' },
  { key: 'band', header: 'Band' },
  { key: 'tyre_count', header: 'Records' },
]

export function assetExportRows(assets = []) {
  return (assets || []).filter(Boolean).map((a) => ({
    asset_no: a.asset_no,
    vehicle_type: a.vehicle_type || 'N/A',
    tyre_procurement: a.tyre_procurement,
    km: a.km > 0 ? a.km : 'N/A',
    cost_per_km: a.cost_per_km ?? 'N/A',
    percentile: a.percentile == null ? 'N/A' : `P${a.percentile}`,
    band: a.band ? BAND_LABEL[a.band] || a.band : 'N/A',
    tyre_count: a.tyre_count,
  }))
}

export const BENCHMARK_EXPORT_COLUMNS = [
  { key: 'type', header: 'Vehicle Type' },
  { key: 'benchmarkCpk', header: 'Benchmark Cost/km' },
  { key: 'actualCpk', header: 'Actual Cost/km' },
  { key: 'assetCount', header: 'Assets' },
  { key: 'variancePct', header: 'Variance %' },
]

export function benchmarkExportRows(benchmarks = []) {
  return (benchmarks || []).map((b) => ({
    type: b.type,
    benchmarkCpk: b.benchmarkCpk,
    actualCpk: b.actualCpk ?? 'N/A',
    assetCount: b.assetCount,
    variancePct: b.variancePct ?? 'N/A',
  }))
}
