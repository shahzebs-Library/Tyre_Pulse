/**
 * baySchedulingAnalytics - pure presentation engine for /bay-scheduling.
 *
 * Bay maths (utilisation, overruns, conflicts, forecast, technician load)
 * lives in src/lib/bayScheduling.js and is REUSED, not duplicated. This module
 * owns the page-level answers built on top: the local "today" window, the KPI
 * set with honest nulls, register filtering, export shapes and the read-cap
 * disclosure. No I/O, no React; `nowMs` is always injected.
 *
 * "Today" is the viewer's LOCAL calendar day. The page previously floored
 * epoch milliseconds to a UTC day, which in the GCC (UTC+3/+4) put jobs
 * finished between midnight and 03:00 local on the wrong day.
 */
import {
  summariseBays, perBayLoad, bayUtilization, overrunMinutes, conflictsForBay,
  technicianConflicts,
} from './bayScheduling'

export const JOB_TYPES = Object.freeze([
  { v: 'tyre_change', l: 'Tyre change' }, { v: 'rotation', l: 'Rotation' },
  { v: 'repair', l: 'Repair' }, { v: 'inspection', l: 'Inspection' },
  { v: 'service', l: 'Service' }, { v: 'alignment', l: 'Alignment' }, { v: 'other', l: 'Other' },
])
export const PRIORITIES = Object.freeze([
  { v: 'low', l: 'Low' }, { v: 'normal', l: 'Normal' },
  { v: 'high', l: 'High' }, { v: 'urgent', l: 'Urgent' },
])
export const STATUSES = Object.freeze([
  { v: 'scheduled', l: 'Scheduled' }, { v: 'in_progress', l: 'In progress' },
  { v: 'completed', l: 'Completed' }, { v: 'delayed', l: 'Delayed' }, { v: 'cancelled', l: 'Cancelled' },
])
export const JOB_TYPE_LABEL = Object.freeze(Object.fromEntries(JOB_TYPES.map((j) => [j.v, j.l])))

/** The service reads at most this many rows (newest first). */
export const READ_LIMIT = 500

/** Title-cased label for a snake_case token, or 'N/A'. */
export function fmtLabel(v) {
  if (v == null || v === '') return 'N/A'
  return String(v).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Minutes as '45 min' / '2h 5m' / '-1h', or 'N/A'. */
export function fmtMin(v) {
  if (v == null || !Number.isFinite(Number(v))) return 'N/A'
  const n = Math.round(Number(v))
  if (Math.abs(n) < 60) return `${n} min`
  const h = Math.floor(Math.abs(n) / 60)
  const m = Math.abs(n) % 60
  return `${n < 0 ? '-' : ''}${h}h${m ? ` ${m}m` : ''}`
}

/** [start, end) of the viewer's local calendar day containing `nowMs`. */
export function localDayWindow(nowMs) {
  const d = new Date(nowMs)
  d.setHours(0, 0, 0, 0)
  const start = d.getTime()
  const e = new Date(start)
  e.setDate(e.getDate() + 1)
  return { start, end: e.getTime() }
}

const t = (v) => {
  if (!v) return NaN
  const n = new Date(v).getTime()
  return Number.isFinite(n) ? n : NaN
}

/** Jobs completed inside the local day of `nowMs` (by actual end, else scheduled end, else created). */
export function completedToday(rows, nowMs) {
  const { start, end } = localDayWindow(nowMs)
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (r?.status !== 'completed') return false
    const x = t(r.actual_end || r.scheduled_end || r.created_at)
    return Number.isFinite(x) && x >= start && x < end
  }).length
}

/** Jobs whose scheduled start falls inside the local day of `nowMs` (cancelled excluded). */
export function scheduledToday(rows, nowMs) {
  const { start, end } = localDayWindow(nowMs)
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (r?.status === 'cancelled') return false
    const x = t(r.scheduled_start)
    return Number.isFinite(x) && x >= start && x < end
  }).length
}

/**
 * On-time rate: share of completed jobs with a measurable overrun that
 * finished within their scheduled window (overrun <= 0). Null when no
 * completed job carries both schedule and actual times.
 */
export function onTimeRate(rows) {
  let measured = 0
  let onTime = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.status !== 'completed') continue
    const ov = overrunMinutes(r)
    if (ov == null) continue
    measured += 1
    if (ov <= 0) onTime += 1
  }
  return { measured, onTime, pct: measured > 0 ? Math.round((onTime / measured) * 1000) / 10 : null }
}

/** Per-bay load for today, each with a local-day utilisation percentage. */
export function bayLoadToday(rows, nowMs) {
  const { start, end } = localDayWindow(nowMs)
  const list = Array.isArray(rows) ? rows : []
  return perBayLoad(list).map((b) => ({
    ...b,
    utilization: Math.round(bayUtilization(list, b.bay_name, start, end)),
  }))
}

/**
 * The page KPI set. Every rate is null when unmeasurable. `capped` warns that
 * the read returned the service ceiling, so totals may exclude older jobs.
 */
export function bayKpis(rows, nowMs, { limit = READ_LIMIT } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const s = summariseBays(list, nowMs)
  const onTime = onTimeRate(list)
  const conflicts = conflictsForBay(list).length
  const techConflicts = technicianConflicts(list).length
  const live = list.filter((r) => r?.status !== 'cancelled' && r?.status !== 'completed').length
  return {
    ...s,
    live,
    completedToday: completedToday(list, nowMs),
    scheduledToday: scheduledToday(list, nowMs),
    onTimePct: onTime.pct,
    onTimeMeasured: onTime.measured,
    conflicts,
    techConflicts,
    capped: list.length >= limit,
  }
}

/** Distinct sorted bay names. */
export function bayOptions(rows) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => r?.bay_name).filter(Boolean))].sort()
}

/** Filter the register by bay, status, priority, job type and a free-text query. */
export function filterJobs(rows, { bay = '', status = '', priority = '', jobType = '', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (bay && r.bay_name !== bay) return false
    if (status && r.status !== status) return false
    if (priority && r.priority !== priority) return false
    if (jobType && r.job_type !== jobType) return false
    if (q) {
      const hay = `${r.bay_name || ''} ${r.workshop_site || ''} ${r.asset_no || ''} ${r.technician || ''} ${r.work_order_ref || ''} ${r.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Set of job ids involved in any bay double-booking (for row flagging). */
export function conflictJobIds(rows) {
  const ids = new Set()
  for (const c of conflictsForBay(rows)) {
    if (c.a?.id != null) ids.add(c.a.id)
    if (c.b?.id != null) ids.add(c.b.id)
  }
  return ids
}

/** Export rows (every filtered job). */
export function jobExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const ov = overrunMinutes(r)
    return {
      bay_name: r.bay_name || '', workshop_site: r.workshop_site || '', asset_no: r.asset_no || '',
      job_type: JOB_TYPE_LABEL[r.job_type] || r.job_type || '', technician: r.technician || '',
      scheduled_start: r.scheduled_start || '', scheduled_end: r.scheduled_end || '',
      estimated_min: r.estimated_min ?? '', overrun_min: ov == null ? '' : Math.round(ov),
      priority: fmtLabel(r.priority), status: fmtLabel(r.status), work_order_ref: r.work_order_ref || '',
    }
  })
}

/** Utilisation band for a percentage; text label so colour is never the only signal. */
export function utilBand(pct) {
  const n = Number(pct)
  if (!Number.isFinite(n)) return { key: 'none', label: 'N/A' }
  if (n >= 90) return { key: 'high', label: 'Overloaded' }
  if (n >= 70) return { key: 'busy', label: 'Busy' }
  return { key: 'ok', label: 'Available' }
}
