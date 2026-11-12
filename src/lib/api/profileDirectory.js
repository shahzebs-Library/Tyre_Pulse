import { supabase } from './_client'

// The PII-free staff directory. Every reader that needs OTHER people's names
// goes through the SECURITY DEFINER function `list_profile_directory`, never a
// select on `profiles`: the function returns names, employee id, role and scope
// only (no email, phone, push token or notes), is scoped in the database to the
// caller's own organisation, and keeps working when the `profiles` row policy is
// narrowed to "own row or elevated". A select on `profiles` is for the caller's
// OWN row and for the elevated admin screens.
//
// Columns returned: id, full_name, username, employee_id, role, country, sites,
// site, approved, locked, org_id, organisation_id, avatar_url.
const RPC = 'list_profile_directory'
const PAGE = 1000 // the function's own per-call ceiling
const CHUNK = 200

/**
 * Directory rows for a set of ids. Throws on a failed read (callers that treat
 * names as cosmetic catch it). Ids are chunked so the request stays small.
 * @param {Array<string|null|undefined>} ids
 * @returns {Promise<object[]>}
 */
export async function fetchDirectoryByIds(ids) {
  const uniq = [...new Set((Array.isArray(ids) ? ids : [])
    .filter((id) => typeof id === 'string' && id.trim() !== ''))]
  const out = []
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const chunk = uniq.slice(i, i + CHUNK)
    const { data, error } = await supabase.rpc(RPC, { p_ids: chunk, p_limit: CHUNK })
    if (error) throw error
    for (const row of (data || [])) out.push(row)
  }
  return out
}

/**
 * A directory listing, ordered by name then id (a total order, so paging never
 * drops or repeats a person). With `limit` it returns one bounded page (a
 * picker); without it it pages the whole organisation up to `max`.
 * @returns {Promise<{rows: object[], truncated: boolean}>}
 */
export async function fetchDirectory({ search = '', roles = [], activeOnly = false, limit = null, max = 20000 } = {}) {
  const base = {
    p_search: search ? String(search) : null,
    p_roles: Array.isArray(roles) && roles.length ? roles : null,
    p_active_only: !!activeOnly,
  }
  if (limit != null) {
    const { data, error } = await supabase.rpc(RPC, { ...base, p_limit: Math.min(Math.max(1, limit), PAGE), p_offset: 0 })
    if (error) throw error
    return { rows: data || [], truncated: false }
  }
  const rows = []
  for (let offset = 0; offset < max; offset += PAGE) {
    const { data, error } = await supabase.rpc(RPC, { ...base, p_limit: PAGE, p_offset: offset })
    if (error) throw error
    const page = data || []
    for (const row of page) rows.push(row)
    if (page.length < PAGE) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

/**
 * Everyone in the caller's organisation, from the directory (names, employee
 * id, role and scope; no contact data). The reader for people pickers and name
 * lookups on screens ordinary roles use. Throws on a failed or partial read.
 * @returns {Promise<object[]>}
 */
export async function listDirectoryPeople() {
  const { rows, truncated } = await fetchDirectory({ max: 50000 })
  if (truncated) throw new Error('The staff directory could not be loaded completely.')
  return rows
}

/** Display name for a directory row: full name, else username, else null. */
export function directoryName(row) {
  const full = row?.full_name && String(row.full_name).trim()
  if (full) return full
  const user = row?.username && String(row.username).trim()
  return user || null
}

// Resolve a set of profile ids to the fields a signer render needs
// (full_name + employee_id) from the directory.
//
// Best-effort by design: a signer whose profile cannot be read (removed account,
// a transient failure) simply does not appear in the map, and the caller then
// renders the honest fallback through signerDisplay rather than a raw email or
// UUID. This never throws.
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
      const { data } = await supabase.rpc(RPC, { p_ids: chunk, p_limit: CHUNK })
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
