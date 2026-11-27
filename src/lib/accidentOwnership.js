/**
 * Accident ownership + notification settings and "my accident tasks".
 *
 * Pure helpers shared by the settings tabs (AccidentWorkflowSettings), the task
 * inbox (CaseTeamInbox), the who-holds-what board and the Command Center card.
 * The data comes from the SQL in supabase/migrations/20261127190100..190400:
 *   accident_team_roles      who owns each step + SLA target per severity
 *   accident_notify_rules    who is told about each event
 *   accident_my_tasks()      open steps owned by me or my role
 *   accident_task_holdings() open steps grouped by holder
 *
 * SLA targets are never invented: a null target reads "Not set" and no timer runs.
 */
import { WORKSTREAMS } from './accidentCase'

export const OWNER_WORKSTREAMS = WORKSTREAMS.map((w) => ({ key: w.key, name: w.name }))
const WS_NAME = Object.fromEntries(WORKSTREAMS.map((w) => [w.key, w.name]))
export function workstreamName(key) {
  return WS_NAME[key] || String(key || 'Step').replace(/[_-]+/g, ' ')
}

/** Roles an owner can pick for a step (the real app roles first). */
export const OWNER_ROLE_CHOICES = [
  'Fleet Supervisor', 'Workshop Area Manager', 'Workshop Maintenance Area Manager',
  'PMV Manager', 'Admin', 'Manager', 'Director', 'Maintenance Supervisor', 'Inspector',
]

/** Events the owner can route, in the order a case meets them. */
export const NOTIFY_EVENTS = [
  { key: 'accident.reported', label: 'Accident reported' },
  { key: 'accident.workstream_assigned', label: 'Step assigned' },
  { key: 'accident.stage_changed', label: 'Stage changed' },
  { key: 'accident.claim_changed', label: 'Claim changed' },
  { key: 'accident.sla_warning', label: 'Step due soon (SLA warning)' },
  { key: 'accident.sla_breach', label: 'Step overdue (SLA breach)' },
  { key: 'accident.stalled', label: 'Case stalled' },
  { key: 'accident.closure_requested', label: 'Closure requested' },
  { key: 'accident.closure_decided', label: 'Closure decided' },
  { key: 'accident.driver_status', label: "Driver's own case status changed" },
  { key: 'accident.task_digest', label: 'Daily digest of open tasks' },
]
const EVENT_LABEL = Object.fromEntries(NOTIFY_EVENTS.map((e) => [e.key, e.label]))
export function eventLabel(key) { return EVENT_LABEL[key] || key }

export const SEVERITY_SLA_FIELDS = [
  { field: 'sla_minutes_minor', label: 'Minor' },
  { field: 'sla_minutes_moderate', label: 'Moderate' },
  { field: 'sla_minutes_major', label: 'Major' },
]

/** "Not set" for an empty target, otherwise hours/days in plain words. */
export function formatSlaMinutes(min) {
  const n = Number(min)
  if (min === null || min === undefined || min === '' || !Number.isFinite(n) || n <= 0) return 'Not set'
  if (n % 1440 === 0) return `${n / 1440} day${n === 1440 ? '' : 's'}`
  if (n % 60 === 0) return `${n / 60} h`
  return `${n} min`
}

/** Hours typed in the form -> minutes stored; blank -> null (not set). */
export function hoursToMinutes(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return NaN
  return Math.round(n * 60)
}
export function minutesToHours(min) {
  const n = Number(min)
  if (min === null || min === undefined || !Number.isFinite(n) || n <= 0) return ''
  return String(Math.round((n / 60) * 100) / 100)
}

/** Steps with no SLA target for any severity: the owner still has to decide. */
export function stepsMissingSla(rules) {
  const list = Array.isArray(rules) ? rules : []
  return OWNER_WORKSTREAMS.filter((ws) => {
    const r = list.find((x) => x.workstream_key === ws.key && !x.country && !x.site && x.active !== false)
    return !r || SEVERITY_SLA_FIELDS.every((f) => r[f.field] == null)
  }).map((ws) => ws.key)
}

/** Steps that nobody owns (no org-wide rule with a role or a named person). */
export function stepsWithoutOwner(rules) {
  const list = Array.isArray(rules) ? rules : []
  return OWNER_WORKSTREAMS.filter((ws) => !list.some((x) =>
    x.workstream_key === ws.key && x.active !== false
    && (x.owner_role || (Array.isArray(x.owner_user_ids) && x.owner_user_ids.length > 0)))).map((ws) => ws.key)
}

/** Plain words for who a notify rule tells. */
export function notifyRuleSummary(rule, nameById = {}) {
  if (!rule) return 'Nobody'
  const parts = []
  if (rule.notify_owner) parts.push('Step owner')
  for (const r of rule.roles || []) parts.push(r)
  for (const id of rule.user_ids || []) parts.push(nameById[id] || 'Named person')
  if (rule.notify_driver) parts.push('The driver who reported')
  let s = parts.length ? parts.join(', ') : 'Nobody'
  if (rule.only_when_serious) s += ` (only severe, injury or cost from ${Number(rule.serious_cost || 20000).toLocaleString()})`
  if (rule.event_key === 'accident.stalled') {
    s += rule.stalled_days ? ` after ${rule.stalled_days} days on one stage` : ' (days not set: no stalled alerts)'
  }
  return s
}

// ── tasks ────────────────────────────────────────────────────────────────────

const SLA_RANK = { breached: 0, warning: 1, running: 2, paused: 3, none: 4, met: 5, cancelled: 6 }

/** Overdue first, then due soonest, then longest in step. */
export function sortTasks(tasks) {
  return [...(Array.isArray(tasks) ? tasks : [])].sort((a, b) => {
    if (Boolean(b.overdue) !== Boolean(a.overdue)) return b.overdue ? 1 : -1
    const ra = SLA_RANK[a.sla_state] ?? 4
    const rb = SLA_RANK[b.sla_state] ?? 4
    if (ra !== rb) return ra - rb
    const da = a.due_at ? Date.parse(a.due_at) : Infinity
    const db = b.due_at ? Date.parse(b.due_at) : Infinity
    if (da !== db) return da - db
    return (Number(b.days_in_step) || 0) - (Number(a.days_in_step) || 0)
  })
}

/** Split into "assigned to me" and "for my role" so a person sees both. */
export function splitTasks(tasks) {
  const sorted = sortTasks(tasks)
  return {
    mine: sorted.filter((t) => t.assigned_to_me === true),
    team: sorted.filter((t) => t.assigned_to_me !== true),
  }
}

export function taskCounts(tasks) {
  const list = Array.isArray(tasks) ? tasks : []
  return {
    total: list.length,
    overdue: list.filter((t) => t.overdue).length,
    dueSoon: list.filter((t) => !t.overdue && t.sla_state === 'warning').length,
    mine: list.filter((t) => t.assigned_to_me === true).length,
  }
}

/** "3.5 days" / "today" for the days-in-step column. */
export function daysLabel(days) {
  if (days === null || days === undefined || days === '') return 'N/A'
  const n = Number(days)
  if (!Number.isFinite(n) || n < 0) return 'N/A'
  if (n < 1) return 'today'
  const r = Math.round(n * 10) / 10
  return `${r} day${r === 1 ? '' : 's'}`
}

export const SLA_STATE_LABEL = {
  breached: 'Overdue', warning: 'Due soon', running: 'On time', paused: 'Paused',
  none: 'No target', met: 'Met', cancelled: 'Cancelled',
}
export function slaStateLabel(task) {
  if (task?.overdue) return 'Overdue'
  return SLA_STATE_LABEL[task?.sla_state] || 'No target'
}

/** Holder rows for the board: people first by overdue, then role queues. */
export function holderLabel(row) {
  if (!row) return 'Nobody'
  if (row.holder_name) return row.holder_name
  if (row.holder_role) return `${row.holder_role} (any)`
  return 'No owner'
}

/**
 * Missing-data warnings for one case (B5). Only checks fields the case already
 * carries; an unknown value is not reported as missing.
 */
export function caseGaps(accident, workstreams = []) {
  if (!accident) return []
  const gaps = []
  const openSteps = (workstreams || []).filter((w) => !['completed', 'not_required', 'cancelled'].includes(w.status))
  if (!accident.responsible_owner_id) gaps.push({ key: 'owner', label: 'No responsible owner' })
  if (openSteps.some((w) => !w.owner_id && !w.owner_role)) gaps.push({ key: 'step_owner', label: 'A step has no owner' })
  if (!String(accident.root_cause || '').trim()) gaps.push({ key: 'root_cause', label: 'Root cause not recorded' })
  if (!String(accident.police_report_no || '').trim()) gaps.push({ key: 'police', label: 'Police report number missing' })
  const photos = accident.photos
  const photoCount = Array.isArray(photos) ? photos.length
    : (photos && typeof photos === 'object' ? Object.values(photos).flat().length : 0)
  if (photoCount === 0) gaps.push({ key: 'photos', label: 'No photos' })
  return gaps
}

/** The step a case is on now: the first open step in the case flow. */
export function currentStep(workstreams = []) {
  const order = WORKSTREAMS.map((w) => w.key)
  const open = (workstreams || [])
    .filter((w) => !['completed', 'not_required', 'cancelled'].includes(w.status))
    .sort((a, b) => order.indexOf(a.workstream_key) - order.indexOf(b.workstream_key))
  return open[0] || null
}
