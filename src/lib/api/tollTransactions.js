/**
 * Toll Transactions service — the single seam between the Toll Transactions page
 * (/toll-transactions) and Supabase (table `toll_transactions`, V169). Keeps an
 * explicit column list (least-privilege selects), null-safe country scoping, and
 * input validation. RLS enforces org isolation; this layer never trusts client
 * input blindly.
 *
 * Mirrors odometerLogs.js. A missing `toll_transactions` relation (org has not
 * run the migration) degrades listing to an empty array so the page can render
 * its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../tollTransactions'

export const COLS =
  'id,organisation_id,country,asset_no,driver_name,tag_id,plaza_name,highway,' +
  'transaction_at,amount,currency,payment_method,status,notes,created_by,' +
  'created_at,updated_at'

const PAYMENT_METHODS = new Set(['tag', 'cash', 'card', 'account', 'other'])
const STATUSES = new Set(['posted', 'disputed', 'reconciled', 'refunded'])

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('toll_transactions'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asTimestamp = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const asEnum = (v, set) => {
  const s = asText(v, 40)
  if (s == null) return null
  const lower = s.toLowerCase()
  return set.has(lower) ? lower : null
}

/**
 * List toll charges (newest first by transaction_at, then created_at). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listTollTransactions({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('toll_transactions').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('transaction_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getTollTransaction(id) {
  return unwrap(await supabase.from('toll_transactions').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Record a toll charge. Requires an asset number (which vehicle). Amount, when
 * supplied, must be a non-negative number. Payment method and status are
 * validated against their allowed sets (unknown values are dropped to null).
 */
export async function createTollTransaction(values = {}) {
  const asset_no = asText(values.asset_no, 120)
  if (!asset_no) throw new Error('An asset number is required.')

  let amount = null
  if (values.amount !== '' && values.amount != null) {
    amount = toFiniteNumber(values.amount)
    if (amount == null) throw new Error('Amount must be a number.')
    if (amount < 0) throw new Error('Amount cannot be negative.')
  }

  const payload = {
    asset_no,
    driver_name: asText(values.driver_name, 200),
    tag_id: asText(values.tag_id, 120),
    plaza_name: asText(values.plaza_name, 200),
    highway: asText(values.highway, 200),
    transaction_at: asTimestamp(values.transaction_at),
    amount,
    currency: asText(values.currency, 12),
    payment_method: asEnum(values.payment_method, PAYMENT_METHODS),
    status: asEnum(values.status, STATUSES),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('toll_transactions').insert(payload).select(COLS).single())
}

/**
 * Patch a toll charge. Strips immutable/ownership fields; coerces each field
 * present so the stored value never drifts from the validated shape.
 */
export async function updateTollTransaction(id, patch = {}) {
  const clean = {}
  if (patch.asset_no !== undefined) {
    const asset_no = asText(patch.asset_no, 120)
    if (!asset_no) throw new Error('An asset number is required.')
    clean.asset_no = asset_no
  }
  if (patch.amount !== undefined) {
    if (patch.amount === '' || patch.amount == null) {
      clean.amount = null
    } else {
      const amount = toFiniteNumber(patch.amount)
      if (amount == null) throw new Error('Amount must be a number.')
      if (amount < 0) throw new Error('Amount cannot be negative.')
      clean.amount = amount
    }
  }
  if (patch.driver_name !== undefined) clean.driver_name = asText(patch.driver_name, 200)
  if (patch.tag_id !== undefined) clean.tag_id = asText(patch.tag_id, 120)
  if (patch.plaza_name !== undefined) clean.plaza_name = asText(patch.plaza_name, 200)
  if (patch.highway !== undefined) clean.highway = asText(patch.highway, 200)
  if (patch.transaction_at !== undefined) clean.transaction_at = asTimestamp(patch.transaction_at)
  if (patch.currency !== undefined) clean.currency = asText(patch.currency, 12)
  if (patch.payment_method !== undefined) clean.payment_method = asEnum(patch.payment_method, PAYMENT_METHODS)
  if (patch.status !== undefined) clean.status = asEnum(patch.status, STATUSES)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('toll_transactions').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteTollTransaction(id) {
  return unwrap(await supabase.from('toll_transactions').delete().eq('id', id))
}
