/**
 * videoTelematicsAnalytics.js - pure analytics for /video-telematics (no I/O).
 *
 * The base counts live in `dashcamEvents.js` (summariseDashcam, byEventType,
 * bySeverity) and are REUSED. This module adds filtering, the honest-null KPI
 * set, a severity-weighted driver risk ranking, the review backlog age, the
 * monthly trend and export rows.
 *
 * HONESTY NOTES
 * - Review rate is null (not 0%) when there are no events. summariseDashcam
 *   returns 0 there, which would read as "nothing has been reviewed".
 * - Average speed only counts events that recorded a speed.
 * - Events with no driver are ranked under "Driver not recorded", never merged
 *   into a named driver.
 * - Time-dependent functions take an injectable `now`.
 */
import { summariseDashcam, byEventType, bySeverity, toFiniteNumber } from './dashcamEvents'

export const EVENT_TYPES = [
  { value: 'collision', label: 'Collision' },
  { value: 'harsh_brake', label: 'Harsh braking' },
  { value: 'tailgating', label: 'Tailgating' },
  { value: 'distraction', label: 'Distraction' },
  { value: 'drowsiness', label: 'Drowsiness' },
  { value: 'phone_use', label: 'Phone use' },
  { value: 'no_seatbelt', label: 'No seatbelt' },
  { value: 'other', label: 'Other' },
]
export const EVENT_TYPE_LABEL = Object.fromEntries(EVENT_TYPES.map((t) => [t.value, t.label]))
export const SEVERITIES = ['low', 'medium', 'high', 'critical']
export const SEVERITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
/** Weights used for the driver risk score (critical counts five times a low). */
export const SEVERITY_WEIGHT = { low: 1, medium: 2, high: 3, critical: 5 }
export const NO_DRIVER = 'Driver not recorded'

const DAY = 86400000

function toMs(v) {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}
function nowMs(now) { return toMs(now ?? new Date()) ?? Date.now() }
function pct(part, whole) { return whole ? Math.round((part / whole) * 1000) / 10 : null }
const sevOf = (r) => String(r?.severity || '').trim().toLowerCase()
const isReviewed = (r) => r?.reviewed === true || r?.reviewed === 'true' || r?.reviewed === 1
function monthKey(ms) {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Filter by type / severity / review state / driver / text / event date range. */
export function filterDashcamEvents(rows = [], f = {}) {
  const list = Array.isArray(rows) ? rows : []
  const q = String(f.search || '').trim().toLowerCase()
  const fromMs = toMs(f.from)
  const toEnd = toMs(f.to)
  const toMsEnd = toEnd == null ? null : toEnd + DAY - 1
  return list.filter((r) => {
    if (f.type && r?.event_type !== f.type) return false
    if (f.severity && sevOf(r) !== f.severity) return false
    if (f.review === 'reviewed' && !isReviewed(r)) return false
    if (f.review === 'unreviewed' && isReviewed(r)) return false
    if (f.driver) {
      const d = String(r?.driver_name || '').trim() || NO_DRIVER
      if (d !== f.driver) return false
    }
    if (fromMs != null || toMsEnd != null) {
      const t = toMs(r?.event_at)
      if (t == null) return false
      if (fromMs != null && t < fromMs) return false
      if (toMsEnd != null && t > toMsEnd) return false
    }
    if (q) {
      const hay = `${r?.asset_no || ''} ${r?.driver_name || ''} ${r?.location || ''} ${r?.notes || ''} ${r?.review_notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** KPI set built on summariseDashcam, with honest nulls. */
export function dashcamKpis(rows = [], { now } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const base = summariseDashcam(list)
  const n = nowMs(now)
  let criticalUnreviewed = 0
  let last7 = 0
  let speedSum = 0
  let speedN = 0
  let oldestUnreviewed = null
  let withVideo = 0
  for (const r of list) {
    const t = toMs(r?.event_at)
    if (t != null && t <= n && n - t <= 7 * DAY) last7 += 1
    const sp = toFiniteNumber(r?.speed_kmh)
    if (sp != null) { speedSum += sp; speedN += 1 }
    if (r?.video_url) withVideo += 1
    if (!isReviewed(r)) {
      if (sevOf(r) === 'critical' || sevOf(r) === 'high') criticalUnreviewed += 1
      if (t != null && t <= n && (oldestUnreviewed == null || t < oldestUnreviewed)) oldestUnreviewed = t
    }
  }
  return {
    ...base,
    reviewedPct: pct(base.reviewedCount, list.length),
    highRiskUnreviewed: criticalUnreviewed,
    last7Days: last7,
    avgSpeedKmh: speedN ? Math.round(speedSum / speedN) : null,
    videoCoverage: pct(withVideo, list.length),
    oldestUnreviewedDays: oldestUnreviewed == null ? null : Math.floor((n - oldestUnreviewed) / DAY),
  }
}

/** Drivers ranked by severity-weighted score. */
export function driverRiskRanking(rows = [], limit = 10) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = String(r?.driver_name || '').trim() || NO_DRIVER
    const b = map.get(d) || { driver: d, events: 0, score: 0, critical: 0, unreviewed: 0 }
    b.events += 1
    b.score += SEVERITY_WEIGHT[sevOf(r)] || 0
    if (sevOf(r) === 'critical') b.critical += 1
    if (!isReviewed(r)) b.unreviewed += 1
    map.set(d, b)
  }
  return [...map.values()]
    .sort((a, b) => b.score - a.score || b.events - a.events || a.driver.localeCompare(b.driver))
    .slice(0, limit)
}

/** Events per month split by severity for the last `months` months. */
export function monthlyEventTrend(rows = [], { now, months = 12 } = {}) {
  const end = new Date(nowMs(now))
  const keys = []
  for (let i = months - 1; i >= 0; i--) keys.push(monthKey(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1)))
  const map = new Map(keys.map((k) => [k, { month: k, low: 0, medium: 0, high: 0, critical: 0 }]))
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = toMs(r?.event_at)
    if (t == null) continue
    const b = map.get(monthKey(t))
    const s = sevOf(r)
    if (b && s in b) b[s] += 1
  }
  return keys.map((k) => map.get(k))
}

export { byEventType, bySeverity }

export const DASHCAM_EXPORT_COLUMNS = [
  ['asset_no', 'Asset'], ['driver_name', 'Driver'], ['event_type', 'Event type'], ['severity', 'Severity'],
  ['event_at', 'Event time'], ['location', 'Location'], ['speed_kmh', 'Speed (km/h)'], ['reviewed', 'Reviewed'],
  ['review_notes', 'Review notes'], ['video_url', 'Video URL'], ['notes', 'Notes'],
]

export function dashcamExportRows(rows = [], { fmtDate = (v) => v || '' } = {}) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    asset_no: r?.asset_no || '',
    driver_name: r?.driver_name || '',
    event_type: EVENT_TYPE_LABEL[r?.event_type] || r?.event_type || '',
    severity: SEVERITY_LABEL[sevOf(r)] || r?.severity || '',
    event_at: fmtDate(r?.event_at),
    location: r?.location || '',
    speed_kmh: toFiniteNumber(r?.speed_kmh) ?? '',
    reviewed: isReviewed(r) ? 'Yes' : 'No',
    review_notes: r?.review_notes || '',
    video_url: r?.video_url || '',
    notes: r?.notes || '',
  }))
}
