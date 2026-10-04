/**
 * Engineering Control Center service: the Supabase boundary for Developer
 * Center, Releases and Feature Flags. Every RPC is SECURITY DEFINER and
 * super-admin gated in the database (migrations 20260930200000 and
 * 20260930201000); this layer only relocates the calls and sanitises errors.
 *
 * Readers THROW a sanitised ServiceError on failure so a page can show an
 * error with Retry, never an empty list or a zero standing in for "unknown".
 */
import { supabase, unwrap, ServiceError } from './_client'
import { toUserMessage } from '../safeError'

function readJson(res, what) {
  const data = unwrap(res)
  if (!data || data.ok === false) throw new ServiceError(`${what} could not be read.`)
  return data
}

/* ── scheduled jobs ─────────────────────────────────────────────────────── */

export async function getCronHealth(days = 7) {
  return readJson(await supabase.rpc('admin_cron_health', { p_days: days }), 'Scheduled job health')
}

export async function getCronJobRuns(jobid, limit = 8) {
  const d = readJson(await supabase.rpc('admin_cron_job_runs', { p_jobid: jobid, p_limit: limit }), 'Job runs')
  return Array.isArray(d.runs) ? d.runs : []
}

export async function setCronJobActive(jobid, active, reason) {
  return unwrap(await supabase.rpc('admin_cron_set_active', { p_jobid: jobid, p_active: active, p_reason: reason }))
}

export async function runCronJobNow(jobid, reason) {
  return unwrap(await supabase.rpc('admin_cron_run_now', { p_jobid: jobid, p_reason: reason }))
}

export const CRON_POLICY_KEYS = Object.freeze({
  enabled: 'cron_alert_enabled',
  grace_min: 'cron_alert_grace_min',
  fail_streak: 'cron_alert_fail_streak',
  stuck_min: 'cron_alert_stuck_min',
  recover_ok: 'cron_alert_recover_ok',
})

/** Validate a job alert policy edit; returns an error message or null. */
export function validateCronPolicy(p) {
  const n = (v) => Number(v)
  if (!Number.isInteger(n(p.grace_min)) || n(p.grace_min) < 1 || n(p.grace_min) > 120) return 'Grace period must be 1 to 120 minutes.'
  if (!Number.isInteger(n(p.fail_streak)) || n(p.fail_streak) < 1 || n(p.fail_streak) > 10) return 'Failures in a row must be 1 to 10.'
  if (!Number.isInteger(n(p.stuck_min)) || n(p.stuck_min) < 1 || n(p.stuck_min) > 240) return 'Stuck threshold must be 1 to 240 minutes.'
  if (!Number.isInteger(n(p.recover_ok)) || n(p.recover_ok) < 1 || n(p.recover_ok) > 10) return 'Good runs to close must be 1 to 10.'
  return null
}

/* ── versions, adoption, migrations ─────────────────────────────────────── */

export async function getAppAdoption() {
  return readJson(await supabase.rpc('admin_app_version_adoption'), 'App adoption')
}

export async function getRecentMigrations(limit = 12) {
  return readJson(await supabase.rpc('admin_recent_migrations', { p_limit: limit }), 'Migration history')
}

const CONFIG_KEYS = [
  'mobile_min_version', 'mobile_latest_version', 'flutter_min_version',
  'ai_enabled', 'ai_model', 'ai_monthly_budget_usd', 'ai_rate_limit_per_min', 'ai_cache_ttl_hours',
  'dual_control_enabled',
]

/** The settings the Developer Center shows, with when and by whom they changed. */
export async function getEngineeringConfig() {
  const { data, error } = await supabase
    .from('system_config').select('key, value, updated_at, updated_by').in('key', CONFIG_KEYS)
  if (error) throw new ServiceError(toUserMessage(error, 'The settings could not be read.'), error.code, error)
  const out = {}
  for (const r of data || []) {
    let v = String(r.value ?? '').trim()
    try { const p = JSON.parse(v); if (typeof p === 'string' || typeof p === 'number' || typeof p === 'boolean') v = String(p) } catch { /* bare value */ }
    out[r.key] = { value: v, updatedAt: r.updated_at || null, updatedBy: r.updated_by || null }
  }
  return out
}

/* ── releases ───────────────────────────────────────────────────────────── */

export async function listRecordedReleases() {
  const { data, error } = await supabase
    .from('releases')
    .select('id, version, notes, released_at, released_by, kind, platform, from_version, to_version, reason')
    .order('released_at', { ascending: false }).limit(200)
  if (error) throw new ServiceError(toUserMessage(error, 'Recorded releases could not be read.'), error.code, error)
  return data || []
}

export async function recordRollback({ platform = 'web', from, to, reason }) {
  return unwrap(await supabase.rpc('admin_record_rollback', { p_platform: platform, p_from: from || null, p_to: to, p_reason: reason }))
}

/** App errors logged before vs after each time, equal windows. */
export async function getReleaseErrorWindows(times = [], hours = 12) {
  const at = (times || []).filter(Boolean).map((t) => new Date(t).toISOString())
  if (!at.length) return []
  const d = readJson(await supabase.rpc('admin_release_error_windows', { p_at: at, p_hours: hours }), 'Errors before and after')
  return Array.isArray(d.items) ? d.items : []
}

/** Server errors logged in the last 24 hours (system_logs error + critical). */
export async function countErrors24h() {
  const since = new Date(Date.now() - 86400000).toISOString()
  const { count, error } = await supabase
    .from('system_logs').select('id', { count: 'exact', head: true })
    .in('severity', ['error', 'critical']).gte('created_at', since)
  if (error) throw new ServiceError(toUserMessage(error, 'Errors could not be counted.'), error.code, error)
  return count ?? null
}

/* ── feature flags ──────────────────────────────────────────────────────── */

export async function getFlagUsage() {
  return readJson(await supabase.rpc('admin_flag_usage'), 'Flag usage')
}

export async function listModulesWithKind() {
  const { data, error } = await supabase
    .from('modules')
    .select('module_id,name,category,status,visible_to,roles,depends_on,note,maintenance_until,maintenance_note,last_updated,updated_by,kind,created_at,review_after')
    .order('category').order('name')
  if (error) throw new ServiceError(toUserMessage(error, 'The module registry could not be read.'), error.code, error)
  return data || []
}

export async function listBooleanConfig() {
  const { data, error } = await supabase
    .from('system_config').select('key, value, updated_at, category, description').order('key')
  if (error) throw new ServiceError(toUserMessage(error, 'Platform switches could not be read.'), error.code, error)
  return data || []
}

export async function listFlagChanges(limit = 100) {
  const { data, error } = await supabase
    .from('flag_changes')
    .select('id,target_type,target_key,new_state,run_at,status,reason,requested_by,approved_by,approved_at,cancel_reason,applied_at,error,created_at')
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw new ServiceError(toUserMessage(error, 'Scheduled changes could not be read.'), error.code, error)
  return data || []
}

export async function scheduleFlagChange({ targetType, key, state, runAt, reason }) {
  return unwrap(await supabase.rpc('admin_schedule_flag_change', {
    p_target_type: targetType, p_target_key: key, p_new_state: state, p_run_at: new Date(runAt).toISOString(), p_reason: reason,
  }))
}

export async function approveFlagChange(id) {
  return unwrap(await supabase.rpc('admin_approve_flag_change', { p_id: id }))
}

export async function cancelFlagChange(id, reason) {
  return unwrap(await supabase.rpc('admin_cancel_flag_change', { p_id: id, p_reason: reason }))
}

/* ── AI administration summary ──────────────────────────────────────────── */

/** Calls in 30 days, all time, last call and priced spend in 30 days. */
export async function getAiStats() {
  const since = new Date(Date.now() - 30 * 86400000).toISOString()
  const [c30, all, last] = await Promise.all([
    supabase.from('ai_token_logs').select('id', { count: 'exact', head: true }).gte('created_at', since),
    supabase.from('ai_token_logs').select('id', { count: 'exact', head: true }),
    supabase.from('ai_token_logs').select('created_at').order('created_at', { ascending: false }).limit(1),
  ])
  const bad = [c30, all, last].find((r) => r.error)
  if (bad) throw new ServiceError(toUserMessage(bad.error, 'AI usage could not be read.'), bad.error.code, bad.error)
  let spend30 = null
  try {
    const { getUsageOverview } = await import('./aiOps')
    const o = await getUsageOverview({ days: 30 })
    spend30 = Number.isFinite(o?.summary?.totalCost) ? o.summary.totalCost : null
  } catch { spend30 = null }
  return { calls30: c30.count ?? null, total: all.count ?? null, last: last.data?.[0]?.created_at || null, spend30 }
}

/** Set a module's kind (release | permission | kill_switch) and review date. */
export async function setModuleKind(moduleId, kind, reviewAfter = null) {
  const allowed = ['release', 'permission', 'kill_switch']
  if (!allowed.includes(kind)) throw new ServiceError('That kind is not valid.')
  const { error } = await supabase.from('modules')
    .update({ kind, review_after: kind === 'release' ? (reviewAfter || null) : null })
    .eq('module_id', moduleId)
  if (error) throw new ServiceError(toUserMessage(error, 'The kind could not be saved.'), error.code, error)
  return true
}
