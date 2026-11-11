import { supabase } from './_client'

// Resolve a set of profile ids to the fields a signer render needs
// (full_name + employee_id), reusing the same authenticated read of `profiles`
// the rest of the app already uses. RLS is the authority: `profiles_select`
// admits every authenticated member of the organisation, which is exactly how
// the workshop board, the approvals queue and the console already read names, so
// this adds no new unscoped surface.
//
// Best-effort by design: a signer whose profile cannot be read (deleted account,
// a transient failure) simply does not appear in the map, and the caller then
// renders the honest fallback through signerDisplay rather than a raw email or
// UUID. This never throws.
const COLS = 'id,full_name,username,employee_id'
const CHUNK = 200

/**
 * @param {Array<string|null|undefined>} ids
 * @returns {Promise<Map<string, {id, full_name, username, employee_id}>>}
 */
export async function getSignerProfiles(ids) {
  const map = new Map()
  const uniq = [...new Set((Array.isArray(ids) ? ids : [])
    .filter((id) => typeof id === 'string' && id.trim() !== ''))]
  if (uniq.length === 0) return map
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const chunk = uniq.slice(i, i + CHUNK)
    try {
      const { data } = await supabase.from('profiles').select(COLS).in('id', chunk).limit(CHUNK)
      for (const p of (data || [])) {
        if (p && p.id != null) map.set(String(p.id), p)
      }
    } catch { /* best effort: a failed chunk leaves those ids unresolved */ }
  }
  return map
}

/**
 * Convenience for the common two-signer case (approver + inspector). Returns an
 * object shaped for `opts.signers` / the `signers` prop: each slot is the
 * resolved profile, or null when the id was absent or unresolvable.
 */
export async function resolveInspectionSigners({ approvedBy, createdBy } = {}) {
  const map = await getSignerProfiles([approvedBy, createdBy])
  return {
    approver: approvedBy ? (map.get(String(approvedBy)) || null) : null,
    inspector: createdBy ? (map.get(String(createdBy)) || null) : null,
  }
}
