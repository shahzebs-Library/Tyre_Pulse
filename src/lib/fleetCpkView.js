/**
 * fleetCpkView - pure, no-I/O render helpers for the unit-aware Fleet CPK section
 * on the Engineering KPI page. Keeps the "N/A when no denominator" honesty and the
 * per-country / worst-CPK ordering testable, out of the JSX.
 *
 * The data shape comes from the get_fleet_cpk RPC (see src/lib/api/fleetCpk.js).
 * A cpk value is NULL when its distance/hours denominator is 0; these helpers
 * render that as "N/A", never a fabricated 0.
 */
import { UNIT_META } from './costIntelligence'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** '/km' or '/hour' suffix for a unit ('km' | 'engine_hours'). */
export function unitSuffix(unit) {
  return UNIT_META[unit]?.suffix || '/km'
}

/** 'km' or 'hour' short label for a unit. */
export function unitLabel(unit) {
  return UNIT_META[unit]?.label || 'km'
}

/**
 * Format a CPK figure for display. Null / non-finite -> "N/A" (no denominator).
 * @param {number|null} value cost per unit
 * @param {string} currency  e.g. 'SAR'
 * @param {'km'|'engine_hours'} unit
 * @returns {string}
 */
export function fmtCpkValue(value, currency, unit) {
  if (value == null || !Number.isFinite(Number(value))) return 'N/A'
  return `${currency} ${Number(value).toFixed(4)}${unitSuffix(unit)}`
}

/** Format a distance/hours figure with its unit label. */
export function fmtDistance(value, unit) {
  const n = num(value)
  if (n <= 0) return 'N/A'
  return `${Math.round(n).toLocaleString()} ${unitLabel(unit)}`
}

/** Format a money amount (rounded, thousands-separated) with its currency. */
export function fmtMoney(value, currency) {
  return `${currency} ${Math.round(num(value)).toLocaleString()}`
}

/** Format a coverage percentage; null -> "N/A". */
export function fmtCoverage(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return 'N/A'
  return `${Number(pct).toFixed(0)}%`
}

/**
 * Order by-type rows worst-CPK first. Rows with a real cpk_total sort ahead of
 * rows without one (a missing denominator is not "best"); ties break on total_cost.
 * @param {Array<object>} rows by_type rows from get_fleet_cpk
 * @returns {Array<object>} a new sorted array
 */
export function sortByTypeWorstFirst(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const ca = a?.cpk_total
    const cb = b?.cpk_total
    const aHas = ca != null && Number.isFinite(Number(ca))
    const bHas = cb != null && Number.isFinite(Number(cb))
    if (aHas && bHas) {
      if (Number(cb) !== Number(ca)) return Number(cb) - Number(ca)
      return num(b?.total_cost) - num(a?.total_cost)
    }
    if (aHas) return -1
    if (bHas) return 1
    return num(b?.total_cost) - num(a?.total_cost)
  })
}

/**
 * Filter + sort per-vehicle rows for the searchable table (richest cost first).
 * @param {Array<object>} rows per_vehicle rows
 * @param {string} [search] case-insensitive match on asset_no or vehicle_type
 * @returns {Array<object>}
 */
export function filterPerVehicle(rows = [], search = '') {
  const q = String(search || '').trim().toLowerCase()
  const list = (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!q) return true
    return (
      String(r?.asset_no || '').toLowerCase().includes(q) ||
      String(r?.vehicle_type || '').toLowerCase().includes(q)
    )
  })
  return list.sort((a, b) => num(b?.total_cost) - num(a?.total_cost))
}

/**
 * Flatten the fleet per-country array into tile view-models (one km tile + one
 * hour tile per country), so a page can render each side with its own currency,
 * coverage and unregistered-spend note. Only emits a side when it carries cost.
 * @param {Array<object>} fleet fleet rows from get_fleet_cpk
 * @returns {Array<object>} tiles
 */
export function fleetTiles(fleet = []) {
  const out = []
  for (const f of Array.isArray(fleet) ? fleet : []) {
    const currency = f?.currency || f?.country || ''
    const sides = [
      { unit: 'km', s: f?.km },
      { unit: 'engine_hours', s: f?.hours },
    ]
    for (const { unit, s } of sides) {
      if (!s) continue
      const cost = num(s.total_cost_matched ?? s.totalCostMatched)
      const distance = num(s.total ?? s.distance_or_hours)
      const hasAny = cost > 0 || distance > 0
      if (!hasAny) continue
      out.push({
        country: f?.country ?? null,
        currency,
        unit,
        cpkTyre: s.cpk_tyre ?? s.cpkTyre ?? null,
        cpkTotal: s.cpk_total ?? s.cpkTotal ?? null,
        coveragePct: s.coverage_pct ?? s.coveragePct ?? null,
        distance,
      })
    }
  }
  return out
}

/** Rows for the by-type Excel/PDF export (flat, string-safe). */
export function byTypeExportRows(rows = [], _currency) {
  return sortByTypeWorstFirst(rows).map((r) => ({
    country: r?.country ?? '',
    vehicle_type: r?.vehicle_type ?? '',
    unit: unitLabel(r?.unit),
    distance: Math.round(num(r?.distance_or_hours)),
    tyre_cost: Math.round(num(r?.tyre_cost)),
    total_cost: Math.round(num(r?.total_cost)),
    cpk_tyre: r?.cpk_tyre == null ? 'N/A' : Number(r.cpk_tyre).toFixed(4),
    cpk_total: r?.cpk_total == null ? 'N/A' : Number(r.cpk_total).toFixed(4),
  }))
}
