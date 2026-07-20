/**
 * Support Sessions service - the single Supabase boundary for the platform-owner
 * SUPPORT SESSION flow (V318). A support session is a time-boxed, reason-
 * required, read-only-by-default, fully-audited authorization for a super-admin
 * to inspect ONE customer organisation's data during a support engagement.
 *
 * AUTH-SENSITIVE: every RPC self-gates on is_super_admin() in the database and
 * raises for anyone else; this layer never re-implements the gate, it only
 * relocates the call and normalises error surfacing (no raw Supabase errors
 * reach the UI).
 *
 * IMPORTANT: opening a session only RECORDS/authorizes it and writes a console
 * audit row. It does NOT (yet) change what data the reads return - wiring an
 * active session into app_current_org()/RLS is a deliberate, separate follow-up
 * (see the V318 migration header). Treat getCurrentSupportSession() as advisory.
 */
import { supabase, unwrap } from './_client'

/**
 * True when the failure is "the RPC / table is not provisioned yet"
 * (pre-migration), the caller is not a super-admin, or a plain read error we
 * want the caller to degrade over rather than surface raw.
 */
export function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' ||        // undefined_table
    code === '42883' ||        // undefined_function (RPC not deployed yet)
    code === 'PGRST202' ||     // PostgREST: could not find the function
    code === 'PGRST205' ||     // PostgREST: could not find the table
    code === '42501' ||        // insufficient_privilege (not a super-admin)
    msg.includes('does not exist') ||
    msg.includes('could not find') ||
    msg.includes('schema cache')
  )
}

/**
 * Open a support session for a target org via `start_support_session`.
 * Super-admin only (DB raises otherwise). Writes a console audit row.
 *
 * @param {string} targetOrgId          the organisation to inspect (uuid)
 * @param {string} reason               free-text justification (required)
 * @param {number} [minutes=30]         time box in minutes (clamped 1..480 in DB)
 * @param {'read_only'|'edit'} [mode='read_only']
 * @returns {Promise<{
 *   id: string, super_admin_id: string, target_org_id: string, reason: string,
 *   mode: string, started_at: string, expires_at: string|null,
 *   ended_at: string|null, active: boolean, created_at: string
 * }>} the new session row
 */
export async function startSupportSession(targetOrgId, reason, minutes = 30, mode = 'read_only') {
  return unwrap(
    await supabase.rpc('start_support_session', {
      p_target_org: targetOrgId,
      p_reason: reason,
      p_minutes: minutes,
      p_mode: mode,
    }),
  )
}

/**
 * Close a support session the caller owns via `end_support_session`.
 * Super-admin only. Idempotent. Writes a console audit row.
 *
 * @param {string} id  the support session uuid
 * @returns {Promise<object>} the closed session row
 */
export async function endSupportSession(id) {
  return unwrap(
    await supabase.rpc('end_support_session', { p_id: id }),
  )
}

/**
 * Read the caller's active, non-expired support session (target org + mode) via
 * `current_support_session`. Returns the session row or null when there is none.
 * Degrades to null when the RPC is missing, the caller is not a super-admin, or
 * any other read error occurs, so callers can render an honest "no active
 * session" state instead of surfacing a raw error.
 *
 * @returns {Promise<object|null>}
 */
export async function getCurrentSupportSession() {
  try {
    const data = unwrap(await supabase.rpc('current_support_session'))
    // The RPC returns a single row (or none); normalise array/scalar/empty.
    if (Array.isArray(data)) return data[0] || null
    return data || null
  } catch {
    return null
  }
}
