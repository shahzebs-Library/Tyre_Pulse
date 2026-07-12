/**
 * Fleet Groups service — the single seam between the Fleet Groups page
 * (/fleet-groups) and Supabase (table `fleet_groups`, V189). Keeps an explicit
 * column list (least-privilege selects), null-safe country scoping, and input
 * validation. RLS enforces org isolation; this layer never trusts client input
 * blindly.
 *
 * Mirrors odometerLogs.js. A missing `fleet_groups` relation (org has not run
 * the migration) degrades listing to an empty array so the page can render its
 * "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../fleetGroups'

export const COLS =
  'id,organisation_id,country,group_name,group_code,group_type,parent_group,' +
  'manager,region,asset_count,active,budget,currency,notes,created_by,' +
  'created_at,updated_at'

/** Allowed group_type values — mirrors the CHECK constraint in V189. */
export const GROUP_TYPES = ['holding', 'subsidiary', 'division', 'depot', 'cost_center', 'custom']

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('fleet_groups'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asType = (v) => {
  const t = asText(v, 40)
  return t && GROUP_TYPES.includes(t) ? t : null
}
const asNonNegInt = (v, field) => {
  const n = toFiniteNumber(v)
  if (n == null) return null
  if (n < 0) throw new Error(`${field} cannot be negative.`)
  return Math.round(n)
}
const asNonNegNum = (v, field) => {
  const n = toFiniteNumber(v)
  if (n == null) return null
  if (n < 0) throw new Error(`${field} cannot be negative.`)
  return n
}

/**
 * List groups (group_name asc, then created_at desc). Optional `country` filter.
 * Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listFleetGroups({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('fleet_groups').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('group_name', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getFleetGroup(id) {
  return unwrap(await supabase.from('fleet_groups').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Create a group. Requires a group name. Numeric fields are validated
 * non-negative; group_type is whitelisted; active is coerced to a boolean.
 */
export async function createFleetGroup(values = {}) {
  const group_name = asText(values.group_name, 200)
  if (!group_name) throw new Error('A group name is required.')

  const payload = {
    group_name,
    group_code: asText(values.group_code, 60),
    group_type: asType(values.group_type),
    parent_group: asText(values.parent_group, 200),
    manager: asText(values.manager, 200),
    region: asText(values.region, 200),
    asset_count: asNonNegInt(values.asset_count, 'Asset count'),
    active: values.active === undefined || values.active === null ? true : Boolean(values.active),
    budget: asNonNegNum(values.budget, 'Budget'),
    currency: asText(values.currency, 8),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('fleet_groups').insert(payload).select(COLS).single())
}

/**
 * Patch a group. Strips immutable/ownership fields; coerces each field present
 * so the stored value never drifts from the validated shape.
 */
export async function updateFleetGroup(id, patch = {}) {
  const clean = {}
  if (patch.group_name !== undefined) {
    const group_name = asText(patch.group_name, 200)
    if (!group_name) throw new Error('A group name is required.')
    clean.group_name = group_name
  }
  if (patch.group_code !== undefined) clean.group_code = asText(patch.group_code, 60)
  if (patch.group_type !== undefined) clean.group_type = asType(patch.group_type)
  if (patch.parent_group !== undefined) clean.parent_group = asText(patch.parent_group, 200)
  if (patch.manager !== undefined) clean.manager = asText(patch.manager, 200)
  if (patch.region !== undefined) clean.region = asText(patch.region, 200)
  if (patch.asset_count !== undefined) clean.asset_count = asNonNegInt(patch.asset_count, 'Asset count')
  if (patch.active !== undefined) clean.active = Boolean(patch.active)
  if (patch.budget !== undefined) clean.budget = asNonNegNum(patch.budget, 'Budget')
  if (patch.currency !== undefined) clean.currency = asText(patch.currency, 8)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('fleet_groups').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteFleetGroup(id) {
  return unwrap(await supabase.from('fleet_groups').delete().eq('id', id))
}
