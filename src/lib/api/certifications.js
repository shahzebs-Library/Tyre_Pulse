/**
 * Certifications service (V136) — driver / vehicle / technician / site
 * certifications & licenses with issue + expiry tracking. RLS enforces org
 * isolation; any authenticated member may read and maintain records. This layer
 * keeps an explicit column list (least-privilege select) and null-safe country
 * scoping, mirroring support.js / tyreAgeCompliance.js.
 *
 * When the table has not been migrated yet, listers degrade to [] so the page
 * can surface an "apply MIGRATIONS_V136_CERTIFICATIONS.sql" hint instead of
 * throwing.
 */
import { supabase, unwrap, applyCountry } from './_client'

const COLS =
  'id,organisation_id,country,subject_type,subject_name,cert_type,cert_number,' +
  'issuer,issue_date,expiry_date,status,notes,created_by,created_at,updated_at'

export const CERT_SUBJECT_TYPES = ['driver', 'vehicle', 'technician', 'site']
export const CERT_STATUS_VALUES = ['valid', 'expiring', 'expired', 'revoked']

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
 * List certifications (newest first). Optional country / status / subjectType
 * filters. Returns [] when the table is missing so the UI can prompt for the
 * migration rather than error.
 */
export async function listCertifications({ country, status, subjectType, limit = 500 } = {}) {
  try {
    let q = supabase.from('certifications').select(COLS)
    if (status) q = q.eq('status', status)
    if (subjectType) q = q.eq('subject_type', subjectType)
    q = applyCountry(q, country)
    return unwrap(await q.order('expiry_date', { ascending: true, nullsFirst: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getCertification(id) {
  return unwrap(await supabase.from('certifications').select(COLS).eq('id', id).maybeSingle())
}

/** Create a certification. `subject_name` is required. */
export async function createCertification(values = {}) {
  const subjectName = String(values.subject_name || '').trim()
  if (!subjectName) throw new Error('A subject name is required.')
  const subjectType = CERT_SUBJECT_TYPES.includes(values.subject_type) ? values.subject_type : 'driver'
  const status = CERT_STATUS_VALUES.includes(values.status) ? values.status : 'valid'
  const payload = {
    subject_type: subjectType,
    subject_name: subjectName.slice(0, 200),
    cert_type: values.cert_type ? String(values.cert_type).slice(0, 120) : null,
    cert_number: values.cert_number ? String(values.cert_number).slice(0, 120) : null,
    issuer: values.issuer ? String(values.issuer).slice(0, 200) : null,
    issue_date: values.issue_date || null,
    expiry_date: values.expiry_date || null,
    status,
    notes: values.notes ? String(values.notes).slice(0, 4000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('certifications').insert(payload).select(COLS).single())
}

/** Patch a certification. Immutable columns are stripped before update. */
export async function updateCertification(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.created_at
  delete clean.created_by
  delete clean.organisation_id
  if (clean.subject_type != null && !CERT_SUBJECT_TYPES.includes(clean.subject_type)) delete clean.subject_type
  if (clean.status != null && !CERT_STATUS_VALUES.includes(clean.status)) delete clean.status
  if (clean.subject_name != null) {
    const name = String(clean.subject_name).trim()
    if (!name) throw new Error('A subject name is required.')
    clean.subject_name = name.slice(0, 200)
  }
  return unwrap(await supabase.from('certifications').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteCertification(id) {
  return unwrap(await supabase.from('certifications').delete().eq('id', id))
}
