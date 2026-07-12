/**
 * Engine hours — pure helpers (no I/O) for the Engine Hours Tracker module
 * (/engine-hours). Engine-hour meter readings are logged per asset over time;
 * these functions derive the latest reading per asset and roll a set of readings
 * up into fleet-level KPIs (total readings, distinct assets tracked, highest and
 * average engine hours across each asset's latest reading).
 *
 * All logic lives here (unit-tested) so the page and service stay thin.
 */

/** Coerce a value to a finite number, or null when it isn't numeric. */
export function toNumber(v) {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Comparable timestamp for a reading (reading_date → created_at). Higher = newer. */
function readingRank(r) {
  const raw = r?.reading_date || r?.created_at || null
  if (!raw) return -Infinity
  const t = new Date(raw).getTime()
  return Number.isNaN(t) ? -Infinity : t
}

/**
 * Reduce a set of readings to the single most recent reading per asset.
 * "Most recent" is decided by reading_date, then created_at as a tie-breaker.
 * Rows without an asset_no are ignored. Returns one row per distinct asset,
 * ordered by asset_no.
 *
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
export function latestPerAsset(rows = []) {
  const byAsset = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const asset = r?.asset_no
    if (asset === null || asset === undefined || String(asset).trim() === '') continue
    const key = String(asset)
    const existing = byAsset.get(key)
    if (!existing || readingRank(r) >= readingRank(existing)) {
      byAsset.set(key, r)
    }
  }
  return [...byAsset.values()].sort((a, b) =>
    String(a.asset_no).localeCompare(String(b.asset_no)),
  )
}

/**
 * Summarise a set of engine-hour readings into fleet KPIs. Distinct-asset,
 * highest-hours and average-hours metrics are computed from each asset's LATEST
 * reading (so a chatty asset with many logs is not double-counted).
 *
 * @param {Array<object>} rows
 * @returns {{ totalReadings:number, assetsTracked:number, maxHours:(number|null), avgHours:(number|null) }}
 */
export function summarizeEngineHours(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const latest = latestPerAsset(list)

  const hours = latest.map((r) => toNumber(r.engine_hours)).filter((n) => n !== null)
  const maxHours = hours.length ? Math.max(...hours) : null
  const avgHours = hours.length
    ? Math.round((hours.reduce((s, n) => s + n, 0) / hours.length) * 10) / 10
    : null

  return {
    totalReadings: list.length,
    assetsTracked: latest.length,
    maxHours,
    avgHours,
  }
}
