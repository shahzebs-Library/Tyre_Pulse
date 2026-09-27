/**
 * journeyLogAnalytics - pure page-side logic for /journeys (Journey Log).
 * Zero I/O; `now` is injectable wherever time matters.
 *
 * The journey maths (duration, speed, on-time, data-quality flags, rollups,
 * monthly trend) lives in src/lib/journeys.js and is REUSED. This module owns
 * what the page used to compute inline: filtering (now with site + date range),
 * the register row shape, the export shape, the datetime-local conversion and
 * the honest distance headline.
 */
import {
  journeyDurationHours, journeyOnTime, journeyAvgSpeedKmh, journeyDataQualityFlags,
  toFiniteNumber, JOURNEY_STATUS_META, ON_TIME_META,
} from './journeys'

const parseDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Local "YYYY-MM-DD" day of a timestamp (the date filter compares whole days). */
function localDay(v) {
  const d = parseDate(v)
  if (!d) return null
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A timestamptz as the value an <input type="datetime-local"> expects. */
export function toLocalInput(v) {
  const d = parseDate(v)
  if (!d) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatJourneyDateTime(v) {
  const d = parseDate(v)
  return d ? d.toLocaleString() : 'N/A'
}

export function journeySearchText(r) {
  return [r?.asset_no, r?.driver_name, r?.origin, r?.destination, r?.purpose, r?.site, r?.notes]
    .filter(Boolean).join(' ').toLowerCase()
}

/**
 * Filter the register. `from`/`to` are inclusive YYYY-MM-DD bounds on the
 * start time; a journey with NO start time is excluded only while a date
 * bound is active (it cannot be placed in the window).
 */
export function filterJourneys(rows = [], { status = 'all', asset = '', site = '', from = '', to = '', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!r) return false
    if (status !== 'all' && r.status !== status) return false
    if (asset && r.asset_no !== asset) return false
    if (site && r.site !== site) return false
    if (from || to) {
      const day = localDay(r.start_time)
      if (!day) return false
      if (from && day < from) return false
      if (to && day > to) return false
    }
    if (q && !journeySearchText(r).includes(q)) return false
    return true
  })
}

export function distinctJourneyValues(rows = [], key) {
  return [...new Set((rows || []).map((r) => r?.[key]).filter(Boolean))].sort()
}

/** A register row decorated with every derived column the table sorts on. */
export function journeyRow(r) {
  const ot = journeyOnTime(r)
  const flags = journeyDataQualityFlags(r)
  return {
    ...r,
    distance: toFiniteNumber(r?.distance_km),
    duration: journeyDurationHours(r),
    speed: journeyAvgSpeedKmh(r),
    onTimeClass: ot.class,
    onTimeDelta: ot.deltaMinutes,
    route: `${r?.origin || 'N/A'} to ${r?.destination || 'N/A'}`,
    flags,
  }
}

/**
 * Distance headline that is null (N/A) when not one journey carries a
 * distance, instead of the 0 km summarizeJourneys reports for that case.
 */
export function distanceHeadline(rows = []) {
  let total = 0
  let n = 0
  for (const r of rows || []) {
    const km = toFiniteNumber(r?.distance_km)
    if (km != null) { total += km; n += 1 }
  }
  return {
    total: n > 0 ? Math.round(total * 100) / 100 : null,
    recorded: n,
    avg: n > 0 ? Math.round((total / n) * 100) / 100 : null,
  }
}

/** Trips started today / in the last 7 days, relative to an injectable `now`. */
export function recentActivity(rows = [], now = new Date()) {
  const today = localDay(now)
  const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
  const weekStart = localDay(weekAgo)
  let todayN = 0
  let weekN = 0
  for (const r of rows || []) {
    const day = localDay(r?.start_time)
    if (!day) continue
    if (day === today) todayN += 1
    if (day >= weekStart && day <= today) weekN += 1
  }
  return { today: todayN, last7Days: weekN }
}

export const JOURNEY_EXPORT_COLUMNS = [
  { key: 'asset_no', header: 'Asset' },
  { key: 'driver_name', header: 'Driver' },
  { key: 'origin', header: 'Origin' },
  { key: 'destination', header: 'Destination' },
  { key: 'purpose', header: 'Purpose' },
  { key: 'start_time', header: 'Start' },
  { key: 'end_time', header: 'End' },
  { key: 'distance_km', header: 'Distance (km)' },
  { key: 'duration_h', header: 'Duration (h)' },
  { key: 'avg_speed', header: 'Avg speed (km/h)' },
  { key: 'on_time', header: 'On time' },
  { key: 'site', header: 'Site' },
  { key: 'status', header: 'Status' },
  { key: 'data_quality', header: 'Data quality' },
]

export function journeyExportRows(rows = []) {
  return (rows || []).filter(Boolean).map((r) => {
    const x = journeyRow(r)
    return {
      asset_no: r.asset_no || 'N/A',
      driver_name: r.driver_name || 'N/A',
      origin: r.origin || 'N/A',
      destination: r.destination || 'N/A',
      purpose: r.purpose || 'N/A',
      start_time: formatJourneyDateTime(r.start_time),
      end_time: formatJourneyDateTime(r.end_time),
      distance_km: x.distance ?? 'N/A',
      duration_h: x.duration ?? 'N/A',
      avg_speed: x.speed ?? 'N/A',
      on_time: x.onTimeClass === 'unknown' ? 'N/A' : (ON_TIME_META[x.onTimeClass]?.label || x.onTimeClass),
      site: r.site || 'N/A',
      status: JOURNEY_STATUS_META[r.status]?.label || r.status || 'N/A',
      data_quality: x.flags.length ? x.flags.map((f) => f.label).join('; ') : 'OK',
    }
  })
}

export const PERF_EXPORT_COLUMNS = [
  { key: 'name', header: 'Name' },
  { key: 'trips', header: 'Trips' },
  { key: 'distance', header: 'Distance (km)' },
  { key: 'completionRate', header: 'Completion %' },
  { key: 'onTimeRate', header: 'On-time %' },
  { key: 'avgDurationHours', header: 'Avg duration (h)' },
]

/** Driver / asset rollup rows with a common `name` key and N/A for unmeasured. */
export function perfRows(analytics, view = 'driver') {
  const list = view === 'asset' ? (analytics?.assets || []) : (analytics?.drivers || [])
  return list.map((r) => ({ ...r, name: view === 'asset' ? r.asset : r.driver }))
}

export function perfExportRows(rows = []) {
  return (rows || []).map((r) => ({
    name: r.name,
    trips: r.trips,
    distance: r.distance,
    completionRate: r.completionRate,
    onTimeRate: r.onTimeRate ?? 'N/A',
    avgDurationHours: r.avgDurationHours ?? 'N/A',
  }))
}
