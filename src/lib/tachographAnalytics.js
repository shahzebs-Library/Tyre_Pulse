/**
 * Tachograph analytics: pure presentation engine for the Tachograph Records
 * page (/tachograph). Builds on the domain primitives in ./tachographRecords
 * (hasInfringement, summariseTachograph, byDriver, toFiniteNumber) and adds the
 * filter, KPI, driver-risk and export shaping the page renders.
 *
 * No I/O. The clock is injected (`now`) so every function is deterministic.
 *
 * HONESTY RULES: a figure that cannot be measured is null (rendered N/A), never
 * a fabricated 0. Compliance rate is null with no records; average driving time
 * is null when no record carries driving minutes; total distance is null when
 * no record carries a distance.
 */
import {
  hasInfringement, summariseTachograph, byDriver, toFiniteNumber, DAILY_DRIVE_LIMIT_MIN,
} from './tachographRecords'

export { hasInfringement, byDriver, DAILY_DRIVE_LIMIT_MIN }

export const DOWNLOAD_TYPES = [
  { value: 'driver_card', label: 'Driver card' },
  { value: 'vehicle_unit', label: 'Vehicle unit' },
]
export const TACHO_STATUSES = [
  { value: 'downloaded', label: 'Downloaded' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'archived', label: 'Archived' },
]
export const DL_LABEL = Object.fromEntries(DOWNLOAD_TYPES.map((t) => [t.value, t.label]))
export const STATUS_LABEL = Object.fromEntries(TACHO_STATUSES.map((s) => [s.value, s.label]))

const DAY_MS = 86400000

/** Minutes to "Xh MMm"; N/A for blank or non-numeric input. */
export function fmtDuration(min) {
  const n = toFiniteNumber(min)
  if (n == null) return 'N/A'
  const h = Math.floor(n / 60)
  const m = Math.round(n % 60)
  return `${h}h ${String(m).padStart(2, '0')}m`
}

/** Render the stored infringement types (array, object or text) as text. */
export function fmtInfringementTypes(v) {
  if (v == null) return ''
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return '' }
  }
  return String(v)
}

/** Parse the free-text infringement types field into an array/object, or null. */
export function parseInfringementTypes(raw) {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  if (s.startsWith('[') || s.startsWith('{')) {
    try { return JSON.parse(s) } catch { /* fall through to CSV */ }
  }
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean)
  return parts.length ? parts : null
}

/** Filter by country / status / download type / free-text search. */
export function filterTachograph(rows = [], { country = '', status = '', type = '', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (country && r.country !== country) return false
    if (status && r.status !== status) return false
    if (type && r.download_type !== type) return false
    if (q) {
      const hay = `${r.driver_name || ''} ${r.asset_no || ''} ${r.card_number || ''} ${r.notes || ''} ${fmtInfringementTypes(r.infringement_types)}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

function parseDay(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * Page KPIs. Extends summariseTachograph with measured-only ratios.
 * @param {Array<object>} rows
 * @param {{ now?: number, windowDays?: number }} opts
 */
export function tachographKpis(rows = [], { now = Date.now(), windowDays = 30 } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const base = summariseTachograph(list)
  let infringingRecords = 0
  let drivingSum = 0
  let drivingN = 0
  let distanceSum = 0
  let distanceN = 0
  let recent = 0
  const cutoff = now - windowDays * DAY_MS
  for (const r of list) {
    if (hasInfringement(r)) infringingRecords += 1
    const d = toFiniteNumber(r?.driving_min)
    if (d != null) { drivingSum += d; drivingN += 1 }
    const km = toFiniteNumber(r?.distance_km)
    if (km != null) { distanceSum += km; distanceN += 1 }
    const t = parseDay(r?.record_date)
    if (t != null && t >= cutoff && t <= now) recent += 1
  }
  return {
    ...base,
    infringingRecords,
    complianceRate: list.length ? Math.round(((list.length - infringingRecords) / list.length) * 1000) / 10 : null,
    avgDrivingMin: drivingN ? Math.round(drivingSum / drivingN) : null,
    totalDistanceKm: distanceN ? Math.round(distanceSum * 10) / 10 : null,
    recordsInWindow: recent,
    windowDays,
  }
}

/** Distinct sorted option values for a column. */
export function optionsFor(rows = [], key) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => r?.[key]).filter(Boolean))].sort()
}

export const EXPORT_COLS = ['driver_name', 'asset_no', 'card_number', 'record_date', 'download_type', 'driving_min', 'rest_min', 'work_min', 'available_min', 'distance_km', 'infringement_count', 'infringement_types', 'status', 'notes']
export const EXPORT_HEADERS = ['Driver', 'Asset', 'Card number', 'Record date', 'Download type', 'Driving (min)', 'Rest (min)', 'Work (min)', 'Available (min)', 'Distance (km)', 'Infringements', 'Infringement types', 'Status', 'Notes']

/** Export rows for the whole filtered set (never the visible page). */
export function tachographExportRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    driver_name: r.driver_name || '', asset_no: r.asset_no || '',
    card_number: r.card_number || '', record_date: r.record_date || '',
    download_type: DL_LABEL[r.download_type] || r.download_type || '',
    driving_min: r.driving_min ?? '', rest_min: r.rest_min ?? '',
    work_min: r.work_min ?? '', available_min: r.available_min ?? '',
    distance_km: r.distance_km ?? '', infringement_count: r.infringement_count ?? '',
    infringement_types: fmtInfringementTypes(r.infringement_types),
    status: STATUS_LABEL[r.status] || r.status || '', notes: r.notes || '',
  }))
}
