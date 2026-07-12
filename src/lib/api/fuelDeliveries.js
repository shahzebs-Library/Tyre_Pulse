/**
 * Fuel Deliveries service — bulk fuel delivery registry (V148). Any authenticated
 * member of the org reads and manages deliveries (RLS enforces org isolation).
 * Mirrors fuelCards.js / support.js: explicit column lists, null-safe country
 * scoping, and validation/clamps at the boundary. `listDeliveries` degrades
 * gracefully when the table is absent so the page can prompt for the migration
 * instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'

export const COLS =
  'id,organisation_id,country,delivery_no,supplier,site,tank,litres,unit_price,' +
  'total_cost,delivered_at,status,notes,created_by,created_at,updated_at'

export const DELIVERY_STATUSES = ['ordered', 'delivered', 'cancelled']

/**
 * True when a Supabase/PostgREST error means the `fuel_deliveries` relation does
 * not exist yet (migration not applied). Covers Postgres 42P01, PostgREST
 * PGRST205, and message-text fallbacks. Anything else is a real error.
 */
export function isMissingDeliveriesTable(error) {
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
 * List fuel deliveries (newest delivery first). Optional status/site/country
 * filters. When the table is missing, returns `[]` so the page can show the
 * "apply migration" state without a hard failure.
 * @param {{ country?:string, status?:string, site?:string, limit?:number }} [opts]
 */
export async function listDeliveries({ country, status, site, limit = 500 } = {}) {
  let q = supabase.from('fuel_deliveries').select(COLS)
  if (status) q = q.eq('status', status)
  if (site) q = q.eq('site', site)
  q = applyCountry(q, country)
  const { data, error } = await q
    .order('delivered_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    if (isMissingDeliveriesTable(error)) return []
    throw error
  }
  return data || []
}

export async function getDelivery(id) {
  return unwrap(await supabase.from('fuel_deliveries').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Lightweight existence probe. Runs a HEAD count and reports whether the
 * `fuel_deliveries` relation is present, so the page can surface the "apply
 * migration" prompt without swallowing/duplicating query logic.
 * @returns {Promise<boolean>} true when the table is missing.
 */
export async function isDeliveriesTableMissing() {
  const { error } = await supabase
    .from('fuel_deliveries')
    .select('id', { head: true, count: 'exact' })
    .limit(1)
  return isMissingDeliveriesTable(error)
}

const clampText = (v, n) => (v ? String(v).slice(0, n) : null)
function numOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Create a delivery. Requires at least a supplier or a site so the record is
 * meaningful. Derives total_cost from litres × unit_price when not supplied.
 */
export async function createDelivery(values = {}) {
  const supplier = String(values.supplier || '').trim()
  const site = String(values.site || '').trim()
  if (!supplier && !site) throw new Error('A supplier or site is required.')

  const litres = numOrNull(values.litres)
  const unitPrice = numOrNull(values.unit_price)
  let totalCost = numOrNull(values.total_cost)
  if (totalCost == null && litres != null && unitPrice != null) {
    totalCost = Math.round(litres * unitPrice * 100) / 100
  }
  const status = DELIVERY_STATUSES.includes(values.status) ? values.status : 'delivered'

  const payload = {
    delivery_no: clampText(values.delivery_no, 64),
    supplier: clampText(supplier, 200),
    site: clampText(site, 200),
    tank: clampText(values.tank, 120),
    litres,
    unit_price: unitPrice,
    total_cost: totalCost,
    delivered_at: values.delivered_at || null,
    status,
    notes: clampText(values.notes, 8000),
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('fuel_deliveries').insert(payload).select(COLS).single())
}

/** Patch a delivery. Strips immutable columns; clamps and coerces provided fields. */
export async function updateDelivery(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.organisation_id
  delete clean.created_by
  delete clean.created_at
  delete clean.updated_at

  if ('supplier' in clean) clean.supplier = clampText(clean.supplier, 200)
  if ('site' in clean) clean.site = clampText(clean.site, 200)
  if ('tank' in clean) clean.tank = clampText(clean.tank, 120)
  if ('delivery_no' in clean) clean.delivery_no = clampText(clean.delivery_no, 64)
  if ('notes' in clean) clean.notes = clampText(clean.notes, 8000)
  if ('litres' in clean) clean.litres = numOrNull(clean.litres)
  if ('unit_price' in clean) clean.unit_price = numOrNull(clean.unit_price)
  if ('total_cost' in clean) clean.total_cost = numOrNull(clean.total_cost)
  if ('delivered_at' in clean) clean.delivered_at = clean.delivered_at || null
  if ('status' in clean && !DELIVERY_STATUSES.includes(clean.status)) delete clean.status

  return unwrap(await supabase.from('fuel_deliveries').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteDelivery(id) {
  return unwrap(await supabase.from('fuel_deliveries').delete().eq('id', id))
}
