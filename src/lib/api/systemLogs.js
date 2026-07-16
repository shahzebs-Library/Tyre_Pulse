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
import { supabase, unwrap } from './_client'

/** Explicit least-privilege column list (no SELECT *). */
export const SYSTEM_LOG_COLS =
  'id,organisation_id,module_id,severity,source,message,detail,reference_id,url,' +
  'user_id,user_email,resolved,resolved_by,resolved_at,created_at'

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

/**
 * List system log rows, newest first. All filters are optional and applied only
 * when provided. Returns [] when the table is not provisioned or on a read error
 * so the health surface degrades gracefully.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.severity]  eq filter on severity
 * @param {string}  [opts.module]    eq filter on module_id
 * @param {boolean} [opts.resolved]  eq filter on resolved (bool)
 * @param {string}  [opts.since]     ISO timestamp; created_at gte filter
 * @param {number}  [opts.limit=500] max rows
 * @returns {Promise<Array<object>>}
 */
export async function listSystemLogs({ severity, module, resolved, since, limit = 500 } = {}) {
  try {
    let q = supabase.from('system_logs').select(SYSTEM_LOG_COLS)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (severity) q = q.eq('severity', severity)
    if (module) q = q.eq('module_id', module)
    if (typeof resolved === 'boolean') q = q.eq('resolved', resolved)
    if (since) q = q.gte('created_at', since)
    return unwrap(await q) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Mark a single log row resolved. Stamps resolved=true, resolved_at=now, and
 * resolved_by = the current user id (best-effort; null when unavailable). Returns
 * the updated row.
 *
 * @param {string|number} id  the log row id
 * @returns {Promise<object|null>}
 */
export async function resolveSystemLog(id) {
  let resolvedBy = null
  try {
    const { data } = await supabase.auth.getUser()
    resolvedBy = data?.user?.id || null
  } catch {
    resolvedBy = null
  }
  return unwrap(
    await supabase.from('system_logs')
      .update({
        resolved: true,
        resolved_by: resolvedBy,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(SYSTEM_LOG_COLS)
      .single(),
  )
}

/**
 * Bulk-resolve log rows via the Admin/super gated `resolve_system_logs` RPC
 * (which stamps resolved_by = auth.uid() server-side). Optionally scope to a
 * single module and/or severity. Returns the integer count of rows resolved.
 *
 * @param {object} [opts]
 * @param {string} [opts.module]    module_id filter (null = all)
 * @param {string} [opts.severity]  severity filter (null = all)
 * @returns {Promise<number>}
 */
export async function resolveAllSystemLogs({ module, severity } = {}) {
  return unwrap(
    await supabase.rpc('resolve_system_logs', {
      p_module: module || null,
      p_severity: severity || null,
    }),
  )
}

/**
 * Fire-and-forget error/event reporter. Best-effort INSERT into system_logs so
 * the app can self-report failures from anywhere without ever throwing. The
 * organisation_id / user_id come from DB defaults (do NOT pass them here).
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
 * @returns {Promise<{ok: boolean}>}
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
} = {}) {
  const msg = message == null ? '' : String(message).trim()
  if (!msg) return { ok: false }
  try {
    const payload = {
      module_id: module_id || null,
      severity: severity || 'error',
      source: source || null,
      message: msg.slice(0, 8000),
      detail: detail == null ? null : detail,
      reference_id: reference_id || null,
      url: url || null,
      user_email: user_email || null,
    }
    const { error } = await supabase.from('system_logs').insert(payload)
    if (error) return { ok: false }
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
    unresolvedCritical, unresolvedError, errorsTotal,
    aiTotal, aiErrors,
    reportsTotal, reportsFailed,
    logsByDay,
  ] = await Promise.all([
    // latestByStream
    latestCreatedAt('tyre_records'),
    latestCreatedAt('inspections'),
    latestCreatedAt('accidents'),
    latestCreatedAt('work_orders'),
    // errors (system_logs, unresolved)
    headCount(() => supabase.from('system_logs')
      .select('id', { count: 'exact', head: true })
      .eq('resolved', false).eq('severity', 'critical')),
    headCount(() => supabase.from('system_logs')
      .select('id', { count: 'exact', head: true })
      .eq('resolved', false).eq('severity', 'error')),
    headCount(() => supabase.from('system_logs')
      .select('id', { count: 'exact', head: true })
      .eq('resolved', false)),
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
    errors: {
      unresolvedCritical,
      unresolvedError,
      total: errorsTotal,
    },
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
async function buildLogsByDay(since) {
  try {
    const { data, error } = await supabase.from('system_logs')
      .select('created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(10000)
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
