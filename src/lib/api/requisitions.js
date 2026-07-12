/**
 * Purchase Requisitions service (V156) — internal purchase requests that precede
 * a Purchase Order (requester, item, quantity, estimated cost, needed-by, status).
 * Any authenticated member of the org reads and manages requisitions (RLS enforces
 * org isolation). Mirrors driverExpenses.js / support.js: explicit column lists,
 * null-safe country scoping, and validation/clamps at the boundary.
 * `listRequisitions` degrades gracefully when the table is absent so the page can
 * prompt for the migration instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'

export const COLS =
  'id,organisation_id,country,requisition_no,requester,item,category,quantity,est_cost,' +
  'needed_by,site,status,notes,created_by,created_at,updated_at'

export const REQUISITION_STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'ordered']
export const REQUISITION_CATEGORIES = [
  'tyres', 'tubes', 'rims', 'valves', 'tpms_sensors', 'lubricants', 'tools',
  'workshop_supplies', 'spare_parts', 'other',
]

/**
 * True when a Supabase/PostgREST error means the `requisitions` relation does not
 * exist yet (migration not applied). Covers Postgres 42P01, PostgREST PGRST205,
 * and message-text fallbacks. Anything else is a real error.
 */
export function isMissingRequisitionsTable(error) {
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
 * List requisitions (soonest needed-by first, newest fallback). Optional
 * status/country filters. When the table is missing, returns `[]` so the page
 * can show the "apply migration" state without a hard failure.
 * @param {{ country?:string, status?:string, limit?:number }} [opts]
 */
export async function listRequisitions({ country, status, limit = 500 } = {}) {
  let q = supabase.from('requisitions').select(COLS)
  if (status) q = q.eq('status', status)
  q = applyCountry(q, country)
  const { data, error } = await q
    .order('needed_by', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    if (isMissingRequisitionsTable(error)) return []
    throw error
  }
  return data || []
}

export async function getRequisition(id) {
  return unwrap(await supabase.from('requisitions').select(COLS).eq('id', id).maybeSingle())
}

const clampText = (v, n) => (v ? String(v).slice(0, n) : null)
function numOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Create a requisition. Requires an item so the record is meaningful. Coerces
 * numeric fields, clamps free-text, and validates status against the lifecycle.
 */
export async function createRequisition(values = {}) {
  const item = String(values.item || '').trim()
  if (!item) throw new Error('An item is required.')

  const status = REQUISITION_STATUSES.includes(values.status) ? values.status : 'draft'
  const payload = {
    requisition_no: clampText(values.requisition_no, 120),
    requester: clampText(values.requester, 200),
    item: clampText(item, 300),
    category: clampText(values.category, 80),
    quantity: numOrNull(values.quantity),
    est_cost: numOrNull(values.est_cost),
    needed_by: values.needed_by || null,
    site: clampText(values.site, 200),
    status,
    notes: clampText(values.notes, 8000),
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('requisitions').insert(payload).select(COLS).single())
}

/** Patch a requisition. Strips immutable columns; clamps and coerces provided fields. */
export async function updateRequisition(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.organisation_id
  delete clean.created_by
  delete clean.created_at
  delete clean.updated_at

  if ('item' in clean) {
    const it = String(clean.item || '').trim()
    if (!it) throw new Error('An item is required.')
    clean.item = clampText(it, 300)
  }
  if ('requisition_no' in clean) clean.requisition_no = clampText(clean.requisition_no, 120)
  if ('requester' in clean) clean.requester = clampText(clean.requester, 200)
  if ('category' in clean) clean.category = clampText(clean.category, 80)
  if ('site' in clean) clean.site = clampText(clean.site, 200)
  if ('notes' in clean) clean.notes = clampText(clean.notes, 8000)
  if ('quantity' in clean) clean.quantity = numOrNull(clean.quantity)
  if ('est_cost' in clean) clean.est_cost = numOrNull(clean.est_cost)
  if ('needed_by' in clean) clean.needed_by = clean.needed_by || null
  if ('status' in clean && !REQUISITION_STATUSES.includes(clean.status)) delete clean.status

  return unwrap(await supabase.from('requisitions').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteRequisition(id) {
  return unwrap(await supabase.from('requisitions').delete().eq('id', id))
}
