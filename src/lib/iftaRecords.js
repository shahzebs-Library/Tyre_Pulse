/**
 * IFTA Fuel Tax Reporting — pure, dependency-free domain logic for the IFTA
 * module (/ifta-reporting). Reduces a set of jurisdiction fuel-tax records into
 * per-jurisdiction roll-ups and a fleet-level KPI summary used for quarterly
 * International Fuel Tax Agreement settlements.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/iftaRecords.js`) and page
 * (`src/pages/IftaReporting.jsx`) both build on these primitives so the roll-up
 * logic lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Fuel economy (km per litre) for a single record: distance_km / fuel_litres.
 * Returns null when either value is missing/non-numeric or fuel is zero (guards
 * divide-by-zero). Negative or zero distance still divides normally.
 *
 * @param {object} record
 * @returns {number|null}
 */
export function fuelEconomyKmPerL(record) {
  const distance = toFiniteNumber(record?.distance_km)
  const fuel = toFiniteNumber(record?.fuel_litres)
  if (distance == null || fuel == null) return null
  if (fuel === 0) return null
  return distance / fuel
}

/**
 * Roll records up by jurisdiction. For each distinct `jurisdiction` sums the
 * distance (km), fuel (litres), fuel cost, and taxable distance (km). Records
 * without a jurisdiction are grouped under "Unspecified". Result is sorted by
 * distanceKm descending (the natural IFTA reporting order — biggest exposure
 * first).
 *
 * @param {Array<object>} rows
 * @returns {Array<{ jurisdiction:string, distanceKm:number, fuelLitres:number,
 *                   fuelCost:number, taxableKm:number }>}
 */
export function byJurisdiction(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()
  for (const r of list) {
    const key = r?.jurisdiction != null && String(r.jurisdiction).trim()
      ? String(r.jurisdiction).trim()
      : 'Unspecified'
    const agg = map.get(key) || {
      jurisdiction: key, distanceKm: 0, fuelLitres: 0, fuelCost: 0, taxableKm: 0,
    }
    agg.distanceKm += toFiniteNumber(r?.distance_km) ?? 0
    agg.fuelLitres += toFiniteNumber(r?.fuel_litres) ?? 0
    agg.fuelCost += toFiniteNumber(r?.fuel_cost) ?? 0
    agg.taxableKm += toFiniteNumber(r?.taxable_km) ?? 0
    map.set(key, agg)
  }
  return [...map.values()].sort((a, b) => b.distanceKm - a.distanceKm)
}

/**
 * Summarise a set of IFTA records for the KPI header:
 *   • totalRecords         — number of rows
 *   • totalDistanceKm      — sum of distance across all rows (km)
 *   • totalFuelLitres      — sum of fuel across all rows (litres)
 *   • totalFuelCost        — sum of fuel cost across all rows
 *   • distinctJurisdictions— count of distinct jurisdictions
 *   • avgKmPerL            — fleet fuel economy = totalDistanceKm / totalFuelLitres
 *                            (null when no fuel recorded — guards divide-by-zero)
 *
 * @param {Array<object>} rows
 * @returns {{ totalRecords:number, totalDistanceKm:number, totalFuelLitres:number,
 *             totalFuelCost:number, distinctJurisdictions:number, avgKmPerL:number|null }}
 */
export function summariseIfta(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const jurisdictions = new Set()
  let totalDistanceKm = 0
  let totalFuelLitres = 0
  let totalFuelCost = 0

  for (const r of list) {
    const j = r?.jurisdiction != null ? String(r.jurisdiction).trim() : ''
    if (j) jurisdictions.add(j)
    totalDistanceKm += toFiniteNumber(r?.distance_km) ?? 0
    totalFuelLitres += toFiniteNumber(r?.fuel_litres) ?? 0
    totalFuelCost += toFiniteNumber(r?.fuel_cost) ?? 0
  }

  return {
    totalRecords: list.length,
    totalDistanceKm,
    totalFuelLitres,
    totalFuelCost,
    distinctJurisdictions: jurisdictions.size,
    avgKmPerL: totalFuelLitres > 0 ? totalDistanceKm / totalFuelLitres : null,
  }
}
