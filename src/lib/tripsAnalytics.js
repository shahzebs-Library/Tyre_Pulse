/**
 * tripsAnalytics - pure analytics for the Trip History page (/trips).
 *
 * Reuses `summariseTrips` / `perAssetTotals` from `./trips` for the fleet
 * roll-ups and adds the filter predicate, driver and status breakdowns, a
 * monthly distance trend, data-quality counts and export shaping. Anything that
 * cannot be measured (no distance, no duration) is null, never zero.
 *
 * No I/O, no React. `now` is injected.
 */
import { toFiniteNumber, summariseTrips, perAssetTotals } from './trips'

export const TRIP_STATUSES = [
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]
/** A trip whose recorded peak speed is above this is flagged for review. */
export const SPEED_REVIEW_KMH = 120

const DAY_MS = 86400000
const lc = (v) => String(v ?? '').trim().toLowerCase()

export function statusLabel(v) {
  return TRIP_STATUSES.find((s) => s.value === v)?.label || (v ? String(v) : 'N/A')
}

/** Shared filter for table, KPIs and exports. Date window applies to started_at. */
export function filterTrips(rows = [], f = {}) {
  const q = lc(f.search)
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (f.asset && r.asset_no !== f.asset) return false
    if (f.status && r.status !== f.status) return false
    if (f.driver && (r.driver_name || '').trim() !== f.driver) return false
    if (f.from || f.to) {
      const d = r.started_at ? String(r.started_at).slice(0, 10) : ''
      if (!d) return false
      if (f.from && d < f.from) return false
      if (f.to && d > f.to) return false
    }
    if (q) {
      const hay = [r.asset_no, r.driver_name, r.origin, r.destination, r.notes].map(lc).join(' ')
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Headline KPIs over a (filtered) trip set. */
export function tripKpis(rows = [], { now = Date.now() } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const base = summariseTrips(list)
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  let withDistance = 0
  let idleMin = 0
  let idleDurMin = 0
  let speedReview = 0
  let last7 = 0
  const drivers = new Set()
  for (const r of list) {
    const dist = toFiniteNumber(r?.distance_km)
    if (dist != null && dist > 0) withDistance += 1
    const idle = toFiniteNumber(r?.idle_min)
    const dur = toFiniteNumber(r?.duration_min)
    if (idle != null && idle >= 0 && dur != null && dur > 0) { idleMin += idle; idleDurMin += dur }
    const max = toFiniteNumber(r?.max_speed_kmh)
    if (max != null && max > SPEED_REVIEW_KMH) speedReview += 1
    const t = r?.started_at ? new Date(r.started_at).getTime() : NaN
    if (Number.isFinite(t) && t <= nowMs && nowMs - t <= 7 * DAY_MS) last7 += 1
    const d = String(r?.driver_name || '').trim()
    if (d) drivers.add(d)
  }
  return {
    ...base,
    withDistance,
    missingDistance: list.length - withDistance,
    avgTripKm: withDistance > 0 ? Math.round((base.totalDistanceKm / withDistance) * 10) / 10 : null,
    idleSharePct: idleDurMin > 0 ? Math.round((idleMin / idleDurMin) * 1000) / 10 : null,
    speedReviewCount: speedReview,
    last7Count: last7,
    distinctDrivers: drivers.size,
    completionPct: list.length > 0 ? Math.round((base.completedCount / list.length) * 1000) / 10 : null,
  }
}

/** Distance and trip count per month for the last `months` months ending at now. */
export function monthlyDistance(rows = [], { now = Date.now(), months = 12 } = {}) {
  const end = new Date(now instanceof Date ? now.getTime() : Number(now))
  const keys = []
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1))
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  const m = new Map(keys.map((k) => [k, { month: k, trips: 0, distanceKm: 0 }]))
  for (const r of Array.isArray(rows) ? rows : []) {
    const b = m.get(r?.started_at ? String(r.started_at).slice(0, 7) : '')
    if (!b) continue
    b.trips += 1
    const dist = toFiniteNumber(r.distance_km)
    if (dist != null && dist > 0) b.distanceKm += dist
  }
  return keys.map((k) => m.get(k))
}

/** Trips per status, in the canonical order, plus an honest unrecorded bucket. */
export function statusMix(rows = []) {
  const counts = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = r?.status || ''
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  const out = TRIP_STATUSES.filter((s) => counts.has(s.value)).map((s) => ({ label: s.label, count: counts.get(s.value) }))
  for (const [k, c] of counts) {
    if (!TRIP_STATUSES.some((s) => s.value === k)) out.push({ label: k ? String(k) : 'Not recorded', count: c })
  }
  return out
}

/** Per-driver roll-up (trips, km, drive time). Rows without a driver are skipped. */
export function driverTotals(rows = []) {
  const m = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = String(r?.driver_name || '').trim()
    if (!d) continue
    const e = m.get(d) || { driver: d, trips: 0, distanceKm: 0, durationMin: 0 }
    e.trips += 1
    const dist = toFiniteNumber(r.distance_km)
    if (dist != null && dist > 0) e.distanceKm += dist
    const dur = toFiniteNumber(r.duration_min)
    if (dur != null && dur > 0) e.durationMin += dur
    m.set(d, e)
  }
  return [...m.values()].sort((a, b) => b.distanceKm - a.distanceKm || a.driver.localeCompare(b.driver))
}

export { perAssetTotals }

export const EXPORT_COLS = ['asset_no', 'driver_name', 'origin', 'destination', 'started_at', 'ended_at', 'distance_km', 'duration_min', 'max_speed_kmh', 'avg_speed_kmh', 'idle_min', 'status', 'notes']
export const EXPORT_HEADERS = ['Asset', 'Driver', 'Origin', 'Destination', 'Started', 'Ended', 'Distance (km)', 'Duration (min)', 'Max speed (km/h)', 'Avg speed (km/h)', 'Idle (min)', 'Status', 'Notes']

export function tripExportRows(rows = []) {
  const n = (v) => toFiniteNumber(v) ?? 'N/A'
  return (rows || []).map((r) => ({
    asset_no: r.asset_no || 'N/A', driver_name: r.driver_name || 'N/A',
    origin: r.origin || 'N/A', destination: r.destination || 'N/A',
    started_at: r.started_at || 'N/A', ended_at: r.ended_at || 'N/A',
    distance_km: n(r.distance_km), duration_min: n(r.duration_min),
    max_speed_kmh: n(r.max_speed_kmh), avg_speed_kmh: n(r.avg_speed_kmh),
    idle_min: n(r.idle_min), status: statusLabel(r.status), notes: r.notes || '',
  }))
}
