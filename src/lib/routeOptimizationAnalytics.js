/**
 * Route Optimization analytics (pure, no I/O) behind /route-optimization.
 *
 * Builds on src/lib/routePlans.js (computeSavings, toFiniteNumber): every
 * saving is recomputed from the entered baseline and planned distances, never
 * read from a stored column that could be stale. Adds per-plan enrichment,
 * filters, the KPI strip, a monthly distance series, a status breakdown and
 * export rows.
 *
 * Honesty: a figure with nothing to measure is null (N/A), never 0. A plan
 * with no baseline or no planned distance has no saving, not a zero saving.
 * `now` is injectable so date-relative filters are deterministic in tests.
 */
import { computeSavings, toFiniteNumber } from './routePlans'

export const ROUTE_STATUSES = ['draft', 'optimized', 'dispatched', 'completed']
export const ROUTE_STATUS_LABEL = { draft: 'Draft', optimized: 'Optimized', dispatched: 'Dispatched', completed: 'Completed' }
export const EMPTY_ROUTE_FILTERS = { search: '', status: '', asset: '', driver: '', from: '', to: '' }

const str = (v) => (v == null ? '' : String(v).trim())
const round1 = (n) => Math.round(n * 10) / 10
const dayOf = (v) => {
  const s = str(v)
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]
  if (!s) return ''
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

export function statusLabel(s) {
  return ROUTE_STATUS_LABEL[s] || (str(s) ? str(s).charAt(0).toUpperCase() + str(s).slice(1) : 'Draft')
}

/** Per-plan derived figures. Saved km/% are null when the plan cannot be measured. */
export function enrichPlan(plan = {}) {
  const total = toFiniteNumber(plan.total_distance_km)
  const optimized = toFiniteNumber(plan.optimized_distance_km)
  const stops = toFiniteNumber(plan.stops_count)
  const measurable = total != null && total > 0 && optimized != null && optimized >= 0
  const { savingsKm, savingsPct } = computeSavings(plan)
  const savedKm = measurable ? round1(Math.max(0, savingsKm)) : null
  const savedPct = measurable ? round1(savingsPct) : null
  const kmPerStop = optimized != null && stops != null && stops > 0 ? round1(optimized / stops) : null
  return {
    ...plan,
    _total: total,
    _optimized: optimized,
    _stops: stops,
    _measurable: measurable,
    _savedKm: savedKm,
    _savedPct: savedPct,
    _worse: measurable && savingsKm < 0,
    _kmPerStop: kmPerStop,
    _day: dayOf(plan.plan_date),
    _statusLabel: statusLabel(plan.status),
  }
}

export function enrichPlans(rows = []) {
  return (Array.isArray(rows) ? rows : []).map(enrichPlan)
}

export function assetOptions(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => str(r?.asset_no)).filter(Boolean))].sort()
}
export function driverOptions(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => str(r?.driver_name)).filter(Boolean))].sort()
}

export function activeRouteFilterCount(f = EMPTY_ROUTE_FILTERS) {
  return ['search', 'status', 'asset', 'driver', 'from', 'to'].filter((k) => str(f[k])).length
}

export function filterPlans(enriched = [], f = EMPTY_ROUTE_FILTERS) {
  const q = str(f.search).toLowerCase()
  return (Array.isArray(enriched) ? enriched : []).filter((r) => {
    if (f.status && (r.status || 'draft') !== f.status) return false
    if (f.asset && str(r.asset_no) !== f.asset) return false
    if (f.driver && str(r.driver_name) !== f.driver) return false
    if (f.from && (!r._day || r._day < f.from)) return false
    if (f.to && (!r._day || r._day > f.to)) return false
    if (q) {
      const hay = `${r.plan_name || ''} ${r.asset_no || ''} ${r.driver_name || ''} ${r.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** KPI strip. Distances sum only what was entered; averages are null when nothing measurable. */
export function routeKpis(enriched = []) {
  const list = Array.isArray(enriched) ? enriched : []
  let baseline = 0
  let planned = 0
  let saved = 0
  let stops = 0
  let pctSum = 0
  let measured = 0
  let worse = 0
  let withDistance = 0
  const byStatus = Object.fromEntries(ROUTE_STATUSES.map((s) => [s, 0]))
  for (const r of list) {
    const s = r.status || 'draft'
    if (byStatus[s] != null) byStatus[s] += 1
    if (r._total != null) { baseline += r._total; withDistance += 1 }
    if (r._optimized != null) planned += r._optimized
    if (r._stops != null) stops += r._stops
    if (r._measurable) {
      measured += 1
      saved += r._savedKm
      pctSum += r._savedPct
      if (r._worse) worse += 1
    }
  }
  return {
    total: list.length,
    byStatus,
    baselineKm: withDistance ? round1(baseline) : null,
    plannedKm: withDistance ? round1(planned) : null,
    savedKm: measured ? round1(saved) : null,
    avgSavedPct: measured ? round1(pctSum / measured) : null,
    measured,
    unmeasured: list.length - measured,
    worse,
    totalStops: stops,
    avgKmPerStop: stops > 0 && planned > 0 ? round1(planned / stops) : null,
  }
}

/** Baseline vs planned km per plan month (YYYY-MM), oldest first. Undated plans excluded. */
export function monthlyDistance(enriched = []) {
  const m = new Map()
  for (const r of Array.isArray(enriched) ? enriched : []) {
    if (!r._day || !r._measurable) continue
    const key = r._day.slice(0, 7)
    const b = m.get(key) || { month: key, baseline: 0, planned: 0, saved: 0, plans: 0 }
    b.baseline += r._total
    b.planned += r._optimized
    b.saved += r._savedKm
    b.plans += 1
    m.set(key, b)
  }
  return [...m.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((b) => ({ ...b, baseline: round1(b.baseline), planned: round1(b.planned), saved: round1(b.saved) }))
}

export const ROUTE_EXPORT_COLUMNS = [
  ['plan_name', 'Plan'], ['asset_no', 'Asset'], ['driver_name', 'Driver'], ['plan_date', 'Plan date'],
  ['stops_count', 'Stops'], ['total_distance_km', 'Total (km)'], ['optimized_distance_km', 'Optimized (km)'],
  ['savings_km', 'Saved (km)'], ['savings_pct', 'Saved %'], ['km_per_stop', 'Km per stop'],
  ['estimated_duration_min', 'Duration (min)'], ['status', 'Status'],
]

export function routeExportRows(enriched = []) {
  return (Array.isArray(enriched) ? enriched : []).map((r) => ({
    plan_name: r.plan_name || '',
    asset_no: r.asset_no || '',
    driver_name: r.driver_name || '',
    plan_date: r.plan_date || '',
    stops_count: r.stops_count ?? '',
    total_distance_km: r.total_distance_km ?? '',
    optimized_distance_km: r.optimized_distance_km ?? '',
    savings_km: r._savedKm == null ? 'N/A' : r._savedKm,
    savings_pct: r._savedPct == null ? 'N/A' : r._savedPct,
    km_per_stop: r._kmPerStop == null ? 'N/A' : r._kmPerStop,
    estimated_duration_min: r.estimated_duration_min ?? '',
    status: r._statusLabel,
  }))
}
