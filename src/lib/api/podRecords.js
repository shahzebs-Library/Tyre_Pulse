/**
 * Proof of Delivery (POD) service — the single seam between the Proof of
 * Delivery page (/proof-of-delivery) and Supabase (table `pod_records`, V179).
 * Keeps an explicit column list (least-privilege selects), null-safe country
 * scoping, and input validation. RLS enforces org isolation; this layer never
 * trusts client input blindly.
 *
 * Mirrors odometerLogs.js. A missing `pod_records` relation (org has not run the
 * migration) degrades listing to an empty array so the page can render its
 * "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../podRecords'
import { safeHref } from '../safeUrl'

/** Scheme-guard a URL on write: safe → the string, anything unsafe/blank → null. */
const asUrl = (v) => { const s = safeHref(v); return s === undefined ? null : s }

export const COLS =
  'id,organisation_id,country,pod_no,asset_no,driver_name,customer_name,' +
  'delivery_address,order_ref,delivered_at,received_by,signature_url,photo_url,' +
  'items_count,status,failure_reason,notes,created_by,created_at,updated_at'

const STATUSES = ['pending', 'delivered', 'partial', 'failed', 'returned']

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('pod_records'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const asStatus = (v) => {
  const s = asText(v, 40)
  if (!s) return null
  const lower = s.toLowerCase()
  return STATUSES.includes(lower) ? lower : null
}

/**
 * List POD records (newest first by delivered_at, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listPodRecords({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('pod_records').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('delivered_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getPodRecord(id) {
  return unwrap(await supabase.from('pod_records').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Capture a POD record. Requires a customer name (who the delivery was for).
 * items_count, when supplied, must be a non-negative number; status, when
 * supplied, is whitelisted against the delivery enum. delivered_at defaults to
 * now when omitted.
 */
export async function createPodRecord(values = {}) {
  const customer_name = asText(values.customer_name, 240)
  if (!customer_name) throw new Error('A customer name is required.')

  let items_count = null
  if (values.items_count !== undefined && values.items_count !== null && values.items_count !== '') {
    items_count = toFiniteNumber(values.items_count)
    if (items_count == null) throw new Error('Items count must be a number.')
    if (items_count < 0) throw new Error('Items count cannot be negative.')
    items_count = Math.trunc(items_count)
  }

  const payload = {
    pod_no: asText(values.pod_no, 120),
    asset_no: asText(values.asset_no, 120),
    driver_name: asText(values.driver_name, 200),
    customer_name,
    delivery_address: values.delivery_address ? String(values.delivery_address).slice(0, 2000) : null,
    order_ref: asText(values.order_ref, 120),
    delivered_at: asDate(values.delivered_at) || new Date().toISOString(),
    received_by: asText(values.received_by, 200),
    signature_url: asUrl(asText(values.signature_url, 2000)),
    photo_url: asUrl(asText(values.photo_url, 2000)),
    items_count,
    status: asStatus(values.status),
    failure_reason: values.failure_reason ? String(values.failure_reason).slice(0, 2000) : null,
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('pod_records').insert(payload).select(COLS).single())
}

/**
 * Patch a POD record. Strips immutable/ownership fields; coerces each field
 * present so the stored value never drifts from the validated shape.
 */
export async function updatePodRecord(id, patch = {}) {
  const clean = {}
  if (patch.customer_name !== undefined) {
    const customer_name = asText(patch.customer_name, 240)
    if (!customer_name) throw new Error('A customer name is required.')
    clean.customer_name = customer_name
  }
  if (patch.items_count !== undefined) {
    if (patch.items_count === null || patch.items_count === '') {
      clean.items_count = null
    } else {
      const items_count = toFiniteNumber(patch.items_count)
      if (items_count == null) throw new Error('Items count must be a number.')
      if (items_count < 0) throw new Error('Items count cannot be negative.')
      clean.items_count = Math.trunc(items_count)
    }
  }
  if (patch.status !== undefined) clean.status = asStatus(patch.status)
  if (patch.pod_no !== undefined) clean.pod_no = asText(patch.pod_no, 120)
  if (patch.asset_no !== undefined) clean.asset_no = asText(patch.asset_no, 120)
  if (patch.driver_name !== undefined) clean.driver_name = asText(patch.driver_name, 200)
  if (patch.delivery_address !== undefined) clean.delivery_address = patch.delivery_address ? String(patch.delivery_address).slice(0, 2000) : null
  if (patch.order_ref !== undefined) clean.order_ref = asText(patch.order_ref, 120)
  if (patch.delivered_at !== undefined) clean.delivered_at = asDate(patch.delivered_at)
  if (patch.received_by !== undefined) clean.received_by = asText(patch.received_by, 200)
  if (patch.signature_url !== undefined) clean.signature_url = asUrl(asText(patch.signature_url, 2000))
  if (patch.photo_url !== undefined) clean.photo_url = asUrl(asText(patch.photo_url, 2000))
  if (patch.failure_reason !== undefined) clean.failure_reason = patch.failure_reason ? String(patch.failure_reason).slice(0, 2000) : null
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('pod_records').update(clean).eq('id', id).select(COLS).single())
}

export async function deletePodRecord(id) {
  return unwrap(await supabase.from('pod_records').delete().eq('id', id))
}
