/**
 * authAssurance - one place that answers "is this Supabase session actually a
 * COMPLETED login?".
 *
 * Supabase establishes a live session the moment a password is accepted
 * (assurance level AAL1). If the account has TOTP/MFA enrolled, that session is
 * only HALF authenticated until the second factor is verified (AAL2). Because
 * the whole app shares one Supabase client + one localStorage session across
 * every tab AND the admin Console, a password-only session would otherwise:
 *   - expose all data in a main-app tab that never completed the 2FA step, and
 *   - propagate across tabs so a Console login "logs in" the main app with no
 *     click.
 * Every surface (main AuthContext, ConsoleAuthContext) must therefore refuse a
 * session whose required assurance level has not been reached.
 *
 * Fails OPEN (returns false = "no unmet MFA") on any error: the check only
 * gates users who actually have MFA enrolled, and a transient decode/list error
 * must never lock a normal (no-MFA) user out of their own account. RLS remains
 * the server-side data boundary regardless.
 */
import { supabase } from './supabase'

/**
 * True when the current session has MFA enrolled but has NOT completed it
 * (currentLevel aal1 while nextLevel aal2). Such a session is a password-only
 * half-login and must not be treated as authenticated by any surface.
 * @returns {Promise<boolean>}
 */
export async function hasUnmetMfa() {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (error || !data) return false
    return data.nextLevel === 'aal2' && data.currentLevel !== 'aal2'
  } catch {
    return false
  }
}
