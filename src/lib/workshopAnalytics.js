/**
 * workshopAnalytics.js - pure, deterministic HISTORY / TREND analytics for the
 * workshop. Where the live engine (`workshopLive.js`) answers "what is happening
 * right now", this engine answers "how did the workshop perform over a DATE
 * RANGE": daily productivity trends, a technician leaderboard, delay cost by
 * reason, first-time-fix rate and target-vs-actual.
 *
 * NO I/O. `now` is injectable (epoch ms) so every number is fully testable and
 * the engine never reads Date.now() implicitly except as a default argument.
 *
 * It REUSES the live engine so the maths live in one place:
 *   - `rollupTechnician` classifies one technician-day's events into
 *     productive / blocked / break / unassigned minutes + utilization.
 *   - `delayBreakdown` turns aggregated blocked-by-reason time into delay rows
 *     with hours lost, cost impact, owning department and suggested action.
 *
 * HONESTY: nothing is fabricated. A metric that cannot be computed from the
 * supplied rows is `null` (utilization with no on-duty time, first-time-fix with
 * no completed jobs, target-vs-actual with no timed jobs) and empty ranges yield
 * empty arrays - never zero-filled invented data.
 */
import { rollupTechnician, delayBreakdown } from './workshopLive'

const MIN = 60_000
const DAY_MS = 86_400_000

// ── small pure helpers ───────────────────────────────────────────────────────

const arr = (v) => (Array.isArray(v) ? v : [])
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
function round1(n) { return Math.round((Number(n) || 0) * 10) / 10 }

/** Epoch ms for a date-ish value, or NaN. */
function ts(v) {
  if (v == null) return NaN
  if (typeof v === 'number') return v
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? NaN : t
}

/** UTC calendar day key (YYYY-MM-DD) for a timestamp-ish value, or ''. */
function dayKey(v) {
  if (v == null || v === '') return ''
  const s = String(v)
  // ISO strings already start YYYY-MM-DD; otherwise round-trip through Date.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const t = ts(v)
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : ''
}

/** Normalise a status token: lowercase, spaces -> underscores. */
function normStatus(s) { return String(s || '').toLowerCase().replace(/\s+/g, '_') }

/** Force a clock string to HH:MM:SS. */
function hhmmss(t) {
  const s = String(t || '').trim()
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return null
  return s.length === 5 ? `${s}:00` : s
}

/** UTC epoch ms for a shift date + clock time (deterministic, timezone-free). */
function shiftTs(date, time) {
  const d = dayKey(date)
  const t = hhmmss(time)
  if (!d || !t) return NaN
  return ts(`${d}T${t}Z`)
}

/** Inclusive list of UTC day keys spanning [from,to]. Empty when bounds absent. */
export function daysInRange(from, to) {
  const lo = dayKey(from)
  const hi = dayKey(to)
  if (!lo || !hi) return []
  const a = ts(`${lo}T00:00:00Z`)
  const b = ts(`${hi}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return []
  const out = []
  for (let t = a; t <= b; t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

/** True when a day key falls inside [from,to] (bounds optional/inclusive). */
function inRange(key, from, to) {
  if (!key) return false
  const lo = dayKey(from)
  const hi = dayKey(to)
  if (lo && key < lo) return false
  if (hi && key > hi) return false
  return true
}

// ── shift index (technician-day -> on-duty window) ───────────────────────────

/**
 * Build a { `${userId}|${date}` -> { start, end } } index of on-duty windows by
 * matching roster `shifts` (person_name) to `technicians` (full_name). Windows
 * are UTC epoch ms. A user-day with no roster shift simply has no entry, and the
 * rollup then infers available duty from the tracked activity itself.
 */
export function buildShiftIndex(technicians, shifts) {
  const nameToId = new Map()
  for (const t of arr(technicians)) {
    const key = String(t?.full_name || t?.name || '').trim().toLowerCase()
    if (key && t?.id != null) nameToId.set(key, t.id)
  }
  const out = new Map()
  for (const s of arr(shifts)) {
    const name = String(s?.person_name || '').trim().toLowerCase()
    const uid = name ? nameToId.get(name) : null
    const date = dayKey(s?.shift_date)
    if (uid == null || !date) continue
    const start = shiftTs(date, s.start_time)
    const end = shiftTs(date, s.end_time)
    out.set(`${uid}|${date}`, {
      start: Number.isFinite(start) ? start : undefined,
      end: Number.isFinite(end) ? end : undefined,
    })
  }
  return out
}

// ── first-time-fix heuristic ─────────────────────────────────────────────────

/**
 * First-time-fix rate over a set of activity events.
 *
 * HEURISTIC (documented, honest approximation): a "job" is any job_id that has at
 * least one `complete_task` event. That job counts as a FIRST-TIME FIX when, after
 * its LAST `complete_task`, there is NO later `report_problem`, `resume_job` or
 * `start_job` on the SAME job_id (across any technician) - i.e. it was completed
 * and never reopened or reworked within the observed window. A later reopen/rework
 * signal marks it not-first-time.
 *
 * @returns {{ rate:(number|null), completed:number, firstTime:number, reworked:number }}
 *   rate is null when there are no completed jobs (nothing to measure).
 */
export function firstTimeFixRate(events) {
  const byJob = new Map()
  for (const e of arr(events)) {
    const jid = e?.job_id
    if (jid == null) continue
    const t = ts(e.at)
    if (!Number.isFinite(t)) continue
    ;(byJob.get(jid) || byJob.set(jid, []).get(jid)).push({ type: e.event_type, t })
  }
  const REOPEN = new Set(['report_problem', 'resume_job', 'start_job'])
  let completed = 0
  let firstTime = 0
  for (const evs of byJob.values()) {
    evs.sort((a, b) => a.t - b.t)
    const completes = evs.filter((e) => e.type === 'complete_task')
    if (!completes.length) continue
    completed += 1
    const lastComplete = completes[completes.length - 1].t
    const reopened = evs.some((e) => REOPEN.has(e.type) && e.t > lastComplete)
    if (!reopened) firstTime += 1
  }
  return {
    rate: completed > 0 ? Math.round((firstTime / completed) * 100) / 100 : null,
    completed,
    firstTime,
    reworked: completed - firstTime,
  }
}

// ── per-technician-per-day rollups ───────────────────────────────────────────

/**
 * Group events by user then by UTC day, and roll each technician-day up through
 * the live `rollupTechnician` engine using that day's shift window (when known).
 *
 * @returns {Array<{ userId, date, roll }>} one entry per technician-day with data
 */
function rollupByUserDay(events, shiftIndex, now, from, to) {
  // user_id -> date -> events[]
  const grouped = new Map()
  for (const e of arr(events)) {
    const uid = e?.user_id
    if (uid == null) continue
    const key = dayKey(e.at)
    if (!key || !inRange(key, from, to)) continue
    let byDay = grouped.get(uid)
    if (!byDay) { byDay = new Map(); grouped.set(uid, byDay) }
    ;(byDay.get(key) || byDay.set(key, []).get(key)).push(e)
  }

  const out = []
  for (const [uid, byDay] of grouped) {
    for (const [date, evs] of byDay) {
      const window = shiftIndex.get(`${uid}|${date}`) || {}
      // Close the day at its end (or the real now for an in-progress today), so a
      // dangling check-in on a past day is bounded to that day, never to "now".
      const dayEnd = ts(`${date}T23:59:59.999Z`)
      const effNow = Math.min(now, Number.isFinite(dayEnd) ? dayEnd : now)
      const roll = rollupTechnician(evs, {
        now: effNow,
        shiftStart: window.start,
        shiftEnd: window.end,
      })
      out.push({ userId: uid, date, roll })
    }
  }
  return out
}

// ── main ─────────────────────────────────────────────────────────────────────

/**
 * Compute the full workshop history analytics bundle.
 *
 * @param {{
 *   events?: object[], jobs?: object[], shifts?: object[], technicians?: object[],
 *   from?: string, to?: string, now?: number, labourRate?: number
 * }} args
 * @returns {{
 *   dailyTrend: object[], technicianLeaderboard: object[],
 *   delayByReason: object[], delayTrend: object[], delayCostTrend: object[],
 *   firstTimeFix: object, avgTaskDurationMin: (number|null),
 *   targetVsActual: (object|null), summary: object
 * }}
 */
export function computeWorkshopAnalytics({
  events, jobs, shifts, technicians, from, to, now = Date.now(), labourRate,
} = {}) {
  const techById = new Map()
  for (const t of arr(technicians)) if (t?.id != null) techById.set(t.id, t)
  const nameFor = (uid) => {
    const t = techById.get(uid)
    return (t && (t.full_name || t.name)) || 'Technician'
  }

  const shiftIndex = buildShiftIndex(technicians, shifts)
  const userDays = rollupByUserDay(events, shiftIndex, now, from, to)

  // ── jobs completed per day (work_orders, completed status) ──────────────────
  const jobsCompletedByDay = new Map()
  let totalJobsCompleted = 0
  for (const jb of arr(jobs)) {
    if (normStatus(jb?.status) !== 'completed') continue
    const key = dayKey(jb.completed_at)
    if (!key || !inRange(key, from, to)) continue
    jobsCompletedByDay.set(key, (jobsCompletedByDay.get(key) || 0) + 1)
    totalJobsCompleted += 1
  }

  // ── daily trend ─────────────────────────────────────────────────────────────
  const dayAgg = new Map() // date -> { productive, blocked, unassigned, break, utilVals[] }
  const allUtil = []
  for (const { date, roll } of userDays) {
    let d = dayAgg.get(date)
    if (!d) { d = { productive: 0, blocked: 0, unassigned: 0, break: 0, utilVals: [] }; dayAgg.set(date, d) }
    d.productive += roll.productiveMin
    d.blocked += roll.blockedMin
    d.unassigned += roll.unassignedMin
    d.break += roll.breakMin
    if (roll.utilization != null) { d.utilVals.push(roll.utilization); allUtil.push(roll.utilization) }
  }
  // Union of days that carry activity OR a completed job, sorted ascending.
  const dayKeys = new Set([...dayAgg.keys(), ...jobsCompletedByDay.keys()])
  const dailyTrend = [...dayKeys].sort().map((date) => {
    const d = dayAgg.get(date) || { productive: 0, blocked: 0, unassigned: 0, break: 0, utilVals: [] }
    const util = d.utilVals.length
      ? Math.round((d.utilVals.reduce((s, u) => s + u, 0) / d.utilVals.length) * 100)
      : null
    return {
      date,
      productiveHours: round1(d.productive / 60),
      blockedHours: round1(d.blocked / 60),
      unassignedHours: round1(d.unassigned / 60),
      breakHours: round1(d.break / 60),
      utilization: util,
      jobsCompleted: jobsCompletedByDay.get(date) || 0,
    }
  })

  // ── technician leaderboard ──────────────────────────────────────────────────
  const techAgg = new Map() // uid -> { productive, blocked, jobsCompleted, utilVals[] }
  for (const { userId, roll } of userDays) {
    let a = techAgg.get(userId)
    if (!a) { a = { productive: 0, blocked: 0, jobsCompleted: 0, utilVals: [] }; techAgg.set(userId, a) }
    a.productive += roll.productiveMin
    a.blocked += roll.blockedMin
    a.jobsCompleted += num(roll.jobsCompleted)
    if (roll.utilization != null) a.utilVals.push(roll.utilization)
  }
  const technicianLeaderboard = [...techAgg.entries()]
    .map(([userId, a]) => ({
      userId,
      name: nameFor(userId),
      productiveHours: round1(a.productive / 60),
      blockedHours: round1(a.blocked / 60),
      jobsCompleted: a.jobsCompleted,
      utilization: a.utilVals.length
        ? Math.round((a.utilVals.reduce((s, u) => s + u, 0) / a.utilVals.length) * 100)
        : null,
    }))
    .sort((x, y) =>
      y.productiveHours - x.productiveHours ||
      (y.utilization || 0) - (x.utilization || 0) ||
      y.jobsCompleted - x.jobsCompleted ||
      String(x.name).localeCompare(String(y.name)))
    .map((row, i) => ({ ...row, rank: i + 1 }))

  // ── delay analysis (reuse the live delayBreakdown engine) ───────────────────
  // Build a synthetic "board" of per-technician-day blocked-by-reason buckets so
  // delayBreakdown aggregates hours + cost by reason across the whole range.
  const delayBoard = userDays
    .filter(({ roll }) => roll.blockedByReason && Object.keys(roll.blockedByReason).length)
    .map(({ userId, roll }) => ({ blockedByReason: roll.blockedByReason, currentJobId: userId }))
  const delayByReason = delayBreakdown(delayBoard, { labourRate, jobs })
  const delayTrend = delayByReason.map((r) => ({
    reason: r.reason, hoursLost: r.hoursLost, affectedJobs: r.affectedJobs,
  }))
  const delayCostTrend = delayByReason.map((r) => ({
    reason: r.reason, costImpact: r.costImpact,
    responsibleDept: r.responsibleDept, suggestedAction: r.suggestedAction, priority: r.priority,
  }))

  // ── first-time-fix (over range-filtered events) ─────────────────────────────
  const rangeEvents = arr(events).filter((e) => inRange(dayKey(e?.at), from, to))
  const firstTimeFix = firstTimeFixRate(rangeEvents)

  // ── task duration + target vs actual (from timed work_orders) ───────────────
  const durations = []
  const tvaRows = []
  for (const jb of arr(jobs)) {
    if (normStatus(jb?.status) !== 'completed') continue
    const started = ts(jb.started_at)
    const done = ts(jb.completed_at)
    if (!Number.isFinite(started) || !Number.isFinite(done) || done <= started) continue
    const key = dayKey(jb.completed_at)
    if (!inRange(key, from, to)) continue
    const actualMin = (done - started) / MIN
    durations.push(actualMin)
    let targetMin = null
    if (num(jb.standard_hours) > 0) targetMin = num(jb.standard_hours) * 60
    else if (num(jb.est_minutes) > 0) targetMin = num(jb.est_minutes)
    tvaRows.push({
      jobNo: jb.work_order_no || jb.id || 'N/A',
      assetNo: jb.asset_no || null,
      targetMin: targetMin == null ? null : round1(targetMin),
      actualMin: round1(actualMin),
    })
  }
  const avgTaskDurationMin = durations.length
    ? round1(durations.reduce((s, d) => s + d, 0) / durations.length)
    : null

  const tvaWithTarget = tvaRows.filter((r) => r.targetMin != null)
  let targetVsActual = null
  if (tvaWithTarget.length) {
    const avgTarget = tvaWithTarget.reduce((s, r) => s + r.targetMin, 0) / tvaWithTarget.length
    const avgActual = tvaWithTarget.reduce((s, r) => s + r.actualMin, 0) / tvaWithTarget.length
    targetVsActual = {
      count: tvaWithTarget.length,
      avgTargetMin: round1(avgTarget),
      avgActualMin: round1(avgActual),
      variancePct: avgTarget > 0 ? Math.round(((avgActual - avgTarget) / avgTarget) * 100) : null,
      rows: tvaWithTarget
        .slice()
        .sort((a, b) => (b.actualMin - b.targetMin) - (a.actualMin - a.targetMin))
        .slice(0, 25),
    }
  }

  // ── summary KPIs ────────────────────────────────────────────────────────────
  const totalProductive = userDays.reduce((s, u) => s + u.roll.productiveMin, 0)
  const totalBlocked = userDays.reduce((s, u) => s + u.roll.blockedMin, 0)
  const totalUnassigned = userDays.reduce((s, u) => s + u.roll.unassignedMin, 0)
  const totalBreak = userDays.reduce((s, u) => s + u.roll.breakMin, 0)
  const summary = {
    avgUtilization: allUtil.length
      ? Math.round((allUtil.reduce((s, u) => s + u, 0) / allUtil.length) * 100)
      : null,
    totalProductiveHours: round1(totalProductive / 60),
    totalBlockedHours: round1(totalBlocked / 60),
    totalUnassignedHours: round1(totalUnassigned / 60),
    totalBreakHours: round1(totalBreak / 60),
    totalDelayCost: delayByReason.reduce((s, r) => s + num(r.costImpact), 0),
    jobsCompleted: totalJobsCompleted,
    firstTimeFixRate: firstTimeFix.rate,
    avgTaskDurationMin,
    activeTechnicians: techAgg.size,
    daysWithActivity: dayAgg.size,
  }

  return {
    dailyTrend,
    technicianLeaderboard,
    delayByReason,
    delayTrend,
    delayCostTrend,
    firstTimeFix,
    avgTaskDurationMin,
    targetVsActual,
    summary,
  }
}
