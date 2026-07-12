/**
 * Load Plans service — the single seam between the Load Planning page
 * (/load-planning) and Supabase (table `load_plans`, V167). Keeps an explicit
 * column list (least-privilege selects), null-safe country scoping, and input
 * validation. RLS enforces org isolation; this layer never trusts client input
 * blindly.
 *
 * Mirrors odometerLogs.js. A missing `load_plans` relation (org has not run the
 * migration) degrades listing to an empty array so the page can render its
 * "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../loadPlans'

export const COLS =
  'id,organisation_id,country,reference,asset_no,origin,destination,plan_date,' +
  'cargo_type,cargo_weight_kg,max_payload_kg,volume_m3,max_volume_m3,pallet_count,' +
  'status,notes,created_by,created_at,updated_at'

const STATUSES = ['draft', 'planned', 'loaded', 'dispatched', 'delivered']

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('load_plans'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
const asStatus = (v) => {
  const s = asText(v, 40)
  return s && STATUSES.includes(s.toLowerCase()) ? s.toLowerCase() : null
}
const asInt = (v) => {
  const n = toFiniteNumber(v)
  return n == null ? null : Math.round(n)
}

/**
 * Coerce and validate a numeric capacity/measurement field. Returns the finite
 * value, or null when blank; throws when present but negative.
 */
function numericNonNegative(v, label) {
  const n = toFiniteNumber(v)
  if (n == null) return null
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

/**
 * List load plans (newest first by plan_date, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listLoadPlans({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('load_plans').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('plan_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getLoadPlan(id) {
  return unwrap(await supabase.from('load_plans').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Create a load plan. Requires a reference (the plan identifier). All numeric
 * measurements are optional but must be non-negative when supplied. Plan date
 * defaults to today when omitted; status defaults to 'draft'.
 */
export async function createLoadPlan(values = {}) {
  const reference = asText(values.reference, 200)
  if (!reference) throw new Error('A plan reference is required.')

  const payload = {
    reference,
    asset_no: asText(values.asset_no, 120),
    origin: asText(values.origin, 200),
    destination: asText(values.destination, 200),
    plan_date: asDate(values.plan_date) || new Date().toISOString().slice(0, 10),
    cargo_type: asText(values.cargo_type, 200),
    cargo_weight_kg: numericNonNegative(values.cargo_weight_kg, 'Cargo weight (kg)'),
    max_payload_kg: numericNonNegative(values.max_payload_kg, 'Max payload (kg)'),
    volume_m3: numericNonNegative(values.volume_m3, 'Volume (m³)'),
    max_volume_m3: numericNonNegative(values.max_volume_m3, 'Max volume (m³)'),
    pallet_count: numericNonNegative(asInt(values.pallet_count), 'Pallet count'),
    status: asStatus(values.status) || 'draft',
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('load_plans').insert(payload).select(COLS).single())
}

/**
 * Patch a load plan. Strips immutable/ownership fields; coerces and validates
 * each field present so the stored value never drifts from the validated shape.
 */
export async function updateLoadPlan(id, patch = {}) {
  const clean = {}
  if (patch.reference !== undefined) {
    const reference = asText(patch.reference, 200)
    if (!reference) throw new Error('A plan reference is required.')
    clean.reference = reference
  }
  if (patch.asset_no !== undefined) clean.asset_no = asText(patch.asset_no, 120)
  if (patch.origin !== undefined) clean.origin = asText(patch.origin, 200)
  if (patch.destination !== undefined) clean.destination = asText(patch.destination, 200)
  if (patch.plan_date !== undefined) clean.plan_date = asDate(patch.plan_date)
  if (patch.cargo_type !== undefined) clean.cargo_type = asText(patch.cargo_type, 200)
  if (patch.cargo_weight_kg !== undefined) clean.cargo_weight_kg = numericNonNegative(patch.cargo_weight_kg, 'Cargo weight (kg)')
  if (patch.max_payload_kg !== undefined) clean.max_payload_kg = numericNonNegative(patch.max_payload_kg, 'Max payload (kg)')
  if (patch.volume_m3 !== undefined) clean.volume_m3 = numericNonNegative(patch.volume_m3, 'Volume (m³)')
  if (patch.max_volume_m3 !== undefined) clean.max_volume_m3 = numericNonNegative(patch.max_volume_m3, 'Max volume (m³)')
  if (patch.pallet_count !== undefined) clean.pallet_count = numericNonNegative(asInt(patch.pallet_count), 'Pallet count')
  if (patch.status !== undefined) clean.status = asStatus(patch.status)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('load_plans').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteLoadPlan(id) {
  return unwrap(await supabase.from('load_plans').delete().eq('id', id))
}
