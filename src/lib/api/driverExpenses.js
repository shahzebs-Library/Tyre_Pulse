/**
 * Driver Expenses service — driver expense-claim registry (V152). Any
 * authenticated member of the org reads and manages claims (RLS enforces org
 * isolation). Mirrors fuelDeliveries.js / support.js: explicit column lists,
 * null-safe country scoping, and validation/clamps at the boundary.
 * `listExpenses` degrades gracefully when the table is absent so the page can
 * prompt for the migration instead of erroring.
 */
import { supabase, unwrap, applyCountry, toServiceError } from './_client'

export const COLS =
  'id,organisation_id,country,driver_name,category,amount,expense_date,asset_no,' +
  'status,description,created_by,created_at,updated_at'

export const EXPENSE_STATUSES = ['pending', 'approved', 'rejected', 'reimbursed']
export const EXPENSE_CATEGORIES = [
  'fuel', 'toll', 'parking', 'meals', 'accommodation', 'maintenance', 'training', 'other',
]

/**
 * True when a Supabase/PostgREST error means the `driver_expenses` relation does
 * not exist yet (migration not applied). Covers Postgres 42P01, PostgREST
 * PGRST205, and message-text fallbacks. Anything else is a real error.
 */
export function isMissingExpensesTable(error) {
  if (!error) return false
  const code = String(error.code || error.cause?.code || '')
  if (code === '42P01' || code === 'PGRST205') return true
  const msg = String(error?.cause?.message ?? error?.message ?? '').toLowerCase()
  return (
    /relation .* does not exist/.test(msg) ||
    (msg.includes('does not exist') && msg.includes('relation')) ||
    (msg.includes('could not find the table') && msg.includes('schema cache'))
  )
}

/**
 * List expense claims (newest expense first). Optional status/country filters.
 * When the table is missing, returns `[]` so the page can show the "apply
 * migration" state without a hard failure.
 * @param {{ country?:string, status?:string, limit?:number }} [opts]
 */
export async function listExpenses({ country, status, limit = 500 } = {}) {
  let q = supabase.from('driver_expenses').select(COLS)
  if (status) q = q.eq('status', status)
  q = applyCountry(q, country)
  const { data, error } = await q
    .order('expense_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    if (isMissingExpensesTable(error)) return []
    throw toServiceError(error)
  }
  return data || []
}

export async function getExpense(id) {
  return unwrap(await supabase.from('driver_expenses').select(COLS).eq('id', id).maybeSingle())
}

const clampText = (v, n) => (v ? String(v).slice(0, n) : null)
function numOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Create an expense claim. Requires a driver name so the record is meaningful.
 * Coerces amount to a number, clamps free-text fields, and validates status.
 */
export async function createExpense(values = {}) {
  const driverName = String(values.driver_name || '').trim()
  if (!driverName) throw new Error('A driver name is required.')

  const status = EXPENSE_STATUSES.includes(values.status) ? values.status : 'pending'
  const payload = {
    driver_name: clampText(driverName, 200),
    category: clampText(values.category, 80),
    amount: numOrNull(values.amount),
    expense_date: values.expense_date || null,
    asset_no: clampText(values.asset_no, 120),
    status,
    description: clampText(values.description, 8000),
    country: values.country ?? null,
  }
  const created = unwrap(await supabase.from('driver_expenses').insert(payload).select(COLS).single())
  // Since migration 20261126170000 the server records every new claim as
  // pending; any other status is a review and goes through the stamped RPC.
  if (created && status !== 'pending' && created.status !== status) {
    try {
      return await reviewExpense(created.id, status, values.review_reason || 'Status set when the claim was recorded')
    } catch (e) {
      // The claim exists; never let a refused review look like a failed save
      // (a retry would duplicate it). Report it as recorded but still pending.
      return { ...created, review_error: e?.message || 'The review was not recorded.' }
    }
  }
  return created
}

/** Patch a claim. Strips immutable columns; clamps and coerces provided fields. */
export async function updateExpense(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.organisation_id
  delete clean.created_by
  delete clean.created_at
  delete clean.updated_at

  if ('driver_name' in clean) {
    const dn = String(clean.driver_name || '').trim()
    if (!dn) throw new Error('A driver name is required.')
    clean.driver_name = clampText(dn, 200)
  }
  if ('category' in clean) clean.category = clampText(clean.category, 80)
  if ('asset_no' in clean) clean.asset_no = clampText(clean.asset_no, 120)
  if ('description' in clean) clean.description = clampText(clean.description, 8000)
  if ('amount' in clean) clean.amount = numOrNull(clean.amount)
  if ('expense_date' in clean) clean.expense_date = clean.expense_date || null
  const nextStatus = EXPENSE_STATUSES.includes(clean.status) ? clean.status : null
  const reviewReason = clean.review_reason
  delete clean.status
  delete clean.review_reason

  let row = Object.keys(clean).length
    ? unwrap(await supabase.from('driver_expenses').update(clean).eq('id', id).select(COLS).single())
    : await getExpense(id)
  if (nextStatus && row && row.status !== nextStatus) {
    row = await reviewExpense(id, nextStatus, reviewReason || 'Status updated')
  }
  return row
}

function isMissingFunction(error) {
  const code = String(error?.code || error?.cause?.code || '')
  return code === '42883' || code === 'PGRST202'
}

/**
 * Approve, reject or mark reimbursed. The server stamps the reviewer and time
 * and refuses a review of your own claim. Before the migration is applied the
 * RPC does not exist, so the legacy direct status update is used instead.
 */
export async function reviewExpense(id, status, reason) {
  if (!EXPENSE_STATUSES.includes(status) || status === 'pending') throw new Error('Choose a review decision.')
  const { data, error } = await supabase.rpc('review_driver_expense', { p_id: id, p_status: status, p_reason: reason })
  if (!error) return data
  if (!isMissingFunction(error)) throw toServiceError(error)
  return unwrap(await supabase.from('driver_expenses').update({ status }).eq('id', id).select(COLS).single())
}

export async function deleteExpense(id) {
  return unwrap(await supabase.from('driver_expenses').delete().eq('id', id))
}
