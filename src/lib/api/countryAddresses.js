/**
 * Country address book (V108) — one editable address per (organisation, country).
 * Reads/writes go through the org-scoped `country_addresses` table (RLS: org
 * isolation for reads, Admin-only writes). The UI auto-lists the operating
 * countries and pre-fills each from the org branding address; `resolveAddress`
 * gives every document a country address with a guaranteed org fallback.
 *
 * The prefill/resolve/format helpers are PURE and unit-tested so document code
 * can rely on them without a DB round-trip.
 */
import { supabase, unwrap, ServiceError } from './_client'

/** Editable columns (order = form order). organisation_id/audit cols are server-set. */
export const COUNTRY_ADDRESS_FIELDS = [
  'legal_name',
  'address_line', 'city', 'region', 'postal_code',
  'tax_id',
  'contact_person', 'contact_email', 'contact_phone', 'website',
  'notes',
]

/** Blank editable address for a country (all fields empty strings). */
export function emptyCountryAddress(country) {
  const base = { country }
  for (const f of COUNTRY_ADDRESS_FIELDS) base[f] = ''
  return base
}

/**
 * Map an org branding object (V68) onto the country-address shape, so a country
 * with no row can inherit the org address as a starting point / fallback.
 */
export function fromOrgBranding(country, branding) {
  const b = branding || {}
  return {
    ...emptyCountryAddress(country),
    legal_name:     b.legal_name || b.display_name || '',
    address_line:   b.address || '',
    contact_email:  b.contact_email || '',
    contact_phone:  b.contact_phone || '',
    website:        b.website || '',
  }
}

/** True when every editable field of an address row is blank. */
export function isBlankAddress(addr) {
  if (!addr) return true
  return COUNTRY_ADDRESS_FIELDS.every((f) => !String(addr[f] ?? '').trim())
}

const norm = (c) => String(c ?? '').trim().toLowerCase()

/** Index a list of stored rows by normalised country for O(1) lookup. */
export function indexByCountry(rows) {
  const map = new Map()
  for (const r of rows || []) map.set(norm(r.country), r)
  return map
}

/**
 * Build the editable list the Settings panel renders: one row per operating
 * country (union of the configured countries and any country that already has a
 * stored row), each carrying its saved values or an org-address prefill.
 *
 * @returns {Array<{ country, saved:boolean, prefilled:boolean, ...fields }>}
 */
export function buildCountryAddressList(countries, rows, branding) {
  const byCountry = indexByCountry(rows)
  const order = []
  const seen = new Set()
  for (const c of countries || []) {
    const k = norm(c)
    if (k && !seen.has(k)) { seen.add(k); order.push(c) }
  }
  // Include stored countries that aren't in the configured list (never hide data).
  for (const r of rows || []) {
    const k = norm(r.country)
    if (k && !seen.has(k)) { seen.add(k); order.push(r.country) }
  }
  return order.map((country) => {
    const saved = byCountry.get(norm(country))
    if (saved && !isBlankAddress(saved)) {
      return { ...emptyCountryAddress(country), ...pick(saved), country, saved: true, prefilled: false }
    }
    // No saved values → prefill from the org address so the field isn't empty.
    return { ...fromOrgBranding(country, branding), country, saved: false, prefilled: true }
  })
}

/**
 * Resolve the effective address for a country: the saved row if it has content,
 * otherwise the org branding address. Always returns a usable block.
 */
export function resolveAddress(country, rows, branding) {
  const saved = indexByCountry(rows).get(norm(country))
  if (saved && !isBlankAddress(saved)) return { ...emptyCountryAddress(country), ...pick(saved), country, source: 'country' }
  return { ...fromOrgBranding(country, branding), country, source: 'org' }
}

/** One-line, human-readable address string (skips blanks), for headers/footers. */
export function formatAddressLine(addr) {
  if (!addr) return ''
  return [addr.address_line, addr.city, addr.region, addr.postal_code, addr.country]
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join(', ')
}

function pick(row) {
  const out = {}
  for (const f of COUNTRY_ADDRESS_FIELDS) if (row[f] != null) out[f] = row[f]
  return out
}

// ── Persistence ──────────────────────────────────────────────────────────────

/** All saved country addresses for the caller's org. */
export async function listCountryAddresses() {
  return unwrap(
    await supabase.from('country_addresses')
      .select(`id,country,${COUNTRY_ADDRESS_FIELDS.join(',')},updated_at`)
      .order('country'),
  )
}

/**
 * Create or update one country's address (manual upsert on the functional unique
 * key). Only whitelisted fields are written; organisation_id + audit columns are
 * set by the table default + trigger. Admin-only via RLS.
 */
export async function upsertCountryAddress(country, data) {
  const c = String(country ?? '').trim()
  if (!c) throw new ServiceError('A country is required.', 'validation')

  const { data: userData } = await supabase.auth.getUser()
  const uid = userData?.user?.id ?? null

  const payload = { country: c }
  for (const f of COUNTRY_ADDRESS_FIELDS) {
    const v = data?.[f]
    payload[f] = v == null ? null : String(v).trim() || null
  }
  if (payload.website && !/^https?:\/\//i.test(payload.website)) {
    payload.website = `https://${payload.website}`
  }

  const { data: existing } = await supabase.from('country_addresses')
    .select('id').ilike('country', c).maybeSingle()

  if (existing?.id) {
    const { error } = await supabase.from('country_addresses')
      .update({ ...payload, updated_by: uid }).eq('id', existing.id)
    if (error) throw new ServiceError(error.message, error.code, error)
    return existing.id
  }
  const { data: ins, error } = await supabase.from('country_addresses')
    .insert({ ...payload, created_by: uid, updated_by: uid }).select('id').single()
  if (error) throw new ServiceError(error.message, error.code, error)
  return ins.id
}

/** Remove a country's saved address (it then falls back to the org address). */
export async function deleteCountryAddress(country) {
  const c = String(country ?? '').trim()
  if (!c) return
  const { error } = await supabase.from('country_addresses').delete().ilike('country', c)
  if (error) throw new ServiceError(error.message, error.code, error)
}
