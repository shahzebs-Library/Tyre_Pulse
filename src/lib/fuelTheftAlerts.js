/**
 * Fuel Theft Alerts — pure, dependency-free domain logic for the Fuel Theft /
 * Fuel Anomaly Alerts module (/fuel-theft-alerts). Reduces a set of detected
 * fuel-drop / refuel-discrepancy events into a fleet-level KPI summary and a
 * per-asset loss roll-up.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/fuelTheftAlerts.js`) and page
 * (`src/pages/FuelTheftAlerts.jsx`) both build on these primitives so the
 * roll-up and loss logic live in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Open statuses are anything not yet dismissed or resolved. */
function isOpen(status) {
  const s = status == null ? '' : String(status).trim().toLowerCase()
  return s !== 'dismissed' && s !== 'resolved'
}

/**
 * Estimated financial loss for one alert. Prefers a derived figure
 * (drop_litres × fuel_price_per_litre) when both drivers are present and
 * numeric, otherwise falls back to the stored estimated_loss, otherwise null.
 *
 * @param {object} alert
 * @returns {number|null}
 */
export function estimatedLoss(alert) {
  if (!alert || typeof alert !== 'object') return null
  const litres = toFiniteNumber(alert.drop_litres)
  const price = toFiniteNumber(alert.fuel_price_per_litre)
  if (litres != null && price != null) return litres * price
  return toFiniteNumber(alert.estimated_loss)
}

/**
 * Summarise a set of alerts for the KPI header:
 *   • totalAlerts         — number of rows
 *   • openCount           — alerts whose status is not dismissed/resolved
 *   • criticalOpenCount   — open alerts with severity 'critical'
 *   • totalEstimatedLoss  — sum of per-alert estimated loss across all rows
 *   • confirmedCount      — alerts with status 'confirmed'
 *
 * @param {Array<object>} rows
 * @returns {{ totalAlerts:number, openCount:number, criticalOpenCount:number,
 *             totalEstimatedLoss:number, confirmedCount:number }}
 */
export function summariseAlerts(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let openCount = 0
  let criticalOpenCount = 0
  let confirmedCount = 0
  let totalEstimatedLoss = 0

  for (const r of list) {
    const status = r?.status == null ? '' : String(r.status).trim().toLowerCase()
    const severity = r?.severity == null ? '' : String(r.severity).trim().toLowerCase()
    const open = isOpen(status)
    if (open) {
      openCount += 1
      if (severity === 'critical') criticalOpenCount += 1
    }
    if (status === 'confirmed') confirmedCount += 1
    const loss = estimatedLoss(r)
    if (loss != null) totalEstimatedLoss += loss
  }

  return {
    totalAlerts: list.length,
    openCount,
    criticalOpenCount,
    totalEstimatedLoss,
    confirmedCount,
  }
}

/**
 * Roll up alerts by asset. Returns one entry per distinct `asset_no` with the
 * alert count and total estimated loss, sorted by loss descending (then by
 * count descending as a stable tiebreaker). Rows without an asset number are
 * ignored.
 *
 * @param {Array<object>} rows
 * @returns {Array<{ asset_no:string, alerts:number, loss:number }>}
 */
export function byAsset(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()
  for (const r of list) {
    const asset = r?.asset_no != null ? String(r.asset_no).trim() : ''
    if (!asset) continue
    const prev = map.get(asset) || { asset_no: asset, alerts: 0, loss: 0 }
    prev.alerts += 1
    const loss = estimatedLoss(r)
    if (loss != null) prev.loss += loss
    map.set(asset, prev)
  }
  return [...map.values()].sort((a, b) => (b.loss - a.loss) || (b.alerts - a.alerts))
}
