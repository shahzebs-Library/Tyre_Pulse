/**
 * consoleSessions - service boundary for the super-admin "Sessions & Devices"
 * console page. Two read surfaces + two write actions:
 *
 *   listConsoleSessions - recent rows from the console audit trail
 *                         (`console_sessions`), newest first.
 *   listUserDevices     - a lean `profiles` projection focused on login +
 *                         device (push token) state for every user.
 *   lockUser            - lock / unlock a user. REUSES the existing super-admin
 *                         path adminUpdateProfile (users.js); this module never
 *                         writes a second lock path.
 *   clearPushToken      - clear a user's push token via the V273 SECURITY
 *                         DEFINER RPC admin_clear_push_token (super-admin gated
 *                         in the database).
 *
 * Read helpers []-degrade: any error (missing relation, RLS, network) resolves
 * to [] so the page renders an honest empty state instead of crashing.
 */
import { supabase, unwrap } from './_client'
import { adminUpdateProfile } from './users'

const SESSION_COLS =
  'id, admin_id, action, target_id, target_type, details, ip_address, created_at'

const DEVICE_COLS =
  'id, full_name, username, role, country, locked, approved, last_login_at, login_count, push_token, push_token_updated_at'

/**
 * Recent console activity (audit trail). Super-admin readable; RLS is the
 * boundary. Returns [] on any error.
 *
 * @param {object} [params]
 * @param {number} [params.limit=200]  max rows
 * @returns {Promise<Array<object>>}
 */
export async function listConsoleSessions({ limit = 200 } = {}) {
  try {
    const { data, error } = await supabase
      .from('console_sessions')
      .select(SESSION_COLS)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

/**
 * Lean profiles projection for the Users & Devices table. `has_device` is
 * derived (push_token present) so the raw token is never surfaced to the UI.
 * Returns [] on any error.
 *
 * @returns {Promise<Array<object>>}
 */
export async function listUserDevices() {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(DEVICE_COLS)
      .order('last_login_at', { ascending: false, nullsFirst: false })
    if (error) return []
    return (Array.isArray(data) ? data : []).map((r) => ({
      id: r.id,
      full_name: r.full_name,
      username: r.username,
      role: r.role,
      country: r.country,
      locked: r.locked,
      approved: r.approved,
      last_login_at: r.last_login_at,
      login_count: r.login_count,
      has_device: r.push_token != null && r.push_token !== '',
      push_token_updated_at: r.push_token_updated_at,
    }))
  } catch {
    return []
  }
}

/**
 * Lock or unlock a user. Thin pass-through to the existing super-admin RPC
 * path (adminUpdateProfile -> admin_update_profile) - do NOT add a second lock
 * mechanism. The database enforces the super-admin gate.
 *
 * @param {string}  userId  target user's uuid
 * @param {boolean} locked  true to lock, false to unlock
 * @returns {Promise<void>}
 */
export async function lockUser(userId, locked) {
  return adminUpdateProfile({ p_user_id: userId, p_locked: !!locked })
}

/**
 * Clear a user's push notification token via the V273 SECURITY DEFINER RPC
 * admin_clear_push_token. Super-admin gated in the database (raises otherwise).
 *
 * @param {string} userId  target user's uuid
 * @returns {Promise<void>}
 */
export async function clearPushToken(userId) {
  return unwrap(
    await supabase.rpc('admin_clear_push_token', { p_user_id: userId }),
  )
}
