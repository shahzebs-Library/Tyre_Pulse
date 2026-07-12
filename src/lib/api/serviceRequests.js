/**
 * Service Requests service — the single seam between the Service Requests page
 * (/service-requests) and Supabase (table `service_requests`, V174). Keeps an
 * explicit column list (least-privilege selects), null-safe country scoping, and
 * input validation. RLS enforces org isolation; this layer never trusts client
 * input blindly.
 *
 * Mirrors odometerLogs.js. A missing `service_requests` relation (org has not
 * run the migration) degrades listing to an empty array so the page can render
 * its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../serviceRequests'

export const COLS =
  'id,organisation_id,country,request_no,asset_no,requester_name,contact,' +
  'category,priority,status,subject,description,requested_at,resolved_at,' +
  'assigned_to,resolution,notes,created_by,created_at,updated_at'

const CATEGORIES = ['tyre', 'mechanical', 'electrical', 'bodywork', 'inspection', 'breakdown', 'other']
const PRIORITIES = ['low', 'medium', 'high', 'urgent']
const STATUSES = ['new', 'triaged', 'in_progress', 'resolved', 'closed', 'cancelled']

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('service_requests'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asEnum = (v, allowed) => {
  if (v == null || v === '') return null
  const s = String(v).trim().toLowerCase()
  return allowed.includes(s) ? s : null
}
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * List requests (newest first by requested_at, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listServiceRequests({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('service_requests').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('requested_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getServiceRequest(id) {
  return unwrap(await supabase.from('service_requests').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Raise a request. Requires a subject (what is being asked for). Enum fields are
 * whitelisted; requested_at defaults to now when omitted.
 */
export async function createServiceRequest(values = {}) {
  const subject = asText(values.subject, 300)
  if (!subject) throw new Error('A subject is required.')

  const payload = {
    request_no: asText(values.request_no, 60),
    asset_no: asText(values.asset_no, 120),
    requester_name: asText(values.requester_name, 200),
    contact: asText(values.contact, 200),
    category: asEnum(values.category, CATEGORIES),
    priority: asEnum(values.priority, PRIORITIES) || 'medium',
    status: asEnum(values.status, STATUSES) || 'new',
    subject,
    description: values.description ? String(values.description).slice(0, 8000) : null,
    requested_at: asTimestamp(values.requested_at) || new Date().toISOString(),
    resolved_at: asTimestamp(values.resolved_at),
    assigned_to: asText(values.assigned_to, 200),
    resolution: values.resolution ? String(values.resolution).slice(0, 8000) : null,
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('service_requests').insert(payload).select(COLS).single())
}

/**
 * Patch a request. Strips immutable/ownership fields; coerces each field present
 * so the stored value never drifts from the validated shape.
 */
export async function updateServiceRequest(id, patch = {}) {
  const clean = {}
  if (patch.subject !== undefined) {
    const subject = asText(patch.subject, 300)
    if (!subject) throw new Error('A subject is required.')
    clean.subject = subject
  }
  if (patch.request_no !== undefined) clean.request_no = asText(patch.request_no, 60)
  if (patch.asset_no !== undefined) clean.asset_no = asText(patch.asset_no, 120)
  if (patch.requester_name !== undefined) clean.requester_name = asText(patch.requester_name, 200)
  if (patch.contact !== undefined) clean.contact = asText(patch.contact, 200)
  if (patch.category !== undefined) clean.category = asEnum(patch.category, CATEGORIES)
  if (patch.priority !== undefined) clean.priority = asEnum(patch.priority, PRIORITIES)
  if (patch.status !== undefined) clean.status = asEnum(patch.status, STATUSES)
  if (patch.description !== undefined) clean.description = patch.description ? String(patch.description).slice(0, 8000) : null
  if (patch.requested_at !== undefined) clean.requested_at = asTimestamp(patch.requested_at)
  if (patch.resolved_at !== undefined) clean.resolved_at = asTimestamp(patch.resolved_at)
  if (patch.assigned_to !== undefined) clean.assigned_to = asText(patch.assigned_to, 200)
  if (patch.resolution !== undefined) clean.resolution = patch.resolution ? String(patch.resolution).slice(0, 8000) : null
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('service_requests').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteServiceRequest(id) {
  return unwrap(await supabase.from('service_requests').delete().eq('id', id))
}

// toFiniteNumber is re-exported for symmetry with odometerLogs.js consumers.
export { toFiniteNumber }
