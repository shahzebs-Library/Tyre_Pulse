/**
 * Journeys — pure, dependency-free domain logic for the Journey Log module.
 *
 * Keeping duration + aggregation here (no Supabase, no React) makes them
 * unit-testable and reusable across the service layer, the page and any future
 * reporting pipeline. The service (`src/lib/api/journeys.js`) and page
 * (`src/pages/JourneyLog.jsx`) both build on these primitives.
 */

/** Canonical journey statuses (mirrors the CHECK constraint in V139). */
export const JOURNEY_STATUSES = ['planned', 'in_progress', 'completed', 'cancelled']

export const JOURNEY_STATUS_META = {
  planned: { label: 'Planned', tint: 'text-sky-400' },
  in_progress: { label: 'In progress', tint: 'text-amber-400' },
  completed: { label: 'Completed', tint: 'text-emerald-400' },
  cancelled: { label: 'Cancelled', tint: 'text-red-400' },
}

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Duration of a journey in hours (2 decimals), derived from end_time - start_time.
 * Returns null when either bound is missing/unparseable or the span is negative
 * (a data inconsistency the caller can flag rather than silently trust).
 */
export function journeyDurationHours(journey) {
  const startRaw = journey?.start_time
  const endRaw = journey?.end_time
  if (!startRaw || !endRaw) return null
  const start = new Date(startRaw)
  const end = new Date(endRaw)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  const ms = end.getTime() - start.getTime()
  if (ms < 0) return null
  return Math.round((ms / 3_600_000) * 100) / 100
}

/**
 * Aggregate a list of journeys into fleet KPIs: counts by status, total trips,
 * total distance (km) and average distance per trip. Non-numeric distances are
 * ignored for the total/average so one bad row cannot poison the KPI.
 */
export function summarizeJourneys(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { planned: 0, in_progress: 0, completed: 0, cancelled: 0 }
  let totalDistance = 0
  let distanceN = 0
  for (const r of list) {
    if (byStatus[r?.status] != null) byStatus[r.status] += 1
    const km = toFiniteNumber(r?.distance_km)
    if (km != null) { totalDistance += km; distanceN += 1 }
  }
  const totalTrips = list.length
  totalDistance = Math.round(totalDistance * 100) / 100
  const avgDistance = distanceN > 0 ? Math.round((totalDistance / distanceN) * 100) / 100 : 0
  return { byStatus, totalTrips, totalDistance, avgDistance }
}
