/**
 * Driver Documents service (V154) — per-driver documents (licence, medical
 * certificate, permit, visa …) with issue + expiry tracking and expiry alerts.
 * RLS enforces org isolation; any authenticated member may read and maintain
 * records. This layer keeps an explicit column list (least-privilege select)
 * and null-safe country scoping, mirroring certifications.js / support.js.
 *
 * When the table has not been migrated yet, listers degrade to [] so the page
 * can surface an "apply MIGRATIONS_V154_DRIVER_DOCUMENTS.sql" hint instead of
 * throwing.
 */
import { supabase, unwrap, applyCountry } from './_client'

export const COLS =
  'id,organisation_id,country,driver_name,doc_type,doc_number,issuer,' +
  'issue_date,expiry_date,status,notes,created_by,created_at,updated_at'

export const DOC_STATUS_VALUES = ['valid', 'expiring', 'expired']

/** True when a Supabase error means the table/relation is not deployed yet. */
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('relation') ||
    m.includes('schema cache') ||
    m.includes('could not find the table')
  )
}

/**
 * List driver documents (soonest expiry first). Optional country / status
 * filters. Returns [] when the table is missing so the UI can prompt for the
 * migration rather than error.
 */
export async function listDriverDocuments({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('driver_documents').select(COLS)
    if (status) q = q.eq('status', status)
    q = applyCountry(q, country)
    return unwrap(await q.order('expiry_date', { ascending: true, nullsFirst: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getDriverDocument(id) {
  return unwrap(await supabase.from('driver_documents').select(COLS).eq('id', id).maybeSingle())
}

/** Create a driver document. `driver_name` is required. */
export async function createDriverDocument(values = {}) {
  const driverName = String(values.driver_name || '').trim()
  if (!driverName) throw new Error('A driver name is required.')
  const status = DOC_STATUS_VALUES.includes(values.status) ? values.status : 'valid'
  const payload = {
    driver_name: driverName.slice(0, 200),
    doc_type: values.doc_type ? String(values.doc_type).slice(0, 120) : null,
    doc_number: values.doc_number ? String(values.doc_number).slice(0, 120) : null,
    issuer: values.issuer ? String(values.issuer).slice(0, 200) : null,
    issue_date: values.issue_date || null,
    expiry_date: values.expiry_date || null,
    status,
    notes: values.notes ? String(values.notes).slice(0, 4000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('driver_documents').insert(payload).select(COLS).single())
}

/** Patch a driver document. Immutable columns are stripped before update. */
export async function updateDriverDocument(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.created_at
  delete clean.created_by
  delete clean.organisation_id
  if (clean.status != null && !DOC_STATUS_VALUES.includes(clean.status)) delete clean.status
  if (clean.driver_name != null) {
    const name = String(clean.driver_name).trim()
    if (!name) throw new Error('A driver name is required.')
    clean.driver_name = name.slice(0, 200)
  }
  return unwrap(await supabase.from('driver_documents').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteDriverDocument(id) {
  return unwrap(await supabase.from('driver_documents').delete().eq('id', id))
}
