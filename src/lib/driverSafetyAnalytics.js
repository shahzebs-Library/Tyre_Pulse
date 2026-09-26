/**
 * driverSafetyAnalytics - pure page-level shaping for /driver-safety.
 *
 * The scoring maths lives in `src/lib/driverSafety.js` (summariseSafety,
 * weightedDriverScorecard, computeDriverSafetyBand, weeklyEventTrend...). This
 * module only holds what the page used to compute inline: the shared filter,
 * per-driver trip utilisation, the composite-band merge, option lists and the
 * export/KPI shaping. No I/O, no clock reads, so every function is testable.
 *
 * HONESTY: nothing here invents data. A driver with no trips gets a null
 * utilisation (never 0), a KPI with no loaded rows reads null, and the weekly
 * trend is always built from real dated events by the base engine.
 */
import { computeDriverSafetyBand, toFiniteNumber } from './driverSafety'

export const EVENT_TYPES = [
  { value: 'harsh_brake', label: 'Harsh braking' },
  { value: 'harsh_accel', label: 'Harsh acceleration' },
  { value: 'harsh_corner', label: 'Harsh cornering' },
  { value: 'speeding', label: 'Speeding' },
  { value: 'overspeed', label: 'Overspeed' },
  { value: 'idling', label: 'Excessive idling' },
  { value: 'fatigue', label: 'Fatigue' },
  { value: 'other', label: 'Other' },
]
export const EVENT_TYPE_LABEL = Object.fromEntries(EVENT_TYPES.map((t) => [t.value, t.label]))
export const SEVERITIES = ['low', 'medium', 'high']

const HARSH = ['harsh_brake', 'harsh_accel', 'harsh_corner']

/** Case-insensitive haystack match over the event's free-text fields. */
export function eventMatchesSearch(r, search) {
  const q = String(search || '').trim().toLowerCase()
  if (!q) return true
  const hay = `${r?.asset_no || ''} ${r?.driver_name || ''} ${r?.location || ''} ${r?.notes || ''}`.toLowerCase()
  return hay.includes(q)
}

/**
 * Every filter EXCEPT event type. The events-by-type breakdown holds its own
 * dimension out, so it is computed over this set.
 */
export function filterEventsBase(rows = [], { country = '', severity = '', search = '' } = {}) {
  return (rows || []).filter((r) => {
    if (country && r.country !== country) return false
    if (severity && r.severity !== severity) return false
    return eventMatchesSearch(r, search)
  })
}

/** Distinct, sorted, non-blank countries present in the loaded events. */
export function countryOptionsFor(rows = []) {
  return [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort()
}

/** Per-driver km and trip counts from the trips table (blank drivers ignored). */
export function driverTripStats(trips = []) {
  const kmByDriver = new Map()
  const countByDriver = new Map()
  for (const t of trips || []) {
    const d = String(t?.driver_name || '').trim()
    if (!d) continue
    const km = toFiniteNumber(t.distance_km) || 0
    kmByDriver.set(d, (kmByDriver.get(d) || 0) + km)
    countByDriver.set(d, (countByDriver.get(d) || 0) + 1)
  }
  return { kmByDriver, countByDriver }
}

/**
 * Merge the weighted behaviour score with trip utilisation into the composite
 * band. Utilisation = this driver's km share of the busiest driver (0-100),
 * null when either side has no km (never a fabricated 0).
 */
export function bandScorecard(weighted = [], trips = []) {
  const { kmByDriver, countByDriver } = driverTripStats(trips)
  const fleetKm = [...kmByDriver.values()].filter((v) => v > 0)
  const maxKm = fleetKm.length ? Math.max(...fleetKm) : 0
  return (weighted || []).map((d) => {
    const km = kmByDriver.get(d.driver_name) || 0
    const tripCount = countByDriver.get(d.driver_name) || 0
    const harshEvents = HARSH.reduce((acc, c) => acc + (d.categoryRisk?.[c] ? 1 : 0), 0)
    const utilization = maxKm > 0 && km > 0 ? Math.round((km / maxKm) * 100) : null
    const composite = computeDriverSafetyBand({
      behavior: d.score, utilization, km, trips: tripCount, harshEvents,
    })
    return { ...d, km, tripCount, utilization, composite }
  })
}

/**
 * KPI strip values. `loaded` false -> every value null so the tile reads N/A
 * rather than a zero that looks like a clean record.
 */
export function safetyKpiValues(summary, { loaded = true, coachingCount = null } = {}) {
  if (!loaded || !summary) {
    return { events: null, high: null, drivers: null, penalty: null, highShare: null, coaching: null }
  }
  const events = summary.totalEvents ?? 0
  const high = summary.highSeverityCount ?? 0
  return {
    events,
    high,
    drivers: summary.distinctDrivers ?? 0,
    penalty: Math.round(summary.totalPenaltyPoints || 0),
    highShare: events > 0 ? high / events : null,
    coaching: coachingCount,
  }
}

/** Export rows for the event log (labels resolved, blanks as ''). */
export function eventExportRows(rows = []) {
  return (rows || []).map((r) => ({
    asset_no: r.asset_no || '',
    driver_name: r.driver_name || '',
    event_type: EVENT_TYPE_LABEL[r.event_type] || r.event_type || '',
    severity: r.severity || '',
    event_at: r.event_at || '',
    location: r.location || '',
    speed_kmh: r.speed_kmh ?? '',
    speed_limit_kmh: r.speed_limit_kmh ?? '',
    g_force: r.g_force ?? '',
    penalty_points: r.penalty_points ?? '',
    notes: r.notes || '',
  }))
}

const pctText = (v) => (v == null ? '' : `${Math.round(v * 1000) / 10}%`)

/** Export rows for the driver to tyre correlation table. Unknown = ''. */
export function correlationExportRows(drivers = []) {
  return (drivers || []).map((d) => ({
    driver_name: d.driver_name,
    tyres: d.tyres,
    removals: d.removals,
    driverCausedRemovalRate: pctText(d.driverCausedRemovalRate),
    driverCpk: d.driverCpk == null ? '' : d.driverCpk,
    prematureRemovalRate: pctText(d.prematureRemovalRate),
  }))
}

/** Export rows for the weighted scorecard. */
export function scorecardExportRows(banded = [], categoryLabel = {}) {
  return (banded || []).map((d) => ({
    driver_name: d.driver_name,
    events: d.events,
    riskIndex: d.riskIndex == null ? '' : Math.round(d.riskIndex * 10) / 10,
    score: d.score ?? '',
    grade: d.grade || '',
    band: d.band || '',
    composite: d.composite?.band || '',
    km: d.km > 0 ? Math.round(d.km) : '',
    trips: d.tripCount || '',
    topIssue: categoryLabel[d.weakestCategory] || d.weakestCategory || '',
  }))
}
