/**
 * sentryCrashes.js - super-admin service for the /console Crash Reports page.
 *
 * The Sentry auth token is a secret and is NEVER handled client-side: it is
 * stored server-side in the deny-all cron_config table via the super-admin RPC
 * `set_sentry_config` and read only by the `sentry-issues` edge function (service
 * role). This layer can read a "configured / not configured" status but never the
 * token. All errors are routed through toUserMessage so no raw backend detail
 * (SQL, endpoints, tokens) can reach the UI.
 */
import { supabase } from './_client'
import { toUserMessage } from '../safeError'

/** { configured, org, region_url, project } - never returns the token. */
export async function getSentryStatus() {
  const { data, error } = await supabase.rpc('get_sentry_config_status')
  if (error) throw new Error(toUserMessage(error, 'Could not load Sentry settings.'))
  return data || { configured: false, org: 'shah-profile', region_url: 'https://de.sentry.io', project: '' }
}

/** Save the Sentry connection. A blank token keeps the existing one. */
export async function saveSentryConfig({ token, org, regionUrl, project } = {}) {
  const { data, error } = await supabase.rpc('set_sentry_config', {
    p_token: token && token.trim() ? token.trim() : null,
    p_org: org ?? null,
    p_region_url: regionUrl ?? null,
    p_project: project ?? null,
  })
  if (error) throw new Error(toUserMessage(error, 'Could not save Sentry settings.'))
  return data
}

/**
 * List Sentry issues via the edge proxy. Returns the raw payload:
 *   { ok:true, org, issues:[...] } | { ok:false, reason:'not_configured'|'auth'|'unauthorized'|'error' }
 */
export async function listSentryIssues({ query, period } = {}) {
  const { data, error } = await supabase.functions.invoke('sentry-issues', {
    body: { query: query || 'is:unresolved', period: period || '14d' },
  })
  if (error) throw new Error(toUserMessage(error, 'Could not load crash reports.'))
  return data || { ok: false, reason: 'error' }
}
