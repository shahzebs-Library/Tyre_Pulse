/**
 * Parts Catalog service — master spare-parts inventory (V140). Any authenticated
 * member reads; Admin/Manager/Director create/update/delete (RLS enforces both,
 * plus org isolation). Mirrors support.js / contracts.js: explicit column lists,
 * null-safe country scoping, and validation/clamps at the boundary. `listParts`
 * degrades gracefully to `[]` when the table is absent so the page can prompt
 * for the migration instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'

export const COLS =
  'id,organisation_id,country,part_no,name,category,unit_cost,on_hand_qty,' +
  'reorder_level,supplier,uom,status,notes,created_by,created_at,updated_at'

export const PART_STATUSES = ['active', 'discontinued']

/**
 * True when a Supabase/PostgREST error means the `parts_catalog` relation does
 * not exist yet (migration not applied). Covers Postgres 42P01, PostgREST
 * PGRST205, and message-text fallbacks. Anything else is a real error.
 */
export function isMissingPartsTable(error) {
  if (!error) return false
  const code = String(error.code || '')
  if (code === '42P01' || code === 'PGRST205') return true
  const msg = String(error.message || '').toLowerCase()
  return (
    /relation .* does not exist/.test(msg) ||
    (msg.includes('does not exist') && msg.includes('relation')) ||
    (msg.includes('could not find the table') && msg.includes('schema cache'))
  )
}

/**
 * List parts (newest first). Optional status/category/country filters. When the
 * table is missing, resolves to `[]` (tagged via a non-enumerable `missing`
 * flag) so the page can show the "apply migration" state without a hard failure.
 * @param {{ country?:string, status?:string, category?:string, limit?:number }} [opts]
 */
export async function listParts({ country, status, category, limit = 1000 } = {}) {
  let q = supabase.from('parts_catalog').select(COLS)
  if (status) q = q.eq('status', status)
  if (category) q = q.eq('category', category)
  q = applyCountry(q, country)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)
  if (error) {
    if (isMissingPartsTable(error)) {
      const out = []
      Object.defineProperty(out, 'missing', { value: true, enumerable: false })
      return out
    }
    throw error
  }
  return data || []
}

export async function getPart(id) {
  return unwrap(await supabase.from('parts_catalog').select(COLS).eq('id', id).maybeSingle())
}

function normStatus(s) {
  return PART_STATUSES.includes(s) ? s : 'active'
}
function numOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Create a part. Requires a part number; clamps free-text; coerces numerics. */
export async function createPart(values = {}) {
  const part_no = String(values.part_no || '').trim()
  if (!part_no) throw new Error('A part number is required.')
  const onHand = numOrNull(values.on_hand_qty)
  const payload = {
    part_no: part_no.slice(0, 120),
    name: values.name ? String(values.name).slice(0, 200) : null,
    category: values.category ? String(values.category).slice(0, 80) : null,
    unit_cost: numOrNull(values.unit_cost),
    on_hand_qty: onHand == null ? 0 : onHand,
    reorder_level: numOrNull(values.reorder_level),
    supplier: values.supplier ? String(values.supplier).slice(0, 200) : null,
    uom: values.uom ? String(values.uom).slice(0, 40) : null,
    status: normStatus(values.status),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('parts_catalog').insert(payload).select(COLS).single())
}

/** Patch a part. Strips immutable columns; clamps and coerces provided fields. */
export async function updatePart(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.organisation_id
  delete clean.created_by
  delete clean.created_at
  delete clean.updated_at
  if ('part_no' in clean) {
    const p = String(clean.part_no || '').trim()
    if (!p) throw new Error('A part number is required.')
    clean.part_no = p.slice(0, 120)
  }
  if ('name' in clean) clean.name = clean.name ? String(clean.name).slice(0, 200) : null
  if ('category' in clean) clean.category = clean.category ? String(clean.category).slice(0, 80) : null
  if ('supplier' in clean) clean.supplier = clean.supplier ? String(clean.supplier).slice(0, 200) : null
  if ('uom' in clean) clean.uom = clean.uom ? String(clean.uom).slice(0, 40) : null
  if ('notes' in clean) clean.notes = clean.notes ? String(clean.notes).slice(0, 8000) : null
  if ('status' in clean) clean.status = normStatus(clean.status)
  if ('unit_cost' in clean) clean.unit_cost = numOrNull(clean.unit_cost)
  if ('reorder_level' in clean) clean.reorder_level = numOrNull(clean.reorder_level)
  if ('on_hand_qty' in clean) {
    const q = numOrNull(clean.on_hand_qty)
    clean.on_hand_qty = q == null ? 0 : q
  }
  return unwrap(await supabase.from('parts_catalog').update(clean).eq('id', id).select(COLS).single())
}

export async function deletePart(id) {
  return unwrap(await supabase.from('parts_catalog').delete().eq('id', id))
}
