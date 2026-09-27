/**
 * iftaReportingAnalytics - pure engine behind the IFTA Fuel Tax page
 * (/ifta-reporting). Builds on `src/lib/iftaRecords.js` (toFiniteNumber,
 * fuelEconomyKmPerL, byJurisdiction, summariseIfta) and adds filtering, the
 * per-currency cost split, a quarter roll-up, data-quality counts and the
 * standard IFTA net-tax estimate per jurisdiction.
 *
 * No I/O, no React.
 *
 * Honesty rules:
 *   - money is NEVER summed across currencies. `costByCurrency` returns one
 *     line per currency; a record with a cost but no currency sits under
 *     'Unspecified' so the gap is visible;
 *   - the net-tax estimate uses the IFTA method:
 *       taxable fuel = taxable distance / fleet km per litre
 *       net tax      = (taxable fuel - fuel bought there) * rate
 *     It is null when the fleet km/L is unmeasurable, the jurisdiction has no
 *     taxable distance, or its records carry no rate. If a jurisdiction's
 *     records disagree on the rate, the estimate is null and `rateConflict`
 *     is set, because picking one would be a guess.
 */
import { toFiniteNumber, fuelEconomyKmPerL, byJurisdiction, summariseIfta } from './iftaRecords'

export { fuelEconomyKmPerL }

/**
 * Filter IFTA records. All criteria optional.
 * @param {{ country?:string, quarter?:string, jurisdiction?:string, currency?:string,
 *           search?:string, incompleteOnly?:boolean }} f
 */
export function filterIftaRecords(rows, f = {}) {
  const list = Array.isArray(rows) ? rows : []
  const q = String(f.search || '').trim().toLowerCase()
  return list.filter((r) => {
    if (!r) return false
    if (f.country && r.country !== f.country) return false
    if (f.quarter && r.quarter !== f.quarter) return false
    if (f.jurisdiction && r.jurisdiction !== f.jurisdiction) return false
    if (f.currency && (r.currency || 'Unspecified') !== f.currency) return false
    if (f.incompleteOnly && recordGaps(r).length === 0) return false
    if (q) {
      const hay = [r.asset_no, r.driver_name, r.jurisdiction, r.quarter, r.notes].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Filing gaps on one record (the fields an IFTA return cannot do without). */
export function recordGaps(r) {
  const gaps = []
  if (!r?.jurisdiction || !String(r.jurisdiction).trim()) gaps.push('jurisdiction')
  if (!r?.quarter || !String(r.quarter).trim()) gaps.push('quarter')
  if (toFiniteNumber(r?.distance_km) == null) gaps.push('distance')
  if (toFiniteNumber(r?.fuel_litres) == null) gaps.push('fuel')
  if (toFiniteNumber(r?.fuel_cost) != null && !(r?.currency && String(r.currency).trim())) gaps.push('currency')
  return gaps
}

/** One line per currency: never a blended total. */
export function costByCurrency(rows) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const cost = toFiniteNumber(r?.fuel_cost)
    if (cost == null) continue
    const cur = r?.currency && String(r.currency).trim() ? String(r.currency).trim().toUpperCase() : 'Unspecified'
    const g = map.get(cur) || { currency: cur, cost: 0, records: 0, litres: 0 }
    g.cost += cost
    g.records += 1
    g.litres += toFiniteNumber(r?.fuel_litres) ?? 0
    map.set(cur, g)
  }
  return [...map.values()]
    .map((g) => ({ ...g, costPerLitre: g.litres > 0 ? g.cost / g.litres : null }))
    .sort((a, b) => b.cost - a.cost)
}

/** Distance / fuel / taxable distance per quarter, oldest first. */
export function quarterRollup(rows) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = r?.quarter && String(r.quarter).trim() ? String(r.quarter).trim() : 'Unspecified'
    const g = map.get(key) || { quarter: key, records: 0, distanceKm: 0, fuelLitres: 0, taxableKm: 0 }
    g.records += 1
    g.distanceKm += toFiniteNumber(r?.distance_km) ?? 0
    g.fuelLitres += toFiniteNumber(r?.fuel_litres) ?? 0
    g.taxableKm += toFiniteNumber(r?.taxable_km) ?? 0
    map.set(key, g)
  }
  return [...map.values()]
    .map((g) => ({ ...g, kmPerL: g.fuelLitres > 0 ? g.distanceKm / g.fuelLitres : null }))
    .sort((a, b) => (a.quarter === 'Unspecified') - (b.quarter === 'Unspecified')
      || a.quarter.localeCompare(b.quarter))
}

/**
 * Jurisdiction roll-up enriched with km/L and the IFTA net-tax estimate.
 * The estimate is in the jurisdiction's own tax units; it is NOT summed across
 * jurisdictions on screen because rates may be in different currencies.
 */
export function jurisdictionTax(rows) {
  const list = Array.isArray(rows) ? rows : []
  const fleetKmPerL = summariseIfta(list).avgKmPerL
  const rates = new Map()
  for (const r of list) {
    const key = r?.jurisdiction && String(r.jurisdiction).trim() ? String(r.jurisdiction).trim() : 'Unspecified'
    const rate = toFiniteNumber(r?.tax_rate)
    if (rate == null) continue
    if (!rates.has(key)) rates.set(key, new Set())
    rates.get(key).add(rate)
  }
  return byJurisdiction(list).map((j) => {
    const set = rates.get(j.jurisdiction)
    const rateConflict = !!set && set.size > 1
    const rate = set && set.size === 1 ? [...set][0] : null
    const taxableFuelL = fleetKmPerL != null && fleetKmPerL > 0 && j.taxableKm > 0
      ? j.taxableKm / fleetKmPerL : null
    const netTax = taxableFuelL != null && rate != null
      ? Math.round((taxableFuelL - j.fuelLitres) * rate * 100) / 100 : null
    return {
      ...j,
      kmPerL: j.fuelLitres > 0 ? j.distanceKm / j.fuelLitres : null,
      rate,
      rateConflict,
      taxableFuelL: taxableFuelL == null ? null : Math.round(taxableFuelL * 10) / 10,
      netTax,
      position: netTax == null ? null : netTax > 0 ? 'owed' : netTax < 0 ? 'credit' : 'even',
    }
  })
}

/** KPI block for the header strip. */
export function iftaKpis(rows) {
  const list = Array.isArray(rows) ? rows : []
  const s = summariseIfta(list)
  const gapRecords = list.filter((r) => recordGaps(r).length > 0).length
  const currencies = costByCurrency(list)
  return {
    totalRecords: s.totalRecords,
    totalDistanceKm: s.totalDistanceKm,
    totalFuelLitres: s.totalFuelLitres,
    avgKmPerL: s.avgKmPerL,
    distinctJurisdictions: s.distinctJurisdictions,
    quarters: quarterRollup(list).filter((q) => q.quarter !== 'Unspecified').length,
    gapRecords,
    completeness: list.length ? Math.round(((list.length - gapRecords) / list.length) * 1000) / 10 : null,
    currencies,
    // A single cost figure only when exactly one currency is present.
    singleCurrencyCost: currencies.length === 1 ? currencies[0] : null,
  }
}
