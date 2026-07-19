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
export async function listSentryIssues({ query, period, project } = {}) {
  const { data, error } = await supabase.functions.invoke('sentry-issues', {
    body: { action: 'list', query: query || 'is:unresolved', period: period || '14d', project: project || '' },
  })
  if (error) throw new Error(toUserMessage(error, 'Could not load crash reports.'))
  return data || { ok: false, reason: 'error' }
}

/** The org's Sentry projects: { ok, projects:[{id,slug,name,platform}] }. */
export async function getSentryProjects() {
  const { data, error } = await supabase.functions.invoke('sentry-issues', { body: { action: 'projects' } })
  if (error) throw new Error(toUserMessage(error, 'Could not load Sentry projects.'))
  return data || { ok: false, reason: 'error' }
}

/** Full detail for one issue: { ok, issue, event:{ exceptions, tags, user, dateCreated } }. */
export async function getSentryIssueDetail(issueId) {
  const { data, error } = await supabase.functions.invoke('sentry-issues', { body: { action: 'detail', issueId } })
  if (error) throw new Error(toUserMessage(error, 'Could not load the crash details.'))
  return data || { ok: false, reason: 'error' }
}

/** Change an issue's status: 'resolved' | 'ignored' | 'unresolved'. */
export async function updateSentryIssue(issueId, status) {
  const { data, error } = await supabase.functions.invoke('sentry-issues', { body: { action: 'update', issueId, status } })
  if (error) throw new Error(toUserMessage(error, 'Could not update the issue.'))
  return data || { ok: false, reason: 'error' }
}

/** Org members for the assignee picker: { ok, members:[{userId,name,email,role}] }. */
export async function getSentryMembers() {
  const { data, error } = await supabase.functions.invoke('sentry-issues', { body: { action: 'members' } })
  if (error) throw new Error(toUserMessage(error, 'Could not load Sentry members.'))
  return data || { ok: false, reason: 'error' }
}

/** Assign an issue. `assignee` = 'user:<id>' or '' to clear. */
export async function assignSentryIssue(issueId, assignee) {
  const { data, error } = await supabase.functions.invoke('sentry-issues', { body: { action: 'assign', issueId, assignee } })
  if (error) throw new Error(toUserMessage(error, 'Could not assign the issue.'))
  return data || { ok: false, reason: 'error' }
}

/** Add a comment/note to an issue. */
export async function commentSentryIssue(issueId, text) {
  const { data, error } = await supabase.functions.invoke('sentry-issues', { body: { action: 'comment', issueId, text } })
  if (error) throw new Error(toUserMessage(error, 'Could not add the comment.'))
  return data || { ok: false, reason: 'error' }
}
