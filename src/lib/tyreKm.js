/**
 * tyreKm.js - THE rule for how far one tyre really ran. Used by the warranty
 * tracker, scrap management and anything else that reports a tyre's life.
 */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Highest believable life for one tyre, by vehicle class (km). MIRROR of SQL
 * public.tyre_life_km_cap(text) (V503) - change both together.
 */
export function tyreLifeCapKm(vehicleType) {
  const t = String(vehicleType || '').toUpperCase()
  if (t.includes('MIXER')) return 80000
  if (t.includes('PUMP')) return 56000
  if (t.includes('LOADER')) return 15000
  return 100000
}

/**
 * How far a tyre really ran, and how sure we are.
 *  - measured:    fitment odometer recorded, km = removal - fitment (or total_km).
 *  - factory:     fitted at 0 km on a new machine (owner-approved), km = removal.
 *  - placeholder: fitment odometer typed as 1, so total_km is the machine's
 *                 odometer, not the tyre's life. km = null.
 *  - over_cap:    a life above the class ceiling is a reading error. km = null.
 *  - missing:     nothing recorded. km = null.
 * Measured live 2026-11-04 on 6,464 removed tyres: 545 carried the "1" placeholder
 * (55 of them over 100,000 km), which is where "worn out at 230,000 km" came from.
 */
export function tyreKmAssessment(t) {
  const cap = tyreLifeCapKm(t?.vehicle_type)
  const total = num(t?.total_km)
  const fit = num(t?.km_at_fitment)
  const rem = num(t?.km_at_removal)
  let km = null
  let status = 'missing'
  if (fit != null && fit > 1 && rem != null && rem > fit) { km = rem - fit; status = 'measured' }
  else if (fit != null && fit > 1 && total != null && total > 0) { km = total; status = 'measured' }
  else if (fit === 1) { status = (total != null && total > 0) || rem != null ? 'placeholder' : 'missing' }
  else if (fit === 0 && ((rem != null && rem > 0) || (total != null && total > 0))) {
    km = total != null && total > 0 ? total : rem; status = 'factory'
  } else if (fit == null && total != null && total > 0) { km = total; status = 'measured' }
  if (km != null && km > cap) return { km: null, status: 'over_cap', cap, reportedKm: km }
  return { km, status, cap, reportedKm: km ?? total ?? null }
}

export const KM_STATUS_LABEL = Object.freeze({
  measured: 'Measured',
  factory: 'Fitted new (0 km)',
  placeholder: 'Fitment km not recorded',
  over_cap: 'Above class limit - check meters',
  missing: 'Not recorded',
})
