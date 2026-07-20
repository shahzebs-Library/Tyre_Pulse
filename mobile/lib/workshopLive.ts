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
