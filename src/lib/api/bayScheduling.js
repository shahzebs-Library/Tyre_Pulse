/**
 * Bay Scheduling service — the single seam between the Bay Scheduling page
 * (/bay-scheduling) and Supabase (table `bay_schedules`, V184). Keeps an
 * explicit column list (least-privilege selects), null-safe country scoping,
 * enum whitelisting, and non-negative numeric validation. RLS enforces org
 * isolation; this layer never trusts client input blindly.
 *
 * Mirrors odometerLogs.js. A missing `bay_schedules` relation (org has not run
 * the migration) degrades listing to an empty array so the page can render its
 * "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../bayScheduling'

export const COLS =
  'id,organisation_id,country,bay_name,workshop_site,asset_no,job_type,technician,' +
  'scheduled_start,scheduled_end,actual_start,actual_end,estimated_min,priority,' +
  'status,work_order_ref,notes,created_by,created_at,updated_at'

const JOB_TYPES = ['tyre_change', 'rotation', 'repair', 'inspection', 'service', 'alignment', 'other']
const PRIORITIES = ['low', 'normal', 'high', 'urgent']
const STATUSES = ['scheduled', 'in_progress', 'completed', 'delayed', 'cancelled']

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('bay_schedules'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asEnum = (v, allowed, field) => {
  if (v == null || v === '') return null
  const s = String(v).trim()
  if (!allowed.includes(s)) throw new Error(`Invalid ${field}: "${s}".`)
  return s
}
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const asNonNegNumber = (v, field) => {
  if (v === '' || v == null) return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${field} must be a number.`)
  if (n < 0) throw new Error(`${field} cannot be negative.`)
  return n
}

/**
 * List schedules (newest first by scheduled_start, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listBaySchedules({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('bay_schedules').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('scheduled_start', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getBaySchedule(id) {
  return unwrap(await supabase.from('bay_schedules').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Create a bay schedule. Requires a bay name. Enums are whitelisted and numeric
 * fields validated non-negative; timestamps are normalised to ISO strings.
 */
export async function createBaySchedule(values = {}) {
  const bay_name = asText(values.bay_name, 120)
  if (!bay_name) throw new Error('A bay name is required.')

  const payload = {
    bay_name,
    workshop_site: asText(values.workshop_site, 200),
    asset_no: asText(values.asset_no, 120),
    job_type: asEnum(values.job_type, JOB_TYPES, 'job type'),
    technician: asText(values.technician, 160),
    scheduled_start: asTimestamp(values.scheduled_start),
    scheduled_end: asTimestamp(values.scheduled_end),
    actual_start: asTimestamp(values.actual_start),
    actual_end: asTimestamp(values.actual_end),
    estimated_min: asNonNegNumber(values.estimated_min, 'Estimated minutes'),
    priority: asEnum(values.priority, PRIORITIES, 'priority'),
    status: asEnum(values.status, STATUSES, 'status'),
    work_order_ref: asText(values.work_order_ref, 120),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('bay_schedules').insert(payload).select(COLS).single())
}

/**
 * Patch a schedule. Strips immutable/ownership fields; coerces each field
 * present so the stored value never drifts from the validated shape.
 */
export async function updateBaySchedule(id, patch = {}) {
  const clean = {}
  if (patch.bay_name !== undefined) {
    const bay_name = asText(patch.bay_name, 120)
    if (!bay_name) throw new Error('A bay name is required.')
    clean.bay_name = bay_name
  }
  if (patch.workshop_site !== undefined) clean.workshop_site = asText(patch.workshop_site, 200)
  if (patch.asset_no !== undefined) clean.asset_no = asText(patch.asset_no, 120)
  if (patch.job_type !== undefined) clean.job_type = asEnum(patch.job_type, JOB_TYPES, 'job type')
  if (patch.technician !== undefined) clean.technician = asText(patch.technician, 160)
  if (patch.scheduled_start !== undefined) clean.scheduled_start = asTimestamp(patch.scheduled_start)
  if (patch.scheduled_end !== undefined) clean.scheduled_end = asTimestamp(patch.scheduled_end)
  if (patch.actual_start !== undefined) clean.actual_start = asTimestamp(patch.actual_start)
  if (patch.actual_end !== undefined) clean.actual_end = asTimestamp(patch.actual_end)
  if (patch.estimated_min !== undefined) clean.estimated_min = asNonNegNumber(patch.estimated_min, 'Estimated minutes')
  if (patch.priority !== undefined) clean.priority = asEnum(patch.priority, PRIORITIES, 'priority')
  if (patch.status !== undefined) clean.status = asEnum(patch.status, STATUSES, 'status')
  if (patch.work_order_ref !== undefined) clean.work_order_ref = asText(patch.work_order_ref, 120)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('bay_schedules').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteBaySchedule(id) {
  return unwrap(await supabase.from('bay_schedules').delete().eq('id', id))
}
