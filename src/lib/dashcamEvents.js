/**
 * Video Telematics / Dashcam Events — pure, dependency-free domain logic for the
 * Video Telematics module (/video-telematics). Reduces a set of detected driving
 * events (collision, harsh braking, tailgating, distraction, drowsiness, phone
 * use, seatbelt violations) into a fleet-level safety KPI summary and per-type /
 * per-severity roll-ups.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/dashcamEvents.js`) and page
 * (`src/pages/VideoTelematics.jsx`) both build on these primitives so the
 * roll-up logic lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Normalise a boolean-ish value (true/'true'/1/'yes') to a strict boolean. */
function asBool(v) {
  if (v === true) return true
  if (v === false || v == null || v === '') return false
  const s = String(v).trim().toLowerCase()
  return s === 'true' || s === '1' || s === 'yes' || s === 'y'
}

/**
 * Summarise a set of dashcam events for the KPI header:
 *   • totalEvents     — number of rows
 *   • criticalCount   — events with severity 'critical'
 *   • highCount       — events with severity 'high'
 *   • reviewedCount   — events flagged reviewed
 *   • unreviewedCount — events awaiting review (totalEvents − reviewedCount)
 *   • distinctAssets  — count of distinct asset numbers
 *   • reviewedPct     — reviewed share of total, rounded 0–100 (0 when empty)
 *
 * @param {Array<object>} rows
 * @returns {{ totalEvents:number, criticalCount:number, highCount:number,
 *             reviewedCount:number, unreviewedCount:number,
 *             distinctAssets:number, reviewedPct:number }}
 */
export function summariseDashcam(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const assets = new Set()
  let criticalCount = 0
  let highCount = 0
  let reviewedCount = 0

  for (const r of list) {
    const asset = r?.asset_no != null ? String(r.asset_no).trim() : ''
    if (asset) assets.add(asset)
    const sev = r?.severity != null ? String(r.severity).trim().toLowerCase() : ''
    if (sev === 'critical') criticalCount += 1
    else if (sev === 'high') highCount += 1
    if (asBool(r?.reviewed)) reviewedCount += 1
  }

  const totalEvents = list.length
  const unreviewedCount = totalEvents - reviewedCount
  const reviewedPct = totalEvents > 0 ? Math.round((reviewedCount / totalEvents) * 100) : 0

  return {
    totalEvents,
    criticalCount,
    highCount,
    reviewedCount,
    unreviewedCount,
    distinctAssets: assets.size,
    reviewedPct,
  }
}

/**
 * Count events by event_type. Returns an array of { type, count } sorted by
 * count descending (ties keep first-seen order via a stable index tiebreak).
 * Rows without an event_type are ignored.
 *
 * @param {Array<object>} rows
 * @returns {Array<{ type:string, count:number }>}
 */
export function byEventType(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const counts = new Map()
  const order = new Map()
  let seq = 0
  for (const r of list) {
    const type = r?.event_type != null ? String(r.event_type).trim() : ''
    if (!type) continue
    if (!counts.has(type)) { counts.set(type, 0); order.set(type, seq++) }
    counts.set(type, counts.get(type) + 1)
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => (b.count - a.count) || (order.get(a.type) - order.get(b.type)))
}

/**
 * Count events by severity bucket. Always returns all four keys (low, medium,
 * high, critical) so the caller never has to guard for absent buckets. Unknown
 * or missing severities are ignored.
 *
 * @param {Array<object>} rows
 * @returns {{ low:number, medium:number, high:number, critical:number }}
 */
export function bySeverity(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const out = { low: 0, medium: 0, high: 0, critical: 0 }
  for (const r of list) {
    const sev = r?.severity != null ? String(r.severity).trim().toLowerCase() : ''
    if (sev in out) out[sev] += 1
  }
  return out
}
