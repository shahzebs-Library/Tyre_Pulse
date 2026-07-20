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
import { supabase, unwrap, ServiceError, fetchAllPages } from './_client'

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

/**
 * Fleet assets reduced to the columns the Site Management rollup needs. The
 * `sites` master is typically near-empty, so the real, authoritative list of
 * operational sites is the set of distinct `vehicle_fleet.site` values — this
 * feed lets the page merge governed master sites with derived (data-only) ones
 * and count assets per site. Paged past the 1000-row cap; org+country RLS
 * enforced server-side.
 */
export async function listSiteAssets({ country } = {}) {
  const rows = await fetchAllPages((from, to) => {
    let q = supabase.from('vehicle_fleet')
      .select('id,asset_no,fleet_number,vehicle_type,site,country,region,status,current_km,active:is_active')
      .order('site', { nullsFirst: false }).order('asset_no').range(from, to)
    if (country && country !== 'All') q = q.or(`country.eq.${country},country.is.null`)
    return q
  })
  return Array.isArray(rows) ? rows : []
}

/**
 * Build a per-site rollup by merging the governed sites master with the sites
 * that actually appear in the fleet. Pure — unit-testable, no I/O. Each row:
 * { name, country, region, city, active, governed, siteId, siteType, assetCount,
 *   activeAssetCount, assets: [...] }. `governed` = present in the sites master.
 */
export function buildSiteRollup(masterSites = [], fleetAssets = []) {
  const map = new Map()
  const keyOf = (name) => norm(name)
  // Guard against a non-array input (a failed/odd query result) so the page
  // never crashes with "not iterable".
  const master = Array.isArray(masterSites) ? masterSites : []
  const assets = Array.isArray(fleetAssets) ? fleetAssets : []

  for (const s of master) {
    const name = String(s.name ?? '').trim()
    if (!name) continue
    map.set(keyOf(name), {
      name,
      country: s.country ?? null,
      region: s.region ?? null,
      city: s.city ?? null,
      active: s.active !== false,
      governed: true,
      siteId: s.id ?? null,
      siteType: s.site_type ?? null,
      assetCount: 0,
      activeAssetCount: 0,
      assets: [],
    })
  }

  for (const a of assets) {
    const name = String(a.site ?? '').trim()
    if (!name) continue
    const k = keyOf(name)
    let entry = map.get(k)
    if (!entry) {
      entry = {
        name,
        country: a.country ?? null,
        region: a.region ?? null,
        city: null,
        active: true,
        governed: false,
        siteId: null,
        siteType: null,
        assetCount: 0,
        activeAssetCount: 0,
        assets: [],
      }
      map.set(k, entry)
    }
    if (!entry.country && a.country) entry.country = a.country
    if (!entry.region && a.region) entry.region = a.region
    entry.assetCount += 1
    if (a.active !== false) entry.activeAssetCount += 1
    entry.assets.push(a)
  }

  return Array.from(map.values()).sort((x, y) => {
    const c = String(x.country ?? '').localeCompare(String(y.country ?? ''))
    if (c !== 0) return c
    return x.name.localeCompare(y.name)
  })
}

/** All sites for the org, optionally filtered by country / active flag. */
export async function listSites({ country, activeOnly } = {}) {
  let q = supabase.from('sites')
    .select('id,country,name,site_code,site_type,region,city,active,notes,updated_at')
    .order('country').order('name')
  if (country && country !== 'All') q = q.eq('country', country)
  if (activeOnly) q = q.eq('active', true)
  const rows = unwrap(await q)
  return Array.isArray(rows) ? rows : []
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
