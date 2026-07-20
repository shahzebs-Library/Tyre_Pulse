/**
 * workshopLive.js - the pure engine for Workshop Live Control & Technician
 * Productivity. NO I/O: it turns the raw activity-event log + shift + assignment
 * data into technician status, time segments, productivity rollups, KPI numbers
 * and alerts. The web dashboard, the mobile technician app and any report reuse
 * THIS engine so the maths lives in one place.
 *
 * Core principle (fairness): non-working time is NEVER blanket "idle". Every
 * minute is classified by its real reason - productive, blocked (waiting for
 * parts / tools / approval / vehicle / vendor / support), break, training, or
 * genuinely unassigned. Only true leftover on-duty time counts as unassigned.
 *
 * All functions are deterministic and take an explicit `now` (epoch ms) so they
 * are unit-testable and never call Date.now() implicitly.
 */

// ── Vocabulary ────────────────────────────────────────────────────────────────

/** Event types a technician (or foreman) can record. Mirrors the DB CHECK. */
export const EVENT_TYPES = Object.freeze([
  'check_in', 'check_out', 'start_job', 'pause_job', 'resume_job', 'complete_task',
  'request_parts', 'request_assistance', 'waiting_approval', 'waiting_vehicle',
  'waiting_tools', 'start_break', 'end_break', 'training', 'report_problem',
])

/** Live technician status keys. */
export const STATUS = Object.freeze({
  WORKING: 'working',
  AVAILABLE: 'available',
  WAITING_PARTS: 'waiting_parts',
  WAITING_APPROVAL: 'waiting_approval',
  WAITING_TOOLS: 'waiting_tools',
  WAITING_VEHICLE: 'waiting_vehicle',
  ON_BREAK: 'on_break',
  TRAINING: 'training',
  AWAITING_INSPECTION: 'awaiting_inspection',
  OFF_DUTY: 'off_duty',
  ABSENT: 'absent',
  OVERTIME: 'overtime',
})

/** Human labels + a semantic colour band per status (consistent everywhere). */
export const STATUS_META = Object.freeze({
  working:             { label: 'Working',                      tone: 'green' },
  available:           { label: 'Available',                    tone: 'blue' },
  waiting_parts:       { label: 'Waiting for Parts',            tone: 'amber' },
  waiting_approval:    { label: 'Waiting for Approval',         tone: 'amber' },
  waiting_tools:       { label: 'Waiting for Tools',            tone: 'amber' },
  waiting_vehicle:     { label: 'Waiting for Vehicle',          tone: 'amber' },
  on_break:            { label: 'On Break',                     tone: 'purple' },
  training:            { label: 'Training',                     tone: 'purple' },
  awaiting_inspection: { label: 'Awaiting Inspection',          tone: 'blue' },
  off_duty:            { label: 'Off Duty',                     tone: 'grey' },
  absent:              { label: 'Absent',                       tone: 'red' },
  overtime:            { label: 'Overtime',                     tone: 'red' },
})

/** Tailwind-ish tone -> hex, used by both the app badges and ECharts. */
export const TONE_COLOR = Object.freeze({
  green: '#22c55e', blue: '#3b82f6', amber: '#f59e0b',
  purple: '#a855f7', red: '#ef4444', grey: '#6b7280',
})

export function statusColor(status) {
  return TONE_COLOR[STATUS_META[status]?.tone] || TONE_COLOR.grey
}

/** Blocked reasons - waiting time that is NOT the technician's fault. */
export const BLOCKED_REASONS = Object.freeze([
  'parts', 'tools', 'approval', 'vehicle', 'vendor', 'support',
])

/** Delay / root-cause categories for the analysis panel. */
export const DELAY_CATEGORIES = Object.freeze([
  'waiting_parts', 'approval_delay', 'technician_shortage', 'skill_shortage',
  'tool_shortage', 'vendor_delay', 'vehicle_unavailable', 'wrong_diagnosis',
  'rework', 'unplanned_breakdown', 'estimate_exceeded',
])

/**
 * Technician action buttons (large, mobile-first). `reason` marks the blocked
 * reason the action implies; `confirm` = needs foreman confirmation.
 */
export const TECH_ACTIONS = Object.freeze([
  { key: 'start_job',         label: 'Start Job',           event: 'start_job' },
  { key: 'pause_job',         label: 'Pause Job',           event: 'pause_job' },
  { key: 'resume_job',        label: 'Resume Job',          event: 'resume_job' },
  { key: 'complete_task',     label: 'Complete Task',       event: 'complete_task', confirm: true },
  { key: 'request_parts',     label: 'Request Parts',       event: 'request_parts',     reason: 'parts' },
  { key: 'request_assistance',label: 'Request Assistance',  event: 'request_assistance',reason: 'support' },
  { key: 'waiting_approval',  label: 'Waiting for Approval',event: 'waiting_approval',  reason: 'approval' },
  { key: 'waiting_vehicle',   label: 'Waiting for Vehicle', event: 'waiting_vehicle',   reason: 'vehicle' },
  { key: 'waiting_tools',     label: 'Waiting for Tools',   event: 'waiting_tools',     reason: 'tools' },
  { key: 'start_break',       label: 'Start Break',         event: 'start_break' },
  { key: 'end_break',         label: 'End Break',           event: 'end_break' },
  { key: 'report_problem',    label: 'Report Problem',      event: 'report_problem' },
])

// ── Internal helpers ──────────────────────────────────────────────────────────

const MIN = 60_000
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const ts = (v) => {
  if (v == null) return NaN
  if (typeof v === 'number') return v
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? NaN : t
}
const arr = (v) => (Array.isArray(v) ? v : [])

/** The on-duty "state" an event moves the technician into (segment classifier). */
const EVENT_STATE = {
  check_in: 'available',
  start_job: 'productive',
  resume_job: 'productive',
  complete_task: 'available', // awaiting next assignment / inspection
  request_parts: 'blocked:parts',
  waiting_tools: 'blocked:tools',
  waiting_approval: 'blocked:approval',
  waiting_vehicle: 'blocked:vehicle',
  start_break: 'break',
  end_break: 'available',
  training: 'training',
  check_out: 'off',
  // pause_job & report_problem handled specially (reason-dependent / inherit)
}

/** Map a raw state token to the classified segment kind + reason. */
function classify(state) {
  if (!state) return { kind: 'unassigned', reason: null }
  if (state === 'productive') return { kind: 'productive', reason: null }
  if (state === 'break') return { kind: 'break', reason: null }
  if (state === 'training') return { kind: 'training', reason: null }
  if (state === 'available') return { kind: 'unassigned', reason: null }
  if (state === 'off') return { kind: 'off', reason: null }
  if (state.startsWith('blocked:')) return { kind: 'blocked', reason: state.slice(8) }
  return { kind: 'unassigned', reason: null }
}

// ── Segment building ──────────────────────────────────────────────────────────

/**
 * Turn one technician's ordered events into contiguous time segments.
 * A `pause_job` uses its own reason_code: a blocked reason -> blocked, a break
 * -> break, otherwise unassigned. `report_problem` inherits the current state.
 *
 * @param {Array} events  raw event rows for ONE user (any order)
 * @param {{ now:number, shiftEnd?:number }} ctx
 * @returns {Array<{kind:string, reason:string|null, start:number, end:number, minutes:number, job_id:any}>}
 */
export function buildSegments(events, { now, shiftEnd } = {}) {
  const evs = arr(events)
    .map((e) => ({ ...e, _t: ts(e.at) }))
    .filter((e) => Number.isFinite(e._t))
    .sort((a, b) => a._t - b._t)
  if (!evs.length) return []

  const segs = []
  let state = null
  let reason = null
  let jobId = null
  let start = null

  const close = (end) => {
    if (state && start != null && end > start) {
      const c = classify(reason ? `blocked:${reason}` : state)
      const kind = state === 'productive' ? 'productive'
        : state === 'break' ? 'break'
          : state === 'training' ? 'training'
            : state === 'off' ? 'off'
              : reason ? 'blocked'
                : state === 'available' ? 'unassigned' : 'unassigned'
      if (kind !== 'off') {
        segs.push({ kind, reason: kind === 'blocked' ? reason : null, start, end, minutes: (end - start) / MIN, job_id: jobId })
      }
    }
  }

  for (const e of evs) {
    const et = e.event_type
    let nextState
    let nextReason = null
    if (et === 'pause_job') {
      const r = String(e.reason_code || '').toLowerCase()
      if (BLOCKED_REASONS.includes(r)) { nextState = 'blocked'; nextReason = r }
      else if (r === 'break') nextState = 'break'
      else nextState = 'available' // generic pause = unassigned
    } else if (et === 'report_problem') {
      // Annotation only - inherit the current state.
      continue
    } else {
      const mapped = EVENT_STATE[et]
      if (!mapped) continue
      if (mapped.startsWith('blocked:')) { nextState = 'blocked'; nextReason = mapped.slice(8) }
      else nextState = mapped
    }

    // Close the running segment at this event boundary.
    close(e._t)

    // Open the new one.
    state = nextState
    reason = nextReason
    if (['productive'].includes(nextState)) jobId = e.job_id ?? jobId
    if (nextState === 'off') { state = null; reason = null; jobId = null; start = null; continue }
    start = e._t
  }

  // Close the final open segment at `now` (bounded by shift end if provided).
  if (state && start != null) {
    const end = shiftEnd ? Math.min(now, Math.max(shiftEnd, start)) : now
    close(Math.max(end, start))
    // Overtime portion (on-duty productive/blocked past shift end) handled in rollup.
  }
  return segs
}

// ── Per-technician rollup ─────────────────────────────────────────────────────

/**
 * @typedef {Object} TechRollup
 * @property {string} status
 * @property {number} productiveMin
 * @property {number} blockedMin
 * @property {number} breakMin
 * @property {number} trainingMin
 * @property {number} unassignedMin
 * @property {number} overtimeMin
 * @property {number} availableDutyMin
 * @property {number|null} utilization  0..1 (null when no available duty)
 * @property {number|null} currentJobId
 * @property {number|null} lastActivityAt
 * @property {number} jobsCompleted
 * @property {Object} blockedByReason
 */

/**
 * Roll one technician's events (+ shift) into productivity numbers and a status.
 *
 * @param {Array} events
 * @param {{ now:number, shiftStart?:number, shiftEnd?:number, present?:boolean }} ctx
 * @returns {TechRollup}
 */
export function rollupTechnician(events, ctx = {}) {
  const { now, shiftStart, shiftEnd, present } = ctx
  const evs = arr(events).map((e) => ({ ...e, _t: ts(e.at) })).filter((e) => Number.isFinite(e._t)).sort((a, b) => a._t - b._t)
  const segs = buildSegments(evs, { now, shiftEnd })

  const bucket = { productive: 0, blocked: 0, break: 0, training: 0, unassigned: 0 }
  const blockedByReason = {}
  let overtimeMin = 0
  for (const s of segs) {
    bucket[s.kind] = (bucket[s.kind] || 0) + s.minutes
    if (s.kind === 'blocked' && s.reason) blockedByReason[s.reason] = (blockedByReason[s.reason] || 0) + s.minutes
    if (shiftEnd && (s.kind === 'productive' || s.kind === 'blocked') && s.end > shiftEnd) {
      overtimeMin += (s.end - Math.max(s.start, shiftEnd)) / MIN
    }
  }

  const last = evs[evs.length - 1]
  const status = statusFromEvents(evs, { now, present })
  const jobsCompleted = evs.filter((e) => e.event_type === 'complete_task').length

  // Available duty = shift length - break - training (approved, non-productive).
  let availableDutyMin = 0
  if (Number.isFinite(shiftStart) && Number.isFinite(shiftEnd) && shiftEnd > shiftStart) {
    availableDutyMin = (Math.min(now, shiftEnd) - shiftStart) / MIN
  } else {
    availableDutyMin = bucket.productive + bucket.blocked + bucket.unassigned + bucket.break + bucket.training
  }
  const dutyForUtil = Math.max(0, availableDutyMin - bucket.break - bucket.training)
  const utilization = dutyForUtil > 0 ? Math.min(1, bucket.productive / dutyForUtil) : null

  // Unassigned = leftover on-duty time not otherwise classified (never negative).
  const unassignedMin = Math.max(bucket.unassigned, Math.max(0, dutyForUtil - bucket.productive - bucket.blocked))

  const currentSeg = segs.length ? segs[segs.length - 1] : null

  return {
    status,
    productiveMin: round(bucket.productive),
    blockedMin: round(bucket.blocked),
    breakMin: round(bucket.break),
    trainingMin: round(bucket.training),
    unassignedMin: round(unassignedMin),
    overtimeMin: round(overtimeMin),
    availableDutyMin: round(availableDutyMin),
    utilization: utilization == null ? null : Math.round(utilization * 100) / 100,
    currentJobId: currentSeg && currentSeg.kind === 'productive' ? (currentSeg.job_id ?? null) : (last?.job_id ?? null),
    lastActivityAt: last ? last._t : null,
    jobsCompleted,
    blockedByReason,
  }
}

function round(n) { return Math.round((Number(n) || 0) * 10) / 10 }

/**
 * Current live status for ONE technician from their ordered events.
 * @param {Array} events
 * @param {{ now:number, present?:boolean, overtimeAfter?:number }} ctx
 * @returns {string} STATUS.*
 */
export function statusFromEvents(events, ctx = {}) {
  const { present } = ctx
  // request_assistance / report_problem are annotations: they do not change the
  // technician's live status (help is incoming; they may still be working).
  const ANNOTATION = new Set(['request_assistance', 'report_problem'])
  const evs = arr(events)
    .map((e) => ({ ...e, _t: ts(e.at) }))
    .filter((e) => Number.isFinite(e._t) && !ANNOTATION.has(e.event_type))
    .sort((a, b) => a._t - b._t)
  if (!evs.length) return present ? STATUS.AVAILABLE : STATUS.ABSENT

  const last = evs[evs.length - 1]
  switch (last.event_type) {
    case 'check_out': return STATUS.OFF_DUTY
    case 'start_job':
    case 'resume_job': return STATUS.WORKING
    case 'start_break': return STATUS.ON_BREAK
    case 'end_break': return STATUS.AVAILABLE
    case 'training': return STATUS.TRAINING
    case 'request_parts': return STATUS.WAITING_PARTS
    case 'waiting_tools': return STATUS.WAITING_TOOLS
    case 'waiting_approval': return STATUS.WAITING_APPROVAL
    case 'waiting_vehicle': return STATUS.WAITING_VEHICLE
    case 'complete_task': return STATUS.AWAITING_INSPECTION
    case 'check_in': return STATUS.AVAILABLE
    case 'pause_job': {
      const r = String(last.reason_code || '').toLowerCase()
      if (r === 'parts') return STATUS.WAITING_PARTS
      if (r === 'tools') return STATUS.WAITING_TOOLS
      if (r === 'approval') return STATUS.WAITING_APPROVAL
      if (r === 'vehicle') return STATUS.WAITING_VEHICLE
      if (r === 'break') return STATUS.ON_BREAK
      return STATUS.AVAILABLE
    }
    default: return STATUS.AVAILABLE
  }
}

// ── Board (per-technician cards) ──────────────────────────────────────────────

/**
 * Build the live technician board.
 * @param {Array} technicians  [{ id, name, employee_id, trade, avatar_url, site }]
 * @param {Object} eventsByUser  { [userId]: Array<event> }
 * @param {{ now:number, shiftByUser?:Object, presentByUser?:Object, jobsById?:Object }} ctx
 * @returns {Array} board cards
 */
export function buildBoard(technicians, eventsByUser, ctx = {}) {
  const { now, shiftByUser = {}, presentByUser = {}, jobsById = {} } = ctx
  return arr(technicians).map((t) => {
    const evs = arr(eventsByUser[t.id])
    const shift = shiftByUser[t.id] || {}
    const roll = rollupTechnician(evs, {
      now,
      shiftStart: ts(shift.start),
      shiftEnd: ts(shift.end),
      present: presentByUser[t.id] === true,
    })
    const job = roll.currentJobId ? jobsById[roll.currentJobId] : null
    return {
      userId: t.id,
      name: t.name || t.full_name || 'Technician',
      employeeId: t.employee_id || null,
      trade: t.trade || null,
      avatar: t.avatar_url || null,
      site: t.site || null,
      shift: shift.label || null,
      ...roll,
      job: job ? { id: job.id, no: job.work_order_no, asset_no: job.asset_no, plate: job.plate_number, target: ts(job.target_completion) } : null,
    }
  })
}

// ── KPI strip ─────────────────────────────────────────────────────────────────

/**
 * Compute the top KPI numbers from the board + job cards.
 * @param {Array} board  buildBoard() output
 * @param {Array} jobs   work_orders rows (with status, vor, target_completion, completed_at)
 * @param {{ now:number, todayStart?:number, overtimeMin?:number }} ctx
 */
export function computeKpis(board, jobs, ctx = {}) {
  const { now, todayStart } = ctx
  const b = arr(board)
  const j = arr(jobs)
  const isToday = (v) => todayStart != null && ts(v) >= todayStart
  const openStatuses = new Set(['new', 'awaiting_assignment', 'assigned', 'in_progress', 'waiting_parts', 'waiting_approval', 'quality_inspection', 'open'])
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '_')

  const countStatus = (st) => b.filter((x) => x.status === st).length
  const openJobs = j.filter((x) => openStatuses.has(norm(x.status)))
  const overdue = j.filter((x) => {
    const tgt = ts(x.target_completion)
    return Number.isFinite(tgt) && tgt < now && !openStatuses.has('completed') && norm(x.status) !== 'completed'
  })

  const sum = (f) => b.reduce((s, x) => s + num(f(x)), 0)

  return {
    onDuty: b.filter((x) => x.status !== STATUS.OFF_DUTY && x.status !== STATUS.ABSENT).length,
    working: countStatus(STATUS.WORKING),
    available: countStatus(STATUS.AVAILABLE),
    unassigned: b.filter((x) => x.status === STATUS.AVAILABLE && !x.currentJobId).length,
    waitingParts: countStatus(STATUS.WAITING_PARTS),
    waitingApproval: countStatus(STATUS.WAITING_APPROVAL),
    onBreak: countStatus(STATUS.ON_BREAK),
    absent: countStatus(STATUS.ABSENT),
    openJobs: openJobs.length,
    overdueJobs: overdue.length,
    vehiclesOffRoad: j.filter((x) => x.vor === true).length,
    jobsCompletedToday: j.filter((x) => norm(x.status) === 'completed' && isToday(x.completed_at)).length,
    productiveHours: round(sum((x) => x.productiveMin) / 60),
    lostHours: round(sum((x) => x.blockedMin + x.unassignedMin) / 60),
    overtimeHours: round(sum((x) => x.overtimeMin) / 60),
    utilization: (() => {
      const withUtil = b.filter((x) => x.utilization != null)
      if (!withUtil.length) return null
      return Math.round((withUtil.reduce((s, x) => s + x.utilization, 0) / withUtil.length) * 100)
    })(),
  }
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export const DEFAULT_THRESHOLDS = Object.freeze({
  unassignedMin: 30,        // unassigned beyond this -> alert
  noActivityMin: 45,        // job started but no activity recorded
  overSafeOvertimeMin: 120, // working beyond safe overtime
  vorSlaHours: 48,          // vehicle off road beyond SLA
})

/**
 * Derive live alerts from the board + jobs. Returns [{ level, type, message, ref }].
 */
export function deriveAlerts(board, jobs, ctx = {}) {
  const { now, thresholds = DEFAULT_THRESHOLDS } = ctx
  const out = []
  const b = arr(board)
  const j = arr(jobs)

  for (const x of b) {
    if (x.status === STATUS.AVAILABLE && !x.currentJobId && x.unassignedMin >= thresholds.unassignedMin) {
      out.push({ level: 'warning', type: 'unassigned', message: `${x.name} unassigned for ${Math.round(x.unassignedMin)} min`, ref: x.userId })
    }
    if (x.status === STATUS.WORKING && x.lastActivityAt && (now - x.lastActivityAt) / MIN >= thresholds.noActivityMin) {
      out.push({ level: 'warning', type: 'no_activity', message: `${x.name} on a job with no update for ${Math.round((now - x.lastActivityAt) / MIN)} min`, ref: x.userId })
    }
    if (x.overtimeMin >= thresholds.overSafeOvertimeMin) {
      out.push({ level: 'critical', type: 'overtime', message: `${x.name} working beyond safe overtime (${Math.round(x.overtimeMin)} min)`, ref: x.userId })
    }
  }
  for (const job of j) {
    const tgt = ts(job.target_completion)
    if (Number.isFinite(tgt) && tgt < now && String(job.status || '').toLowerCase() !== 'completed') {
      out.push({ level: 'warning', type: 'overdue', message: `Job ${job.work_order_no || ''} exceeded target time`, ref: job.id })
    }
    if (job.vor === true && Number.isFinite(ts(job.vor_since)) && (now - ts(job.vor_since)) / 3_600_000 >= thresholds.vorSlaHours) {
      out.push({ level: 'critical', type: 'vor_sla', message: `Vehicle ${job.asset_no || ''} off road beyond SLA`, ref: job.id })
    }
    if (String(job.status || '').toLowerCase().replace(/\s+/g, '_') === 'quality_inspection') {
      out.push({ level: 'info', type: 'qc_pending', message: `Job ${job.work_order_no || ''} completed, awaiting inspection`, ref: job.id })
    }
  }
  return out
}

// ── Delay / root-cause rollup ─────────────────────────────────────────────────

/**
 * Aggregate blocked time across the board into delay categories with hours lost
 * and affected job count. Honest: only reasons that actually occurred appear.
 */
export function delayBreakdown(board, ctx = {}) {
  const b = arr(board)
  const byReason = {}
  const jobsByReason = {}
  for (const x of b) {
    for (const [reason, min] of Object.entries(x.blockedByReason || {})) {
      byReason[reason] = (byReason[reason] || 0) + num(min)
      jobsByReason[reason] = (jobsByReason[reason] || new Set())
      if (x.currentJobId) jobsByReason[reason].add(x.currentJobId)
    }
  }
  return Object.entries(byReason)
    .map(([reason, min]) => ({ reason, hoursLost: round(min / 60), affectedJobs: (jobsByReason[reason]?.size) || 0 }))
    .sort((a, z) => z.hoursLost - a.hoursLost)
}
