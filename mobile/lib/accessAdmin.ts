/**
 * Super-Admin Access Console service (mobile).
 *
 * Thin data layer for the super-admin "Access Control" screen: list users and
 * read / write their PER-USER mobile module grants. Mobile grants are namespaced
 * in `user_access_grants.module_key` with the `mobile:` prefix (see permissions.ts
 * MOBILE_GRANT_PREFIX / mobileGrantKey) so they are INDEPENDENT of the web app's
 * access grants and of the checklist Approvals flow.
 *
 * Backend (already exists, no migration):
 *   - table  public.user_access_grants (super-admin SELECT/mutate via RLS)
 *   - rpc    set_user_access_grant(p_user_id, p_module_key, p_capability,
 *                                  p_effect, p_note, p_expires_at)
 *   - rpc    revoke_user_access_grant(p_id)
 *
 * All calls are wrapped: a genuinely missing backend (relation/function absent)
 * degrades to an empty result for reads, and any real failure surfaces as a clean
 * Error the UI can show - never a raw thrown PostgREST object.
 */

import { supabase } from './supabase'
import { ModuleKey, mobileGrantKey, MOBILE_GRANT_PREFIX } from './permissions'

// ── Types ────────────────────────────────────────────────────────────────────

export interface AdminUserRow {
  id: string
  full_name: string | null
  username: string | null
  role: string | null
  email: string | null
  site: string | null
  approved: boolean | null
}

export type GrantEffect = 'grant' | 'revoke'

/** One stored override for a module (carries the row id so it can be cleared). */
export interface MobileGrantEntry {
  id: string
  effect: GrantEffect
}

/** Map of ModuleKey (mobile: prefix stripped) -> stored override. */
export type MobileGrantEntryMap = Partial<Record<ModuleKey, MobileGrantEntry>>

// ── Error helpers ─────────────────────────────────────────────────────────────

interface PgError { message?: string; code?: string; details?: string }

/** A missing table / function (backend not provisioned) - degrade, don't error. */
function isMissingBackend(err: PgError | null | undefined): boolean {
  if (!err) return false
  const code = err.code ?? ''
  // 42P01 = undefined_table, 42883 = undefined_function, PGRST202 = no such rpc
  if (code === '42P01' || code === '42883' || code === 'PGRST202') return true
  const m = (err.message ?? '').toLowerCase()
  return m.includes('does not exist') || m.includes('could not find')
}

function friendlyError(err: PgError | null | undefined, fallback: string): Error {
  const code = err?.code ?? ''
  if (code === '42501' || (err?.message ?? '').toLowerCase().includes('permission')) {
    return new Error('You do not have permission to change access.')
  }
  return new Error(fallback)
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * List all profiles for the user picker. Returns [] if the backend is missing;
 * throws a clean Error on a real failure so the screen can show a retry state.
 */
export async function listUsers(): Promise<AdminUserRow[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, username, role, email, site, approved')
    .order('full_name', { ascending: true })
    .limit(500)
  if (error) {
    if (isMissingBackend(error)) return []
    throw friendlyError(error, 'Could not load users.')
  }
  return (data ?? []) as AdminUserRow[]
}

/**
 * Read one user's MOBILE module overrides as a map keyed by ModuleKey (the
 * `mobile:` prefix stripped). Only `mobile:` rows are considered. Returns {} if
 * the backend is missing; throws a clean Error on a real failure.
 */
export async function listUserMobileGrants(userId: string): Promise<MobileGrantEntryMap> {
  const { data, error } = await supabase
    .from('user_access_grants')
    .select('id, module_key, effect')
    .eq('user_id', userId)
    .like('module_key', `${MOBILE_GRANT_PREFIX}%`)
  if (error) {
    if (isMissingBackend(error)) return {}
    throw friendlyError(error, "Could not load this user's access.")
  }
  const map: MobileGrantEntryMap = {}
  for (const row of (data ?? []) as { id: string; module_key: string; effect: string }[]) {
    if (!row.module_key?.startsWith(MOBILE_GRANT_PREFIX)) continue
    const key = row.module_key.slice(MOBILE_GRANT_PREFIX.length) as ModuleKey
    map[key] = { id: row.id, effect: row.effect === 'revoke' ? 'revoke' : 'grant' }
  }
  return map
}

// ── Writes ────────────────────────────────────────────────────────────────────

/** Grant or revoke a single mobile module for one user (capability = view). */
export async function setUserMobileGrant(
  userId: string, moduleKey: ModuleKey, effect: GrantEffect,
): Promise<void> {
  const { error } = await supabase.rpc('set_user_access_grant', {
    p_user_id: userId,
    p_module_key: mobileGrantKey(moduleKey),
    p_capability: 'view',
    p_effect: effect,
    p_note: 'mobile',
    p_expires_at: null,
  })
  if (error) throw friendlyError(error, 'Could not update access. Please try again.')
}

/** Remove an existing override (back to role default) by its grant row id. */
export async function clearUserMobileGrant(grantId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_user_access_grant', { p_id: grantId })
  if (error) throw friendlyError(error, 'Could not clear the override. Please try again.')
}
