/**
 * orgInvitations.js - client boundary for company invitations (TEN-9 / TEN-8b).
 *
 * Server objects (all already in production, read from pg_proc):
 *   org_invite_member(p_email text, p_role text, p_days int) -> jsonb
 *       Admin of the caller's company (or a super admin). Returns the one-time
 *       invite_token; the table keeps only its sha256, so the link can be shown
 *       once and never again.
 *   org_revoke_invitation(p_id uuid) -> jsonb { ok }
 *   get_invitation_preview(p_token text) -> jsonb (anon-callable)
 *       { ok:true, organisation_name, company_code, role, email_required, expires_at }
 *       or { ok:false, reason: invalid|revoked|used|expired|unavailable }
 *   org_invitations (table) - RLS: Admin of own company / super admin may read.
 *
 * A sign-up that carries the token in its metadata (invite_token) is placed in
 * the invitation's company, approved, with the invited role, by
 * _signup_context inside handle_new_user. That works in single-company mode
 * too: the invitation names the company, so nothing about it is a default.
 */
import { supabase, toServiceError } from './_client'

/** Columns safe to read: never token_hash. */
const LIST_COLS = 'id, email, role, is_owner, expires_at, accepted_at, revoked_at, created_at'

/** Reasons the server may return for a link that does not work. */
export const INVITE_REASONS = ['invalid', 'revoked', 'used', 'expired', 'unavailable']

/** How long a link may live: the server clamps to 1..30 days. */
export const INVITE_DAY_OPTIONS = [1, 3, 7, 14, 30]

/**
 * Status of one invitation row. The order matters and mirrors
 * get_invitation_preview: revoked, then used, then expired, then waiting.
 */
export function invitationStatus(row, now = new Date()) {
  if (!row) return 'expired'
  if (row.revoked_at) return 'revoked'
  if (row.accepted_at) return 'accepted'
  const exp = row.expires_at ? new Date(row.expires_at) : null
  if (!exp || Number.isNaN(exp.getTime()) || exp.getTime() <= new Date(now).getTime()) return 'expired'
  return 'pending'
}

/** Only a waiting invitation can be cancelled. */
export function canRevoke(row, now = new Date()) {
  return invitationStatus(row, now) === 'pending'
}

/** The link a person opens to join. The token travels in the path, never a query log. */
export function buildInviteUrl(token, origin) {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '')
  return `${String(base).replace(/\/+$/, '')}/invite/${encodeURIComponent(String(token || ''))}`
}

/** True when a token has the shape the server accepts (32 to 200 characters). */
export function isPlausibleInviteToken(token) {
  const v = String(token ?? '').trim()
  return v.length >= 32 && v.length <= 200
}

/**
 * Read an invitation by its token. Never throws: a network failure returns
 * { ok:false, reason:'error' } so the page can offer a retry instead of
 * telling the person their link is bad.
 */
export async function getInvitationPreview(token) {
  const v = String(token ?? '').trim()
  if (!isPlausibleInviteToken(v)) return { ok: false, reason: 'invalid' }
  try {
    const { data, error } = await supabase.rpc('get_invitation_preview', { p_token: v })
    if (error || !data || typeof data !== 'object') return { ok: false, reason: 'error' }
    if (data.ok === true) return data
    return { ok: false, reason: INVITE_REASONS.includes(data.reason) ? data.reason : 'invalid' }
  } catch {
    return { ok: false, reason: 'error' }
  }
}

/** Create an invitation in the caller's own company. Throws a ServiceError. */
export async function createInvitation({ email = null, role = 'Reporter', days = 7 } = {}) {
  const { data, error } = await supabase.rpc('org_invite_member', {
    p_email: email && String(email).trim() ? String(email).trim() : null,
    p_role: role,
    p_days: days,
  })
  if (error) throw toServiceError(error, 'The invitation could not be created.')
  if (!data?.invite_token) throw toServiceError(null, 'The invitation could not be created.')
  return data
}

/** Cancel a waiting invitation. Resolves true only when exactly one row changed. */
export async function revokeInvitation(id) {
  const { data, error } = await supabase.rpc('org_revoke_invitation', { p_id: id })
  if (error) throw toServiceError(error, 'The invitation could not be cancelled.')
  return data?.ok === true
}

/** The newest invitations of the caller's company (RLS decides which rows). */
export async function listInvitations({ limit = 200 } = {}) {
  const { data, error } = await supabase
    .from('org_invitations')
    .select(LIST_COLS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(Math.min(Math.max(Number(limit) || 200, 1), 500))
  if (error) throw toServiceError(error, 'Could not load the invitations.')
  return data || []
}
