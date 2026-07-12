/**
 * Incidents service — operational incident reports (V138). Any authenticated
 * member of the org may raise, view, update and resolve incidents. RLS enforces
 * org isolation; this layer keeps an explicit column list (no SELECT *), null-safe
 * country scoping, and tolerates a missing table (returns [] until the migration
 * is applied). Mirrors accidents.js / support.js.
 */
import { supabase, unwrap, applyCountry } from './_client'

const COLS =
  'id,organisation_id,country,incident_no,incident_type,asset_no,site,incident_date,' +
  'severity,reported_by,description,action_taken,status,created_by,created_at,updated_at'

export const INCIDENT_TYPES = ['near_miss', 'damage', 'breakdown', 'safety', 'theft', 'other']
export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical']
export const INCIDENT_STATUSES = ['open', 'investigating', 'resolved', 'closed']

/** True for "relation/table does not exist" errors — the migration isn't applied yet. */
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
 * List incidents, newest first. Country-scoped (null-safe) and optionally
 * filtered by status / severity. Returns [] (never throws) when the underlying
 * table is missing, so the page can prompt for the migration gracefully.
 * @param {{country?:string, status?:string, severity?:string, limit?:number}} [opts]
 */
export async function listIncidents({ country, status, severity, limit = 500 } = {}) {
  try {
    let q = supabase
      .from('incident_reports')
      .select(COLS)
      .order('created_at', { ascending: false })
      .limit(limit)
    q = applyCountry(q, country)
    if (status) q = q.eq('status', status)
    if (severity) q = q.eq('severity', severity)
    return unwrap(await q) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Get one incident by id (or null if not found). */
export async function getIncident(id) {
  return unwrap(await supabase.from('incident_reports').select(COLS).eq('id', id).maybeSingle())
}

/** Raise a new incident; returns the inserted row. Requires a description or asset. */
export async function createIncident(values = {}) {
  const description = String(values.description || '').trim()
  const asset_no = String(values.asset_no || '').trim()
  if (!description && !asset_no) {
    throw new Error('Add a description or link an asset before saving the incident.')
  }
  const incident_type = INCIDENT_TYPES.includes(values.incident_type) ? values.incident_type : 'other'
  const severity = INCIDENT_SEVERITIES.includes(values.severity) ? values.severity : 'medium'
  const status = INCIDENT_STATUSES.includes(values.status) ? values.status : 'open'
  const payload = {
    country: values.country ?? null,
    incident_no: values.incident_no ? String(values.incident_no).slice(0, 60) : null,
    incident_type,
    asset_no: asset_no || null,
    site: values.site ? String(values.site).slice(0, 120) : null,
    incident_date: values.incident_date || null,
    severity,
    reported_by: values.reported_by ? String(values.reported_by).slice(0, 120) : null,
    description: description ? description.slice(0, 8000) : null,
    action_taken: values.action_taken ? String(values.action_taken).slice(0, 8000) : null,
    status,
  }
  return unwrap(await supabase.from('incident_reports').insert(payload).select(COLS).single())
}

/** Patch an incident by id; returns the updated row. Strips immutable columns. */
export async function updateIncident(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.created_at
  delete clean.organisation_id
  delete clean.created_by
  return unwrap(await supabase.from('incident_reports').update(clean).eq('id', id).select(COLS).single())
}

/** Delete an incident by id. */
export async function deleteIncident(id) {
  return unwrap(await supabase.from('incident_reports').delete().eq('id', id))
}
