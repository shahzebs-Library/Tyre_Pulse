/**
 * workshopTasks.js - pure engine for JOB TASK MANAGEMENT inside Workshop Live
 * Control. NO I/O: it turns a job's task list (wo_tasks) plus that job's activity
 * event log (tech_activity_events) into per-task time + progress numbers used by
 * the dashboard task expander.
 *
 * A job is split into ordered tasks. Technicians log events against a task_id, so
 * the time a task consumed is derived from the event timeline: each event holds
 * the workshop until the next event, and that span is attributed to the task_id
 * the earlier event referenced. This is the same "events -> segments" idea the
 * status engine uses, scoped to one job's tasks. Deterministic (explicit `now`).
 *
 * Honest: a task with no matching events shows 0 minutes (never invented); a job
 * with no tasks yields an all-zero summary the UI renders as an empty state.
 */

const MIN = 60_000

/** Coerce to epoch ms, or NaN. */
function ts(v) {
  if (v == null) return NaN
  if (typeof v === 'number') return v
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? NaN : t
}

const arr = (v) => (Array.isArray(v) ? v : [])
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** Task status tokens (mirror the DB CHECK on wo_tasks.status). */
export const TASK_STATUS = Object.freeze(['pending', 'in_progress', 'blocked', 'done', 'qc'])

/** Human label per task status. */
export const TASK_STATUS_LABEL = Object.freeze({
  pending: 'Pending',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
  qc: 'Quality Check',
})

/**
 * Sum minutes spent per task_id from a job's ordered event log. Each event holds
 * time until the next event (or `now` for the last one); that span is credited to
 * the earlier event's task_id. Events with no task_id contribute no task time.
 *
 * @param {Array} eventsForJob  tech_activity_events rows for ONE job (any order)
 * @param {number} now  epoch ms
 * @returns {Object} { [task_id]: minutes }
 */
export function minutesByTask(eventsForJob, now) {
  const evs = arr(eventsForJob)
    .map((e) => ({ task_id: e.task_id ?? null, _t: ts(e.at) }))
    .filter((e) => Number.isFinite(e._t))
    .sort((a, b) => a._t - b._t)
  const out = {}
  for (let i = 0; i < evs.length; i++) {
    const start = evs[i]._t
    const end = i + 1 < evs.length ? evs[i + 1]._t : num(now)
    if (!(end > start)) continue
    const tid = evs[i].task_id
    if (tid == null) continue
    out[tid] = (out[tid] || 0) + (end - start) / MIN
  }
  return out
}

/**
 * Roll a job's tasks up against its event log.
 *
 * @param {Array} tasks  wo_tasks rows for the job
 * @param {Array} eventsForJob  tech_activity_events rows for the job
 * @param {{ now:number }} ctx
 * @returns {Array<{ id, title, seq, skill, status, statusLabel, assignee,
 *   est_minutes, minutesSpent, overBudget }>}  ordered by seq then title
 */
export function taskRollup(tasks, eventsForJob, ctx = {}) {
  const now = num(ctx.now)
  const byTask = minutesByTask(eventsForJob, now)
  return arr(tasks)
    .map((t) => {
      const status = TASK_STATUS.includes(t.status) ? t.status : 'pending'
      const est = t.est_minutes == null ? null : num(t.est_minutes)
      const minutesSpent = Math.round((byTask[t.id] || 0) * 10) / 10
      return {
        id: t.id,
        title: t.title || 'Untitled task',
        seq: t.seq == null ? null : num(t.seq),
        skill: t.skill || null,
        status,
        statusLabel: TASK_STATUS_LABEL[status] || status,
        assignee: t.assignee_user_id || null,
        est_minutes: est,
        minutesSpent,
        overBudget: est != null && est > 0 && minutesSpent > est,
      }
    })
    .sort((a, b) => {
      const sa = a.seq == null ? Infinity : a.seq
      const sb = b.seq == null ? Infinity : b.seq
      if (sa !== sb) return sa - sb
      return String(a.title).localeCompare(String(b.title))
    })
}

/**
 * Progress summary for a job's tasks.
 *
 * @param {Array} tasks  wo_tasks rows (raw, or taskRollup output - both carry status)
 * @returns {{ total:number, done:number, inProgress:number, blocked:number,
 *   pending:number, qc:number, pct:number }}  pct = done / total * 100 (0 when none)
 */
export function jobTaskSummary(tasks) {
  const t = arr(tasks)
  const total = t.length
  const count = (st) => t.filter((x) => (TASK_STATUS.includes(x.status) ? x.status : 'pending') === st).length
  const done = count('done')
  return {
    total,
    done,
    inProgress: count('in_progress'),
    blocked: count('blocked'),
    pending: count('pending'),
    qc: count('qc'),
    pct: total ? Math.round((done / total) * 100) : 0,
  }
}
