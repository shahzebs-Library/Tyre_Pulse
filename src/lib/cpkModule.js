/**
 * cpkModule.js - pure, no-I/O helpers for the standalone CPK Intelligence module.
 *
 * Two jobs, both testable without a DOM or the network:
 *  1) PERIOD presets. The module deliberately loads a BOUNDED window (default the
 *     current month) rather than everything at once, per country. `periodBounds`
 *     turns a preset key + an anchor date into ISO {from,to} bounds.
 *  2) MOBILITY split. Every CPK row carries a `unit` ('km' | 'engine_hours') from
 *     cpk_unit_for_asset_type. MOVABLE assets are measured per km, NON-MOVABLE
 *     (generators / pumps / plant) per engine-hour. `splitByMobility` divides any
 *     row array on that field so the two are shown as separate, independent tables.
 *
 * The anchor date is always injected (never `new Date()` inside), so the presets
 * are deterministic in tests.
 */

/** Mobility of a CPK unit. movable = distance (km); non_movable = engine-hours. */
export function mobilityOfUnit(unit) {
  return unit === 'engine_hours' ? 'non_movable' : 'movable'
}

/** Display meta for each mobility class. */
export const MOBILITY_META = {
  movable: { key: 'movable', label: 'Movable', sublabel: 'cost per km', unit: 'km' },
  non_movable: { key: 'non_movable', label: 'Non-movable', sublabel: 'cost per hour', unit: 'engine_hours' },
}

/** Pad a number to 2 digits. */
const p2 = (n) => String(n).padStart(2, '0')
/** ISO YYYY-MM-DD for a Y/M(0-based)/D triple, built without timezone drift. */
const iso = (y, m0, d) => `${y}-${p2(m0 + 1)}-${p2(d)}`
/** Last calendar day of a 0-based month. */
const lastDay = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()

/**
 * The ordered preset list the module offers. `current_month` is the default so a
 * page never fetches the full history on open.
 */
export const CPK_PERIODS = [
  { key: 'week', label: 'Last 7 days' },
  { key: 'prev_week', label: 'Previous 7 days' },
  { key: 'current_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'last_12m', label: 'Last 12 months' },
]

export const DEFAULT_PERIOD = 'current_month'

/**
 * Resolve a preset key to ISO {from,to} bounds relative to an anchor date.
 * Unknown keys fall back to the current month. The anchor is read in UTC so the
 * bounds match the server's date arithmetic.
 *
 * @param {string} key one of CPK_PERIODS[].key
 * @param {Date} [anchor] the "now" to compute against (defaults to new Date())
 * @returns {{ from:string, to:string, key:string, label:string }}
 */
export function periodBounds(key = DEFAULT_PERIOD, anchor = new Date()) {
  const a = anchor instanceof Date && !Number.isNaN(anchor.getTime()) ? anchor : new Date()
  const y = a.getUTCFullYear()
  const m = a.getUTCMonth() // 0-based
  const d = a.getUTCDate()
  const meta = CPK_PERIODS.find((p) => p.key === key)
    || CPK_PERIODS.find((p) => p.key === DEFAULT_PERIOD)
    || CPK_PERIODS[0]
  let from
  let to
  switch (meta.key) {
    case 'week': {
      // Rolling 7-day window ending today (unambiguous for a weekly site report).
      const back = new Date(Date.UTC(y, m, d))
      back.setUTCDate(back.getUTCDate() - 6)
      from = iso(back.getUTCFullYear(), back.getUTCMonth(), back.getUTCDate())
      to = iso(y, m, d)
      break
    }
    case 'prev_week': {
      const end = new Date(Date.UTC(y, m, d)); end.setUTCDate(end.getUTCDate() - 7)
      const start = new Date(Date.UTC(y, m, d)); start.setUTCDate(start.getUTCDate() - 13)
      from = iso(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
      to = iso(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())
      break
    }
    case 'last_month': {
      const ly = m === 0 ? y - 1 : y
      const lm = m === 0 ? 11 : m - 1
      from = iso(ly, lm, 1)
      to = iso(ly, lm, lastDay(ly, lm))
      break
    }
    case 'quarter': {
      const q0 = Math.floor(m / 3) * 3
      from = iso(y, q0, 1)
      to = iso(y, m, d)
      break
    }
    case 'ytd': {
      from = iso(y, 0, 1)
      to = iso(y, m, d)
      break
    }
    case 'last_12m': {
      // 365-day trailing window ending today.
      const back = new Date(Date.UTC(y, m, d))
      back.setUTCDate(back.getUTCDate() - 365)
      from = iso(back.getUTCFullYear(), back.getUTCMonth(), back.getUTCDate())
      to = iso(y, m, d)
      break
    }
    case 'current_month':
    default: {
      from = iso(y, m, 1)
      to = iso(y, m, d)
      break
    }
  }
  return { from, to, key: meta.key, label: meta.label }
}

/** A short human label for a resolved {from,to,label}. */
export function periodLabel(bounds) {
  if (!bounds) return ''
  return `${bounds.label} (${bounds.from} to ${bounds.to})`
}

/**
 * Split any array of CPK rows (per_vehicle or by_type) into movable (km) and
 * non_movable (engine_hours) buckets by each row's `unit`. Rows with an unknown
 * unit are treated as movable (km is the default in cpk_unit_for_asset_type).
 *
 * @param {Array<{unit?:string}>} rows
 * @returns {{ movable:Array, non_movable:Array }}
 */
export function splitByMobility(rows = []) {
  const out = { movable: [], non_movable: [] }
  for (const r of Array.isArray(rows) ? rows : []) {
    out[mobilityOfUnit(r?.unit)].push(r)
  }
  return out
}

/**
 * Pick the fleet-side sub-object (km or hours) for a mobility class from a single
 * fleet[] country row, normalised to a flat shape the KPI strip can render. Returns
 * null when that side carries no cost and no distance (nothing to show).
 *
 * @param {object} fleetRow one element of get_fleet_cpk().fleet
 * @param {'movable'|'non_movable'} mobility
 */
export function fleetSideFor(fleetRow, mobility) {
  if (!fleetRow) return null
  const s = mobility === 'non_movable' ? fleetRow.hours : fleetRow.km
  if (!s) return null
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const cost = num(s.total_cost_matched ?? s.totalCostMatched)
  const distance = num(s.total_km ?? s.total_hours ?? s.total ?? s.distance_or_hours)
  if (cost <= 0 && distance <= 0) return null
  return {
    country: fleetRow.country ?? null,
    currency: fleetRow.currency ?? fleetRow.country ?? '',
    unit: MOBILITY_META[mobility].unit,
    cpkTyre: s.cpk_tyre ?? s.cpkTyre ?? null,
    cpkTotal: s.cpk_total ?? s.cpkTotal ?? null,
    coveragePct: s.coverage_pct ?? s.coveragePct ?? null,
    tyreCost: num(s.tyre_cost_matched ?? s.tyre_cost ?? s.tyreCost),
    totalCost: cost,
    distance,
    unregisteredCost: num(s.unregistered_cost ?? s.unregisteredCost),
  }
}
