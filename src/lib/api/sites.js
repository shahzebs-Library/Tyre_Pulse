/**
 * Sites master (V109) — the governed, org-scoped list of sites/branches per
 * country. One canonical name per (organisation, country) so every filter and
 * form across the app can offer the SAME selectable options instead of deriving
 * ad-hoc lists from whatever data happens to exist.
 *
 * The grouping / option helpers are PURE and unit-tested so page dropdowns can
 * consume them without duplicating logic.
 */
import { supabase, unwrap, ServiceError } from './_client'

export const SITE_TYPES = ['depot', 'workshop', 'warehouse', 'camp', 'branch', 'project', 'yard', 'other']
export const SITE_STATUSES = ['active', 'inactive']

export const SITE_FIELDS = [
  'country', 'site_name', 'site_code', 'site_type',
  'address_line', 'city', 'region',
  'contact_person', 'contact_phone', 'status', 'notes',
]

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
 * renders. `activeOnly` (default true) hides inactive sites from pickers.
 */
export function siteOptionsForCountry(rows, country, { activeOnly = true } = {}) {
  const want = norm(country)
  const seen = new Set()
  const out = []
  for (const r of rows || []) {
    if (want && norm(r.country) !== want) continue
    if (activeOnly && r.status && r.status !== 'active') continue
    const name = String(r.site_name ?? '').trim()
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
    country, site_name: '', site_code: '', site_type: 'other',
    address_line: '', city: '', region: '',
    contact_person: '', contact_phone: '', status: 'active', notes: '',
  }
}

// ── Persistence ──────────────────────────────────────────────────────────────

/** All sites for the org, optionally filtered by country / status. */
export async function listSites({ country, status } = {}) {
  let q = supabase.from('sites')
    .select(`id,${SITE_FIELDS.join(',')},updated_at`)
    .order('country').order('site_name')
  if (country && country !== 'All') q = q.eq('country', country)
  if (status) q = q.eq('status', status)
  return unwrap(await q)
}

/**
 * Create or update one site (manual upsert on the functional unique key
 * country+name). Only whitelisted fields are written; organisation_id + audit
 * columns are server-set. Admin/Manager only via RLS.
 */
export async function upsertSite(site) {
  const country = String(site?.country ?? '').trim()
  const name = String(site?.site_name ?? '').trim()
  if (!country) throw new ServiceError('A country is required.', 'validation')
  if (!name) throw new ServiceError('A site name is required.', 'validation')
  if (site.site_type && !SITE_TYPES.includes(site.site_type)) throw new ServiceError('Invalid site type.', 'validation')
  if (site.status && !SITE_STATUSES.includes(site.status)) throw new ServiceError('Invalid status.', 'validation')

  const { data: userData } = await supabase.auth.getUser()
  const uid = userData?.user?.id ?? null

  const payload = {}
  for (const f of SITE_FIELDS) {
    const v = site?.[f]
    payload[f] = v == null ? null : (typeof v === 'string' ? v.trim() : v)
  }
  payload.country = country
  payload.site_name = name
  payload.site_type = payload.site_type || 'other'
  payload.status = payload.status || 'active'

  const { data: existing } = await supabase.from('sites')
    .select('id').ilike('country', country).ilike('site_name', name).maybeSingle()

  if (existing?.id) {
    const { error } = await supabase.from('sites')
      .update({ ...payload, updated_by: uid }).eq('id', existing.id)
    if (error) throw new ServiceError(error.message, error.code, error)
    return existing.id
  }
  const { data: ins, error } = await supabase.from('sites')
    .insert({ ...payload, created_by: uid, updated_by: uid }).select('id').single()
  if (error) throw new ServiceError(error.message, error.code, error)
  return ins.id
}

/** Toggle a site active/inactive without editing the rest. */
export async function setSiteStatus(id, status) {
  if (!SITE_STATUSES.includes(status)) throw new ServiceError('Invalid status.', 'validation')
  const { error } = await supabase.from('sites').update({ status }).eq('id', id)
  if (error) throw new ServiceError(error.message, error.code, error)
}

/** Permanently delete a site from the master. */
export async function deleteSite(id) {
  const { error } = await supabase.from('sites').delete().eq('id', id)
  if (error) throw new ServiceError(error.message, error.code, error)
}
