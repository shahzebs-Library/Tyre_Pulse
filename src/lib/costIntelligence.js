/**
 * costIntelligence.js - pure helpers (no I/O) for a unit-aware cost metric:
 * cost per cubic metre (m3), cost per kilometre (km), and cost per engine-hour.
 *
 * The maths is deliberately trivial and HONEST: a per-unit cost is
 * expenses / running-units, and it is only produced when the running total is a
 * positive finite number. When m3 / km / hours are unavailable the value is
 * `null` (never a fabricated number) so the UI can fall back to plain expenses.
 *
 * Expenses come from the existing Tyres / General(Maintenance) / Combined split
 * via costSources.pickCost - this module does NOT rebuild the cost split.
 */
import { pickCost } from './costSources'

const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0)
const posOrNull = (x) => {
  const n = Number(x)
  return Number.isFinite(n) && n > 0 ? n : null
}

// Keyword -> running-unit map. Volume assets (pumps, water treatment) measure
// output in m3; power assets (generators) in engine-hours; everything else in km.
const M3_KEYWORDS = ['pump', 'water', 'treatment', 'concrete', 'batching', 'plaster', 'grout', 'slurry']
const HOUR_KEYWORDS = ['generator', 'genset', 'gen set', 'compressor', 'excavator', 'loader', 'crane', 'forklift', 'dozer', 'grader', 'roller']

/**
 * The running unit that best expresses cost for an asset type.
 * @param {string} type  a vehicle / asset type label (any casing)
 * @returns {'m3'|'engine_hours'|'km'}
 */
export function runningUnitForAssetType(type) {
  const s = String(type || '').toLowerCase()
  if (M3_KEYWORDS.some((k) => s.includes(k))) return 'm3'
  if (HOUR_KEYWORDS.some((k) => s.includes(k))) return 'engine_hours'
  return 'km'
}

/** Human label + suffix for a running unit. */
export const UNIT_META = {
  m3: { label: 'm3', suffix: '/m3' },
  km: { label: 'km', suffix: '/km' },
  engine_hours: { label: 'hour', suffix: '/hour' },
}

/**
 * Cost per running unit for a single unit selection.
 * @param {{ expenses:number, km?:number, hours?:number, m3?:number,
 *   unit:'m3'|'km'|'engine_hours' }} args
 * @returns {{ unit:string, running:number, value:number|null }}
 *   value is expenses/running when running>0, else null (honest, no fabrication).
 */
export function costPerUnit({ expenses, km, hours, m3, unit } = {}) {
  const exp = num(expenses)
  let runningRaw
  if (unit === 'm3') runningRaw = m3
  else if (unit === 'engine_hours') runningRaw = hours
  else runningRaw = km
  const running = posOrNull(runningRaw)
  return {
    unit: unit || 'km',
    running: running == null ? 0 : running,
    value: running == null ? null : exp / running,
  }
}

/**
 * Build the full unit-aware cost view for a period.
 * Expenses derive from the mode via pickCost(mode, split) - Combined / Tyres /
 * Maintenance(General). Each per-unit figure is null when its running total is
 * 0 / absent, so the caller falls back to the plain expenses figure.
 *
 * @param {{ split:{tyre:number,maintenance:number}, mode:string,
 *   km?:number, hours?:number, m3?:number }} args
 * @returns {{ expenses:number,
 *   perKm:{unit,running,value}, perHour:{unit,running,value}, perM3:{unit,running,value} }}
 */
export function buildCostIntelligence({ split = {}, mode = 'combined', km, hours, m3 } = {}) {
  const expenses = pickCost(mode, split)
  return {
    expenses,
    perKm: costPerUnit({ expenses, km, unit: 'km' }),
    perHour: costPerUnit({ expenses, hours, unit: 'engine_hours' }),
    perM3: costPerUnit({ expenses, m3, unit: 'm3' }),
  }
}
