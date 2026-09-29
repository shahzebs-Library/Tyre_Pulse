/**
 * vehicleReservationsView.js - pure view engine for the redesigned Vehicle
 * Reservations page (/reservations). No Supabase, no React.
 *
 * Builds on vehicleReservations.js (duration, overlap) and never re-implements
 * it. This module adds:
 *   - a derived booking status (active, upcoming, overdue, completed,
 *     cancelled, not started, unscheduled) read from the workflow status and
 *     the clock,
 *   - the five headline KPIs and the summary donut,
 *   - the calendar grid (day / week / month slots, bars per vehicle with lane
 *     packing so two bookings on one vehicle never hide each other),
 *   - the clash check for a new booking, the availability check for a window,
 *   - mapping of an imported spreadsheet row onto the reservation columns.
 *
 * HONESTY NOTES
 * - The table records no reservation type, project, driver or attachment, so
 *   none are derived here.
 * - A booking with no start time cannot be placed on the calendar; it is
 *   counted as unscheduled, never silently dropped.
 * - Time-dependent functions take an injectable `now`.
 */
import { overlaps } from './vehicleReservations'

export const DAY_MS = 86400000

function toMs(v) {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}
const nowOf = (now) => toMs(now ?? new Date()) ?? Date.now()
const statusOf = (r) => String(r?.status || '').trim().toLowerCase()
const assetOf = (r) => (r?.asset_no != null ? String(r.asset_no).trim() : '')

/* ── Derived status ─────────────────────────────────────────────────────────── */

export const VIEW_STATUSES = ['active', 'upcoming', 'overdue', 'not_started', 'completed', 'cancelled', 'unscheduled']
export const VIEW_STATUS_META = {
  active: { label: 'Active', tone: 'good', color: '#16a34a' },
  upcoming: { label: 'Upcoming', tone: 'info', color: '#2563eb' },
  overdue: { label: 'Overdue', tone: 'bad', color: '#dc2626' },
  not_started: { label: 'Not collected', tone: 'warn', color: '#d97706' },
  completed: { label: 'Completed', tone: 'muted', color: '#94a3b8' },
  cancelled: { label: 'Cancelled', tone: 'muted', color: '#64748b' },
  unscheduled: { label: 'Unscheduled', tone: 'muted', color: '#a855f7' },
}

/**
 * Status a person reads off the calendar:
 *   cancelled -> cancelled, returned -> completed,
 *   out -> overdue once the return time has passed, else active,
 *   requested / approved -> upcoming before the start, not collected once the
 *   start has passed (the vehicle was never checked out), unscheduled with no
 *   start time.
 */
export function deriveStatus(r, { now } = {}) {
  const s = statusOf(r)
  const n = nowOf(now)
  if (s === 'cancelled') return 'cancelled'
  if (s === 'returned') return 'completed'
  const start = toMs(r?.start_at)
  const end = toMs(r?.end_at)
  if (s === 'out') return end != null && end < n ? 'overdue' : 'active'
  if (start == null) return 'unscheduled'
  return start > n ? 'upcoming' : 'not_started'
}

/** Headline KPIs of the mockup. Upcoming counts starts within the next `days`. */
export function viewKpis(rows = [], { now, days = 7 } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const n = nowOf(now)
  const horizon = n + days * DAY_MS
  let active = 0; let upcoming = 0; let overdue = 0; let cancelled = 0
  for (const r of list) {
    const st = deriveStatus(r, { now: n })
    if (st === 'active') active += 1
    else if (st === 'overdue') overdue += 1
    else if (st === 'cancelled') cancelled += 1
    else if (st === 'upcoming') {
      const start = toMs(r?.start_at)
      if (start != null && start < horizon) upcoming += 1
    }
  }
  return { total: list.length, active, upcoming, overdue, cancelled }
}

/** Donut segments in a fixed order; empty buckets are kept so the legend is stable. */
export function summarySegments(rows = [], { now } = {}) {
  const counts = Object.fromEntries(VIEW_STATUSES.map((s) => [s, 0]))
  for (const r of Array.isArray(rows) ? rows : []) counts[deriveStatus(r, { now })] += 1
  return VIEW_STATUSES
    .filter((s) => s !== 'unscheduled' || counts[s] > 0)
    .map((s) => ({ key: s, label: VIEW_STATUS_META[s].label, color: VIEW_STATUS_META[s].color, count: counts[s] }))
}

/* ── Calendar slots ─────────────────────────────────────────────────────────── */

export const CAL_MODES = ['day', 'week', 'month']

function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d }
function addDays(d, n) { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x }
const fmtDayMonth = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const fmtFull = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** Monday of the week containing `ms` (local time). */
export function startOfWeek(ms) {
  const d = startOfDay(ms)
  const dow = (d.getDay() + 6) % 7 // Monday = 0
  return addDays(d, -dow)
}

/**
 * Slots for a calendar mode, in local time.
 *   day   -> 12 two-hour slots
 *   week  -> 7 days from Monday
 *   month -> every day of the month
 * Each slot is { start, end, label, sub, today }.
 */
export function buildSlots(anchor, mode = 'week', { now } = {}) {
  const a = toMs(anchor) ?? nowOf(now)
  const todayStart = startOfDay(nowOf(now)).getTime()
  const slots = []
  if (mode === 'day') {
    const d0 = startOfDay(a)
    for (let h = 0; h < 24; h += 2) {
      const s = new Date(d0.getTime()); s.setHours(h)
      const e = new Date(d0.getTime()); e.setHours(h + 2)
      slots.push({ start: s.getTime(), end: e.getTime(), label: `${String(h).padStart(2, '0')}:00`, sub: '', today: false })
    }
    return { mode, start: slots[0].start, end: slots[slots.length - 1].end, slots, label: fmtFull(d0) }
  }
  let first; let count
  if (mode === 'month') {
    const d = startOfDay(a); d.setDate(1)
    first = d
    const next = new Date(d.getTime()); next.setMonth(next.getMonth() + 1)
    count = Math.round((startOfDay(next.getTime()).getTime() - d.getTime()) / DAY_MS)
  } else {
    first = startOfWeek(a)
    count = 7
  }
  for (let i = 0; i < count; i++) {
    const s = addDays(first, i)
    const e = addDays(first, i + 1)
    slots.push({
      start: s.getTime(),
      end: e.getTime(),
      label: mode === 'month' ? String(s.getDate()) : s.toLocaleDateString('en-GB', { weekday: 'short' }),
      sub: mode === 'month' ? s.toLocaleDateString('en-GB', { weekday: 'narrow' }) : fmtDayMonth(s),
      today: s.getTime() === todayStart,
    })
  }
  const last = new Date(slots[slots.length - 1].start)
  const label = mode === 'month'
    ? first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : `${fmtFull(first)} to ${fmtFull(last)}`
  return { mode, start: slots[0].start, end: slots[slots.length - 1].end, slots, label }
}

/** Move the anchor one period forward (dir 1) or back (dir -1). */
export function shiftAnchor(anchor, mode, dir) {
  const d = new Date(toMs(anchor) ?? Date.now())
  if (mode === 'day') d.setDate(d.getDate() + dir)
  else if (mode === 'month') { d.setDate(1); d.setMonth(d.getMonth() + dir) } else d.setDate(d.getDate() + 7 * dir)
  return d.getTime()
}

/**
 * Lay reservations out on the calendar. One row per vehicle that has a
 * booking inside the range; each bar spans the slots it touches and is packed
 * into the first free lane, so overlapping bookings on one vehicle stack
 * instead of hiding each other. Cancelled bookings are left off (they do not
 * hold the vehicle). Rows without a start cannot be placed and are counted.
 *
 * @returns {{ vehicles: Array<{asset:string, laneCount:number, bars:Array}>, unplaced:number, outOfRange:number }}
 */
export function layoutCalendar(rows = [], grid, { now } = {}) {
  const slots = grid?.slots || []
  const byAsset = new Map()
  let unplaced = 0
  let outOfRange = 0
  if (!slots.length) return { vehicles: [], unplaced: 0, outOfRange: 0 }
  const rStart = slots[0].start
  const rEnd = slots[slots.length - 1].end
  for (const r of Array.isArray(rows) ? rows : []) {
    if (statusOf(r) === 'cancelled') continue
    const start = toMs(r?.start_at)
    if (start == null) { unplaced += 1; continue }
    let end = toMs(r?.end_at)
    // An open booking (no return time) occupies its start slot until returned.
    if (end == null || end <= start) end = statusOf(r) === 'out' ? Math.max(start + 1, nowOf(now)) : start + 1
    if (end <= rStart || start >= rEnd) { outOfRange += 1; continue }
    let first = slots.findIndex((s) => s.end > start)
    let last = -1
    for (let i = slots.length - 1; i >= 0; i--) { if (slots[i].start < end) { last = i; break } }
    if (first < 0 || last < first) { outOfRange += 1; continue }
    first = Math.max(0, first)
    const key = assetOf(r) || '(no asset)'
    if (!byAsset.has(key)) byAsset.set(key, [])
    byAsset.get(key).push({
      row: r, startCol: first, span: last - first + 1,
      clippedStart: start < rStart, clippedEnd: end > rEnd,
      status: deriveStatus(r, { now }), start,
    })
  }
  const vehicles = [...byAsset.entries()].map(([asset, bars]) => {
    bars.sort((a, b) => a.startCol - b.startCol || a.start - b.start)
    const laneEnds = []
    for (const b of bars) {
      let lane = laneEnds.findIndex((endCol) => endCol < b.startCol)
      if (lane < 0) { lane = laneEnds.length; laneEnds.push(-1) }
      laneEnds[lane] = b.startCol + b.span - 1
      b.lane = lane
    }
    return { asset, laneCount: Math.max(1, laneEnds.length), bars }
  }).sort((a, b) => a.asset.localeCompare(b.asset, 'en', { numeric: true }))
  return { vehicles, unplaced, outOfRange }
}

/* ── Clash and availability ─────────────────────────────────────────────────── */

const holdsVehicle = (r) => {
  const s = statusOf(r)
  return s !== 'cancelled' && s !== 'returned'
}

/**
 * Existing bookings the candidate would clash with: same vehicle, overlapping
 * window, not cancelled or already returned, and not the booking being edited.
 */
export function clashesFor(candidate, rows = [], { excludeId } = {}) {
  if (!candidate) return []
  return (Array.isArray(rows) ? rows : []).filter((r) => (
    r && holdsVehicle(r) && (excludeId == null || r.id !== excludeId) && overlaps(candidate, r)
  ))
}

/**
 * Which fleet assets are free for [from, to): an asset is booked when any
 * non-cancelled, non-returned reservation overlaps the window.
 */
export function availability(fleet = [], rows = [], { from, to } = {}) {
  const f = toMs(from)
  const t = toMs(to)
  if (f == null || t == null || t <= f) return null
  const probeFor = (asset) => ({ asset_no: asset, start_at: f, end_at: t })
  const free = []
  const booked = []
  const seen = new Set()
  for (const a of Array.isArray(fleet) ? fleet : []) {
    const asset = assetOf(a)
    if (!asset || seen.has(asset)) continue
    seen.add(asset)
    const hits = clashesFor(probeFor(asset), rows)
    if (hits.length) booked.push({ asset: a, bookings: hits })
    else free.push(a)
  }
  return { free, booked }
}

/** Next bookings to act on: active, overdue, not collected and upcoming, soonest start first. */
export function upcomingList(rows = [], { now, limit = 8 } = {}) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({ r, st: deriveStatus(r, { now }), start: toMs(r?.start_at) }))
    .filter((x) => ['active', 'overdue', 'not_started', 'upcoming'].includes(x.st))
    .sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity))
    .slice(0, limit)
    .map((x) => x.r)
}

/* ── Spreadsheet import ─────────────────────────────────────────────────────── */

const IMPORT_HEADERS = {
  asset_no: ['asset', 'asset no', 'asset number', 'vehicle', 'vehicle asset', 'asset code'],
  start_at: ['start', 'start at', 'start date', 'pickup', 'pickup time', 'from'],
  end_at: ['end', 'end at', 'end date', 'return', 'return time', 'to'],
  requester_name: ['requester', 'requested by', 'booked by', 'requester name'],
  department: ['department', 'dept'],
  purpose: ['purpose', 'remark', 'remarks', 'purpose remark'],
  reference: ['reference', 'reference no', 'ref', 'ref no'],
  pickup_location: ['pickup location', 'site', 'location'],
  return_location: ['return location'],
  status: ['status'],
  notes: ['notes', 'note'],
}
const normHeader = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Map one imported row (object keyed by the sheet's own headers) onto the
 * reservation columns. Returns { values } or { error }. The service still
 * validates every field on insert.
 */
export function mapImportRow(obj = {}) {
  const byNorm = new Map(Object.keys(obj || {}).map((k) => [normHeader(k), obj[k]]))
  const values = {}
  for (const [field, names] of Object.entries(IMPORT_HEADERS)) {
    for (const n of names) {
      const v = byNorm.get(n)
      if (v != null && String(v).trim() !== '') { values[field] = String(v).trim(); break }
    }
  }
  if (!values.asset_no) return { error: 'No asset number' }
  if (values.start_at && toMs(values.start_at) == null) return { error: 'Start time is not a date' }
  if (values.end_at && toMs(values.end_at) == null) return { error: 'End time is not a date' }
  if (values.start_at && values.end_at && toMs(values.end_at) <= toMs(values.start_at)) return { error: 'End is not after start' }
  if (values.status) values.status = values.status.toLowerCase()
  return { values }
}

export const IMPORT_TEMPLATE_HEADERS = ['Asset', 'Start', 'End', 'Requester', 'Department', 'Purpose', 'Reference', 'Pickup location', 'Return location', 'Status', 'Notes']
