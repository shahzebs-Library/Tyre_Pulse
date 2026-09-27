/**
 * checklistSchedulesAnalytics - the pure engine behind Checklist Schedules
 * (/checklist-schedules). The page used to decide "overdue" and summarise a
 * schedule's target inline; those rules, the register filters, the headline
 * figures and the export rows now live here.
 *
 * No I/O. Time is injected (`now`, epoch ms).
 *
 * DUE STATES (each schedule is exactly one, in this precedence):
 *   paused     the schedule is switched off
 *   ended      it has an end date that has passed
 *   overdue    active, and next_due is more than one day in the past
 *                (the SAME grace the page always used, so nothing re-bands)
 *   due_soon   active, next_due within the next DUE_SOON_DAYS days
 *   scheduled  active, next_due further out
 *   no_date    active but carries no readable next_due - reported, not guessed
 */

export const CADENCES = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'once', label: 'One-off' },
]
export const CADENCE_LABEL = Object.fromEntries(CADENCES.map((c) => [c.key, c.label]))
export const DUE_SOON_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

export const DUE_STATES = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'due_soon', label: `Due within ${DUE_SOON_DAYS} days` },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'no_date', label: 'No next date' },
  { key: 'paused', label: 'Paused' },
  { key: 'ended', label: 'Ended' },
]
export const dueStateLabel = (k) => DUE_STATES.find((s) => s.key === k)?.label || k

function toMs(v) {
  if (!v) return null
  const s = String(v)
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s)
  return Number.isNaN(t) ? null : t
}

/** Whole days from now to next_due (negative when past), or null. */
export function daysToDue(schedule, now = Date.now()) {
  const t = toMs(schedule?.next_due)
  if (t == null) return null
  return Math.floor((t - now) / DAY_MS)
}

export function dueState(schedule, now = Date.now()) {
  if (!schedule?.active) return 'paused'
  const end = toMs(schedule?.end_date)
  if (end != null && end + DAY_MS < now) return 'ended'
  const due = toMs(schedule?.next_due)
  if (due == null) return 'no_date'
  if (due < now - DAY_MS) return 'overdue'
  if (due <= now + DUE_SOON_DAYS * DAY_MS) return 'due_soon'
  return 'scheduled'
}

/** A schedule's audience, summarised: "3 sites", "12 assets" or "All". */
export function targetSummary(s) {
  const sites = Array.isArray(s?.sites) ? s.sites.filter(Boolean) : []
  const assets = Array.isArray(s?.asset_nos) ? s.asset_nos.filter(Boolean) : []
  if (sites.length) return `${sites.length} site${sites.length === 1 ? '' : 's'}`
  if (assets.length) return `${assets.length} asset${assets.length === 1 ? '' : 's'}`
  return 'All'
}

export function targetDetail(s) {
  const sites = Array.isArray(s?.sites) ? s.sites.filter(Boolean) : []
  const assets = Array.isArray(s?.asset_nos) ? s.asset_nos.filter(Boolean) : []
  return (sites.length ? sites : assets).join(', ')
}

/** Attach `_state`, `_days` and `_template` (the resolved template name). */
export function enrichSchedules(rows = [], now = Date.now(), templateNameOf = () => '') {
  return (Array.isArray(rows) ? rows : []).map((s) => ({
    ...s,
    _state: dueState(s, now),
    _days: daysToDue(s, now),
    _template: templateNameOf(s?.template_id) || '',
  }))
}

/** Narrow ENRICHED schedules. */
export function filterSchedules(rows = [], { query = '', cadence = 'all', state = 'all', role = 'all' } = {}) {
  const q = String(query || '').trim().toLowerCase()
  return (rows || []).filter((s) => {
    if (cadence !== 'all' && String(s.cadence || '').toLowerCase() !== cadence) return false
    if (state !== 'all' && s._state !== state) return false
    if (role !== 'all' && (s.assignee_role || '') !== (role === 'anyone' ? '' : role)) return false
    if (q) {
      const hay = [s.name, s._template, s.assignee_role, targetDetail(s)].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Headline figures for ENRICHED schedules. */
export function summarizeSchedules(rows = []) {
  const byState = Object.fromEntries(DUE_STATES.map((s) => [s.key, 0]))
  const byCadence = Object.fromEntries(CADENCES.map((c) => [c.key, 0]))
  let unscoped = 0
  for (const s of rows || []) {
    if (byState[s._state] != null) byState[s._state] += 1
    const c = String(s.cadence || '').toLowerCase()
    if (byCadence[c] != null) byCadence[c] += 1
    if (targetSummary(s) === 'All') unscoped += 1
  }
  const total = (rows || []).length
  const active = total - byState.paused
  return {
    total,
    active,
    paused: byState.paused,
    overdue: byState.overdue,
    dueSoon: byState.due_soon,
    ended: byState.ended,
    noDate: byState.no_date,
    unscoped,
    byState,
    byCadence,
    // Of the schedules that should be running, how many are on time.
    onTimePct: active - byState.ended > 0
      ? Math.round(((active - byState.ended - byState.overdue) / (active - byState.ended)) * 1000) / 10
      : null,
  }
}

export const SCHEDULE_EXPORT_COLUMNS = [
  { key: 'name', header: 'Schedule' },
  { key: 'template', header: 'Template' },
  { key: 'cadence', header: 'Cadence' },
  { key: 'target', header: 'Target' },
  { key: 'target_detail', header: 'Sites / assets' },
  { key: 'assignee_role', header: 'Assignee role' },
  { key: 'next_due', header: 'Next due' },
  { key: 'state', header: 'Due state' },
  { key: 'start_date', header: 'Start' },
  { key: 'end_date', header: 'End' },
  { key: 'active', header: 'Active' },
]

export function scheduleExportRows(rows = []) {
  return (rows || []).map((s) => ({
    name: s.name || 'Untitled schedule',
    template: s._template || '',
    cadence: CADENCE_LABEL[s.cadence] || s.cadence || '',
    target: targetSummary(s),
    target_detail: targetDetail(s),
    assignee_role: s.assignee_role || 'Anyone',
    next_due: s.next_due ? String(s.next_due).slice(0, 10) : '',
    state: dueStateLabel(s._state),
    start_date: s.start_date ? String(s.start_date).slice(0, 10) : '',
    end_date: s.end_date ? String(s.end_date).slice(0, 10) : '',
    active: s.active ? 'Yes' : 'No',
  }))
}
