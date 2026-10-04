/**
 * monitorCenter.js - the Supabase boundary for the Control Center MONITOR screens:
 * Error Center, Alert Center, Analytics, Notifications and Operations.
 *
 * Every read is a super-admin SECURITY DEFINER RPC (migrations 20260930160000 to
 * 20260930164000, plus admin_cron_* from the Developer Center migration, reused,
 * not duplicated). Every write goes through an audited RPC; nothing here writes a
 * table directly except announcements and system_config, which RLS already limits
 * to super admins and which the old pages wrote the same way.
 *
 * Errors: a failed read throws a sanitised ServiceError (toUserMessage), so a page
 * shows "could not load" with Retry and never shows a failed read as zero.
 */
import { supabase, ServiceError } from './_client'
import { toUserMessage } from '../safeError'

async function rpc(name, args, fallback) {
  let res
  try { res = await supabase.rpc(name, args) } catch (err) {
    throw new ServiceError(toUserMessage(err, fallback), err?.code, err)
  }
  if (res?.error) throw new ServiceError(toUserMessage(res.error, fallback), res.error?.code, res.error)
  const d = res?.data
  if (d && typeof d === 'object' && d.ok === false) {
    throw new ServiceError(fallback, 'not_ok', d)
  }
  return d
}

/* ── Error Center ─────────────────────────────────────────────────────────── */

export const getErrorGroups = (days = null) =>
  rpc('get_error_groups', { p_days: days }, 'The error groups could not be loaded.')

export const setErrorGroupState = ({ key, status = null, owner = null, version = null, note = null, notify = null, reason = null }) =>
  rpc('set_error_group_state', {
    p_key: key, p_status: status, p_owner: owner, p_version: version, p_note: note, p_notify: notify, p_reason: reason,
  }, 'The error group could not be updated. Nothing was changed.')

export const resolveErrorGroups = (keys, reason) =>
  rpc('resolve_error_groups', { p_keys: keys, p_reason: reason }, 'The error groups could not be resolved. Nothing was changed.')

/** Optional, built by another screen: problem report summary. Null when absent. */
export async function getUserIssueSummary() {
  try {
    const { data, error } = await supabase.rpc('get_user_issue_summary')
    if (error) return null
    return data || null
  } catch { return null }
}

/* ── Alert Center ─────────────────────────────────────────────────────────── */

export const getAlertInbox = () => rpc('get_alert_inbox', {}, 'The alert inbox could not be loaded.')

export const setAlertState = ({ keys, action, owner = null, snoozeHours = null, reason = null }) =>
  rpc('set_alert_state', {
    p_keys: keys, p_action: action, p_owner: owner, p_snooze_hours: snoozeHours, p_reason: reason,
  }, 'The alert could not be changed. Nothing was changed.')

/* ── Analytics ────────────────────────────────────────────────────────────── */

export const getPlatformActivity = () => rpc('get_platform_activity', {}, 'Platform activity could not be loaded.')

/* ── Notifications ────────────────────────────────────────────────────────── */

export const getNotificationHealth = () => rpc('get_notification_health', {}, 'Notification health could not be loaded.')

/**
 * Sign-in reach of an audience (accounts, signed in within 30 days, push
 * reachable). The composer itself sends through broadcast_send, whose own
 * preview decides who is told; this adds the "will they actually see it" line.
 */
export const getAnnouncementAudience = (roles = null, countries = null) =>
  rpc('announcement_audience', {
    p_roles: roles && roles.length ? roles : null,
    p_countries: countries && countries.length ? countries : null,
  }, 'The audience could not be counted.')

/* ── Operations (scheduled jobs) ──────────────────────────────────────────── */

export const getCronHealth = (days = 7) => rpc('admin_cron_health', { p_days: days }, 'Scheduled jobs could not be loaded.')

export const getCronLastFailures = () => rpc('admin_cron_last_failures', {}, 'Job history could not be loaded.')

export const setCronActive = (jobid, active, reason) =>
  rpc('admin_cron_set_active', { p_jobid: jobid, p_active: active, p_reason: reason }, 'The job could not be changed. Nothing was changed.')

export const runCronNow = (jobid, reason) =>
  rpc('admin_cron_run_now', { p_jobid: jobid, p_reason: reason }, 'The job could not be started. Nothing was changed.')

/* ── import batches (read only, RLS limits to super admin / Admin) ────────── */

export async function listImportBatches(limit = 200) {
  const { data, error } = await supabase
    .from('import_batches')
    .select('id,module,country,site,source_system,import_status,approval_status,total_rows,imported_rows,skipped_rows,duplicate_rows,error_rows,uploader,created_by,created_at,completed_at,file_id')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new ServiceError(toUserMessage(error, 'Import batches could not be loaded.'), error.code, error)
  return data || []
}

/* ── people who can own an error or alert (super admins) ──────────────────── */

export { listCommanderProfiles as listOwnerProfiles } from './platformIncidents'
