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
const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000

/**
 * Working-day capacity model (§ capacity planning). A workshop bay is not
 * available 24h/day, so utilisation and capacity must be measured against the
 * productive window, not the wall clock. Defaults model a single 08:00→18:00
 * shift = 10 productive hours/day. All values are configurable via
 * `DEFAULT_CAPACITY_CONFIG` / a `cfg` override so a site running a different
 * shift pattern can recalibrate without touching the maths.
 *
 * NOTE: day boundaries are computed in UTC to stay deterministic and match the
 * page, which floors `Date.now()` to a UTC day. `WORKING_DAY_START_HOUR` is the
 * hour (UTC) the productive window opens each day.
 */
export const WORKING_DAY_START_HOUR = 8 // 08:00
export const WORKING_DAY_END_HOUR = 18 // 18:00
export const WORKING_HOURS_PER_DAY = WORKING_DAY_END_HOUR - WORKING_DAY_START_HOUR // 10h
export const WORKING_MS_PER_DAY = WORKING_HOURS_PER_DAY * MS_PER_HOUR

/**
 * Capacity-planning defaults. Every consumer (page, forecast, utilisation)
 * reads through here so the model lives in exactly one place.
 *   • workingDayStartHour   — UTC hour the productive window opens
 *   • workingHoursPerDay     — productive hours per bay per day
 *   • avgJobHours            — fallback mean job duration when the data carries
 *                              no measurable scheduled windows (slot sizing)
 *   • forecastDays           — forecast horizon (days)
 *   • historyDays            — look-back window for the average daily demand
 *   • overloadThresholdPct   — utilisation above which a day/bay is "overloaded"
 */
export const DEFAULT_CAPACITY_CONFIG = Object.freeze({
  workingDayStartHour: WORKING_DAY_START_HOUR,
  workingHoursPerDay: WORKING_HOURS_PER_DAY,
  avgJobHours: 1.5,
  forecastDays: 7,
  historyDays: 30,
  overloadThresholdPct: 90,
})

/** Merge a partial cfg onto the defaults (undefined/null fields fall back). */
function resolveCfg(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {}
  return {
    workingDayStartHour: c.workingDayStartHour ?? DEFAULT_CAPACITY_CONFIG.workingDayStartHour,
    workingHoursPerDay: c.workingHoursPerDay ?? DEFAULT_CAPACITY_CONFIG.workingHoursPerDay,
    avgJobHours: c.avgJobHours ?? DEFAULT_CAPACITY_CONFIG.avgJobHours,
    forecastDays: c.forecastDays ?? DEFAULT_CAPACITY_CONFIG.forecastDays,
    historyDays: c.historyDays ?? DEFAULT_CAPACITY_CONFIG.historyDays,
    overloadThresholdPct: c.overloadThresholdPct ?? DEFAULT_CAPACITY_CONFIG.overloadThresholdPct,
  }
}

/**
 * Productive (working-hours) milliseconds inside [winStart, winEnd]. For each
 * UTC day the window touches, this intersects the window with that day's
 * [start+startHour, start+startHour+hoursPerDay] shift and sums the overlaps.
 * This is the correct denominator for utilisation: a bay busy a full working
 * day reads ~100%, not ~33% against a 24h clock (utilisation calibration fix).
 */
export function workingMsInWindow(winStartMs, winEndMs, cfg) {
  const { workingDayStartHour, workingHoursPerDay } = resolveCfg(cfg)
  const winStart = toFiniteNumber(winStartMs)
  const winEnd = toFiniteNumber(winEndMs)
  if (winStart == null || winEnd == null || winEnd <= winStart) return 0
  const shiftMs = workingHoursPerDay * MS_PER_HOUR
  if (shiftMs <= 0) return 0
  let total = 0
  for (let dayStart = Math.floor(winStart / MS_PER_DAY) * MS_PER_DAY; dayStart < winEnd; dayStart += MS_PER_DAY) {
    const workStart = dayStart + workingDayStartHour * MS_PER_HOUR
    const workEnd = workStart + shiftMs
    const s = Math.max(workStart, winStart)
    const e = Math.min(workEnd, winEnd)
    if (e > s) total += e - s
  }
  return total
}

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
 * Utilisation is measured against the PRODUCTIVE window (working hours inside
 * [start,end]), not the raw span — so a bay busy a full 10h working day reads
 * ~100% rather than ~33% against a 24h clock. When the window contains no
 * working hours at all (e.g. an all-out-of-hours span) it falls back to the raw
 * span so the figure is still bounded and non-zero-divide. The numerator (merged
 * busy intervals clipped to the window) is unchanged.
 *
 * @param {Array<object>} rows
 * @param {string} bayName
 * @param {number} windowStartMs
 * @param {number} windowEndMs
 * @param {object} [cfg]  capacity config (working-day model); see DEFAULT_CAPACITY_CONFIG
 * @returns {number} 0..100
 */
export function bayUtilization(rows, bayName, windowStartMs, windowEndMs, cfg) {
  const list = Array.isArray(rows) ? rows : []
  const winStart = toFiniteNumber(windowStartMs)
  const winEnd = toFiniteNumber(windowEndMs)
  if (winStart == null || winEnd == null || winEnd <= winStart) return 0
  const workingMs = workingMsInWindow(winStart, winEnd, cfg)
  const denomMs = workingMs > 0 ? workingMs : winEnd - winStart
  const windowMin = denomMs / MS_PER_MIN

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

// ── Capacity planning (ported from tyre_saas workshop_engine / capacity) ──────

/** True when [aStart,aEnd) and [bStart,bEnd) overlap (touching ends do not). */
export function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

/**
 * Distinct active bays: bays carrying at least one non-cancelled job. Used as
 * the capacity multiplier when a bay master isn't available.
 * @param {Array<object>} rows
 * @returns {number}
 */
export function activeBayCount(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const bays = new Set()
  for (const r of list) {
    if (r?.status === 'cancelled') continue
    const bay = String(r?.bay_name ?? '').trim()
    if (bay) bays.add(bay)
  }
  return bays.size
}

/**
 * Mean job duration in HOURS across non-cancelled jobs with a measurable
 * scheduled window; falls back to `cfg.avgJobHours` when none are measurable.
 * This sizes a "job slot" for capacity/forecast maths.
 * @param {Array<object>} rows
 * @param {object} [cfg]
 * @returns {number} hours (> 0)
 */
export function avgJobHours(rows = [], cfg) {
  const { avgJobHours: fallback } = resolveCfg(cfg)
  const list = Array.isArray(rows) ? rows : []
  let sum = 0
  let n = 0
  for (const r of list) {
    if (r?.status === 'cancelled') continue
    const mins = scheduledMinutes(r)
    if (mins != null && mins > 0) { sum += mins; n += 1 }
  }
  const derived = n > 0 ? sum / n / 60 : null
  const val = derived != null && derived > 0 ? derived : fallback
  return val > 0 ? val : 1
}

/**
 * G1 — Forward capacity forecast for the next `cfg.forecastDays` days.
 *
 * Method (ported from workshop_capacity.capacity_forecast, calibrated to the
 * working-day model):
 *   • avgDaily   = non-cancelled jobs scheduled in the last `historyDays` / historyDays
 *   • per day    scheduled = jobs scheduled that (UTC) day
 *                expected  = max(scheduled, avgDaily)
 *                slotsPerDay = activeBays * workingHoursPerDay / avgJobHours
 *                utilPct   = expected / slotsPerDay * 100
 *                overloaded = utilPct > overloadThresholdPct
 *
 * `nowMs` is injected (never Date.now() in here) so the forecast is
 * deterministic and unit-testable. `cfg.activeBays` / `cfg.avgJobHours` override
 * the values derived from the rows.
 *
 * @param {Array<object>} rows
 * @param {number} nowMs
 * @param {object} [cfg]
 * @returns {{ avgDaily:number, activeBays:number, avgJobHours:number,
 *   slotsPerDay:number, days:Array<object> }}
 */
export function forecastCapacity(rows = [], nowMs = 0, cfg) {
  const c = resolveCfg(cfg)
  const list = Array.isArray(rows) ? rows : []
  const now = toFiniteNumber(nowMs) ?? 0
  const bays = cfg?.activeBays != null ? Math.max(0, cfg.activeBays) : activeBayCount(list)
  const jobHours = cfg?.avgJobHours != null ? (cfg.avgJobHours > 0 ? cfg.avgJobHours : 1) : avgJobHours(list, c)
  const slotsPerDay = jobHours > 0 ? (bays * c.workingHoursPerDay) / jobHours : 0

  // Average daily demand over the look-back window.
  const historyStart = now - c.historyDays * MS_PER_DAY
  let recent = 0
  for (const r of list) {
    if (r?.status === 'cancelled') continue
    const s = timeMs(r?.scheduled_start)
    if (s != null && s >= historyStart && s < now) recent += 1
  }
  const avgDaily = c.historyDays > 0 ? recent / c.historyDays : 0

  const todayStart = Math.floor(now / MS_PER_DAY) * MS_PER_DAY
  const days = []
  for (let i = 0; i < c.forecastDays; i++) {
    const dayStart = todayStart + i * MS_PER_DAY
    const dayEnd = dayStart + MS_PER_DAY
    let scheduled = 0
    for (const r of list) {
      if (r?.status === 'cancelled') continue
      const s = timeMs(r?.scheduled_start)
      if (s != null && s >= dayStart && s < dayEnd) scheduled += 1
    }
    const expected = Math.max(scheduled, avgDaily)
    const utilPct = slotsPerDay > 0 ? (expected / slotsPerDay) * 100 : 0
    days.push({
      dayStartMs: dayStart,
      date: new Date(dayStart).toISOString().slice(0, 10),
      dayName: new Date(dayStart).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      scheduled,
      expected: Math.round(expected * 10) / 10,
      slotsPerDay: Math.round(slotsPerDay * 10) / 10,
      utilPct: Math.round(utilPct * 10) / 10,
      overloaded: utilPct > c.overloadThresholdPct,
    })
  }

  return {
    avgDaily: Math.round(avgDaily * 10) / 10,
    activeBays: bays,
    avgJobHours: Math.round(jobHours * 100) / 100,
    slotsPerDay: Math.round(slotsPerDay * 10) / 10,
    days,
  }
}

/**
 * G3 — Per-technician load roll-up. Groups non-cancelled jobs by technician
 * (blank → "Unassigned") into { technician, jobs, bookedMin, completed,
 * utilPct }. utilPct is booked minutes vs one working day
 * (`cfg.workingHoursPerDay` hours). Sorted by bookedMin desc (ties: jobs, name).
 *
 * @param {Array<object>} rows
 * @param {object} [cfg]
 * @returns {Array<{technician:string, jobs:number, bookedMin:number,
 *   completed:number, utilPct:number}>}
 */
export function perTechnicianLoad(rows = [], cfg) {
  const { workingHoursPerDay } = resolveCfg(cfg)
  const dayMin = workingHoursPerDay * 60
  const list = Array.isArray(rows) ? rows : []
  const byTech = new Map()
  for (const r of list) {
    if (r?.status === 'cancelled') continue
    const tech = String(r?.technician ?? '').trim() || 'Unassigned'
    const cur = byTech.get(tech) || { technician: tech, jobs: 0, bookedMin: 0, completed: 0 }
    cur.jobs += 1
    const mins = scheduledMinutes(r)
    if (mins != null) cur.bookedMin += mins
    if (r?.status === 'completed') cur.completed += 1
    byTech.set(tech, cur)
  }
  return [...byTech.values()]
    .map((t) => ({
      ...t,
      bookedMin: Math.round(t.bookedMin),
      utilPct: dayMin > 0 ? Math.round((t.bookedMin / dayMin) * 1000) / 10 : 0,
    }))
    .sort((a, b) =>
      b.bookedMin - a.bookedMin ||
      b.jobs - a.jobs ||
      a.technician.localeCompare(b.technician),
    )
}

/**
 * G5 — Per-technician scheduling conflicts: the same technician booked into two
 * jobs whose scheduled windows overlap while sitting in DIFFERENT bays (a same-
 * bay overlap is already reported by `conflictsForBay`, so it is excluded here
 * to avoid double-counting). Cancelled jobs and jobs without a technician or a
 * valid window are ignored. Each conflict is emitted once as
 * `{ technician, a, b }` with `a` the earlier-starting job.
 *
 * @param {Array<object>} rows
 * @returns {Array<{technician:string, a:object, b:object}>}
 */
export function technicianConflicts(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const byTech = new Map()
  for (const r of list) {
    if (r?.status === 'cancelled') continue
    const tech = String(r?.technician ?? '').trim()
    if (!tech) continue
    const s = timeMs(r?.scheduled_start)
    const e = timeMs(r?.scheduled_end)
    if (s == null || e == null || e <= s) continue
    if (!byTech.has(tech)) byTech.set(tech, [])
    byTech.get(tech).push({ job: r, s, e, bay: String(r?.bay_name ?? '').trim() })
  }

  const out = []
  for (const [tech, items] of byTech.entries()) {
    items.sort((x, y) => x.s - y.s)
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (items[j].s >= items[i].e) break // sorted by start → no later job can overlap
        if (items[i].bay && items[j].bay && items[i].bay === items[j].bay) continue // same-bay handled elsewhere
        out.push({ technician: tech, a: items[i].job, b: items[j].job })
      }
    }
  }
  return out
}

/**
 * Pure write-time overlap guard (the testable core behind the service's
 * conflict prevention). Returns the existing non-cancelled rows on the SAME bay
 * whose scheduled window overlaps the candidate's [start,end). The candidate's
 * own row (matched by id) is excluded so edits don't collide with themselves.
 * Returns [] when the candidate has no bay or no valid window (nothing to guard).
 *
 * @param {{id?:any, bay_name?:string, scheduled_start?:any, scheduled_end?:any, status?:string}} candidate
 * @param {Array<object>} rows
 * @returns {Array<object>} overlapping existing rows
 */
export function bayOverlapConflicts(candidate, rows = []) {
  if (candidate?.status === 'cancelled') return []
  const s = timeMs(candidate?.scheduled_start)
  const e = timeMs(candidate?.scheduled_end)
  if (s == null || e == null || e <= s) return []
  const bay = String(candidate?.bay_name ?? '').trim()
  if (!bay) return []
  const list = Array.isArray(rows) ? rows : []
  const out = []
  for (const r of list) {
    if (candidate?.id != null && r?.id != null && r.id === candidate.id) continue
    if (r?.status === 'cancelled') continue
    if (String(r?.bay_name ?? '').trim() !== bay) continue
    const rs = timeMs(r?.scheduled_start)
    const re = timeMs(r?.scheduled_end)
    if (rs == null || re == null || re <= rs) continue
    if (intervalsOverlap(s, e, rs, re)) out.push(r)
  }
  return out
}
