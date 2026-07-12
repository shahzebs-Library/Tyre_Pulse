/**
 * Sites master (V109) — the governed, org-scoped list of sites/branches per
 * country. One canonical name per (organisation, country) so every filter and
 * form across the app can offer the SAME selectable options instead of deriving
 * ad-hoc lists from whatever data happens to exist.
 *
 * Backed by the existing `sites` table (id, name, country, region, city, active,
 * notes, + site_code/site_type added in V109). The grouping / option helpers are
 * PURE and unit-tested so page dropdowns can consume them without duplicating
 * logic.
 */
import { supabase, unwrap, ServiceError } from './_client'

export const SITE_TYPES = ['depot', 'workshop', 'warehouse', 'camp', 'branch', 'project', 'yard', 'other']

/** Editable columns (matches the sites table). `active` is a boolean. */
export const SITE_FIELDS = ['country', 'name', 'site_code', 'site_type', 'region', 'city', 'notes']

const norm = (v) => String(v ?? '').trim().toLowerCase()

/** Stable identity key for a site row: country + name, case/space-insensitive. */
export function siteKey(country, name) {
  return `${norm(country)}${norm(name)}`
}

/** Group rows by country → array of sites (input order preserved). */
export function groupSitesByCountry(rows) {
  const map = {}
  for (const r of rows || []) {
    const c = String(r.country ?? '').trim() || 'Unassigned'
    ;(map[c] ||= []).push(r)
  }
  return map
}

/**
 * Sorted, de-duplicated site NAMES for one country — the option list a dropdown
 * renders. `activeOnly` (default true) hides deactivated sites from pickers.
 */
export function siteOptionsForCountry(rows, country, { activeOnly = true } = {}) {
  const want = norm(country)
  const seen = new Set()
  const out = []
  for (const r of rows || []) {
    if (want && norm(r.country) !== want) continue
    if (activeOnly && r.active === false) continue
    const name = String(r.name ?? '').trim()
    const k = norm(name)
    if (!name || seen.has(k)) continue
    seen.add(k)
    out.push(name)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

/** Blank editable site for a country. */
export function emptySite(country = '') {
  return {
    country, name: '', site_code: '', site_type: 'other',
    region: '', city: '', notes: '', active: true,
  }
}

// ── Persistence ──────────────────────────────────────────────────────────────

/**
 * Unique site names derived from LIVE operational data (vehicle_fleet,
 * tyre_records, inspections, accidents, work_orders, corrective_actions,
 * gate_passes + the sites master) via the org-scoped RPC (V129). Used by the
 * checklist Site picker so it always offers the sites that actually exist in the
 * tenant's data — the sites master is frequently near-empty. Sorted; empty on
 * any RPC error.
 */
export async function listDataSiteOptions(country) {
  const { data, error } = await supabase.rpc('reference_site_options', {
    p_country: country && country !== 'All' ? country : null,
  })
  if (error) throw new ServiceError(error.message, error.code, error)
  return (Array.isArray(data) ? data : []).map((r) => r?.name).filter(Boolean)
}

/** All sites for the org, optionally filtered by country / active flag. */
export async function listSites({ country, activeOnly } = {}) {
  let q = supabase.from('sites')
    .select('id,country,name,site_code,site_type,region,city,active,notes,updated_at')
    .order('country').order('name')
  if (country && country !== 'All') q = q.eq('country', country)
  if (activeOnly) q = q.eq('active', true)
  return unwrap(await q)
}

/**
 * Create or update one site (manual upsert on the natural key country+name).
 * Only whitelisted fields are written; organisation_id + audit columns are
 * server-set. Admin/Manager only via RLS.
 */
export async function upsertSite(site) {
  const country = String(site?.country ?? '').trim()
  const name = String(site?.name ?? '').trim()
  if (!country) throw new ServiceError('A country is required.', 'validation')
  if (!name) throw new ServiceError('A site name is required.', 'validation')
  if (site.site_type && !SITE_TYPES.includes(site.site_type)) throw new ServiceError('Invalid site type.', 'validation')

  const { data: userData } = await supabase.auth.getUser()
  const uid = userData?.user?.id ?? null

  const payload = {}
  for (const f of SITE_FIELDS) {
    const v = site?.[f]
    payload[f] = v == null ? null : (typeof v === 'string' ? v.trim() : v)
  }
  payload.country = country
  payload.name = name
  payload.site_type = payload.site_type || 'other'
  payload.active = site.active !== false

  const { data: existing } = await supabase.from('sites')
    .select('id').ilike('country', country).ilike('name', name).maybeSingle()

  if (existing?.id) {
    const { error } = await supabase.from('sites')
      .update({ ...payload, updated_by: uid }).eq('id', existing.id)
    if (error) throw new ServiceError(error.message, error.code, error)
    return existing.id
  }
  const { data: ins, error } = await supabase.from('sites')
    .insert({ ...payload, created_by: uid }).select('id').single()
  if (error) throw new ServiceError(error.message, error.code, error)
  return ins.id
}

/** Activate / deactivate a site without editing the rest. */
export async function setSiteActive(id, active) {
  const { error } = await supabase.from('sites').update({ active: !!active }).eq('id', id)
  if (error) throw new ServiceError(error.message, error.code, error)
}

/** Permanently delete a site from the master. */
export async function deleteSite(id) {
  const { error } = await supabase.from('sites').delete().eq('id', id)
  if (error) throw new ServiceError(error.message, error.code, error)
}
