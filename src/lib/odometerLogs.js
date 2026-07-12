/**
 * Odometer Logs — pure, dependency-free domain logic for the Odometer Logs
 * module (/odometer-logs). Reduces a set of odometer readings into per-asset
 * latest values and a fleet-level KPI summary.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/odometerLogs.js`) and page
 * (`src/pages/OdometerLogs.jsx`) both build on these primitives so the roll-up
 * logic lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Sortable ordinal for a reading: prefer reading_date, fall back to created_at. */
function readingTime(r) {
  const d = r?.reading_date || r?.created_at
  if (!d) return 0
  const t = new Date(d).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * Latest reading per asset. For each distinct `asset_no`, keeps the row with the
 * most recent reading_date (created_at as tiebreaker/fallback); when dates tie,
 * the higher odometer value wins so a same-day correction upward is preferred.
 * Rows without an asset number are ignored. Returns an array (unsorted).
 *
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
export function latestPerAsset(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byAsset = new Map()
  for (const r of list) {
    const asset = r?.asset_no != null ? String(r.asset_no).trim() : ''
    if (!asset) continue
    const prev = byAsset.get(asset)
    if (!prev) { byAsset.set(asset, r); continue }
    const tNew = readingTime(r)
    const tOld = readingTime(prev)
    if (tNew > tOld) { byAsset.set(asset, r); continue }
    if (tNew === tOld) {
      const kmNew = toFiniteNumber(r?.odometer_km) ?? -Infinity
      const kmOld = toFiniteNumber(prev?.odometer_km) ?? -Infinity
      if (kmNew > kmOld) byAsset.set(asset, r)
    }
  }
  return [...byAsset.values()]
}

/**
 * Summarise a set of readings for the KPI header:
 *   • totalReadings  — number of rows
 *   • distinctAssets — count of distinct asset numbers
 *   • highestKm      — single largest odometer reading across all rows
 *   • fleetKm        — sum of the latest odometer per asset (fleet distance basis)
 *
 * @param {Array<object>} rows
 * @returns {{ totalReadings:number, distinctAssets:number,
 *             highestKm:number|null, fleetKm:number }}
 */
export function summarizeOdometer(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const assets = new Set()
  let highestKm = null

  for (const r of list) {
    const asset = r?.asset_no != null ? String(r.asset_no).trim() : ''
    if (asset) assets.add(asset)
    const km = toFiniteNumber(r?.odometer_km)
    if (km != null && (highestKm == null || km > highestKm)) highestKm = km
  }

  const fleetKm = latestPerAsset(list).reduce((sum, r) => {
    const km = toFiniteNumber(r?.odometer_km)
    return sum + (km != null ? km : 0)
  }, 0)

  return {
    totalReadings: list.length,
    distinctAssets: assets.size,
    highestKm,
    fleetKm,
  }
}
