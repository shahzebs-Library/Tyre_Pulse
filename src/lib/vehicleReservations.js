/**
 * Vehicle Reservations — pure, dependency-free domain logic for the Vehicle
 * Reservations / Motor Pool Booking module (/vehicle-reservations). Turns a set
 * of reservation rows into duration, double-booking (conflict) detection, and a
 * fleet-level KPI summary.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/vehicleReservations.js`) and page
 * (`src/pages/VehicleReservations.jsx`) both build on these primitives so the
 * booking logic lives in exactly one place.
 *
 * Determinism note: functions that need a notion of "now" accept an explicit
 * `nowMs` argument. This module never calls Date.now() itself.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Parse a timestamp-ish value to epoch ms, or null when it isn't a valid date. */
function timeMs(v) {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

/** Normalise an asset number for comparison (trimmed string, '' when absent). */
function assetKey(r) {
  return r?.asset_no != null ? String(r.asset_no).trim() : ''
}

/**
 * Duration of a reservation in hours (end_at − start_at), or null when either
 * bound is missing/invalid or the window is non-positive.
 *
 * @param {object} res
 * @returns {number|null}
 */
export function durationHours(res) {
  const start = timeMs(res?.start_at)
  const end = timeMs(res?.end_at)
  if (start == null || end == null) return null
  const hours = (end - start) / 3_600_000
  return hours > 0 ? hours : null
}

/**
 * True when two reservations are for the SAME asset and their
 * [start_at, end_at) windows overlap. Half-open intervals: back-to-back
 * bookings (one ends exactly when the next starts) do NOT overlap. Rows with a
 * missing asset number or an unparseable/degenerate window never overlap.
 *
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
export function overlaps(a, b) {
  if (!a || !b) return false
  const ka = assetKey(a)
  const kb = assetKey(b)
  if (!ka || !kb || ka !== kb) return false

  const aStart = timeMs(a.start_at)
  const aEnd = timeMs(a.end_at)
  const bStart = timeMs(b.start_at)
  const bEnd = timeMs(b.end_at)
  if (aStart == null || aEnd == null || bStart == null || bEnd == null) return false
  if (aEnd <= aStart || bEnd <= bStart) return false

  // Half-open [start, end): overlap iff aStart < bEnd AND bStart < aEnd.
  return aStart < bEnd && bStart < aEnd
}

/**
 * Find every conflicting pair among the rows: same asset, overlapping windows,
 * and neither reservation cancelled. Each pair is reported once as {a, b}
 * (i < j ordering) so callers never see duplicated/mirrored pairs.
 *
 * @param {Array<object>} rows
 * @returns {Array<{a:object,b:object}>}
 */
export function findConflicts(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const active = list.filter((r) => r && String(r.status || '').toLowerCase() !== 'cancelled')
  const pairs = []
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (overlaps(active[i], active[j])) pairs.push({ a: active[i], b: active[j] })
    }
  }
  return pairs
}

/**
 * Summarise a set of reservations for the KPI header:
 *   • totalReservations — number of rows
 *   • activeOutCount    — rows with status 'out' (vehicle currently in use)
 *   • upcomingCount     — rows with status 'approved'/'requested' whose start_at
 *                         is in the future relative to `nowMs`
 *   • distinctAssets    — count of distinct asset numbers
 *   • conflictCount     — number of conflicting (double-booked) pairs
 *
 * `nowMs` must be supplied by the caller (e.g. Date.now()) so this stays
 * deterministic and testable.
 *
 * @param {Array<object>} rows
 * @param {number} [nowMs=0]
 * @returns {{ totalReservations:number, activeOutCount:number,
 *             upcomingCount:number, distinctAssets:number, conflictCount:number }}
 */
export function summariseReservations(rows = [], nowMs = 0) {
  const list = Array.isArray(rows) ? rows : []
  const now = Number.isFinite(nowMs) ? nowMs : 0
  const assets = new Set()
  let activeOutCount = 0
  let upcomingCount = 0

  for (const r of list) {
    const asset = assetKey(r)
    if (asset) assets.add(asset)
    const status = String(r?.status || '').toLowerCase()
    if (status === 'out') activeOutCount += 1
    if (status === 'approved' || status === 'requested') {
      const start = timeMs(r?.start_at)
      if (start != null && start > now) upcomingCount += 1
    }
  }

  return {
    totalReservations: list.length,
    activeOutCount,
    upcomingCount,
    distinctAssets: assets.size,
    conflictCount: findConflicts(list).length,
  }
}
