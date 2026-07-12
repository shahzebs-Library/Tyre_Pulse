/**
 * EV Charging Sessions — pure, dependency-free domain logic for the Charging
 * Sessions module (/charging-sessions). Derives per-session cost efficiency and
 * a fleet-level KPI summary from a set of charging session records.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/chargingSessions.js`) and page
 * (`src/pages/ChargingSessions.jsx`) both build on these primitives so the
 * roll-up logic lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Cost per kWh for a single session: cost / energy_kwh. Returns null when either
 * value is missing/non-numeric or energy is zero (guards divide-by-zero).
 *
 * @param {object} session
 * @returns {number|null}
 */
export function costPerKwh(session) {
  const cost = toFiniteNumber(session?.cost)
  const kwh = toFiniteNumber(session?.energy_kwh)
  if (cost == null || kwh == null || kwh === 0) return null
  return cost / kwh
}

/**
 * Summarise a set of charging sessions for the KPI header:
 *   • totalSessions   — number of rows
 *   • totalKwh        — sum of energy_kwh across all rows
 *   • totalCost       — sum of cost across all rows
 *   • avgCostPerKwh   — totalCost / totalKwh (null when totalKwh is 0)
 *   • distinctAssets  — count of distinct asset numbers
 *   • completedCount  — rows with status === 'completed'
 *   • avgSocGainPct   — mean of (end_soc − start_soc) over rows where both are
 *                       present, clamped to 0..100 (null when no such rows)
 *
 * @param {Array<object>} rows
 * @returns {{ totalSessions:number, totalKwh:number, totalCost:number,
 *             avgCostPerKwh:number|null, distinctAssets:number,
 *             completedCount:number, avgSocGainPct:number|null }}
 */
export function summariseCharging(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const assets = new Set()
  let totalKwh = 0
  let totalCost = 0
  let completedCount = 0
  let socGainSum = 0
  let socGainCount = 0

  for (const r of list) {
    const asset = r?.asset_no != null ? String(r.asset_no).trim() : ''
    if (asset) assets.add(asset)

    const kwh = toFiniteNumber(r?.energy_kwh)
    if (kwh != null) totalKwh += kwh

    const cost = toFiniteNumber(r?.cost)
    if (cost != null) totalCost += cost

    if (r?.status === 'completed') completedCount += 1

    const start = toFiniteNumber(r?.start_soc)
    const end = toFiniteNumber(r?.end_soc)
    if (start != null && end != null) {
      socGainSum += end - start
      socGainCount += 1
    }
  }

  const avgCostPerKwh = totalKwh > 0 ? totalCost / totalKwh : null
  const avgSocGainPct =
    socGainCount > 0 ? Math.max(0, Math.min(100, socGainSum / socGainCount)) : null

  return {
    totalSessions: list.length,
    totalKwh,
    totalCost,
    avgCostPerKwh,
    distinctAssets: assets.size,
    completedCount,
    avgSocGainPct,
  }
}
