/**
 * Email & alerts settings service: per-organisation recipients for each email
 * type (accident, assignment, sign-up, daily summary). Reads and writes go only
 * through the DEFINER RPCs get_email_event_settings / set_email_event_setting,
 * which check Admin + organisation and validate every address server side.
 */
import { supabase, unwrap, fetchAllPages } from './_client'

export const MAX_EXTERNAL = 10
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/

/** Client-side mirror of the server rule: real, single-line, not a synthetic login address. */
export function isDeliverableAddress(raw) {
  const e = String(raw || '').trim().toLowerCase()
  return e.length <= 254 && !/[\r\n]/.test(e) && EMAIL_RE.test(e) && !/@users\.tyrepulse\.app$/.test(e)
}

/** Splits a typed list (comma, semicolon, space or new line) into distinct lower-case addresses. */
export function parseAddressList(text) {
  return Array.from(new Set(String(text || '').split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean)))
}

export async function getEmailEventSettings() {
  const data = unwrap(await supabase.rpc('get_email_event_settings'))
  return Array.isArray(data) ? data : []
}

export async function setEmailEventSetting({ eventKey, enabled, roles, userIds, external, includeAssignee = true }) {
  const ext = Array.from(new Set((external || []).map(a => String(a).trim().toLowerCase()).filter(Boolean)))
  if (ext.length > MAX_EXTERNAL) throw new Error(`At most ${MAX_EXTERNAL} external addresses per email type.`)
  const bad = ext.find(a => !isDeliverableAddress(a))
  if (bad) throw new Error(`This address cannot receive email: ${bad}`)
  return unwrap(await supabase.rpc('set_email_event_setting', {
    p_event_key: eventKey,
    p_enabled: !!enabled,
    p_roles: roles || [],
    p_user_ids: userIds || [],
    p_external: ext,
    p_include_assignee: !!includeAssignee,
  }))
}

export async function sendTestEmail() {
  return unwrap(await supabase.rpc('send_test_email')) === true
}

/** People in the caller's organisation (RLS scopes the read) for the named-person picker. */
export async function listOrgPeople() {
  const { data, error } = await fetchAllPages((from, to) => supabase.from('profiles')
    .select('id, full_name, username, role')
    .eq('approved', true)
    .order('full_name', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to), { max: 5000 })
  if (error) unwrap({ data: null, error })
  return data || []
}

/** Acknowledge one notification: stops its reminder chain (owner-only server side). */
export async function ackNotification(notificationId) {
  if (!notificationId) return false
  const { data, error } = await supabase.rpc('ack_notification', { p_notification_id: notificationId })
  if (error) return false
  return data === true
}
