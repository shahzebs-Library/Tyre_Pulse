/**
 * loginGuard.js — client boundary for the server-enforced account lockout
 * (System Configuration -> Max Login Attempts / max_login_attempts, V287).
 *
 * The DB keeps the authoritative counter (public.login_attempts) and locks an
 * identifier after N failed attempts within a rolling window. This is DISTINCT
 * from the in-memory exponential backoff in Login.jsx (a per-tab UX nicety that
 * resets on reload) — this survives reloads and is admin-configurable.
 *
 * All three helpers FAIL SAFE: any error resolves to "not locked" so a transient
 * RPC failure can never block a legitimate sign-in (the real boundary is that a
 * failed password never authenticates; the lock just slows brute force).
 */
import { supabase } from './_client'

/** Pre-auth probe: is this identifier currently locked? */
export async function loginAttemptStatus(identifier) {
  try {
    const { data, error } = await supabase.rpc('login_attempt_status', { p_identifier: String(identifier || '') })
    if (error) return { enabled: false, locked: false }
    return data || { enabled: false, locked: false }
  } catch {
    return { enabled: false, locked: false }
  }
}

/** Record one failed password attempt; returns the resulting lock state. */
export async function recordLoginFailure(identifier) {
  try {
    const { data, error } = await supabase.rpc('record_login_failure', { p_identifier: String(identifier || '') })
    if (error) return { enabled: false, locked: false }
    return data || { enabled: false, locked: false }
  } catch {
    return { enabled: false, locked: false }
  }
}

/** Clear the signed-in user's own counter after a successful login (authed). */
export async function resetLoginAttempts() {
  try { await supabase.rpc('reset_login_attempts') } catch { /* best-effort */ }
}

/** Human-friendly minutes label from a retry_after_seconds value (min 1). */
export function lockMinutes(status) {
  const s = Number(status?.retry_after_seconds) || 0
  return Math.max(1, Math.ceil(s / 60))
}

/**
 * Username / employee-id sign-in through the `sign-in` edge function.
 *
 * The function resolves the account's email server-side (it is never sent to
 * the browser), checks and RECORDS the V287 lockout itself, and returns a
 * session only after a correct password. Every refusal comes back with
 * `counted: true` so the login page does not record the same failure again.
 *
 * Resolves to `{ session }` or `{ error }` where error is one of:
 *   { code: 'invalid_credentials', counted: true }  unknown user OR wrong password
 *   { code: 'login_locked', counted: true, retry_after_seconds }
 *   { code: 'captcha_failed' }
 *   { code: 'auth_unavailable' }                     backend busy/down, not counted
 */
export async function signInWithIdentifier(identifier, password, captchaToken) {
  let data
  let error
  try {
    ({ data, error } = await supabase.functions.invoke('sign-in', {
      body: {
        identifier: String(identifier || ''),
        password: String(password || ''),
        ...(captchaToken ? { captcha_token: captchaToken } : {}),
      },
    }))
  } catch {
    return { error: { code: 'auth_unavailable' } }
  }
  if (!error && data?.access_token && data?.refresh_token) return { session: data }

  let body = data && typeof data === 'object' ? data : null
  if (error?.context && typeof error.context.json === 'function') {
    body = await error.context.clone().json().catch(() => null)
  }
  const reason = body?.error
  if (reason === 'invalid_credentials') return { error: { code: 'invalid_credentials', counted: true, message: 'Invalid login credentials' } }
  if (reason === 'locked') {
    return { error: { code: 'login_locked', counted: true, retry_after_seconds: Number(body?.retry_after_seconds) || 0 } }
  }
  if (reason === 'captcha_failed') return { error: { code: 'captcha_failed' } }
  return { error: { code: 'auth_unavailable' } }
}
