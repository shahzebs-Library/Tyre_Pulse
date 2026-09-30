/**
 * userIssues service - "Report a problem" (Problem Tracking, Phase 1).
 *
 * Writes go ONLY through SECURITY DEFINER RPCs (migration
 * 20260930150000_user_issues.sql): the server stamps reporter, company,
 * country, site and time, and attaches the reporter's own recent error logs.
 * Reads use the tables under RLS: a reporter sees their own reports, an
 * Admin sees their company's, a super admin sees every company's.
 *
 * Errors: server refusals written for people (SAFE_SERVER_MESSAGES) are shown as
 * is; anything else goes through toUserMessage so no database text leaks.
 */
import { supabase } from './_client'
import { toUserMessage } from '../safeError'
import { SAFE_SERVER_MESSAGES, describeClient, webAppVersion, validateIssueInput, shapeIssueSummary } from '../problemReport'

export const USER_ISSUE_COLS =
  'id,organisation_id,country,site,reporter_id,platform,app_version,device,os,page_or_screen,' +
  'description,category,severity,reference_id,linked_log_ids,linked_sentry_ids,status,assignee_id,' +
  'fixed_in_version,sla_due_at,first_response_at,resolved_at,sla_breach_notified_at,created_at,updated_at'

export const USER_ISSUE_EVENT_COLS = 'id,issue_id,actor_id,event_type,from_value,to_value,note,created_at'

/** Turn any failure into an Error whose message is safe to show. */
export function issueError(err, fallback) {
  const raw = typeof err?.message === 'string' ? err.message.trim() : ''
  if (raw && SAFE_SERVER_MESSAGES.has(raw)) return new Error(raw)
  return new Error(toUserMessage(err, fallback))
}

async function rpc(name, args, fallback) {
  let res
  try {
    res = await supabase.rpc(name, args)
  } catch (err) {
    throw issueError(err, fallback)
  }
  if (res?.error) throw issueError(res.error, fallback)
  return res?.data
}

/** The context the web app attaches to every report. Never throws. */
export function currentWebContext() {
  const client = describeClient(typeof navigator !== 'undefined' ? navigator.userAgent : '')
  let page = null
  try { page = typeof location !== 'undefined' ? location.pathname : null } catch { page = null }
  return {
    platform: 'web',
    app_version: webAppVersion(),
    device: client.device,
    os: client.os,
    page,
  }
}

/**
 * Submit a report. Validates first so the user sees a clear message before any
 * round trip. Returns { id, linkedLogs }.
 */
export async function submitUserIssue({ description, category, severity, referenceId, context } = {}) {
  const check = validateIssueInput({ description, category, severity })
  if (!check.ok) throw new Error(Object.values(check.errors)[0])
  const ctx = context || currentWebContext()
  const data = await rpc('submit_user_issue', {
    p_description: check.value.description,
    p_category: check.value.category,
    p_severity: check.value.severity,
    p_platform: ctx.platform || 'web',
    p_app_version: ctx.app_version || null,
    p_device: ctx.device || null,
    p_os: ctx.os || null,
    p_page: ctx.page || null,
    p_reference_id: referenceId || null,
  }, 'Your report could not be sent. Please try again.')
  if (!data?.ok) throw new Error('Your report could not be sent. Please try again.')
  return { id: data.id, linkedLogs: Number(data.linked_logs) || 0 }
}

/** Reports visible to the caller, newest first, with reporter / owner names. */
export async function listUserIssues({ limit = 500 } = {}) {
  const { data, error } = await supabase.from('user_issues')
    .select(USER_ISSUE_COLS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)
  if (error) throw issueError(error, 'Reported problems could not be loaded.')
  const rows = Array.isArray(data) ? data : []
  const ids = [...new Set(rows.flatMap((r) => [r.reporter_id, r.assignee_id]).filter(Boolean))]
  const orgIds = [...new Set(rows.map((r) => r.organisation_id).filter(Boolean))]
  const [names, orgs] = await Promise.all([profileNames(ids), orgNames(orgIds)])
  return rows.map((r) => ({
    ...r,
    reporter_name: names.get(r.reporter_id) || null,
    assignee_name: names.get(r.assignee_id) || null,
    org_name: orgs.get(r.organisation_id) || null,
  }))
}

async function profileNames(ids) {
  const out = new Map()
  if (!ids.length) return out
  try {
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase.from('profiles')
        .select('id,full_name,username').in('id', ids.slice(i, i + 200))
      for (const p of data || []) out.set(p.id, p.full_name || p.username || null)
    }
  } catch { /* names are a convenience; the list still renders */ }
  return out
}

async function orgNames(ids) {
  const out = new Map()
  if (!ids.length) return out
  try {
    const { data } = await supabase.from('organisations').select('id,name').in('id', ids)
    for (const o of data || []) out.set(o.id, o.name || null)
  } catch { /* optional */ }
  return out
}

/** History rows for one report, oldest first. */
export async function listIssueEvents(issueId) {
  const { data, error } = await supabase.from('user_issue_events')
    .select(USER_ISSUE_EVENT_COLS)
    .eq('issue_id', issueId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw issueError(error, 'The history could not be loaded.')
  const rows = Array.isArray(data) ? data : []
  const names = await profileNames([...new Set(rows.map((r) => r.actor_id).filter(Boolean))])
  return rows.map((r) => ({ ...r, actor_name: names.get(r.actor_id) || null }))
}

/** The error logs attached to a report (admin only, served by an RPC). */
export async function getIssueLogs(issueId) {
  const data = await rpc('get_user_issue_logs', { p_id: issueId }, 'The linked errors could not be loaded.')
  return Array.isArray(data) ? data : []
}

export async function setIssueStatus(issueId, status, { fixedInVersion, note } = {}) {
  return rpc('set_user_issue_status', {
    p_id: issueId,
    p_status: status,
    p_fixed_in_version: fixedInVersion || null,
    p_note: note || null,
  }, 'The status could not be changed.')
}

export async function assignIssue(issueId, assigneeId) {
  return rpc('assign_user_issue', { p_id: issueId, p_assignee_id: assigneeId || null },
    'The owner could not be changed.')
}

export async function commentIssue(issueId, note) {
  if (!note || !String(note).trim()) throw new Error('Write a note first')
  return rpc('comment_user_issue', { p_id: issueId, p_note: String(note).trim() },
    'The note could not be saved.')
}

/** People who can own a report: super admins and Admins. */
export async function listIssueOwners() {
  try {
    const { data } = await supabase.from('profiles')
      .select('id,full_name,username,role,is_super_admin,organisation_id,org_id,locked')
      .or('is_super_admin.eq.true,role.eq.Admin')
      .limit(200)
    return (data || []).filter((p) => !p.locked)
      .map((p) => ({ ...p, name: p.full_name || p.username || 'Unnamed' }))
  } catch {
    return []
  }
}

/** Columns the reporter's own page needs (no linked log ids, no owner id). */
export const MY_ISSUE_COLS =
  'id,platform,app_version,page_or_screen,description,category,severity,reference_id,status,' +
  'fixed_in_version,sla_due_at,first_response_at,resolved_at,created_at,updated_at'

/**
 * The signed-in user's OWN reports, newest first. RLS already limits a normal
 * user to their own rows, but an Admin also sees the company's, so the page
 * filters on reporter_id explicitly: "my problems" means mine.
 */
export async function listMyIssues(userId, { limit = 200 } = {}) {
  if (!userId) return []
  const { data, error } = await supabase.from('user_issues')
    .select(MY_ISSUE_COLS)
    .eq('reporter_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)
  if (error) throw issueError(error, 'Your reported problems could not be loaded.')
  return Array.isArray(data) ? data : []
}

/** Super-admin summary for the Error Center (read only). */
export async function getUserIssueSummary() {
  const data = await rpc('get_user_issue_summary', {}, 'The problem summary could not be loaded.')
  return shapeIssueSummary(data)
}
