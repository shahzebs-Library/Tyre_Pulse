/**
 * vehicleReservationsAnalytics.js - pure analytics for /vehicle-reservations.
 *
 * Duration, overlap (double-booking) detection and the base summary live in
 * `vehicleReservations.js` and are REUSED here. This module adds filtering,
 * the honest-null KPI set (overdue returns, pending approvals, booked hours,
 * cancellation rate), status mix, department demand, the monthly booking trend
 * and export rows.
 *
 * HONESTY NOTES
 * - Rates and averages are null (never 0) when nothing is measurable.
 * - Booked hours count only non-cancelled bookings with a valid window.
 * - An "overdue return" is a booking marked out whose end time has passed. A
 *   booking with no end time cannot be overdue and is not counted.
 * - Time-dependent functions take an injectable `now`.
 */
import { durationHours, findConflicts, summariseReservations, toFiniteNumber } from './vehicleReservations'

export const RESERVATION_STATUSES = ['requested', 'approved', 'out', 'returned', 'cancelled']
export const RESERVATION_STATUS_LABEL = {
  requested: 'Requested', approved: 'Approved', out: 'Out', returned: 'Returned', cancelled: 'Cancelled',
}
export const NO_DEPARTMENT = 'No department'

const DAY = 86400000

function toMs(v) {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}
function nowMs(now) { return toMs(now ?? new Date()) ?? Date.now() }
function pct(part, whole) { return whole ? Math.round((part / whole) * 1000) / 10 : null }
const round1 = (n) => Math.round(n * 10) / 10
function monthKey(ms) {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const statusOf = (r) => String(r?.status || '').toLowerCase()

/** Ids that take part in at least one double-booking. */
export function conflictIdSet(conflicts = []) {
  const s = new Set()
  for (const c of Array.isArray(conflicts) ? conflicts : []) {
    if (c?.a?.id != null) s.add(c.a.id)
    if (c?.b?.id != null) s.add(c.b.id)
  }
  return s
}

/** True when a booking is out and its return time has already passed. */
export function isOverdueReturn(r, { now } = {}) {
  if (statusOf(r) !== 'out') return false
  const end = toMs(r?.end_at)
  return end != null && end < nowMs(now)
}

/** Filter by status / asset / department / text / pickup date range / conflicts only. */
export function filterReservations(rows = [], f = {}) {
  const list = Array.isArray(rows) ? rows : []
  const q = String(f.search || '').trim().toLowerCase()
  const fromMs = toMs(f.from)
  const toEnd = toMs(f.to)
  const toMsEnd = toEnd == null ? null : toEnd + DAY - 1
  const ids = f.conflictIds instanceof Set ? f.conflictIds : null
  return list.filter((r) => {
    if (f.status && statusOf(r) !== f.status) return false
    if (f.asset && r?.asset_no !== f.asset) return false
    if (f.department) {
      const d = String(r?.department || '').trim() || NO_DEPARTMENT
      if (d !== f.department) return false
    }
    if (f.conflictsOnly && !(ids && ids.has(r?.id))) return false
    if (f.overdueOnly && !isOverdueReturn(r, { now: f.now })) return false
    if (fromMs != null || toMsEnd != null) {
      const t = toMs(r?.start_at)
      if (t == null) return false
      if (fromMs != null && t < fromMs) return false
      if (toMsEnd != null && t > toMsEnd) return false
    }
    if (q) {
      const hay = `${r?.asset_no || ''} ${r?.reference || ''} ${r?.requester_name || ''} ${r?.department || ''} ${r?.purpose || ''} ${r?.pickup_location || ''} ${r?.return_location || ''} ${r?.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** KPI set. Reuses summariseReservations for the base counts. */
export function reservationKpis(rows = [], { now } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const n = nowMs(now)
  const base = summariseReservations(list, n)
  let hours = 0
  let hoursN = 0
  let cancelled = 0
  let pending = 0
  let overdue = 0
  let expectedKm = 0
  let kmN = 0
  for (const r of list) {
    const s = statusOf(r)
    if (s === 'cancelled') { cancelled += 1; continue }
    if (s === 'requested') pending += 1
    if (isOverdueReturn(r, { now: n })) overdue += 1
    const h = durationHours(r)
    if (h != null) { hours += h; hoursN += 1 }
    const km = toFiniteNumber(r?.expected_km)
    if (km != null) { expectedKm += km; kmN += 1 }
  }
  return {
    ...base,
    pendingApproval: pending,
    overdueReturns: overdue,
    bookedHours: hoursN ? round1(hours) : null,
    avgDurationHours: hoursN ? round1(hours / hoursN) : null,
    cancellationRate: pct(cancelled, list.length),
    expectedKm: kmN ? Math.round(expectedKm) : null,
  }
}

/** Count per status in workflow order (unknown statuses are ignored). */
export function reservationStatusMix(rows = []) {
  const counts = Object.fromEntries(RESERVATION_STATUSES.map((s) => [s, 0]))
  for (const r of Array.isArray(rows) ? rows : []) {
    const s = statusOf(r)
    if (s in counts) counts[s] += 1
  }
  return RESERVATION_STATUSES.map((s) => ({ key: s, label: RESERVATION_STATUS_LABEL[s], count: counts[s] }))
}

/** Bookings and booked hours per department (cancelled excluded), busiest first. */
export function departmentDemand(rows = [], limit = 8) {
  const map = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    if (statusOf(r) === 'cancelled') continue
    const d = String(r?.department || '').trim() || NO_DEPARTMENT
    const b = map.get(d) || { department: d, bookings: 0, hours: 0, measured: 0 }
    b.bookings += 1
    const h = durationHours(r)
    if (h != null) { b.hours += h; b.measured += 1 }
    map.set(d, b)
  }
  return [...map.values()]
    .map((b) => ({ department: b.department, bookings: b.bookings, hours: b.measured ? round1(b.hours) : null }))
    .sort((a, b) => b.bookings - a.bookings || a.department.localeCompare(b.department))
    .slice(0, limit)
}

/** Bookings per month by pickup date for the last `months` months ending at now. */
export function monthlyBookings(rows = [], { now, months = 12 } = {}) {
  const end = new Date(nowMs(now))
  const keys = []
  for (let i = months - 1; i >= 0; i--) keys.push(monthKey(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1)))
  const map = new Map(keys.map((k) => [k, { month: k, bookings: 0, cancelled: 0 }]))
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = toMs(r?.start_at)
    if (t == null) continue
    const b = map.get(monthKey(t))
    if (!b) continue
    if (statusOf(r) === 'cancelled') b.cancelled += 1
    else b.bookings += 1
  }
  return keys.map((k) => map.get(k))
}

export { findConflicts }

export const RESERVATION_EXPORT_COLUMNS = [
  ['reference', 'Reference'], ['asset_no', 'Asset'], ['requester_name', 'Requester'], ['department', 'Department'],
  ['status', 'Status'], ['start_at', 'Start'], ['end_at', 'End'], ['duration', 'Duration (h)'],
  ['pickup_location', 'Pickup'], ['return_location', 'Return'], ['expected_km', 'Expected km'],
  ['double_booked', 'Double-booked'], ['purpose', 'Purpose'],
]

/** Export rows; `fmtDate` formats timestamps (defaults to the raw value). */
export function reservationExportRows(rows = [], { conflictIds, fmtDate = (v) => v || '' } = {}) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const h = durationHours(r)
    return {
      reference: r?.reference || '',
      asset_no: r?.asset_no || '',
      requester_name: r?.requester_name || '',
      department: r?.department || '',
      status: RESERVATION_STATUS_LABEL[statusOf(r)] || r?.status || '',
      start_at: fmtDate(r?.start_at),
      end_at: fmtDate(r?.end_at),
      duration: h == null ? '' : round1(h),
      pickup_location: r?.pickup_location || '',
      return_location: r?.return_location || '',
      expected_km: toFiniteNumber(r?.expected_km) ?? '',
      double_booked: conflictIds && conflictIds.has(r?.id) ? 'Yes' : 'No',
      purpose: r?.purpose || '',
    }
  })
}
