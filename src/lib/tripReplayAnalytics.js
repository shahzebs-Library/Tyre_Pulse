/**
 * tripReplayAnalytics - pure analytics for the Trip Replay page (/trip-replay).
 *
 * Reuses the path maths in `./tripReplay` (ordering, haversine distance, event
 * counting, speed profile) and adds the honest layer the page needs: a figure
 * that cannot be measured is null, never 0. `speedProfile` reports 0 km/h when
 * no breadcrumb carries a speed; this engine turns that into N/A. Distance
 * needs two positioned points; duration needs two timestamps.
 *
 * No I/O, no React. `now` is injected where time matters.
 */
import {
  toFiniteNumber, summariseTrip, countEvents, speedProfile, orderSegments,
  HARSH_EVENTS, EVENT_TYPES,
} from './tripReplay'

export { EVENT_TYPES, HARSH_EVENTS }

export const EVENT_LABELS = {
  move: 'Move', stop: 'Stop', idle: 'Idle', harsh_brake: 'Harsh brake',
  harsh_accel: 'Harsh accel', harsh_corner: 'Harsh corner', speeding: 'Speeding', none: 'None',
}
const HARSH = new Set(HARSH_EVENTS)
const lc = (v) => String(v ?? '').trim().toLowerCase()

export const eventLabel = (t) => EVENT_LABELS[t] || 'Not recorded'
export const isHarsh = (t) => HARSH.has(t)

function toTime(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/** KPI block for one trip's segments. */
export function replayKpis(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const base = summariseTrip(list)
  const speed = speedProfile(list)
  let speedPoints = 0
  let gpsPoints = 0
  let first = null
  let last = null
  for (const r of list) {
    if (toFiniteNumber(r?.speed_kmh) != null) speedPoints += 1
    if (toFiniteNumber(r?.latitude) != null && toFiniteNumber(r?.longitude) != null) gpsPoints += 1
    const t = toTime(r?.recorded_at)
    if (t != null) {
      if (first == null || t < first) first = t
      if (last == null || t > last) last = t
    }
  }
  const moving = list.some((r) => (toFiniteNumber(r?.speed_kmh) ?? 0) > 0)
  const distanceKm = gpsPoints >= 2 ? base.distanceKm : null
  return {
    segments: base.segments,
    stops: base.stops,
    harshEvents: base.harshEvents,
    distanceKm,
    gpsPoints,
    speedPoints,
    maxKmh: speedPoints > 0 ? speed.maxKmh : null,
    avgKmh: speedPoints > 0 ? speed.avgKmh : null,
    movingAvgKmh: moving ? speed.movingAvgKmh : null,
    durationMin: first != null && last != null && last > first ? Math.round((last - first) / 60000) : null,
    harshRatePct: base.segments > 0 ? Math.round((base.harshEvents / base.segments) * 1000) / 10 : null,
    harshPer100Km: distanceKm && distanceKm > 0 ? Math.round((base.harshEvents / distanceKm) * 1000) / 10 : null,
  }
}

/** Event counts with share of segments, only for types that occurred. */
export function eventBreakdown(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const counts = countEvents(list)
  const total = list.length
  return EVENT_TYPES
    .filter((t) => (counts[t] || 0) > 0)
    .map((t) => ({ type: t, label: eventLabel(t), count: counts[t], pct: total ? Math.round((counts[t] / total) * 100) : null, harsh: isHarsh(t) }))
}

/** Filter segments for the timeline table and exports. */
export function filterSegments(rows = [], f = {}) {
  const q = lc(f.search)
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (f.asset && r.asset_no !== f.asset) return false
    if (f.event && r.event_type !== f.event) return false
    if (f.harshOnly && !isHarsh(r.event_type)) return false
    if (q) {
      const hay = [r.asset_no, r.driver_name, r.address, r.notes, r.event_type, eventLabel(r.event_type)].map(lc).join(' ')
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/**
 * Speed series along the ordered path, down-sampled to at most `maxPoints`.
 * Harsh points are always kept so a sample never hides an event.
 */
export function speedSeries(rows = [], maxPoints = 160) {
  const ordered = orderSegments(rows)
  const pts = ordered.map((r, i) => ({
    seq: toFiniteNumber(r.sequence) ?? i + 1,
    speed: toFiniteNumber(r.speed_kmh),
    harsh: isHarsh(r.event_type),
  }))
  if (pts.length <= maxPoints) return pts
  const step = pts.length / maxPoints
  const keep = new Set()
  for (let i = 0; i < maxPoints; i += 1) keep.add(Math.floor(i * step))
  pts.forEach((p, i) => { if (p.harsh) keep.add(i) })
  return [...keep].sort((a, b) => a - b).map((i) => pts[i])
}

/** Trip selector rows with duration and a search filter. */
export function tripListRows(trips = [], { search = '' } = {}) {
  const q = lc(search)
  return (Array.isArray(trips) ? trips : [])
    .filter((t) => !q || [t.trip_ref, t.asset_no, t.driver_name].map(lc).join(' ').includes(q))
    .map((t) => {
      const a = toTime(t.firstAt)
      const b = toTime(t.lastAt)
      return { ...t, durationMin: a != null && b != null && b > a ? Math.round((b - a) / 60000) : null }
    })
}

export const EXPORT_COLS = ['sequence', 'recorded_at', 'event_type', 'speed_kmh', 'heading', 'latitude', 'longitude', 'address', 'asset_no', 'driver_name', 'notes']
export const EXPORT_HEADERS = ['Seq', 'Time', 'Event', 'Speed (km/h)', 'Heading', 'Latitude', 'Longitude', 'Address', 'Asset', 'Driver', 'Notes']

export function segmentExportRows(rows = []) {
  const n = (v) => toFiniteNumber(v) ?? 'N/A'
  return (rows || []).map((r) => ({
    sequence: n(r.sequence), recorded_at: r.recorded_at || 'N/A',
    event_type: r.event_type ? eventLabel(r.event_type) : 'N/A', speed_kmh: n(r.speed_kmh),
    heading: n(r.heading), latitude: n(r.latitude), longitude: n(r.longitude),
    address: r.address || 'N/A', asset_no: r.asset_no || 'N/A',
    driver_name: r.driver_name || 'N/A', notes: r.notes || '',
  }))
}

/** Plain-language takeaway under the event breakdown. */
export function replayNarrative(k) {
  if (!k || !k.segments) return ''
  if (k.harshEvents === 0) return 'No harsh driving events were recorded on this trip.'
  return `${k.harshEvents} harsh event${k.harshEvents === 1 ? '' : 's'} across ${k.segments} segments (${k.harshRatePct}%). Review driver coaching if this recurs.`
}
