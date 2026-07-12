/**
 * Customers service — Customer Management registry (V158). A per-organisation
 * book of customer accounts with contact details, classification and status.
 * RLS enforces org isolation and role-gated writes; this layer keeps an explicit
 * column list (least-privilege selects), null-safe country scoping, and graceful
 * degradation when the table has not been migrated yet (returns [] on a missing
 * relation so the page can prompt for the migration instead of crashing).
 */
import { supabase, unwrap, applyCountry } from './_client'

export const COLS =
  'id,organisation_id,country,name,customer_type,contact_name,email,phone,' +
  'address,site,status,notes,created_by,created_at,updated_at'

export const CUSTOMER_STATUSES = ['active', 'inactive', 'prospect']

/** True when an error indicates the table/relation is not present yet. */
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  const code = String(err?.code || '')
  return (
    code === '42P01' ||
    m.includes('does not exist') ||
    m.includes('could not find the table') ||
    m.includes('schema cache') ||
    (m.includes('relation') && m.includes('customers'))
  )
}

/**
 * List customers (newest first). Optional country + status filters. When the
 * table is missing (not yet migrated) resolves to an empty array so the page can
 * surface an "apply migration" hint rather than an error.
 */
export async function listCustomers({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('customers').select(COLS)
    if (status) q = q.eq('status', status)
    q = applyCountry(q, country)
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Create a customer. Validates the required name and normalises the payload. */
export async function createCustomer(values = {}) {
  const name = String(values.name || '').trim()
  if (!name) throw new Error('A customer name is required.')
  const status = CUSTOMER_STATUSES.includes(values.status) ? values.status : 'active'
  const clean = (v, max) => {
    const s = v == null ? null : String(v).trim()
    return s ? s.slice(0, max) : null
  }
  const payload = {
    name: name.slice(0, 200),
    customer_type: clean(values.customer_type, 80),
    contact_name: clean(values.contact_name, 160),
    email: clean(values.email, 254),
    phone: clean(values.phone, 60),
    address: clean(values.address, 500),
    site: clean(values.site, 160),
    status,
    notes: clean(values.notes, 4000),
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('customers').insert(payload).select(COLS).single())
}

/** Patch a customer. Strips immutable/managed columns before writing. */
export async function updateCustomer(id, patch = {}) {
  if (!id) throw new Error('A customer id is required.')
  const clean = { ...patch }
  delete clean.id
  delete clean.organisation_id
  delete clean.created_by
  delete clean.created_at
  delete clean.updated_at
  if (clean.status != null && !CUSTOMER_STATUSES.includes(clean.status)) delete clean.status
  if (clean.name != null) {
    const name = String(clean.name).trim()
    if (!name) throw new Error('A customer name is required.')
    clean.name = name.slice(0, 200)
  }
  return unwrap(await supabase.from('customers').update(clean).eq('id', id).select(COLS).single())
}

/** Delete a customer by id. */
export async function deleteCustomer(id) {
  if (!id) throw new Error('A customer id is required.')
  return unwrap(await supabase.from('customers').delete().eq('id', id))
}
