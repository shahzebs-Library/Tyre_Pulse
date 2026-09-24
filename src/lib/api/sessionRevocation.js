/**
 * Session revocation ("force sign-out everywhere") for the super-admin console.
 *
 * Calls the self-validating edge function `admin-revoke-sessions`, which deletes
 * every auth session (refresh token) for the target user, optionally locks the
 * account, and writes an access_audit + console_sessions record in one DB
 * transaction. Only a super admin can call it; the server re-checks.
 *
 * LIMIT: an access token already issued stays valid until it expires (up to
 * 1 hour by default). Revocation stops it from ever being renewed.
 */
import { supabase } from '../supabase'
import { toUserMessage } from '../safeError'

export const REVOCATION_FUNCTION = 'admin-revoke-sessions'

/** Plain-English copy for the UI about the access-token window. */
export const ACCESS_TOKEN_NOTE =
  'All sign-ins are ended now. A page the user already has open can keep working for up to 1 hour, until its current access token expires; it cannot be renewed.'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FALLBACK = 'Could not revoke sessions. Please try again.'

/**
 * Read the JSON `error` string an edge function returned in its body.
 * Returns null for transport-level failures (no readable body).
 * @param {any} err - error from supabase.functions.invoke
 * @returns {Promise<string|null>}
 */
export async function readFunctionError(err) {
  try {
    const res = err?.context
    if (res && typeof res.json === 'function') {
      const source = typeof res.clone === 'function' ? res.clone() : res
      const parsed = await source.json().catch(() => null)
      if (parsed && typeof parsed.error === 'string' && parsed.error) return parsed.error
    }
  } catch {
    /* fall through */
  }
  return null
}

/**
 * Force sign-out of every session for one user.
 *
 * @param {string} userId - target profile / auth user id
 * @param {{ reason: string, lock?: boolean }} opts
 * @returns {Promise<{ ok: true, sessionsRevoked: number, locked: boolean, note: string }
 *                  | { ok: false, error: string }>}
 */
export async function revokeUserSessions(userId, { reason, lock = false } = {}) {
  const id = typeof userId === 'string' ? userId.trim() : ''
  const why = typeof reason === 'string' ? reason.trim() : ''
  if (!UUID_RE.test(id)) return { ok: false, error: 'A valid user is required.' }
  if (why.length < 3) return { ok: false, error: 'Please give a reason (at least 3 characters).' }
  if (why.length > 500) return { ok: false, error: 'The reason is too long (500 characters maximum).' }

  try {
    const { data, error } = await supabase.functions.invoke(REVOCATION_FUNCTION, {
      body: { user_id: id, reason: why, lock: lock === true },
    })
    if (error) {
      const serverMsg = await readFunctionError(error)
      return { ok: false, error: toUserMessage(serverMsg ? new Error(serverMsg) : error, FALLBACK) }
    }
    if (!data || data.ok !== true) {
      const msg = data && typeof data.error === 'string' ? data.error : null
      return { ok: false, error: toUserMessage(msg ? new Error(msg) : null, FALLBACK) }
    }
    return {
      ok: true,
      sessionsRevoked: Number.isFinite(Number(data.sessions_revoked)) ? Number(data.sessions_revoked) : 0,
      locked: data.locked === true,
      note: typeof data.note === 'string' && data.note ? data.note : ACCESS_TOKEN_NOTE,
    }
  } catch (err) {
    return { ok: false, error: toUserMessage(err, FALLBACK) }
  }
}

export default revokeUserSessions
