/**
 * workshopLive.ts - mobile mirror of the web pure engine (src/lib/workshopLive.js).
 *
 * The mobile app cannot import web `src/lib`, so this is a SMALL, dependency-free
 * port of just the pieces the technician screen needs:
 *   - the vocabulary (event types + blocked reasons),
 *   - the large technician action buttons (TECH_ACTIONS),
 *   - the status labels + a theme-neutral tone / StatusKind per status,
 *   - `statusFromEvents(events, { now, present })` -> the current live status.
 *
 * KEEP IN SYNC with the web engine: the DB CHECK vocabulary, the action set and
 * the status switch are the shared contract between the technician app and the
 * foreman dashboard. Deterministic + pure (no Date.now, no I/O).
 */

// ── Vocabulary (mirrors the tech_activity_events CHECK) ──────────────────────

export type WorkshopEventType =
  | 'check_in' | 'check_out' | 'start_job' | 'pause_job' | 'resume_job'
  | 'complete_task' | 'request_parts' | 'request_assistance' | 'waiting_approval'
  | 'waiting_vehicle' | 'waiting_tools' | 'start_break' | 'end_break'
  | 'training' | 'report_problem'

export const EVENT_TYPES: readonly WorkshopEventType[] = Object.freeze([
  'check_in', 'check_out', 'start_job', 'pause_job', 'resume_job', 'complete_task',
  'request_parts', 'request_assistance', 'waiting_approval', 'waiting_vehicle',
  'waiting_tools', 'start_break', 'end_break', 'training', 'report_problem',
])

/** Blocked reasons - waiting time that is NOT the technician's fault. */
export type WorkshopReason =
  'parts' | 'tools' | 'approval' | 'vehicle' | 'vendor' | 'support' | 'break'

export const BLOCKED_REASONS: readonly WorkshopReason[] = Object.freeze([
  'parts', 'tools', 'approval', 'vehicle', 'vendor', 'support',
])

// ── Live status ──────────────────────────────────────────────────────────────

export type WorkshopStatus =
  | 'working' | 'available' | 'waiting_parts' | 'waiting_approval' | 'waiting_tools'
  | 'waiting_vehicle' | 'on_break' | 'training' | 'awaiting_inspection'
  | 'off_duty' | 'absent'

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
} as const)

/** Semantic tone (matches the web engine) + human label per status. */
export type WorkshopTone = 'green' | 'blue' | 'amber' | 'purple' | 'red' | 'grey'

export const STATUS_META: Record<WorkshopStatus, { label: string; tone: WorkshopTone }> = Object.freeze({
  working:             { label: 'Working',             tone: 'green' },
  available:           { label: 'Available',           tone: 'blue' },
  waiting_parts:       { label: 'Waiting for Parts',   tone: 'amber' },
  waiting_approval:    { label: 'Waiting for Approval',tone: 'amber' },
  waiting_tools:       { label: 'Waiting for Tools',   tone: 'amber' },
  waiting_vehicle:     { label: 'Waiting for Vehicle', tone: 'amber' },
  on_break:            { label: 'On Break',            tone: 'purple' },
  training:            { label: 'Training',            tone: 'purple' },
  awaiting_inspection: { label: 'Awaiting Inspection', tone: 'blue' },
  off_duty:            { label: 'Off Duty',            tone: 'grey' },
  absent:              { label: 'Absent',              tone: 'red' },
})

/**
 * Map a live status to a theme StatusKind (contexts/theme.ts) so badges follow
 * the Daylight palette in both light + dark. The theme has no dedicated purple
 * status band, so break/training fall back to `neutral` (they are non-blocking,
 * approved time, never an alert).
 */
export type StatusKind = 'success' | 'warning' | 'danger' | 'info' | 'critical' | 'neutral'

export function statusKind(status: WorkshopStatus): StatusKind {
  switch (status) {
    case 'working': return 'success'
    case 'available':
    case 'awaiting_inspection':
    case 'training': return 'info'
    case 'waiting_parts':
    case 'waiting_approval':
    case 'waiting_tools':
    case 'waiting_vehicle': return 'warning'
    case 'absent': return 'danger'
    case 'on_break':
    case 'off_duty':
    default: return 'neutral'
  }
}

export function statusLabel(status: WorkshopStatus): string {
  return STATUS_META[status]?.label ?? 'Available'
}

// ── Technician action buttons (large, thumb-first) ───────────────────────────

/**
 * `reason` marks the blocked reason the action implies (stored in reason_code);
 * `confirm` = the action asks the technician to confirm before recording (a
 * completion is significant); `icon` is an Ionicons glyph for the button.
 * Mirrors the web TECH_ACTIONS set (check in/out live in the header banner).
 */
export interface TechAction {
  key: string
  label: string
  event: WorkshopEventType
  reason?: WorkshopReason
  confirm?: boolean
  icon: string
}

export const TECH_ACTIONS: readonly TechAction[] = Object.freeze([
  { key: 'start_job',          label: 'Start Job',           event: 'start_job',          icon: 'play-circle-outline' },
  { key: 'pause_job',          label: 'Pause Job',           event: 'pause_job',          icon: 'pause-circle-outline' },
  { key: 'resume_job',         label: 'Resume Job',          event: 'resume_job',         icon: 'play-forward-circle-outline' },
  { key: 'complete_task',      label: 'Complete Task',       event: 'complete_task',      confirm: true, icon: 'checkmark-done-circle-outline' },
  { key: 'request_parts',      label: 'Request Parts',       event: 'request_parts',      reason: 'parts',    icon: 'cube-outline' },
  { key: 'request_assistance', label: 'Request Assistance',  event: 'request_assistance', reason: 'support',  icon: 'people-outline' },
  { key: 'waiting_approval',   label: 'Waiting for Approval',event: 'waiting_approval',   reason: 'approval', icon: 'shield-checkmark-outline' },
  { key: 'waiting_vehicle',    label: 'Waiting for Vehicle', event: 'waiting_vehicle',    reason: 'vehicle',  icon: 'car-outline' },
  { key: 'waiting_tools',      label: 'Waiting for Tools',   event: 'waiting_tools',      reason: 'tools',    icon: 'construct-outline' },
  { key: 'start_break',        label: 'Start Break',         event: 'start_break',        reason: 'break',    icon: 'cafe-outline' },
  { key: 'end_break',          label: 'End Break',           event: 'end_break',          icon: 'walk-outline' },
  { key: 'report_problem',     label: 'Report Problem',      event: 'report_problem',     icon: 'alert-circle-outline' },
])

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Minimal event shape the status engine reads. */
export interface WorkshopEventLike {
  event_type: string
  reason_code?: string | null
  at?: string | number | null
}

function ts(v: string | number | null | undefined): number {
  if (v == null) return NaN
  if (typeof v === 'number') return v
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? NaN : t
}

/**
 * Current live status for ONE technician (or one job stream) from their events.
 * `request_assistance` / `report_problem` are ANNOTATIONS: help is incoming or a
 * problem is flagged, but the technician may still be working, so they do NOT
 * change the live status. A `pause_job` resolves to its reason_code's waiting
 * status. With no events -> available when present (checked in) else absent.
 *
 * Faithful port of the web engine's statusFromEvents switch.
 */
export function statusFromEvents(
  events: WorkshopEventLike[] | null | undefined,
  ctx: { now?: number; present?: boolean } = {},
): WorkshopStatus {
  const { present } = ctx
  const ANNOTATION = new Set(['request_assistance', 'report_problem'])
  const evs = (Array.isArray(events) ? events : [])
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

/**
 * Whether the technician is currently ON DUTY (checked in and not checked out).
 * Reads only check_in / check_out events (job events do not toggle duty).
 */
export function isCheckedIn(events: WorkshopEventLike[] | null | undefined): boolean {
  const duty = (Array.isArray(events) ? events : [])
    .filter((e) => e.event_type === 'check_in' || e.event_type === 'check_out')
    .map((e) => ({ e, _t: ts(e.at) }))
    .filter((x) => Number.isFinite(x._t))
    .sort((a, b) => a._t - b._t)
  if (!duty.length) return false
  return duty[duty.length - 1].e.event_type === 'check_in'
}

// ── My productivity today (compact self-rollup) ──────────────────────────────
//
// A minimal, dependency-free port of the web engine's buildSegments +
// rollupTechnician (src/lib/workshopLive.js) reduced to just the numbers the
// technician's own summary card needs. Deterministic: `now` is passed in, never
// read from Date.now() here.

const MIN = 60_000

/** The on-duty "state" an event moves the technician into (segment classifier). */
const EVENT_STATE: Record<string, string> = {
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

type SegKind = 'productive' | 'blocked' | 'break' | 'training' | 'unassigned' | 'off'

interface Segment { kind: SegKind; reason: string | null; start: number; end: number; minutes: number }

/**
 * Turn one technician's ordered events into contiguous, classified time segments.
 * A `pause_job` uses its own reason_code (blocked reason -> blocked, break ->
 * break, otherwise unassigned); `report_problem` is an annotation and inherits
 * the current state. Faithful (reduced) port of the web engine.
 */
export function buildSegments(
  events: WorkshopEventLike[] | null | undefined,
  ctx: { now: number; shiftEnd?: number },
): Segment[] {
  const { now, shiftEnd } = ctx
  const evs = (Array.isArray(events) ? events : [])
    .map((e) => ({ ...e, _t: ts(e.at) }))
    .filter((e) => Number.isFinite(e._t))
    .sort((a, b) => a._t - b._t)
  if (!evs.length) return []

  const segs: Segment[] = []
  let state: string | null = null
  let reason: string | null = null
  let start: number | null = null

  const close = (end: number) => {
    if (state && start != null && end > start) {
      const kind: SegKind = state === 'productive' ? 'productive'
        : state === 'break' ? 'break'
          : state === 'training' ? 'training'
            : state === 'off' ? 'off'
              : reason ? 'blocked'
                : 'unassigned'
      if (kind !== 'off') {
        segs.push({ kind, reason: kind === 'blocked' ? reason : null, start, end, minutes: (end - start) / MIN })
      }
    }
  }

  for (const e of evs) {
    const et = e.event_type
    let nextState: string
    let nextReason: string | null = null
    if (et === 'pause_job') {
      const r = String(e.reason_code || '').toLowerCase()
      if ((BLOCKED_REASONS as readonly string[]).includes(r)) { nextState = 'blocked'; nextReason = r }
      else if (r === 'break') nextState = 'break'
      else nextState = 'available'
    } else if (et === 'report_problem') {
      continue // annotation only - inherit the current state
    } else {
      const mapped = EVENT_STATE[et]
      if (!mapped) continue
      if (mapped.startsWith('blocked:')) { nextState = 'blocked'; nextReason = mapped.slice(8) }
      else nextState = mapped
    }

    close((e as any)._t)

    state = nextState
    reason = nextReason
    if (nextState === 'off') { state = null; reason = null; start = null; continue }
    start = (e as any)._t
  }

  if (state && start != null) {
    const end = shiftEnd ? Math.min(now, Math.max(shiftEnd, start)) : now
    close(Math.max(end, start))
  }
  return segs
}

export interface MyProductivity {
  productiveMin: number
  blockedMin: number
  unassignedMin: number
  breakMin: number
  jobsCompleted: number
}

function round1(n: number): number { return Math.round((Number(n) || 0) * 10) / 10 }

/**
 * Compact self-rollup for the technician's OWN summary card: how many minutes of
 * their duty so far were productive vs blocked (waiting parts/tools/approval/
 * vehicle) vs unassigned (leftover on-duty) vs break, and how many tasks they
 * completed. Reduced port of rollupTechnician - deterministic (`now` passed in).
 */
export function myProductivityToday(
  events: WorkshopEventLike[] | null | undefined,
  ctx: { now: number; shiftStart?: number; shiftEnd?: number },
): MyProductivity {
  const { now, shiftStart, shiftEnd } = ctx
  const evs = (Array.isArray(events) ? events : [])
    .map((e) => ({ ...e, _t: ts(e.at) }))
    .filter((e) => Number.isFinite((e as any)._t))
  const segs = buildSegments(evs, { now, shiftEnd })

  const bucket: Record<string, number> = { productive: 0, blocked: 0, break: 0, training: 0, unassigned: 0 }
  for (const s of segs) bucket[s.kind] = (bucket[s.kind] || 0) + s.minutes

  // Available duty = shift length when known, else the sum of classified time.
  let availableDutyMin: number
  if (Number.isFinite(shiftStart) && Number.isFinite(shiftEnd) && (shiftEnd as number) > (shiftStart as number)) {
    availableDutyMin = (Math.min(now, shiftEnd as number) - (shiftStart as number)) / MIN
  } else {
    availableDutyMin = bucket.productive + bucket.blocked + bucket.unassigned + bucket.break + bucket.training
  }
  const dutyForUtil = Math.max(0, availableDutyMin - bucket.break - bucket.training)
  const unassignedMin = Math.max(bucket.unassigned, Math.max(0, dutyForUtil - bucket.productive - bucket.blocked))

  const jobsCompleted = evs.filter((e) => e.event_type === 'complete_task').length

  return {
    productiveMin: round1(bucket.productive),
    blockedMin: round1(bucket.blocked),
    unassignedMin: round1(unassignedMin),
    breakMin: round1(bucket.break),
    jobsCompleted,
  }
}
