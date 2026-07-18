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
 * testing; the fetchers stay thin. Everything degrades to [] / an empty summary
 * before the migration is applied or when a relation is unreadable (honest empty
 * states, never a raw error to the UI).
 */
import { supabase } from './_client'
import { listJobRuns, summarizeJobs } from './aiOps'

// Re-export the report_send_log readers so the page has one import surface and
// does not re-query report_send_log directly (reuse over duplication).
export { listJobRuns, summarizeJobs }

/** True when a Supabase error means the table / relation is not deployed yet. */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === '42703' || code === 'PGRST205' || code === 'PGRST204' ||
    msg.includes('does not exist') ||
    msg.includes('could not find') ||
    msg.includes('schema cache') ||
    msg.includes('relation')
  )
}

/* ── Scheduled reports (report_schedules) ────────────────────────────────────── */

const SCHEDULE_COLS =
  'id,name,report_type,frequency,day_of_week,day_of_month,time_of_day,recipients,' +
  'active,last_sent_at,next_run_at,org_id,created_at,run_at,output_formats,last_status,last_error'

/**
 * List every scheduled report (newest first). Returns [] pre-migration / when
 * unreadable so the page prompts instead of throwing.
 */
export async function listSchedules({ limit = 500 } = {}) {
  try {
    const { data, error } = await supabase
      .from('report_schedules')
      .select(SCHEDULE_COLS)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return data || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
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
 * Returns [] when pg_cron is absent, the RPC is not deployed, or the caller is
 * not authorized (the page shows an honest empty state either way).
 */
export async function listCronJobs() {
  try {
    const { data, error } = await supabase.rpc('console_cron_jobs')
    if (error) throw error
    return Array.isArray(data) ? data : []
  } catch (err) {
    if (isMissingRelation(err)) return []
    // Permission / not-authorized -> treat as "nothing to show" rather than error.
    const msg = String(err?.message || '').toLowerCase()
    if (msg.includes('not authorized') || err?.code === '42501') return []
    throw err
  }
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
