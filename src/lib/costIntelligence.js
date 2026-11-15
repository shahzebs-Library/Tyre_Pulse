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

// ROAD VEHICLE WORDS (ENG-4, audit case C20b). The keyword lists above match by
// substring, so WATER TANKER, LOW LOADER TRAILER, CONCRETE MIXER TRUCK, CRANE
// TRUCK and ROLLER SHUTTER VAN were all measured in engine hours: road vehicles
// with no hour meter, which then showed no CPK at all. A type that names a road
// vehicle as a whole word is measured in km, unless it also names a machine that
// genuinely runs on an hour meter (a truck mounted concrete pump, a generator
// trailer). Verified read-only against every vehicle type in the live fleet,
// tyre and expense tables on 2026-11-12: no existing type changes unit.
// MIRROR of the SQL draft 20261113123000 (cpk_unit_for_asset_type). Change both.
const ROAD_VEHICLE_RE = /(^|[^a-z0-9_])(tanker|trailer|truck|lorry|van|bus|pickup|pick up|pick-up|car|suv|mixer|prime mover|tractor head)([^a-z0-9_]|$)/
const HOUR_MACHINE_RE = /(^|[^a-z0-9_])(pump|pumps|generator|genset|gen set|compressor|excavator|forklift|dozer|grader)([^a-z0-9_]|$)/

/** True when the type names a road vehicle and no hour-metered machine. */
export function isRoadVehicleType(type) {
  const s = String(type || '').toLowerCase()
  return ROAD_VEHICLE_RE.test(s) && !HOUR_MACHINE_RE.test(s)
}

/**
 * The running unit that best expresses cost for an asset type.
 * @param {string} type  a vehicle / asset type label (any casing)
 * @returns {'m3'|'engine_hours'|'km'}
 */
export function runningUnitForAssetType(type) {
  const s = String(type || '').toLowerCase()
  if (isRoadVehicleType(s)) return 'km'
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
 * CPK running unit for an asset type, collapsed to the two units cost-per-km can
 * actually measure: 'km' for road assets, 'engine_hours' for power / plant assets.
 * An m3 asset (pumps, batching, water treatment) is measured by engine-hours here
 * because there is no reliable per-asset m3 series to divide by. This reuses the
 * keyword map in runningUnitForAssetType so there is ONE keyword truth in JS.
 *
 * MIRROR: this MUST stay equivalent to the SQL public.cpk_unit_for_asset_type()
 * used by get_fleet_cpk (V433). Change BOTH together, and keep the SQL similar-to
 * keyword list = M3_KEYWORDS + HOUR_KEYWORDS above.
 * KNOWN GAP UNTIL DRAFT 20261113123000 IS APPLIED: the road vehicle override
 * (isRoadVehicleType) exists here and in that draft, not yet in the live SQL.
 * No vehicle type in the live data is affected (measured 2026-11-12), so the
 * two sides agree on every existing row; they differ only for type names a new
 * tenant might use (WATER TANKER, LOW LOADER TRAILER, CONCRETE MIXER TRUCK).
 *
 * @param {string} type asset / vehicle type label (any casing)
 * @returns {'km'|'engine_hours'}
 */
export function cpkUnitForAssetType(type) {
  return runningUnitForAssetType(type) === 'km' ? 'km' : 'engine_hours'
}

/**
 * Normalise one raw asset row into a CPK object. The denominator is chosen by the
 * asset's CPK unit (km for road, engine_hours for plant). CPK is cost / denominator
 * and is null when the denominator is 0 (honest, never fabricated). Costs and the
 * denominator can be supplied directly (distance_or_hours), or km / hours passed and
 * the right one selected by unit.
 *
 * @param {{ country?:string, asset_no?:string, vehicle_type?:string, currency?:string,
 *   unit?:'km'|'engine_hours', distance_or_hours?:number, km?:number, hours?:number,
 *   tyre_cost?:number, maintenance_cost?:number }} row
 */
export function assetCpk(row = {}) {
  const unit = row.unit === 'km' || row.unit === 'engine_hours'
    ? row.unit
    : cpkUnitForAssetType(row.vehicle_type)
  const denomRaw = row.distance_or_hours != null
    ? row.distance_or_hours
    : (unit === 'km' ? row.km : row.hours)
  const denom = posOrNull(denomRaw)
  const tyreCost = num(row.tyre_cost)
  const maintenanceCost = num(row.maintenance_cost)
  const totalCost = tyreCost + maintenanceCost
  return {
    country: row.country ?? null,
    asset_no: row.asset_no ?? null,
    vehicle_type: row.vehicle_type ?? null,
    currency: row.currency ?? row.country ?? null,
    unit,
    distanceOrHours: denom == null ? 0 : denom,
    tyreCost,
    maintenanceCost,
    totalCost,
    cpkTyre: denom == null ? null : tyreCost / denom,
    cpkTotal: denom == null ? null : totalCost / denom,
  }
}

/**
 * Roll raw per-asset rows up into the per-vehicle / by-type / fleet CPK views the
 * UI renders. Mirrors the shape of the get_fleet_cpk RPC so a caller can use either
 * the server aggregate or this client roll-up. Rules that keep it honest:
 *  - CPK divides ONLY matched cost (assets that have the denominator) by the matched
 *    distance / hours, and reports coverage - never whole-group cost over part-group
 *    distance.
 *  - The fleet view splits km-unit and hour-unit assets (a blended /km+/hour figure
 *    is meaningless) and never mixes currencies (grouped by country).
 *
 * @param {Array<object>} rows raw asset rows (see assetCpk)
 * @returns {{ perVehicle:Array, byType:Array, fleet:Array }}
 */
export function rollupFleetCpk(rows = []) {
  const assets = (Array.isArray(rows) ? rows : []).map(assetCpk)

  // per-vehicle: cost-bearing assets, richest first
  const perVehicle = assets
    .filter((a) => a.totalCost > 0)
    .sort((a, b) => b.totalCost - a.totalCost)

  // by-type: group by country + vehicle_type + unit
  const typeMap = new Map()
  for (const a of assets) {
    if (!a.vehicle_type) continue
    const key = `${a.country}\u0000${a.vehicle_type}\u0000${a.unit}`
    let g = typeMap.get(key)
    if (!g) {
      g = {
        country: a.country, currency: a.currency, vehicle_type: a.vehicle_type, unit: a.unit,
        assets: 0, assetsMeasured: 0, tyreCost: 0, maintenanceCost: 0, totalCost: 0,
        distanceOrHours: 0, matchedTyre: 0, matchedTotal: 0,
      }
      typeMap.set(key, g)
    }
    g.assets += 1
    g.tyreCost += a.tyreCost
    g.maintenanceCost += a.maintenanceCost
    g.totalCost += a.totalCost
    if (a.distanceOrHours > 0) {
      g.assetsMeasured += 1
      g.distanceOrHours += a.distanceOrHours
      g.matchedTyre += a.tyreCost
      g.matchedTotal += a.totalCost
    }
  }
  const byType = [...typeMap.values()]
    .map((g) => ({
      country: g.country, currency: g.currency, vehicle_type: g.vehicle_type, unit: g.unit,
      assets: g.assets, assetsMeasured: g.assetsMeasured,
      tyreCost: g.tyreCost, maintenanceCost: g.maintenanceCost, totalCost: g.totalCost,
      distanceOrHours: g.distanceOrHours,
      cpkTyre: g.distanceOrHours > 0 ? g.matchedTyre / g.distanceOrHours : null,
      cpkTotal: g.distanceOrHours > 0 ? g.matchedTotal / g.distanceOrHours : null,
    }))
    .sort((a, b) => b.totalCost - a.totalCost)

  // fleet: group by country, split km vs hours
  const fleetMap = new Map()
  const side = () => ({ sum: 0, tyreMatched: 0, totalMatched: 0, costAssets: 0, measuredAssets: 0 })
  for (const a of assets) {
    let g = fleetMap.get(a.country)
    if (!g) {
      g = { country: a.country, currency: a.currency, tyreCost: 0, maintenanceCost: 0, totalCost: 0, km: side(), hours: side() }
      fleetMap.set(a.country, g)
    }
    g.tyreCost += a.tyreCost
    g.maintenanceCost += a.maintenanceCost
    g.totalCost += a.totalCost
    const s = a.unit === 'km' ? g.km : g.hours
    if (a.distanceOrHours > 0) s.sum += a.distanceOrHours
    if (a.totalCost > 0) {
      s.costAssets += 1
      if (a.distanceOrHours > 0) {
        s.measuredAssets += 1
        s.tyreMatched += a.tyreCost
        s.totalMatched += a.totalCost
      }
    }
  }
  const sideOut = (s) => ({
    total: s.sum,
    costAssets: s.costAssets,
    measuredAssets: s.measuredAssets,
    coveragePct: s.costAssets > 0 ? (100 * s.measuredAssets) / s.costAssets : null,
    tyreCostMatched: s.tyreMatched,
    totalCostMatched: s.totalMatched,
    cpkTyre: s.sum > 0 ? s.tyreMatched / s.sum : null,
    cpkTotal: s.sum > 0 ? s.totalMatched / s.sum : null,
  })
  const fleet = [...fleetMap.values()]
    .map((g) => ({
      country: g.country, currency: g.currency,
      tyreCost: g.tyreCost, maintenanceCost: g.maintenanceCost, totalCost: g.totalCost,
      km: sideOut(g.km), hours: sideOut(g.hours),
    }))
    .sort((a, b) => String(a.country).localeCompare(String(b.country)))

  return { perVehicle, byType, fleet }
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
