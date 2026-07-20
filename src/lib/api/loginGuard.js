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
