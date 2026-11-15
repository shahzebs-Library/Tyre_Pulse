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
import { rowRate, tyreRateMetric, totalRateMetric, metricDef, TYRE_SPEND_RATIO_BASIS } from './cpkMetrics'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/**
 * Suffix for a get_fleet_cpk rate. The km side of that RPC divides by TYRE km
 * (lifetime km of tyres taken off in the period), never vehicle km, so the
 * suffix says so (ENG-1).
 */
export function unitSuffix(unit) {
  return unit === 'engine_hours' ? (UNIT_META.engine_hours?.suffix || '/hour') : ' per tyre km'
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
 * Order by-type rows worst rate first. The rate is `rowRate`: operating cost per
 * engine hour for plant, the tyre spend ratio for km assets (a total over tyre
 * km is withheld, ENG-1). Rows with a rate sort ahead of rows without one (a
 * missing denominator is not "best"); ties break on total_cost.
 * @param {Array<object>} rows by_type rows from get_fleet_cpk
 * @returns {Array<object>} a new sorted array
 */
export function sortByTypeWorstFirst(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const ca = rowRate(a)
    const cb = rowRate(b)
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
      // fleet km/hours sub-objects report distance as total_km / total_hours
      const distance = num(s.total_km ?? s.total_hours ?? s.total ?? s.distance_or_hours)
      const hasAny = cost > 0 || distance > 0
      if (!hasAny) continue
      out.push({
        country: f?.country ?? null,
        currency,
        unit,
        cpkTyre: s.cpk_tyre ?? s.cpkTyre ?? null,
        // km side: a total over tyre km is not a measurement (ENG-1), always null.
        cpkTotal: unit === 'km' ? null : (s.cpk_total ?? s.cpkTotal ?? null),
        coveragePct: s.coverage_pct ?? s.coveragePct ?? null,
        distance,
        // The one figure a tile may headline, and what it is called.
        rate: unit === 'km' ? (s.cpk_tyre ?? s.cpkTyre ?? null) : (s.cpk_total ?? s.cpkTotal ?? null),
        rateLabel: metricDef(unit === 'km' ? tyreRateMetric(unit) : totalRateMetric(unit))?.short || '',
        tyreLabel: metricDef(tyreRateMetric(unit))?.short || '',
      })
    }
  }
  return out
}

/**
 * The value cells of one fleet tile, already named from the glossary. An hour
 * tile has two (operating cost and tyre cost per engine hour). A km tile has
 * one, the tyre spend ratio: a total over tyre km does not exist (ENG-1).
 * @returns {Array<{ label:string, value:string, primary:boolean }>}
 */
export function tileCells(tile) {
  if (!tile) return []
  if (tile.unit === 'engine_hours') {
    return [
      { label: metricDef(totalRateMetric('engine_hours')).short, value: fmtCpkValue(tile.cpkTotal, tile.currency, tile.unit), primary: true },
      { label: metricDef(tyreRateMetric('engine_hours')).short, value: fmtCpkValue(tile.cpkTyre, tile.currency, tile.unit), primary: false },
    ]
  }
  return [
    { label: metricDef(tyreRateMetric('km')).short, value: fmtCpkValue(tile.cpkTyre, tile.currency, tile.unit), primary: true },
  ]
}

/** One line saying what a tile's figure is measured over. */
export function tileBasis(tile) {
  if (!tile) return ''
  return tile.unit === 'engine_hours'
    ? 'Period spend on plant with meter readings over their engine hours in the period.'
    : TYRE_SPEND_RATIO_BASIS
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
    cpk_total: r?.unit !== 'engine_hours' || r?.cpk_total == null ? 'N/A' : Number(r.cpk_total).toFixed(4),
  }))
}

/**
 * Column headers for a table of get_fleet_cpk rows of ONE mobility. The km side
 * has no total rate (ENG-1), so its header set omits it.
 * @param {'movable'|'non_movable'} mobility
 */
export function rateHeaders(mobility) {
  const unit = mobility === 'non_movable' ? 'engine_hours' : 'km'
  return {
    tyre: metricDef(tyreRateMetric(unit))?.short || '',
    total: totalRateMetric(unit) ? metricDef(totalRateMetric(unit)).short : null,
  }
}
