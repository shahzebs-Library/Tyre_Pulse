/**
 * workshopLiveView - pure presentation shaping for the Workshop Live Control
 * page (route /workshop-live), rebuilt to the owner's mockup.
 *
 * The productivity maths stay in `workshopLive.js` (buildBoard / computeKpis /
 * deriveAlerts / delayBreakdown). This module only groups and labels what those
 * engines (and the loaded job cards) already produced:
 *   - jobFlowCounts: open job cards by workflow stage (the "Job Flow" strip)
 *   - alertRows:     engine alerts as sorted rows with a severity pill
 *   - techJobLine / initials / boardChips: technician board helpers
 * No I/O and no clock: time always comes in as an argument.
 */
import { normalizeWoStatus } from './workOrderStatus'
import { STATUS } from './workshopLive'

/**
 * Job Flow stages, in workflow order. Every stage is read from a real column:
 * the canonical work_orders.status, the assigned owner, and work_orders.qc_status
 * (a QC pass that has not yet been closed out is "Ready to close").
 */
export const JOB_FLOW_STAGES = Object.freeze([
  { key: 'unassigned', label: 'Unassigned', tone: 'blue', hint: 'New or awaiting assignment, no owner yet' },
  { key: 'assigned', label: 'Assigned', tone: 'purple', hint: 'Owner set, work not started' },
  { key: 'in_progress', label: 'In progress', tone: 'green', hint: 'Status In Progress' },
  { key: 'blocked', label: 'Blocked', tone: 'amber', hint: 'Waiting for parts, waiting for approval or on hold' },
  { key: 'qa', label: 'QA', tone: 'purple', hint: 'Quality inspection pending' },
  { key: 'ready', label: 'Ready to close', tone: 'green', hint: 'QC passed but the job card is not completed yet' },
])

const CLOSED = new Set(['Completed', 'Cancelled'])

/** Which Job Flow stage an open job card sits in; null when closed or unknown. */
export function jobFlowStage(job) {
  if (!job) return null
  const s = normalizeWoStatus(job.status)
  if (CLOSED.has(s)) return null
  if (String(job.qc_status || '').toLowerCase() === 'passed') return 'ready'
  switch (s) {
    case 'New':
    case 'Awaiting Assignment':
    case 'Overdue':
      return job.assigned_owner_id ? 'assigned' : 'unassigned'
    case 'Assigned': return 'assigned'
    case 'In Progress': return 'in_progress'
    case 'Waiting for Parts':
    case 'Waiting for Approval':
    case 'On Hold':
      return 'blocked'
    case 'Quality Inspection': return 'qa'
    default: return null
  }
}

/**
 * Count open job cards per stage. `other` = open jobs whose status matched no
 * stage (shown honestly as a note rather than silently dropped).
 */
export function jobFlowCounts(jobs = []) {
  const counts = Object.fromEntries(JOB_FLOW_STAGES.map((s) => [s.key, 0]))
  let other = 0
  let open = 0
  for (const j of Array.isArray(jobs) ? jobs : []) {
    const s = normalizeWoStatus(j?.status)
    if (CLOSED.has(s)) continue
    open += 1
    const k = jobFlowStage(j)
    if (k) counts[k] += 1
    else other += 1
  }
  const max = Math.max(0, ...Object.values(counts))
  return {
    stages: JOB_FLOW_STAGES.map((st) => ({
      ...st,
      count: counts[st.key],
      share: open ? counts[st.key] / open : 0,
      bar: max ? counts[st.key] / max : 0,
    })),
    open,
    other,
  }
}

/** Plain-language heading per engine alert type. */
export const ALERT_TYPE_LABEL = Object.freeze({
  vor_sla: 'Vehicle off road beyond SLA',
  overtime: 'Overtime threshold reached',
  overlapping_jobs: 'Owner of overlapping jobs',
  parts_pending: 'Blocked waiting for parts',
  approval_pending: 'Approval pending too long',
  unassigned: 'Technician unassigned',
  no_activity: 'No activity on active job',
  not_checked_in: 'Assigned but not checked in',
  overdue: 'Job past target time',
  job_no_owner: 'Job card has no owner',
  qc_pending: 'Awaiting quality inspection',
})

const LEVEL_ORDER = { critical: 0, warning: 1, info: 2 }
const LEVEL_PILL = {
  critical: { tone: 'bad', label: 'Critical' },
  warning: { tone: 'warn', label: 'Warning' },
  info: { tone: 'info', label: 'Info' },
}

/** Engine alerts as display rows, most severe first, stable within a level. */
export function alertRows(alerts = []) {
  return (Array.isArray(alerts) ? alerts : [])
    .map((a, i) => ({ a, i }))
    .sort((x, y) => ((LEVEL_ORDER[x.a.level] ?? 3) - (LEVEL_ORDER[y.a.level] ?? 3)) || x.i - y.i)
    .map(({ a, i }) => {
      const pill = LEVEL_PILL[a.level] || { tone: 'muted', label: 'Notice' }
      return {
        key: `${a.type}-${a.ref}-${i}`,
        title: ALERT_TYPE_LABEL[a.type] || 'Workshop alert',
        detail: a.message || '',
        level: a.level,
        pillTone: pill.tone,
        pillLabel: pill.label,
        ref: a.ref,
      }
    })
}

/** Counts per alert level (for the card header). */
export function alertLevelCounts(alerts = []) {
  const out = { critical: 0, warning: 0, info: 0 }
  for (const a of Array.isArray(alerts) ? alerts : []) if (a && a.level in out) out[a.level] += 1
  return out
}

/** Two-letter initials for an avatar; '?' when there is no name. */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** "WO-123 | TM514" for the technician's current job, or a plain fallback. */
export function techJobLine(tech) {
  if (!tech?.job) return 'No active job'
  return [tech.job.no || 'Job', tech.job.asset_no].filter(Boolean).join(' | ')
}

/** Board filter chips: status groups the five headline tiles do not cover. */
export const BOARD_CHIPS = Object.freeze([
  { key: 'all', label: 'All' },
  { key: 'unassigned', label: 'Unassigned', pred: (x) => x.status === STATUS.AVAILABLE && !x.currentJobId },
  { key: 'waiting', label: 'Waiting', pred: (x) => [STATUS.WAITING_PARTS, STATUS.WAITING_APPROVAL, STATUS.WAITING_TOOLS, STATUS.WAITING_VEHICLE].includes(x.status) },
  { key: 'inspection', label: 'Awaiting inspection', pred: (x) => x.status === STATUS.AWAITING_INSPECTION },
  { key: 'break', label: 'Break or training', pred: (x) => x.status === STATUS.ON_BREAK || x.status === STATUS.TRAINING },
  { key: 'away', label: 'Off duty or absent', pred: (x) => x.status === STATUS.OFF_DUTY || x.status === STATUS.ABSENT },
])

export function chipCounts(board = []) {
  const out = {}
  for (const c of BOARD_CHIPS) out[c.key] = c.pred ? board.filter(c.pred).length : board.length
  return out
}

/** Header date chip text for a live (today only) board. */
export function todayLabel(now) {
  const d = new Date(now)
  if (Number.isNaN(d.getTime())) return 'Today'
  return `Today, ${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`
}
