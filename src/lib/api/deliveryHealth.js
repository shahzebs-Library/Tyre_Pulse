/**
 * Delivery Health service - the single reader behind the console
 * "Delivery & Notifications" page (ConsoleDelivery.jsx).
 *
 * Two delivery channels, both already in the database:
 *   - report_send_log      -> scheduled-report EMAIL delivery (sent vs failed).
 *   - workflow_notifications -> push / workflow NOTIFICATIONS (queued / delivered
 *                              / failed, with attempts + last_error).
 *   - profiles.push_token    -> a light head count of devices reachable by push.
 *
 * Pure summarizers (emailStats / pushStats) are exported for unit testing; the
 * fetchers stay thin and degrade to [] / 0 before a relation exists.
 */
import { supabase } from './_client'
import { fetchAllPages } from '../fetchAll'

/**
 * Ceiling on rows read per channel per window. PostgREST caps every response
 * at 1,000 rows whatever `.limit()` says, so the logs are PAGED; this ceiling
 * only stops an absurd range from pulling an unbounded table into the browser.
 * When it is hit the result carries `truncated: true` and the page says so.
 */
export const DELIVERY_LOG_MAX = 50000

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

/* ── Fetchers ─────────────────────────────────────────────────────────────────── */

const EMAIL_COLS =
  'id,schedule_id,schedule_name,report_type,recipients,status,error,sent_at,organisation_id'

/**
 * Report email delivery rows for a window, paged past the 1,000-row server cap.
 * Newest first, `id` as the unique tiebreak so a page boundary never drops or
 * repeats a row. A missing relation resolves to no rows; any other failure
 * THROWS, so the page shows an error instead of an empty log.
 * @returns {Promise<{rows: object[], truncated: boolean}>}
 */
export async function listEmailLog({ days = 30, from, to, max = DELIVERY_LOG_MAX } = {}) {
  const start = from
    ? new Date(from).toISOString()
    : new Date(Date.now() - days * 86_400_000).toISOString()
  const end = to ? new Date(to).toISOString() : null
  const { data, error, truncated } = await fetchAllPages((a, b) => {
    let q = supabase.from('report_send_log').select(EMAIL_COLS).gte('sent_at', start)
    if (end) q = q.lte('sent_at', end)
    return q.order('sent_at', { ascending: false }).order('id', { ascending: false }).range(a, b)
  }, { max })
  if (error) {
    if (isMissingRelation(error)) return { rows: [], truncated: false }
    throw error
  }
  return { rows: data || [], truncated: !!truncated }
}

const PUSH_COLS =
  'id,event_type,recipient_count,status,attempts,next_attempt_at,response_status,' +
  'result,last_error,created_at,delivered_at,organisation_id'

/**
 * Workflow / push notification rows for a window, paged past the 1,000-row
 * server cap (newest first, `id` tiebreak). Same error contract as listEmailLog.
 * @returns {Promise<{rows: object[], truncated: boolean}>}
 */
export async function listPushLog({ days = 30, from, to, max = DELIVERY_LOG_MAX } = {}) {
  const start = from
    ? new Date(from).toISOString()
    : new Date(Date.now() - days * 86_400_000).toISOString()
  const end = to ? new Date(to).toISOString() : null
  const { data, error, truncated } = await fetchAllPages((a, b) => {
    let q = supabase.from('workflow_notifications').select(PUSH_COLS).gte('created_at', start)
    if (end) q = q.lte('created_at', end)
    return q.order('created_at', { ascending: false }).order('id', { ascending: false }).range(a, b)
  }, { max })
  if (error) {
    if (isMissingRelation(error)) return { rows: [], truncated: false }
    throw error
  }
  return { rows: data || [], truncated: !!truncated }
}

/** Head count of devices reachable by push (profiles.push_token not null). */
export async function pushReach() {
  try {
    const { count, error } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .not('push_token', 'is', null)
    if (error) throw error
    return count || 0
  } catch (err) {
    if (isMissingRelation(err)) return 0
    throw err
  }
}

/* ── Pure summarizers ─────────────────────────────────────────────────────────── */

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v))
const isBlank = (v) => v == null || String(v).trim() === ''

function monthKey(iso) {
  const s = String(iso || '')
  return s.length >= 7 ? s.slice(0, 7) : ''
}

/** An email log row is a success only when status === 'sent'. */
function emailOk(r) {
  return String(r?.status || '').toLowerCase() === 'sent'
}

/**
 * Aggregate report_send_log rows into email delivery KPIs + breakdowns. Pure.
 * @returns {{sent, failed, total, failureRate, byType, byDay, recentFailures}}
 */
export function emailStats(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let sent = 0
  let failed = 0
  const byType = {}
  const byDay = {}

  for (const r of list) {
    const ok = emailOk(r)
    if (ok) sent += 1
    else failed += 1

    const type = r?.report_type || 'other'
    const t = (byType[type] ||= { type, sent: 0, failed: 0, total: 0 })
    t.total += 1
    if (ok) t.sent += 1
    else t.failed += 1

    const day = String(r?.sent_at || '').slice(0, 10)
    if (day) {
      const d = (byDay[day] ||= { date: day, sent: 0, failed: 0 })
      if (ok) d.sent += 1
      else d.failed += 1
    }
  }

  const total = list.length
  const recentFailures = list
    .filter((r) => !emailOk(r))
    .slice(0, 50)
    .map((r) => ({
      id: r.id,
      channel: 'email',
      name: r.schedule_name || r.report_type || 'Report',
      status: r.status || 'error',
      error: r.error || null,
      at: r.sent_at || null,
    }))

  return {
    sent,
    failed,
    total,
    failureRate: total ? failed / total : 0,
    byType: Object.values(byType).sort((a, b) => b.total - a.total),
    byDay: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
    recentFailures,
  }
}

/** A push row is delivered when status delivered/sent, failed when status failed/error. */
function pushDelivered(r) {
  const s = String(r?.status || '').toLowerCase()
  return s === 'delivered' || s === 'sent'
}
function pushFailed(r) {
  const s = String(r?.status || '').toLowerCase()
  return s === 'failed' || s === 'error'
}

/**
 * Aggregate workflow_notifications rows into push delivery KPIs + breakdowns. Pure.
 * @returns {{queued, delivered, failed, total, recipients, failureRate, byDay, recentFailures}}
 */
export function pushStats(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let delivered = 0
  let failed = 0
  let queued = 0
  let recipients = 0
  const byDay = {}

  for (const r of list) {
    recipients += num(r?.recipient_count)
    const isDelivered = pushDelivered(r)
    const isFailed = pushFailed(r)
    if (isDelivered) delivered += 1
    else if (isFailed) failed += 1
    else queued += 1

    const day = String(r?.created_at || '').slice(0, 10)
    if (day) {
      const d = (byDay[day] ||= { date: day, delivered: 0, failed: 0, queued: 0 })
      if (isDelivered) d.delivered += 1
      else if (isFailed) d.failed += 1
      else d.queued += 1
    }
  }

  const total = list.length
  const settled = delivered + failed
  const recentFailures = list
    .filter(pushFailed)
    .slice(0, 50)
    .map((r) => ({
      id: r.id,
      channel: 'push',
      name: r.event_type || 'Notification',
      status: r.status || 'failed',
      error: r.last_error || (isBlank(r.response_status) ? null : `HTTP ${r.response_status}`),
      at: r.created_at || null,
      attempts: num(r.attempts),
    }))

  return {
    queued,
    delivered,
    failed,
    total,
    recipients,
    failureRate: settled ? failed / settled : 0,
    byDay: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
    recentFailures,
  }
}

/**
 * Merge email + push per-day series into one trend table keyed by date. Pure.
 * @returns {Array<{date, emailSent, emailFailed, pushDelivered, pushFailed}>}
 */
export function mergeTrend(email = {}, push = {}) {
  const byDate = {}
  for (const d of email.byDay || []) {
    const e = (byDate[d.date] ||= { date: d.date, emailSent: 0, emailFailed: 0, pushDelivered: 0, pushFailed: 0 })
    e.emailSent += num(d.sent)
    e.emailFailed += num(d.failed)
  }
  for (const d of push.byDay || []) {
    const e = (byDate[d.date] ||= { date: d.date, emailSent: 0, emailFailed: 0, pushDelivered: 0, pushFailed: 0 })
    e.pushDelivered += num(d.delivered)
    e.pushFailed += num(d.failed)
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
}

// Kept for callers that want a monthly rollup; not used by the page yet.
export { monthKey }
