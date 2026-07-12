/**
 * Materials Management service — the single seam between the Materials page
 * (/materials) and Supabase (table `materials`, V190). Manages the workshop's
 * consumable/material inventory (oils, filters, valves, sealants, greases,
 * coolants, cleaning agents, fasteners and other shop consumables), distinct
 * from the fitment-grade tyre Parts Catalog.
 *
 * Keeps an explicit column list (least-privilege selects), null-safe country
 * scoping, and input validation. RLS enforces org isolation; this layer never
 * trusts client input blindly. A missing `materials` relation (org has not run
 * the migration) degrades listing to an empty array so the page can render its
 * "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../materials'

export const COLS =
  'id,organisation_id,country,sku,name,category,unit,quantity_on_hand,' +
  'reorder_point,reorder_qty,unit_cost,currency,supplier,location,status,' +
  'notes,created_by,created_at,updated_at'

const CATEGORIES = new Set([
  'oil', 'filter', 'valve', 'sealant', 'grease', 'coolant', 'cleaning',
  'fastener', 'consumable', 'other',
])
const STATUSES = new Set(['active', 'low', 'out_of_stock', 'discontinued'])

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('materials'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))

/**
 * Coerce a numeric field to a non-negative number. Returns undefined when the
 * value is absent (so it can be omitted from a patch); throws on invalid or
 * negative input.
 */
function asNonNegative(v, label) {
  if (v === undefined || v === null || v === '') return undefined
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${label} must be a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

const asCategory = (v) => {
  const c = asText(v, 40)
  return c && CATEGORIES.has(c) ? c : null
}
const asStatus = (v) => {
  const s = asText(v, 40)
  return s && STATUSES.has(s) ? s : null
}

/**
 * List materials (name asc, then created_at desc as a stable tiebreaker).
 * Optional `country` filter. Returns [] when the table has not been provisioned
 * yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listMaterials({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('materials').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('name', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getMaterial(id) {
  return unwrap(await supabase.from('materials').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Add a material. Requires a name. Numeric fields are validated as non-negative;
 * category and status are whitelisted against the allowed enums.
 */
export async function createMaterial(values = {}) {
  const name = asText(values.name, 200)
  if (!name) throw new Error('A material name is required.')

  const payload = {
    name,
    sku: asText(values.sku, 120),
    category: asCategory(values.category),
    unit: asText(values.unit, 40),
    quantity_on_hand: asNonNegative(values.quantity_on_hand, 'Quantity on hand') ?? 0,
    reorder_point: asNonNegative(values.reorder_point, 'Reorder point') ?? 0,
    reorder_qty: asNonNegative(values.reorder_qty, 'Reorder quantity') ?? 0,
    unit_cost: asNonNegative(values.unit_cost, 'Unit cost') ?? 0,
    currency: asText(values.currency, 8),
    supplier: asText(values.supplier, 200),
    location: asText(values.location, 200),
    status: asStatus(values.status),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('materials').insert(payload).select(COLS).single())
}

/**
 * Patch a material. Strips immutable/ownership fields (id, organisation_id,
 * created_by, created_at, updated_at); coerces each field present so the stored
 * value never drifts from the validated shape.
 */
export async function updateMaterial(id, patch = {}) {
  const clean = {}
  if (patch.name !== undefined) {
    const name = asText(patch.name, 200)
    if (!name) throw new Error('A material name is required.')
    clean.name = name
  }
  if (patch.sku !== undefined) clean.sku = asText(patch.sku, 120)
  if (patch.category !== undefined) clean.category = asCategory(patch.category)
  if (patch.unit !== undefined) clean.unit = asText(patch.unit, 40)
  if (patch.quantity_on_hand !== undefined) {
    clean.quantity_on_hand = asNonNegative(patch.quantity_on_hand, 'Quantity on hand') ?? 0
  }
  if (patch.reorder_point !== undefined) {
    clean.reorder_point = asNonNegative(patch.reorder_point, 'Reorder point') ?? 0
  }
  if (patch.reorder_qty !== undefined) {
    clean.reorder_qty = asNonNegative(patch.reorder_qty, 'Reorder quantity') ?? 0
  }
  if (patch.unit_cost !== undefined) {
    clean.unit_cost = asNonNegative(patch.unit_cost, 'Unit cost') ?? 0
  }
  if (patch.currency !== undefined) clean.currency = asText(patch.currency, 8)
  if (patch.supplier !== undefined) clean.supplier = asText(patch.supplier, 200)
  if (patch.location !== undefined) clean.location = asText(patch.location, 200)
  if (patch.status !== undefined) clean.status = asStatus(patch.status)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('materials').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteMaterial(id) {
  return unwrap(await supabase.from('materials').delete().eq('id', id))
}
