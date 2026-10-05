/**
 * tripReplayView - pure shaping for the Trip Replay page (/trip-replay) rebuilt
 * to the owner's mockup: period filter, route trace geometry (drawn as local
 * SVG, never external map tiles), playback position, speed chart, stops
 * timeline and the events panel.
 *
 * Source is trip_segments only. Fuel, CO2, tolls, geofence events, a planned
 * route (for deviation), elevation, engine RPM and tyre pressure along a trip
 * have no column on trip_segments, so they are returned as null / not recorded
 * instead of being estimated.
 *
 * No I/O, no React.
 */
import { toFiniteNumber, orderSegments, haversineKm } from './tripReplay'
import { isHarsh, eventLabel } from './tripReplayAnalytics'

const toMs = (v) => {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}
const dayOf = (v) => String(v || '').slice(0, 10)

/** Trips whose first point falls inside [from, to] (either bound optional). */
export function tripsInPeriod(trips = [], { from = '', to = '' } = {}) {
  return (Array.isArray(trips) ? trips : []).filter((t) => {
    const d = dayOf(t.firstAt || t.lastAt)
    if (!d) return !from && !to
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  })
}

/** Route tone per breadcrumb, matching the mockup legend. */
export function segmentTone(r) {
  const e = r?.event_type
  if (e === 'speeding') return 'speeding'
  if (isHarsh(e)) return 'harsh'
  if (e === 'stop' || e === 'idle') return 'stop'
  const s = toFiniteNumber(r?.speed_kmh)
  if (s != null && s > 0 && s < 20) return 'slow'
  return 'normal'
}

export const TONE_LABEL = {
  normal: 'Normal driving', slow: 'Slow speed (under 20 km/h)', harsh: 'Harsh event', speeding: 'Speeding', stop: 'Stop or idle',
}

/**
 * Project positioned breadcrumbs into a w x h box (equirectangular, longitude
 * scaled by cos(latitude) so shapes are not stretched). Null when fewer than
 * two points carry coordinates.
 */
export function pathGeometry(rows = [], { w = 800, h = 300, pad = 24 } = {}) {
  const pts = orderSegments(rows)
    .map((r, i) => ({ r, i, lat: toFiniteNumber(r.latitude), lng: toFiniteNumber(r.longitude) }))
    .filter((p) => p.lat != null && p.lng != null)
  if (pts.length < 2) return null
  const meanLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length
  const k = Math.cos((meanLat * Math.PI) / 180) || 1
  const xs = pts.map((p) => p.lng * k); const ys = pts.map((p) => p.lat)
  const minX = Math.min(...xs); const maxX = Math.max(...xs)
  const minY = Math.min(...ys); const maxY = Math.max(...ys)
  const spanX = maxX - minX || 1e-6; const spanY = maxY - minY || 1e-6
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY)
  const offX = (w - spanX * scale) / 2; const offY = (h - spanY * scale) / 2
  const points = pts.map((p, n) => ({
    x: Math.round((offX + (xs[n] - minX) * scale) * 10) / 10,
    y: Math.round((h - (offY + (ys[n] - minY) * scale)) * 10) / 10,
    index: p.i,
    tone: segmentTone(p.r),
    event: p.r.event_type || null,
    row: p.r,
  }))
  const lines = points.slice(1).map((p, n) => ({ x1: points[n].x, y1: points[n].y, x2: p.x, y2: p.y, tone: p.tone, index: p.index }))
  // Rough scale bar: km across the drawn width.
  const kmPerUnit = haversineKm({ latitude: meanLat, longitude: minX / k }, { latitude: meanLat, longitude: maxX / k }) / ((spanX * scale) || 1)
  return { points, lines, w, h, kmAcross: Math.round(kmPerUnit * (w - pad * 2) * 10) / 10 }
}

/** Position of the playback head: the segment at `index`, elapsed vs total time. */
export function playbackAt(rows = [], index = 0) {
  const list = orderSegments(rows)
  if (!list.length) return { current: null, index: 0, last: 0, elapsedMin: null, totalMin: null, pct: 0 }
  const i = Math.max(0, Math.min(list.length - 1, Math.trunc(index) || 0))
  const t0 = toMs(list[0].recorded_at); const tN = toMs(list[list.length - 1].recorded_at); const ti = toMs(list[i].recorded_at)
  const totalMin = t0 != null && tN != null && tN > t0 ? Math.round((tN - t0) / 60000) : null
  const elapsedMin = t0 != null && ti != null && ti >= t0 ? Math.round((ti - t0) / 60000) : null
  return {
    current: list[i], index: i, last: list.length - 1, elapsedMin, totalMin,
    pct: list.length > 1 ? Math.round((i / (list.length - 1)) * 100) : 100,
  }
}

export function fmtClock(min) {
  if (min == null) return 'N/A'
  const h = Math.floor(min / 60); const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Minutes each stop/idle segment lasted (until the next breadcrumb). */
function stopDurations(list) {
  const out = new Map()
  list.forEach((r, i) => {
    if (r.event_type !== 'stop' && r.event_type !== 'idle') return
    const a = toMs(r.recorded_at); const b = toMs(list[i + 1]?.recorded_at)
    out.set(i, a != null && b != null && b > a ? Math.round((b - a) / 60000) : null)
  })
  return out
}

/**
 * Events panel. Counts come straight from event_type; the items that have no
 * column on trip_segments (geofence, fuel, tolls) are null so the page says so.
 */
export function eventsSummary(rows = []) {
  const list = orderSegments(rows)
  const durs = stopDurations(list)
  let idleMin = 0; let idleKnown = 0; let stops = 0
  const harsh = { harsh_brake: 0, harsh_accel: 0, harsh_corner: 0 }
  let speeding = 0; let maxSpeed = null
  list.forEach((r, i) => {
    if (r.event_type === 'speeding') speeding += 1
    if (r.event_type in harsh) harsh[r.event_type] += 1
    if (durs.has(i)) { stops += 1; const d = durs.get(i); if (d != null) { idleMin += d; idleKnown += 1 } }
    const s = toFiniteNumber(r.speed_kmh)
    if (s != null && (maxSpeed == null || s > maxSpeed)) maxSpeed = s
  })
  return {
    speeding, maxSpeed,
    harsh: harsh.harsh_brake + harsh.harsh_accel + harsh.harsh_corner,
    harshBreakdown: harsh,
    stops,
    idleMin: idleKnown ? idleMin : null,
    geofence: null, fuel: null, tolls: null,
  }
}

/** Start, every stop / idle / harsh / speeding point, and end, in order. */
export function stopsTimeline(rows = [], max = 12) {
  const list = orderSegments(rows)
  if (!list.length) return []
  const durs = stopDurations(list)
  const out = [{ key: `s-${list[0].id ?? 0}`, kind: 'start', at: list[0].recorded_at, label: `Start${list[0].address ? ` - ${list[0].address}` : ''}`, note: '' }]
  list.forEach((r, i) => {
    if (i === 0 || i === list.length - 1) return
    if (durs.has(i)) out.push({ key: `p-${r.id ?? i}`, kind: 'stop', at: r.recorded_at, label: `${eventLabel(r.event_type)}${r.address ? ` - ${r.address}` : ''}`, note: durs.get(i) != null ? `${durs.get(i)} min` : '' })
    else if (isHarsh(r.event_type)) out.push({ key: `h-${r.id ?? i}`, kind: 'harsh', at: r.recorded_at, label: `${eventLabel(r.event_type)}${r.address ? ` - ${r.address}` : ''}`, note: toFiniteNumber(r.speed_kmh) != null ? `${toFiniteNumber(r.speed_kmh)} km/h` : '' })
  })
  const end = list[list.length - 1]
  if (list.length > 1) out.push({ key: `e-${end.id ?? 'end'}`, kind: 'end', at: end.recorded_at, label: `End${end.address ? ` - ${end.address}` : ''}`, note: '' })
  if (out.length <= max) return out
  return [...out.slice(0, max - 1), out[out.length - 1]]
}

/**
 * Speed chart geometry: a polyline over time (or sequence when timestamps are
 * missing) plus event markers. Null when no breadcrumb has a speed.
 */
export function speedChart(rows = [], { w = 800, h = 150, padL = 34, padB = 20, padT = 10 } = {}) {
  const list = orderSegments(rows)
  const pts = list.map((r, i) => ({ r, i, s: toFiniteNumber(r.speed_kmh), t: toMs(r.recorded_at) })).filter((p) => p.s != null)
  if (!pts.length) return null
  const useTime = pts.every((p) => p.t != null) && pts[pts.length - 1].t > pts[0].t
  const xv = (p) => (useTime ? p.t : p.i)
  const x0 = xv(pts[0]); const x1 = xv(pts[pts.length - 1]); const spanX = x1 - x0 || 1
  const maxS = Math.max(20, ...pts.map((p) => p.s))
  const top = Math.ceil(maxS / 30) * 30
  const X = (p) => Math.round((padL + ((xv(p) - x0) / spanX) * (w - padL - 6)) * 10) / 10
  const Y = (s) => Math.round((padT + (1 - s / top) * (h - padT - padB)) * 10) / 10
  const line = pts.map((p) => `${X(p)},${Y(p.s)}`).join(' ')
  const area = `${X(pts[0])},${h - padB} ${line} ${X(pts[pts.length - 1])},${h - padB}`
  const markers = pts.filter((p) => isHarsh(p.r.event_type) || p.r.event_type === 'stop' || p.r.event_type === 'idle')
    .map((p) => ({ x: X(p), y: Y(p.s), tone: segmentTone(p.r), label: eventLabel(p.r.event_type), index: p.i }))
  const yTicks = [0, top / 3, (2 * top) / 3, top].map((v) => ({ v: Math.round(v), y: Y(v) }))
  return { w, h, line, area, markers, yTicks, top, useTime, padL, padB, xOf: (i) => { const p = pts.find((q) => q.i >= i) || pts[pts.length - 1]; return X(p) } }
}

/** Trip summary tiles. Fuel, efficiency and CO2 are not recorded on segments. */
export function tripSummary(k = {}) {
  return {
    distanceKm: k.distanceKm ?? null,
    durationMin: k.durationMin ?? null,
    avgKmh: k.movingAvgKmh ?? k.avgKmh ?? null,
    fuelL: null, efficiency: null, co2Kg: null,
  }
}
