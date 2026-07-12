/**
 * SLA Records service — the single seam between the SLA Dashboard page
 * (/sla-dashboard) and Supabase (table `sla_records`, V185). Keeps an explicit
 * column list (least-privilege selects), null-safe country scoping, enum
 * whitelisting, and input validation. RLS enforces org isolation; this layer
 * never trusts client input blindly.
 *
 * Mirrors odometerLogs.js. A missing `sla_records` relation (org has not run the
 * migration) degrades listing to an empty array so the page can render its
 * "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../slaRecords'

export const COLS =
  'id,organisation_id,country,reference,sla_type,asset_no,priority,target_hours,' +
  'started_at,due_at,resolved_at,status,owner,notes,created_by,created_at,updated_at'

const SLA_TYPES = ['work_order', 'breakdown', 'delivery', 'inspection', 'procurement', 'support', 'other']
const PRIORITIES = ['low', 'medium', 'high', 'critical']
const STATUSES = ['on_track', 'at_risk', 'breached', 'met', 'cancelled']

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('sla_records'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asEnum = (v, allowed, fallback) => {
  const s = v == null ? '' : String(v).trim().toLowerCase()
  return allowed.includes(s) ? s : fallback
}
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * List SLA records (newest due first, then created_at). Optional `country`
 * filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listSlaRecords({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('sla_records').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('due_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getSlaRecord(id) {
  return unwrap(await supabase.from('sla_records').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Create an SLA record. Requires a reference (what this SLA is for). Enums are
 * whitelisted; target_hours, when present, must be a non-negative number.
 */
export async function createSlaRecord(values = {}) {
  const reference = asText(values.reference, 200)
  if (!reference) throw new Error('A reference is required.')

  let target_hours = null
  if (values.target_hours !== undefined && values.target_hours !== '' && values.target_hours != null) {
    target_hours = toFiniteNumber(values.target_hours)
    if (target_hours == null) throw new Error('Target hours must be a number.')
    if (target_hours < 0) throw new Error('Target hours cannot be negative.')
  }

  const payload = {
    reference,
    sla_type: asEnum(values.sla_type, SLA_TYPES, 'other'),
    asset_no: asText(values.asset_no, 120),
    priority: asEnum(values.priority, PRIORITIES, 'medium'),
    target_hours,
    started_at: asTimestamp(values.started_at),
    due_at: asTimestamp(values.due_at),
    resolved_at: asTimestamp(values.resolved_at),
    status: asEnum(values.status, STATUSES, 'on_track'),
    owner: asText(values.owner, 200),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('sla_records').insert(payload).select(COLS).single())
}

/**
 * Patch an SLA record. Strips immutable/ownership fields; coerces each field
 * present so the stored value never drifts from the validated shape.
 */
export async function updateSlaRecord(id, patch = {}) {
  const clean = {}
  if (patch.reference !== undefined) {
    const reference = asText(patch.reference, 200)
    if (!reference) throw new Error('A reference is required.')
    clean.reference = reference
  }
  if (patch.sla_type !== undefined) clean.sla_type = asEnum(patch.sla_type, SLA_TYPES, 'other')
  if (patch.asset_no !== undefined) clean.asset_no = asText(patch.asset_no, 120)
  if (patch.priority !== undefined) clean.priority = asEnum(patch.priority, PRIORITIES, 'medium')
  if (patch.target_hours !== undefined) {
    if (patch.target_hours === '' || patch.target_hours == null) {
      clean.target_hours = null
    } else {
      const th = toFiniteNumber(patch.target_hours)
      if (th == null) throw new Error('Target hours must be a number.')
      if (th < 0) throw new Error('Target hours cannot be negative.')
      clean.target_hours = th
    }
  }
  if (patch.started_at !== undefined) clean.started_at = asTimestamp(patch.started_at)
  if (patch.due_at !== undefined) clean.due_at = asTimestamp(patch.due_at)
  if (patch.resolved_at !== undefined) clean.resolved_at = asTimestamp(patch.resolved_at)
  if (patch.status !== undefined) clean.status = asEnum(patch.status, STATUSES, 'on_track')
  if (patch.owner !== undefined) clean.owner = asText(patch.owner, 200)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('sla_records').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteSlaRecord(id) {
  return unwrap(await supabase.from('sla_records').delete().eq('id', id))
}
