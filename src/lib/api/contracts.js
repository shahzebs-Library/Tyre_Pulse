/**
 * Contracts service — supplier & service contract management (V131). Any
 * authenticated member reads; Admin/Manager/Director create/update/delete
 * (RLS enforces both, plus org isolation). Mirrors support.js / stock.js:
 * explicit column lists, null-safe country scoping, and validation/clamps at
 * the boundary. `listContracts` degrades gracefully when the table is absent
 * so the page can prompt for the migration instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'

const COLS =
  'id,organisation_id,country,title,vendor,contract_type,start_date,end_date,' +
  'value,currency,status,notes,created_by,created_at,updated_at'

export const CONTRACT_STATUSES = ['active', 'expired', 'pending', 'cancelled']
export const CONTRACT_TYPES = ['supply', 'service', 'maintenance', 'lease', 'retread', 'other']

/**
 * True when a Supabase/PostgREST error means the `contracts` relation does not
 * exist yet (migration not applied). Covers Postgres 42P01, PostgREST PGRST205,
 * and the message-text fallbacks. Anything else is a real error.
 */
export function isMissingContractsTable(error) {
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
 * List contracts (newest first). Optional status/country filters. When the
 * table is missing, returns a tagged empty result `{ rows: [], missing: true }`
 * so callers can show the "apply migration" state without a hard failure.
 */
export async function listContracts({ status, country, limit = 500 } = {}) {
  let q = supabase.from('contracts').select(COLS)
  if (status) q = q.eq('status', status)
  q = applyCountry(q, country)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)
  if (error) {
    if (isMissingContractsTable(error)) return { rows: [], missing: true }
    throw error
  }
  return { rows: data || [], missing: false }
}

export async function getContract(id) {
  return unwrap(await supabase.from('contracts').select(COLS).eq('id', id).maybeSingle())
}

/** Create a contract. Validates title; clamps free-text; normalises status. */
export async function createContract(values = {}) {
  const title = String(values.title || '').trim()
  if (!title) throw new Error('A contract title is required.')
  const status = CONTRACT_STATUSES.includes(values.status) ? values.status : 'active'
  const value = values.value === '' || values.value == null ? null : Number(values.value)
  const payload = {
    title: title.slice(0, 200),
    vendor: values.vendor ? String(values.vendor).slice(0, 200) : null,
    contract_type: values.contract_type ? String(values.contract_type).slice(0, 80) : null,
    start_date: values.start_date || null,
    end_date: values.end_date || null,
    value: Number.isFinite(value) ? value : null,
    currency: values.currency ? String(values.currency).slice(0, 12) : null,
    status,
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('contracts').insert(payload).select(COLS).single())
}

/** Patch a contract. Strips immutable columns; clamps and coerces provided fields. */
export async function updateContract(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.organisation_id
  delete clean.created_by
  delete clean.created_at
  delete clean.updated_at
  if ('title' in clean) {
    const t = String(clean.title || '').trim()
    if (!t) throw new Error('A contract title is required.')
    clean.title = t.slice(0, 200)
  }
  if ('status' in clean && !CONTRACT_STATUSES.includes(clean.status)) delete clean.status
  if ('value' in clean) {
    const v = clean.value === '' || clean.value == null ? null : Number(clean.value)
    clean.value = Number.isFinite(v) ? v : null
  }
  if ('vendor' in clean) clean.vendor = clean.vendor ? String(clean.vendor).slice(0, 200) : null
  if ('contract_type' in clean) clean.contract_type = clean.contract_type ? String(clean.contract_type).slice(0, 80) : null
  if ('currency' in clean) clean.currency = clean.currency ? String(clean.currency).slice(0, 12) : null
  if ('notes' in clean) clean.notes = clean.notes ? String(clean.notes).slice(0, 8000) : null
  return unwrap(await supabase.from('contracts').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteContract(id) {
  return unwrap(await supabase.from('contracts').delete().eq('id', id))
}
