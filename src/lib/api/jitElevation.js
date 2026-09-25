/**
 * Just-in-time (JIT) privilege elevation service (console /console/jit-elevation).
 *
 * Every call goes through a SECURITY DEFINER RPC from
 * supabase/migrations/20260924116000_jit_elevation.sql. The super-admin RPCs
 * refuse anyone else with 42501; every write audits to console_sessions and
 * access_audit. An approval writes an EXPIRING row into the existing
 * user_access_grants table, so there is no second permission system.
 *
 * Honest reads: every read THROWS on failure (a failed read must never render
 * as "no requests"), and the admin list is paged past the 1000-row response cap
 * by offset against the server's own total, with a stated ceiling.
 */
import { supabase, unwrap, fetchAllPages } from './_client'

const PAGE = 1000
export const LIST_CEILING = 20000

/**
 * All elevation rows (optionally one status), newest first.
 * @returns {Promise<{rows:object[], total:number, truncated:boolean, generatedAt:string|null}>}
 */
export async function listElevations({ status = null } = {}) {
  const rows = []
  let total = null
  let generatedAt = null
  for (let offset = 0; offset < LIST_CEILING; offset += PAGE) {
    const raw = unwrap(await supabase.rpc('admin_list_elevations', {
      p_status: status || null, p_limit: PAGE, p_offset: offset,
    })) || {}
    const page = Array.isArray(raw.rows) ? raw.rows : []
    if (total === null) { total = Number(raw.total) || 0; generatedAt = raw.generated_at || null }
    rows.push(...page)
    if (page.length < PAGE || rows.length >= total) break
  }
  return { rows, total: total ?? rows.length, truncated: (total ?? 0) > rows.length, generatedAt }
}

export async function decideElevation(id, { approve, note = null, minutes = null } = {}) {
  if (!id) throw new Error('Missing request id')
  return unwrap(await supabase.rpc('admin_decide_elevation', {
    p_id: id, p_approve: !!approve, p_note: note ? String(note).trim() : null,
    p_minutes: minutes === null || minutes === undefined || minutes === '' ? null : Number(minutes),
  }))
}

export async function grantElevation({ userId, moduleKey, capability, minutes, reason }) {
  if (!userId) throw new Error('Choose a user')
  return unwrap(await supabase.rpc('admin_grant_elevation', {
    p_user_id: userId, p_module_key: moduleKey, p_capability: capability,
    p_minutes: Number(minutes), p_reason: String(reason || '').trim(),
  }))
}

export async function revokeElevation(id, reason) {
  if (!id) throw new Error('Missing request id')
  return unwrap(await supabase.rpc('admin_revoke_elevation', { p_id: id, p_reason: String(reason || '').trim() }))
}

/** Requester side (any approved non-super, non-Admin user). */
export async function requestElevation({ moduleKey, capability, minutes, reason }) {
  return unwrap(await supabase.rpc('request_elevation', {
    p_module_key: moduleKey, p_capability: capability, p_minutes: Number(minutes),
    p_reason: String(reason || '').trim(),
  }))
}

export async function cancelElevation(id) {
  if (!id) throw new Error('Missing request id')
  return unwrap(await supabase.rpc('cancel_elevation', { p_id: id }))
}

export async function listMyElevations() {
  const raw = unwrap(await supabase.rpc('my_elevation_requests'))
  return Array.isArray(raw) ? raw : []
}

/**
 * Users a super admin may elevate: approved, unlocked, not a super admin and
 * not an Admin (both already hold every capability, and the server refuses them).
 */
export async function listElevationCandidates() {
  const { data, error, truncated } = await fetchAllPages(
    (from, to) => supabase.from('profiles')
      .select('id, full_name, email, role, approved, locked, is_super_admin')
      .eq('approved', true)
      .order('full_name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    { max: 20000 },
  )
  if (error) unwrap({ error })
  const users = (data || []).filter((p) => !p.locked && !p.is_super_admin && p.role !== 'Admin')
  return { users, truncated }
}
