/**
 * Bay Scheduling — pure, dependency-free domain logic for the Bay Scheduling /
 * Workshop Capacity module (/bay-scheduling). Reduces a set of bay-schedule
 * rows into per-bay load, utilisation, overrun, scheduling conflicts, and a
 * workshop-level KPI summary.
 *
 * Keeping this here (no Supabase, no React, no wall-clock reads) makes it
 * deterministic and unit-testable; the service (`src/lib/api/bayScheduling.js`)
 * and page (`src/pages/BayScheduling.jsx`) both build on these primitives so
 * the roll-up logic lives in exactly one place. Every function that needs
 * "now" takes a `nowMs` argument — never call Date.now() in here.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Parse a timestamp-ish value to epoch ms, or null when it isn't a valid date. */
function timeMs(v) {
  if (v == null || v === '') return null
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}

const MS_PER_MIN = 60000

/**
 * Planned duration of a job in minutes, derived from scheduled_start →
 * scheduled_end. Returns null when either bound is missing/invalid or the end
 * is not after the start.
 * @param {object} job
 * @returns {number|null}
 */
export function scheduledMinutes(job) {
  const s = timeMs(job?.scheduled_start)
  const e = timeMs(job?.scheduled_end)
  if (s == null || e == null || e <= s) return null
  return (e - s) / MS_PER_MIN
}

/**
 * Realised duration of a job in minutes, derived from actual_start →
 * actual_end. Returns null when either bound is missing/invalid or the end is
 * not after the start.
 * @param {object} job
 * @returns {number|null}
 */
export function actualMinutes(job) {
  const s = timeMs(job?.actual_start)
  const e = timeMs(job?.actual_end)
  if (s == null || e == null || e <= s) return null
  return (e - s) / MS_PER_MIN
}

/**
 * Overrun in minutes: how much longer the job actually took versus its
 * estimate. Positive = ran over, negative = finished early. The estimate is
 * `estimated_min` when present, otherwise the scheduled window. Returns null
 * when the actual duration or the estimate basis is unavailable.
 * @param {object} job
 * @returns {number|null}
 */
export function overrunMinutes(job) {
  const actual = actualMinutes(job)
  if (actual == null) return null
  const est = toFiniteNumber(job?.estimated_min)
  const basis = est != null && est > 0 ? est : scheduledMinutes(job)
  if (basis == null) return null
  return actual - basis
}

/**
 * Bay utilisation over a window: the share of the window (in %, 0..100) during
 * which the named bay is occupied by scheduled jobs. Each job's occupancy is
 * the overlap of its scheduled window with [windowStartMs, windowEndMs];
 * overlaps are merged so double-booked intervals are never counted twice.
 * Cancelled jobs are excluded. Returns 0 when the window is empty/invalid.
 *
 * @param {Array<object>} rows
 * @param {string} bayName
 * @param {number} windowStartMs
 * @param {number} windowEndMs
 * @returns {number} 0..100
 */
export function bayUtilization(rows, bayName, windowStartMs, windowEndMs) {
  const list = Array.isArray(rows) ? rows : []
  const winStart = toFiniteNumber(windowStartMs)
  const winEnd = toFiniteNumber(windowEndMs)
  if (winStart == null || winEnd == null || winEnd <= winStart) return 0
  const windowMin = (winEnd - winStart) / MS_PER_MIN

  const intervals = []
  for (const r of list) {
    if (String(r?.bay_name ?? '').trim() !== String(bayName ?? '').trim()) continue
    if (r?.status === 'cancelled') continue
    const s = timeMs(r?.scheduled_start)
    const e = timeMs(r?.scheduled_end)
    if (s == null || e == null || e <= s) continue
    const clipStart = Math.max(s, winStart)
    const clipEnd = Math.min(e, winEnd)
    if (clipEnd > clipStart) intervals.push([clipStart, clipEnd])
  }
  if (!intervals.length) return 0

  // Merge overlapping intervals so simultaneous bookings count once.
  intervals.sort((a, b) => a[0] - b[0])
  let busyMs = 0
  let [curStart, curEnd] = intervals[0]
  for (let i = 1; i < intervals.length; i++) {
    const [s, e] = intervals[i]
    if (s <= curEnd) {
      if (e > curEnd) curEnd = e
    } else {
      busyMs += curEnd - curStart
      curStart = s
      curEnd = e
    }
  }
  busyMs += curEnd - curStart

  const busyMin = busyMs / MS_PER_MIN
  const pct = (busyMin / windowMin) * 100
  return Math.max(0, Math.min(100, pct))
}

/**
 * Workshop-level KPI summary.
 *   • totalJobs       — number of rows
 *   • scheduledCount  — status === 'scheduled'
 *   • inProgressCount — status === 'in_progress'
 *   • completedCount  — status === 'completed'
 *   • delayedCount    — status === 'delayed'
 *   • avgOverrunMin   — mean overrun (minutes) across jobs with a measurable
 *                       overrun; null when none are measurable
 *   • activeBays      — distinct bays carrying at least one non-cancelled job
 *
 * `nowMs` is accepted for symmetry/future time-relative logic; the summary is
 * otherwise time-agnostic and deterministic.
 *
 * @param {Array<object>} rows
 * @param {number} [nowMs]
 */
export function summariseBays(rows = [], nowMs = 0) {
  const list = Array.isArray(rows) ? rows : []
  let scheduledCount = 0
  let inProgressCount = 0
  let completedCount = 0
  let delayedCount = 0
  let overrunSum = 0
  let overrunN = 0
  const bays = new Set()

  for (const r of list) {
    switch (r?.status) {
      case 'scheduled': scheduledCount++; break
      case 'in_progress': inProgressCount++; break
      case 'completed': completedCount++; break
      case 'delayed': delayedCount++; break
      default: break
    }
    if (r?.status !== 'cancelled') {
      const bay = String(r?.bay_name ?? '').trim()
      if (bay) bays.add(bay)
    }
    const ov = overrunMinutes(r)
    if (ov != null) { overrunSum += ov; overrunN++ }
  }

  return {
    totalJobs: list.length,
    scheduledCount,
    inProgressCount,
    completedCount,
    delayedCount,
    avgOverrunMin: overrunN > 0 ? overrunSum / overrunN : null,
    activeBays: bays.size,
  }
}

/**
 * Per-bay load table. One entry per distinct bay (cancelled jobs excluded from
 * every metric):
 *   • bay_name  — the bay
 *   • jobs      — count of non-cancelled jobs assigned to the bay
 *   • busyMin   — total scheduled minutes booked into the bay
 *   • completed — count of completed jobs in the bay
 * Sorted by busyMin descending (ties broken by job count, then bay name).
 *
 * @param {Array<object>} rows
 * @returns {Array<{bay_name:string, jobs:number, busyMin:number, completed:number}>}
 */
export function perBayLoad(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byBay = new Map()
  for (const r of list) {
    if (r?.status === 'cancelled') continue
    const bay = String(r?.bay_name ?? '').trim()
    if (!bay) continue
    const cur = byBay.get(bay) || { bay_name: bay, jobs: 0, busyMin: 0, completed: 0 }
    cur.jobs += 1
    const mins = scheduledMinutes(r)
    if (mins != null) cur.busyMin += mins
    if (r?.status === 'completed') cur.completed += 1
    byBay.set(bay, cur)
  }
  return [...byBay.values()].sort((a, b) =>
    b.busyMin - a.busyMin ||
    b.jobs - a.jobs ||
    a.bay_name.localeCompare(b.bay_name),
  )
}

/**
 * Scheduling conflicts: pairs of scheduled jobs on the same bay whose scheduled
 * windows overlap (a bay can only service one job at a time). Cancelled jobs
 * are ignored, as are jobs without a valid scheduled window. Each conflict is
 * emitted once as `{ a, b }` with `a` the earlier-starting job.
 *
 * @param {Array<object>} rows
 * @returns {Array<{a:object, b:object}>}
 */
export function conflictsForBay(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byBay = new Map()
  for (const r of list) {
    if (r?.status === 'cancelled') continue
    const bay = String(r?.bay_name ?? '').trim()
    if (!bay) continue
    const s = timeMs(r?.scheduled_start)
    const e = timeMs(r?.scheduled_end)
    if (s == null || e == null || e <= s) continue
    if (!byBay.has(bay)) byBay.set(bay, [])
    byBay.get(bay).push({ job: r, s, e })
  }

  const out = []
  for (const items of byBay.values()) {
    items.sort((x, y) => x.s - y.s)
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        // Sorted by start; once a later job starts at/after the earlier one's
        // end, no further job can overlap the earlier one.
        if (items[j].s >= items[i].e) break
        out.push({ a: items[i].job, b: items[j].job })
      }
    }
  }
  return out
}
