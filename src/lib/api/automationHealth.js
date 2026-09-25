/**
 * Automation Health service - the single reader behind the console
 * "Automation Health" page (ConsoleAutomation.jsx).
 *
 * Surfaces three already-existing operational channels for the super-admin:
 *   - report_schedules   -> every scheduled report, its cadence, whether it is
 *                           active, when it next runs / last sent, last status.
 *   - report_send_log    -> delivery attempts (reused via aiOps.listJobRuns /
 *                           summarizeJobs where the shapes align).
 *   - cron.job (+ runs)  -> pg_cron background jobs and their most recent run,
 *                           via the V274 SECURITY DEFINER RPC console_cron_jobs().
 *
 * Pure summarizers (summarizeSchedules / summarizeCron) are exported for unit
 * testing; the fetchers stay thin. They degrade to [] ONLY before the migration
 * is applied (a not-deployed table / RPC, by error code). A permission or
 * network failure THROWS a sanitised ServiceError, so the page shows an error
 * with Retry instead of "nothing scheduled" / "no background jobs".
 */
import { supabase, isNotProvisioned, ServiceError } from './_client'
import { toUserMessage } from '../safeError'
import { listJobRuns, summarizeJobs } from './aiOps'

// Re-export the report_send_log readers so the page has one import surface and
// does not re-query report_send_log directly (reuse over duplication).
export { listJobRuns, summarizeJobs }

/**
 * True only when a table / RPC is genuinely not deployed yet, by error CODE.
 * The old message sniffer matched a bare "relation", which a permission denial
 * ("permission denied for relation ...") also contains - so an unreadable
 * schedule list rendered as "no scheduled reports".
 */
const isMissingRelation = isNotProvisioned

/* ── Scheduled reports (report_schedules) ────────────────────────────────────── */

const SCHEDULE_COLS =
  'id,name,report_type,frequency,day_of_week,day_of_month,time_of_day,recipients,' +
  'active,last_sent_at,next_run_at,org_id,created_at,run_at,output_formats,last_status,last_error'

/**
 * List every scheduled report (newest first). Returns [] only pre-migration;
 * any other failure throws. The schedule register is small (tens of rows) and
 * `limit` is clamped to the 1,000-row response cap.
 */
export async function listSchedules({ limit = 500 } = {}) {
  const { data, error } = await supabase
    .from('report_schedules')
    .select(SCHEDULE_COLS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(Math.min(Math.max(1, Number(limit) || 500), 1000))
  if (error) {
    if (isMissingRelation(error)) return []
    throw new ServiceError(toUserMessage(error), error.code, error)
  }
  return data || []
}

/**
 * Recent report delivery-log rows for a trailing window. Thin wrapper over the
 * aiOps reader so report_send_log is queried in one place only.
 */
export async function listSendLog({ days = 30, limit = 500 } = {}) {
  return listJobRuns({ days, limit })
}

const isBlank = (v) => v == null || String(v).trim() === ''

/** A schedule is "failing" when its last run errored or carries an error note. */
function scheduleFailing(row) {
  const st = String(row?.last_status || '').toLowerCase()
  return st === 'error' || st === 'failed' || !isBlank(row?.last_error)
}

/**
 * Aggregate schedule rows into the KPI counts the page renders. Pure.
 * @param {Array} rows report_schedules projection
 * @param {number|Date} now reference time for overdue detection
 * @returns {{total:number, active:number, paused:number, overdue:number, failing:number}}
 */
export function summarizeSchedules(rows = [], now = Date.now()) {
  const list = Array.isArray(rows) ? rows : []
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  const ref = Number.isFinite(nowMs) ? nowMs : Date.now()

  let active = 0
  let paused = 0
  let overdue = 0
  let failing = 0

  for (const r of list) {
    const isActive = r?.active === true
    if (isActive) active += 1
    else paused += 1

    if (isActive && !isBlank(r?.next_run_at)) {
      const t = new Date(r.next_run_at).getTime()
      if (Number.isFinite(t) && t < ref) overdue += 1
    }
    if (scheduleFailing(r)) failing += 1
  }

  return { total: list.length, active, paused, overdue, failing }
}

/** Per-row presentation flags (PAUSED / OVERDUE / FAILING) for a schedule. */
export function scheduleFlags(row, now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now)
  const ref = Number.isFinite(nowMs) ? nowMs : Date.now()
  const paused = row?.active !== true
  let overdue = false
  if (!paused && !isBlank(row?.next_run_at)) {
    const t = new Date(row.next_run_at).getTime()
    overdue = Number.isFinite(t) && t < ref
  }
  return { paused, overdue, failing: scheduleFailing(row) }
}

/* ── pg_cron jobs (console_cron_jobs RPC, V274) ──────────────────────────────── */

/**
 * List pg_cron jobs with their most recent run status/time via the V274 RPC.
 * Returns [] only when the RPC is not deployed (or pg_cron returns no jobs).
 * A permission denial is NOT swallowed any more: this page is super-admin only,
 * so "not authorized" is a real fault to show, not "no background jobs".
 */
export async function listCronJobs() {
  const { data, error } = await supabase.rpc('console_cron_jobs')
  if (error) {
    if (isMissingRelation(error)) return []
    throw new ServiceError(toUserMessage(error), error.code, error)
  }
  return Array.isArray(data) ? data : []
}

/** Map a pg_cron run status string to a traffic-light tone. */
export function cronRunTone(status) {
  const s = String(status || '').toLowerCase()
  if (!s) return 'gray'
  if (s === 'succeeded' || s === 'success') return 'green'
  if (s === 'running' || s === 'starting' || s === 'sending') return 'amber'
  if (s === 'failed' || s === 'error') return 'red'
  return 'gray'
}

/**
 * Aggregate cron rows into KPI counts + per-job health tone. Pure.
 * @returns {{total:number, active:number, inactive:number, failing:number, jobs:Array}}
 */
export function summarizeCron(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let active = 0
  let inactive = 0
  let failing = 0
  const jobs = list.map((r) => {
    const isActive = r?.active === true
    if (isActive) active += 1
    else inactive += 1
    const tone = cronRunTone(r?.last_status)
    if (tone === 'red') failing += 1
    return {
      jobid: r?.jobid,
      jobname: r?.jobname || `job ${r?.jobid ?? ''}`.trim(),
      schedule: r?.schedule || '',
      active: isActive,
      lastStatus: r?.last_status || null,
      lastEnd: r?.last_end || null,
      tone,
    }
  })
  return { total: list.length, active, inactive, failing, jobs }
}
