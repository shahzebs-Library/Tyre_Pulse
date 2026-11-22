/**
 * System Logs service - the single Supabase boundary for the super-admin System
 * Health surface (V255 `system_logs`). Mirrors the sibling service modules
 * (adminAccess.js / dataReconciliation.js / tyrePool.js): explicit least-privilege
 * column list, `unwrap`/`ServiceError` error surfacing, thin faithful RPC
 * pass-throughs, and a missing-relation guard that degrades to an empty result so
 * a page can render its "apply the migration" state instead of erroring.
 *
 * RLS (V255): any authenticated user may INSERT (so the app can self-report
 * errors); only Admin / super-admin may read or UPDATE. The `resolve_system_logs`
 * RPC is Admin/super gated in the database - this layer never re-implements the
 * gate, it only relocates the call and normalises error surfacing.
 */
import { supabase, unwrap, ServiceError } from './_client'
import { validReason, MIN_REASON_LENGTH } from '../errorStatus'
import { fetchAllPages } from '../fetchAll'
import { errorFingerprint, webAppVersion, describeClient } from '../problemReport'

/** Explicit least-privilege column list (no SELECT *). */
export const SYSTEM_LOG_COLS =
  'id,organisation_id,module_id,severity,source,message,detail,reference_id,url,' +
  'user_id,user_email,resolved,resolved_by,resolved_at,created_at,' +
  'platform,app_version,device,screen,error_fingerprint'

/**
 * True when the failure is "table does not exist yet" (pre-migration) so callers
 * can degrade to an empty result rather than surfacing a raw error.
 */
export function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('system_logs'))
  )
}

/** True when the server does not have the status RPCs yet (migration not applied). */
function isMissingRpc(err) {
  const code = err?.code || err?.cause?.code
  return code === 'PGRST202' || code === '42883'
}

/**
 * List system log rows, newest first, each with its Error Center status:
 *   group_key, group_status (for_review | reviewed | fixed_in_code | resolved | ignored | routine),
 *   is_open.
 * Status comes from the Error Center triage table, NOT from system_logs.resolved, because log rows
 * are immutable and their own resolved flag never changes. Before the status RPC exists on the
 * server, rows are read directly and treated as open, which is what the database really says.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.severity]  eq filter on severity
 * @param {string}  [opts.module]    eq filter on module_id
 * @param {'open'|'closed'} [opts.status]  Error Center status filter
 * @param {boolean} [opts.resolved]  legacy alias: true = closed, false = open
 * @param {string}  [opts.since]     ISO timestamp; created_at gte filter
 * @param {number}  [opts.limit=500] max rows
 * @returns {Promise<Array<object>>}
 */
export async function listSystemLogs({ severity, module, status, resolved, since, limit = 500 } = {}) {
  const wanted = status || (resolved === true ? 'closed' : resolved === false ? 'open' : null)
  try {
    return unwrap(await supabase.rpc('list_system_logs_with_status', {
      p_severity: severity || null,
      p_module: module || null,
      p_status: wanted,
      p_since: since || null,
      p_limit: limit,
    })) || []
  } catch (err) {
    if (!isMissingRpc(err)) {
      if (isMissingRelation(err)) return []
      throw err
    }
  }
  // Fallback: status RPC not deployed yet. Every log is open in the database's own terms.
  if (wanted === 'closed') return []
  try {
    let q = supabase.from('system_logs').select(SYSTEM_LOG_COLS)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (severity) q = q.eq('severity', severity)
    if (module) q = q.eq('module_id', module)
    if (since) q = q.gte('created_at', since)
    const rows = unwrap(await q) || []
    return rows.map((r) => ({ ...r, group_status: null, is_open: true }))
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

function requireReason(reason) {
  if (!validReason(reason)) {
    throw new ServiceError(`Enter a reason (at least ${MIN_REASON_LENGTH} characters) to resolve.`, '22023')
  }
  return String(reason).trim()
}

/**
 * Resolve the error GROUP a log belongs to, with a reason. The log row itself is never changed
 * (it is an immutable audit record); the status, actor, time and reason are written to the Error
 * Center triage table and its history. Super admin only (enforced by the database).
 *
 * @param {string} id      the log row id
 * @param {string} reason  why it is resolved (required)
 * @returns {Promise<{ok: boolean, resolved: number}>}
 */
export async function resolveSystemLog(id, reason) {
  const why = requireReason(reason)
  return unwrap(await supabase.rpc('resolve_system_log_groups', {
    p_log_ids: [id],
    p_module: null,
    p_severity: null,
    p_reason: why,
  }))
}

/**
 * Resolve every open error group behind the matching logs, with a reason. Returns how many groups
 * were resolved. Falls back to the old RPC (same effect after the migration) when the new one is
 * not deployed.
 *
 * @param {object} [opts]
 * @param {string} [opts.module]    module_id filter (null = all)
 * @param {string} [opts.severity]  severity filter (null = all)
 * @param {string} opts.reason      why (required)
 * @returns {Promise<number>}
 */
export async function resolveAllSystemLogs({ module, severity, reason } = {}) {
  const why = requireReason(reason)
  try {
    const out = unwrap(await supabase.rpc('resolve_system_log_groups', {
      p_log_ids: null,
      p_module: module || null,
      p_severity: severity || null,
      p_reason: why,
    }))
    return Number(out?.resolved) || 0
  } catch (err) {
    if (!isMissingRpc(err)) throw err
  }
  return unwrap(await supabase.rpc('resolve_system_logs', {
    p_module: module || null,
    p_severity: severity || null,
  }))
}

/**
 * Open error-log counts by severity, using the Error Center status. Null when not available
 * (the caller then falls back to the raw count, which treats every log as open).
 */
export async function openLogCounts(since = null) {
  try {
    const out = unwrap(await supabase.rpc('system_log_open_counts', { p_since: since }))
    return out && typeof out === 'object' ? out : null
  } catch {
    return null
  }
}

/**
 * Fire-and-forget error/event reporter. Best-effort INSERT into system_logs so
 * the app can self-report failures from anywhere without ever throwing. The
 * organisation_id / user_id come from DB defaults (do NOT pass them here).
 * When the direct insert is refused (signed out: anon has no table grant) it
 * falls back to the `log_client_error` RPC so pre-login errors are captured.
 *
 * @param {object}  [event]
 * @param {string}  [event.module_id]
 * @param {string}  [event.severity='error']  info | warning | error | critical
 * @param {string}  [event.source]
 * @param {string}  event.message             required (skipped when empty)
 * @param {object}  [event.detail]            jsonb detail payload
 * @param {string}  [event.reference_id]
 * @param {string}  [event.url]
 * @param {string}  [event.user_email]
 * @param {string}  [event.screen]           defaults to location.pathname
 * @param {string}  [event.fingerprint]      defaults to source + normalised message
 * @returns {Promise<{ok: boolean}>}
 *
 * Attribution (Phase 0): every row carries platform='web', the build version
 * (VITE_APP_VERSION, null when the build does not set one), the browser, the
 * screen and a fingerprint so identical errors group together.
 */
export async function logSystemEvent({
  module_id,
  severity = 'error',
  source,
  message,
  detail,
  reference_id,
  url,
  user_email,
  screen,
  fingerprint,
} = {}) {
  const msg = message == null ? '' : String(message).trim()
  if (!msg) return { ok: false }
  try {
    const client = describeClient(typeof navigator !== 'undefined' ? navigator.userAgent : '')
    const here = typeof location !== 'undefined' ? location.pathname : null
    const payload = {
      module_id: module_id || null,
      severity: severity || 'error',
      source: source || null,
      message: msg.slice(0, 8000),
      detail: detail == null ? null : detail,
      reference_id: reference_id || null,
      url: url || null,
      user_email: user_email || null,
      platform: 'web',
      app_version: webAppVersion(),
      device: client.device ? `${client.device}${client.os ? ` on ${client.os}` : ''}`.slice(0, 200) : null,
      screen: (screen || here || null) ? String(screen || here).slice(0, 300) : null,
      error_fingerprint: fingerprint || errorFingerprint(source, msg),
    }
    const { error } = await supabase.from('system_logs').insert(payload)
    if (!error) return { ok: true }
    // The direct insert is refused before sign-in (anon holds no table grant,
    // V281) and on any RLS denial. Fall back to the narrowly-scoped
    // log_client_error RPC, which caps lengths, whitelists severity, rate
    // limits and derives org/user server-side (user_email is not accepted).
    return await logViaRpc(payload)
  } catch {
    return { ok: false }
  }
}

/** Fallback path through the log_client_error RPC. Never throws. */
async function logViaRpc(payload) {
  try {
    const detail = payload.detail
    const { data, error } = await supabase.rpc('log_client_error', {
      p_severity: payload.severity,
      p_source: payload.source,
      p_message: String(payload.message).slice(0, 2000),
      p_module_id: payload.module_id,
      p_detail: detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : null,
      p_reference_id: payload.reference_id,
      p_url: payload.url,
      p_platform: payload.platform,
      p_app_version: payload.app_version,
      p_device: payload.device,
      p_screen: payload.screen,
      p_fingerprint: payload.error_fingerprint,
    })
    if (error || data !== true) return { ok: false }
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/* ── Health metrics ─────────────────────────────────────────────────────────
 * Each source is gathered in its OWN try/catch so one unavailable table never
 * sinks the whole dashboard. Counts use head-only exact-count queries (no rows
 * transferred) and degrade to 0; timestamps degrade to null.
 * ───────────────────────────────────────────────────────────────────────── */

const DAY_MS = 24 * 60 * 60 * 1000
const iso = (d) => new Date(d).toISOString()

/** Latest created_at (ISO) for a stream, or null. Head-order-limit-1 read. */
async function latestCreatedAt(table) {
  try {
    const { data, error } = await supabase.from(table)
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) return null
    const row = Array.isArray(data) ? data[0] : null
    return row?.created_at || null
  } catch {
    return null
  }
}

/** Exact head count for a query builder, degrading to 0. */
async function headCount(buildQuery) {
  try {
    const { count, error } = await buildQuery()
    if (error) return 0
    return count || 0
  } catch {
    return 0
  }
}

/**
 * Gather the Fleet-Health-Score inputs plus status-card data. Never throws.
 *
 * @returns {Promise<{
 *   latestByStream: { tyre_records: string|null, inspections: string|null,
 *                     accidents: string|null, work_orders: string|null },
 *   errors: { unresolvedCritical: number, unresolvedError: number, total: number },
 *   ai: { total: number, errors: number },
 *   reports: { total: number, failed: number },
 *   logsByDay: Array<{ day: string, count: number }>
 * }>}
 */
export async function getHealthMetrics() {
  const now = Date.now()
  const since24h = iso(now - DAY_MS)
  const since14d = iso(now - 14 * DAY_MS)

  const [
    trLatest, inspLatest, accLatest, woLatest,
    openCounts, legacyCritical, legacyError, errorsTotal,
    aiTotal, aiErrors,
    reportsTotal, reportsFailed,
    logsByDay,
  ] = await Promise.all([
    // latestByStream
    latestCreatedAt('tyre_records'),
    latestCreatedAt('inspections'),
    latestCreatedAt('accidents'),
    latestCreatedAt('work_orders'),
    // errors: open by Error Center status (log rows are immutable; their own resolved flag never changes)
    openLogCounts(),
    // Fallback when the status RPC is not deployed: every log row is open in the database's terms.
    headCount(() => supabase.from('system_logs')
      .select('id', { count: 'exact', head: true }).eq('severity', 'critical')),
    headCount(() => supabase.from('system_logs')
      .select('id', { count: 'exact', head: true }).eq('severity', 'error')),
    headCount(() => supabase.from('system_logs')
      .select('id', { count: 'exact', head: true })),
    // ai (last 24h)
    headCount(() => supabase.from('ai_token_logs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since24h)),
    headCount(() => supabase.from('ai_token_logs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'error').gte('created_at', since24h)),
    // reports (last 14d)
    headCount(() => supabase.from('report_send_log')
      .select('id', { count: 'exact', head: true })
      .gte('sent_at', since14d)),
    headCount(() => supabase.from('report_send_log')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed').gte('sent_at', since14d)),
    // logsByDay (system_logs, last 14 days)
    buildLogsByDay(since14d),
  ])

  return {
    latestByStream: {
      tyre_records: trLatest,
      inspections: inspLatest,
      accidents: accLatest,
      work_orders: woLatest,
    },
    errors: openCounts
      ? {
          unresolvedCritical: Number(openCounts.critical) || 0,
          unresolvedError: Number(openCounts.error) || 0,
          total: Object.values(openCounts).reduce((n, v) => n + (Number(v) || 0), 0),
        }
      : { unresolvedCritical: legacyCritical, unresolvedError: legacyError, total: errorsTotal },
    ai: { total: aiTotal, errors: aiErrors },
    reports: { total: reportsTotal, failed: reportsFailed },
    logsByDay,
  }
}

/**
 * Group system_logs created_at into per-day counts over the last 14 days.
 * Reads the id/created_at of recent rows and buckets client-side. Degrades to []
 * when the table is unavailable.
 */
/** Safety ceiling for the 14-day trend read (rows, not days). */
const LOGS_BY_DAY_MAX = 50000

export async function buildLogsByDay(since) {
  try {
    // Paged: PostgREST caps a response at 1,000 rows whatever `.limit()` asks
    // for, so the old `.limit(10000)` silently stopped at 1,000 and the trend
    // under-counted busy days. `id` is the unique tiebreak for stable paging.
    const { data, error } = await fetchAllPages((a, b) => supabase.from('system_logs')
      .select('id,created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b), { max: LOGS_BY_DAY_MAX })
    if (error) return []
    const rows = Array.isArray(data) ? data : []
    const buckets = new Map()
    for (const r of rows) {
      const day = String(r?.created_at || '').slice(0, 10)
      if (!day) continue
      buckets.set(day, (buckets.get(day) || 0) + 1)
    }
    return Array.from(buckets.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([day, count]) => ({ day, count }))
  } catch {
    return []
  }
}
