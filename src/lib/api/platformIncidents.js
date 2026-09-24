/**
 * Platform incident service (super-admin console only).
 *
 * Reads and writes go through the SECURITY DEFINER RPCs from
 * 20260924115000_platform_incidents.sql; each refuses anyone who is not a
 * super admin with 42501 and writes a console_sessions audit row.
 *
 * Signals are NOT copied: they come from the services that already own them
 * (system_logs via systemLogs.js, trust_alerts via lineageOps.js). Each signal
 * source reports whether it loaded, so an unreadable source says so instead of
 * reading as "no signals".
 */
import { supabase, unwrap } from './_client'
import { listSystemLogs } from './systemLogs'
import { listTrustAlerts } from './lineageOps'
import { SEVERITIES, STATUSES } from '../platformIncidents'

export async function listIncidents({ since = null, limit = 300 } = {}) {
  const data = unwrap(await supabase.rpc('admin_list_incidents', {
    p_since: since ? new Date(since).toISOString() : null,
    p_limit: limit,
  }))
  return Array.isArray(data) ? data : []
}

export async function openIncident({
  title, severity, impact = '', affected_modules = [], started_at = null,
  commander = null, source_type = null, source_ref = null, message = '',
} = {}) {
  const t = String(title || '').trim()
  if (t.length < 3) throw new Error('An incident needs a title of at least 3 characters.')
  if (!SEVERITIES.includes(severity)) throw new Error('Choose a severity.')
  const mods = (Array.isArray(affected_modules) ? affected_modules : String(affected_modules || '').split(','))
    .map((m) => String(m).trim()).filter(Boolean)
  return unwrap(await supabase.rpc('admin_open_incident', {
    p_title: t,
    p_severity: severity,
    p_impact: String(impact || '').trim() || null,
    p_affected_modules: mods,
    p_started_at: started_at ? new Date(started_at).toISOString() : null,
    p_commander: commander || null,
    p_source_type: source_type || null,
    p_source_ref: source_ref || null,
    p_message: String(message || '').trim() || null,
  }))
}

export async function postIncidentUpdate(incidentId, status, message) {
  const m = String(message || '').trim()
  if (!m) throw new Error('An update needs a message.')
  if (!STATUSES.includes(status)) throw new Error('Choose a status.')
  return unwrap(await supabase.rpc('admin_post_incident_update', {
    p_incident_id: incidentId,
    p_status: status,
    p_message: m,
  }))
}

/**
 * Recent signals worth opening an incident from: unresolved critical and error
 * system logs from the last `days`, and open trust alerts.
 * @returns {Promise<{logs: {ok, rows}, trust: {ok, rows}}>}
 */
export async function loadIncidentSignals({ days = 7, now = new Date() } = {}) {
  const since = new Date(now.getTime() - days * 86400000).toISOString()
  const [crit, err, trust] = await Promise.allSettled([
    listSystemLogs({ severity: 'critical', resolved: false, since, limit: 25 }),
    listSystemLogs({ severity: 'error', resolved: false, since, limit: 25 }),
    listTrustAlerts({ status: 'open' }),
  ])
  const logsOk = crit.status === 'fulfilled' && err.status === 'fulfilled'
  const logs = [
    ...(crit.status === 'fulfilled' ? crit.value : []),
    ...(err.status === 'fulfilled' ? err.value : []),
  ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 25)
  return {
    logs: { ok: logsOk, rows: logs },
    trust: { ok: trust.status === 'fulfilled', rows: trust.status === 'fulfilled' ? (trust.value || []).slice(0, 25) : [] },
  }
}
