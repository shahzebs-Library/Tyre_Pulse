/**
 * loadPlanningAnalytics - pure presentation engine for the Load Planning
 * register (/load-planning). Utilisation and overload detection stay in
 * `src/lib/loadPlans.js`; this module owns what the PAGE derives: filters,
 * the utilisation band of each plan, the KPI strip, the status and route
 * breakdowns, the overload worklist and the export shape. No I/O.
 *
 * Honesty rule: `summariseLoadPlans` reports an average utilisation of 0 when
 * no plan carries a rated capacity. Zero reads as "trucks running empty", which
 * is a claim nobody measured, so the KPI strip here returns null (N/A) instead.
 */
import { summariseLoadPlans, utilization, isOverloaded, toFiniteNumber } from './loadPlans'

export const LOAD_STATUSES = Object.freeze(['draft', 'planned', 'loaded', 'dispatched', 'delivered'])
export const LOAD_BANDS = Object.freeze(['overloaded', 'near', 'ok', 'unmeasured'])
export const LOAD_BAND_LABEL = Object.freeze({ overloaded: 'Overloaded', near: 'Near capacity (90% or more)', ok: 'Within capacity', unmeasured: 'No rated capacity' })

const text = (v) => (v == null ? '' : String(v).trim())
const day = (v) => {
  const s = text(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

export function statusLabel(s) {
  const t = text(s)
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'N/A'
}

/** The worse of weight/volume utilisation for a plan, or null. */
export function peakUtilPct(plan) {
  const { weightPct, volumePct } = utilization(plan)
  if (weightPct == null && volumePct == null) return null
  return Math.max(weightPct ?? -Infinity, volumePct ?? -Infinity)
}

/** 'overloaded' | 'near' | 'ok' | 'unmeasured' */
export function loadBand(plan) {
  if (isOverloaded(plan)) return 'overloaded'
  const peak = peakUtilPct(plan)
  if (peak == null) return 'unmeasured'
  return peak >= 90 ? 'near' : 'ok'
}

export const LOAD_FILTERS = Object.freeze({ status: '', country: '', band: '', from: '', to: '', search: '' })

export function hasLoadFilters(f = LOAD_FILTERS) {
  return ['status', 'country', 'band', 'from', 'to', 'search'].some((k) => !!text(f[k]))
}

export function loadCountryOptions(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => text(r?.country)).filter(Boolean))].sort()
}

/** Attach utilisation, band, route text and date. */
export function loadTableRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const u = utilization(r)
    return {
      ...r,
      _weightPct: u.weightPct,
      _volumePct: u.volumePct,
      _band: loadBand(r),
      _over: isOverloaded(r),
      _route: r?.origin || r?.destination ? `${r?.origin || 'N/A'} to ${r?.destination || 'N/A'}` : null,
      _date: day(r?.plan_date),
      _weight: toFiniteNumber(r?.cargo_weight_kg),
    }
  })
}

export function filterLoadPlans(rows = [], f = LOAD_FILTERS) {
  const q = text(f.search).toLowerCase()
  const from = day(f.from)
  const to = day(f.to)
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (text(f.status) && text(r?.status) !== text(f.status)) return false
    if (text(f.country) && text(r?.country) !== text(f.country)) return false
    if (text(f.band) && loadBand(r) !== f.band) return false
    if (from || to) {
      const d = day(r?.plan_date)
      if (!d) return false
      if (from && d < from) return false
      if (to && d > to) return false
    }
    if (q) {
      const hay = `${r?.reference || ''} ${r?.asset_no || ''} ${r?.origin || ''} ${r?.destination || ''} ${r?.cargo_type || ''} ${r?.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

function mean(values) {
  const v = values.filter((x) => x != null)
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null
}

/** KPI strip with null averages when nothing is measurable. */
export function loadKpis(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const base = summariseLoadPlans(list)
  const utils = list.map(utilization)
  const bands = Object.fromEntries(LOAD_BANDS.map((b) => [b, 0]))
  for (const r of list) bands[loadBand(r)] += 1
  const measured = list.length - bands.unmeasured
  return {
    total: base.totalPlans,
    totalWeightKg: list.some((r) => toFiniteNumber(r?.cargo_weight_kg) != null) ? base.totalWeightKg : null,
    avgWeightUtilPct: mean(utils.map((u) => u.weightPct)),
    avgVolumeUtilPct: mean(utils.map((u) => u.volumePct)),
    overloaded: base.overloadedCount,
    overloadRatePct: measured ? Math.round((bands.overloaded / measured) * 1000) / 10 : null,
    dispatched: base.dispatchedCount,
    bands,
  }
}

/** Count per lifecycle status (canonical order, zero-filled, unknowns under 'other'). */
export function loadStatusBreakdown(rows = []) {
  const counts = Object.fromEntries(LOAD_STATUSES.map((s) => [s, 0]))
  let other = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    const s = text(r?.status).toLowerCase()
    if (counts[s] != null) counts[s] += 1
    else other += 1
  }
  return { counts, other }
}

/** Per-route (origin to destination) plans, overloads and planned tonnage. */
export function loadRouteRollup(rows = []) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!text(r?.origin) && !text(r?.destination)) continue
    const route = `${text(r?.origin) || 'N/A'} to ${text(r?.destination) || 'N/A'}`
    const g = map.get(route) || { route, plans: 0, overloaded: 0, weightKg: null }
    g.plans += 1
    if (isOverloaded(r)) g.overloaded += 1
    const w = toFiniteNumber(r?.cargo_weight_kg)
    if (w != null) g.weightKg = (g.weightKg ?? 0) + w
    map.set(route, g)
  }
  return [...map.values()].sort((a, b) => b.plans - a.plans || a.route.localeCompare(b.route))
}

/** Overloaded plans, worst peak utilisation first. */
export function overloadWorklist(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => isOverloaded(r))
    .map((r) => {
      const u = utilization(r)
      return { ...r, _peak: peakUtilPct(r), _weightPct: u.weightPct, _volumePct: u.volumePct }
    })
    .sort((a, b) => (b._peak ?? 0) - (a._peak ?? 0))
}

export const LOAD_EXPORT_COLS = [
  'reference', 'asset_no', 'origin', 'destination', 'plan_date', 'cargo_type',
  'cargo_weight_kg', 'max_payload_kg', 'weight_util', 'volume_m3', 'max_volume_m3',
  'volume_util', 'band', 'pallet_count', 'status', 'notes',
]
export const LOAD_EXPORT_HEADERS = [
  'Reference', 'Asset', 'Origin', 'Destination', 'Plan date', 'Cargo type',
  'Cargo weight (kg)', 'Max payload (kg)', 'Weight util %', 'Volume (m3)',
  'Max volume (m3)', 'Volume util %', 'Capacity band', 'Pallets', 'Status', 'Notes',
]

export function loadExportRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const u = utilization(r)
    return {
      reference: r?.reference || '', asset_no: r?.asset_no || '',
      origin: r?.origin || '', destination: r?.destination || '',
      plan_date: day(r?.plan_date) || '', cargo_type: r?.cargo_type || '',
      cargo_weight_kg: r?.cargo_weight_kg ?? '', max_payload_kg: r?.max_payload_kg ?? '',
      weight_util: u.weightPct ?? 'N/A', volume_m3: r?.volume_m3 ?? '',
      max_volume_m3: r?.max_volume_m3 ?? '', volume_util: u.volumePct ?? 'N/A',
      band: LOAD_BAND_LABEL[loadBand(r)],
      pallet_count: r?.pallet_count ?? '', status: statusLabel(r?.status), notes: r?.notes || '',
    }
  })
}
