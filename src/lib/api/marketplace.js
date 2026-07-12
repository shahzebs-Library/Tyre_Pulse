/**
 * Supplier Marketplace service — the single seam between the Supplier
 * Marketplace page (/supplier-marketplace) and Supabase (tables
 * `marketplace_listings` and `marketplace_rfqs`, V196). Keeps explicit column
 * lists (least-privilege selects), null-safe country scoping, whitelist-based
 * enum validation and non-negative numeric checks. RLS enforces org isolation;
 * this layer never trusts client input blindly.
 *
 * Mirrors odometerLogs.js. A missing relation (org has not run the migration)
 * degrades listing to an empty array so the page can render its "apply the
 * migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../marketplace'

export const LISTING_COLS =
  'id,organisation_id,country,listing_no,supplier,category,product_name,brand,' +
  'size_spec,unit_price,currency,moq,lead_time_days,rating,in_stock,status,' +
  'notes,created_by,created_at,updated_at'

export const RFQ_COLS =
  'id,organisation_id,country,rfq_no,product_name,category,quantity,target_price,' +
  'currency,needed_by,responses_count,best_quote,awarded_supplier,status,notes,' +
  'created_by,created_at,updated_at'

const LISTING_CATEGORIES = new Set(['tyre', 'retread', 'parts', 'service', 'other'])
const LISTING_STATUSES = new Set(['active', 'out_of_stock', 'archived'])
const RFQ_STATUSES = new Set(['open', 'quoting', 'awarded', 'closed', 'cancelled'])

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && (msg.includes('marketplace_listings') || msg.includes('marketplace_rfqs')))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asNotes = (v) => (v ? String(v).slice(0, 8000) : null)
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
const asEnum = (v, set) => {
  const s = asText(v, 40)
  return s && set.has(s) ? s : null
}
const asBool = (v) => {
  if (v === true || v === 'true' || v === 1 || v === '1') return true
  if (v === false || v === 'false' || v === 0 || v === '0') return false
  return null
}

/**
 * Coerce a numeric field, enforcing non-negativity. Returns null when absent;
 * throws with a field-named message when present but invalid/negative.
 */
function numericField(value, label, { integer = false } = {}) {
  if (value === undefined || value === null || value === '') return null
  const n = toFiniteNumber(value)
  if (n == null) throw new Error(`${label} must be a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return integer ? Math.round(n) : n
}

// ── Listings ────────────────────────────────────────────────────────────────

/**
 * List marketplace listings (newest first). Optional `country` filter. Returns
 * [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listMarketplaceListings({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('marketplace_listings').select(LISTING_COLS)
    q = applyCountry(q, country)
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getListing(id) {
  return unwrap(await supabase.from('marketplace_listings').select(LISTING_COLS).eq('id', id).maybeSingle())
}

/**
 * Create a listing. Requires a supplier. Numeric fields are validated
 * non-negative; category/status are whitelisted; in_stock is coerced boolean.
 */
export async function createListing(values = {}) {
  const supplier = asText(values.supplier, 200)
  if (!supplier) throw new Error('A supplier is required.')

  const inStock = asBool(values.in_stock)
  const payload = {
    supplier,
    listing_no: asText(values.listing_no, 120),
    category: asEnum(values.category, LISTING_CATEGORIES),
    product_name: asText(values.product_name, 200),
    brand: asText(values.brand, 120),
    size_spec: asText(values.size_spec, 120),
    unit_price: numericField(values.unit_price, 'Unit price'),
    currency: asText(values.currency, 8),
    moq: numericField(values.moq, 'MOQ', { integer: true }),
    lead_time_days: numericField(values.lead_time_days, 'Lead time (days)'),
    rating: numericField(values.rating, 'Rating'),
    in_stock: inStock == null ? true : inStock,
    status: asEnum(values.status, LISTING_STATUSES),
    notes: asNotes(values.notes),
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('marketplace_listings').insert(payload).select(LISTING_COLS).single())
}

/**
 * Patch a listing. Strips immutable/ownership fields; coerces each field present
 * so the stored value never drifts from the validated shape.
 */
export async function updateListing(id, patch = {}) {
  const clean = {}
  if (patch.supplier !== undefined) {
    const supplier = asText(patch.supplier, 200)
    if (!supplier) throw new Error('A supplier is required.')
    clean.supplier = supplier
  }
  if (patch.listing_no !== undefined) clean.listing_no = asText(patch.listing_no, 120)
  if (patch.category !== undefined) clean.category = asEnum(patch.category, LISTING_CATEGORIES)
  if (patch.product_name !== undefined) clean.product_name = asText(patch.product_name, 200)
  if (patch.brand !== undefined) clean.brand = asText(patch.brand, 120)
  if (patch.size_spec !== undefined) clean.size_spec = asText(patch.size_spec, 120)
  if (patch.unit_price !== undefined) clean.unit_price = numericField(patch.unit_price, 'Unit price')
  if (patch.currency !== undefined) clean.currency = asText(patch.currency, 8)
  if (patch.moq !== undefined) clean.moq = numericField(patch.moq, 'MOQ', { integer: true })
  if (patch.lead_time_days !== undefined) clean.lead_time_days = numericField(patch.lead_time_days, 'Lead time (days)')
  if (patch.rating !== undefined) clean.rating = numericField(patch.rating, 'Rating')
  if (patch.in_stock !== undefined) { const b = asBool(patch.in_stock); clean.in_stock = b == null ? true : b }
  if (patch.status !== undefined) clean.status = asEnum(patch.status, LISTING_STATUSES)
  if (patch.notes !== undefined) clean.notes = asNotes(patch.notes)
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('marketplace_listings').update(clean).eq('id', id).select(LISTING_COLS).single())
}

export async function deleteListing(id) {
  return unwrap(await supabase.from('marketplace_listings').delete().eq('id', id))
}

// ── RFQs ────────────────────────────────────────────────────────────────────

/**
 * List RFQs (newest first). Optional `country` filter. Returns [] when the
 * table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listRfqs({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('marketplace_rfqs').select(RFQ_COLS)
    q = applyCountry(q, country)
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getRfq(id) {
  return unwrap(await supabase.from('marketplace_rfqs').select(RFQ_COLS).eq('id', id).maybeSingle())
}

/**
 * Create an RFQ. Requires a product_name. Numeric fields are validated
 * non-negative; status is whitelisted.
 */
export async function createRfq(values = {}) {
  const product_name = asText(values.product_name, 200)
  if (!product_name) throw new Error('A product name is required.')

  const payload = {
    product_name,
    rfq_no: asText(values.rfq_no, 120),
    category: asText(values.category, 40),
    quantity: numericField(values.quantity, 'Quantity'),
    target_price: numericField(values.target_price, 'Target price'),
    currency: asText(values.currency, 8),
    needed_by: asDate(values.needed_by),
    responses_count: numericField(values.responses_count, 'Responses count', { integer: true }),
    best_quote: numericField(values.best_quote, 'Best quote'),
    awarded_supplier: asText(values.awarded_supplier, 200),
    status: asEnum(values.status, RFQ_STATUSES),
    notes: asNotes(values.notes),
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('marketplace_rfqs').insert(payload).select(RFQ_COLS).single())
}

/**
 * Patch an RFQ. Strips immutable/ownership fields; coerces each field present.
 */
export async function updateRfq(id, patch = {}) {
  const clean = {}
  if (patch.product_name !== undefined) {
    const product_name = asText(patch.product_name, 200)
    if (!product_name) throw new Error('A product name is required.')
    clean.product_name = product_name
  }
  if (patch.rfq_no !== undefined) clean.rfq_no = asText(patch.rfq_no, 120)
  if (patch.category !== undefined) clean.category = asText(patch.category, 40)
  if (patch.quantity !== undefined) clean.quantity = numericField(patch.quantity, 'Quantity')
  if (patch.target_price !== undefined) clean.target_price = numericField(patch.target_price, 'Target price')
  if (patch.currency !== undefined) clean.currency = asText(patch.currency, 8)
  if (patch.needed_by !== undefined) clean.needed_by = asDate(patch.needed_by)
  if (patch.responses_count !== undefined) clean.responses_count = numericField(patch.responses_count, 'Responses count', { integer: true })
  if (patch.best_quote !== undefined) clean.best_quote = numericField(patch.best_quote, 'Best quote')
  if (patch.awarded_supplier !== undefined) clean.awarded_supplier = asText(patch.awarded_supplier, 200)
  if (patch.status !== undefined) clean.status = asEnum(patch.status, RFQ_STATUSES)
  if (patch.notes !== undefined) clean.notes = asNotes(patch.notes)
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('marketplace_rfqs').update(clean).eq('id', id).select(RFQ_COLS).single())
}

export async function deleteRfq(id) {
  return unwrap(await supabase.from('marketplace_rfqs').delete().eq('id', id))
}
