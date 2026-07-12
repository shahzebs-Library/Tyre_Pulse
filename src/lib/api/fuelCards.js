/**
 * Fuel Cards service — fleet fuel card registry (V135). Any authenticated member
 * of the org reads; Admin/Manager/Director create/update/delete (RLS enforces
 * both, plus org isolation). Mirrors contracts.js / support.js: explicit column
 * lists, null-safe country scoping, and validation/clamps at the boundary.
 * `listFuelCards` degrades gracefully when the table is absent so the page can
 * prompt for the migration instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'

export const COLS =
  'id,organisation_id,country,card_number,provider,asset_no,driver_name,' +
  'monthly_limit,status,expiry_date,notes,created_by,created_at,updated_at'

export const FUEL_CARD_STATUSES = ['active', 'blocked', 'expired', 'unassigned']

/**
 * True when a Supabase/PostgREST error means the `fuel_cards` relation does not
 * exist yet (migration not applied). Covers Postgres 42P01, PostgREST PGRST205,
 * and the message-text fallbacks. Anything else is a real error.
 */
export function isMissingFuelCardsTable(error) {
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
 * List fuel cards (newest first). Optional status/country filters. When the
 * table is missing, returns a tagged empty result `{ rows: [], missing: true }`
 * so callers can show the "apply migration" state without a hard failure.
 * @param {{ status?:string, country?:string, limit?:number }} [opts]
 */
export async function listFuelCards({ status, country, limit = 500 } = {}) {
  let q = supabase.from('fuel_cards').select(COLS)
  if (status) q = q.eq('status', status)
  q = applyCountry(q, country)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)
  if (error) {
    if (isMissingFuelCardsTable(error)) return { rows: [], missing: true }
    throw error
  }
  return { rows: data || [], missing: false }
}

export async function getFuelCard(id) {
  return unwrap(await supabase.from('fuel_cards').select(COLS).eq('id', id).maybeSingle())
}

/** Create a fuel card. Requires a card number; clamps free-text; normalises status. */
export async function createFuelCard(values = {}) {
  const cardNumber = String(values.card_number || '').trim()
  if (!cardNumber) throw new Error('A card number is required.')
  const status = FUEL_CARD_STATUSES.includes(values.status) ? values.status : 'active'
  const limit = values.monthly_limit === '' || values.monthly_limit == null
    ? null : Number(values.monthly_limit)
  const payload = {
    card_number: cardNumber.slice(0, 64),
    provider: values.provider ? String(values.provider).slice(0, 120) : null,
    asset_no: values.asset_no ? String(values.asset_no).slice(0, 120) : null,
    driver_name: values.driver_name ? String(values.driver_name).slice(0, 200) : null,
    monthly_limit: Number.isFinite(limit) ? limit : null,
    status,
    expiry_date: values.expiry_date || null,
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('fuel_cards').insert(payload).select(COLS).single())
}

/** Patch a fuel card. Strips immutable columns; clamps and coerces provided fields. */
export async function updateFuelCard(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.organisation_id
  delete clean.created_by
  delete clean.created_at
  delete clean.updated_at
  if ('card_number' in clean) {
    const n = String(clean.card_number || '').trim()
    if (!n) throw new Error('A card number is required.')
    clean.card_number = n.slice(0, 64)
  }
  if ('status' in clean && !FUEL_CARD_STATUSES.includes(clean.status)) delete clean.status
  if ('monthly_limit' in clean) {
    const v = clean.monthly_limit === '' || clean.monthly_limit == null ? null : Number(clean.monthly_limit)
    clean.monthly_limit = Number.isFinite(v) ? v : null
  }
  if ('provider' in clean) clean.provider = clean.provider ? String(clean.provider).slice(0, 120) : null
  if ('asset_no' in clean) clean.asset_no = clean.asset_no ? String(clean.asset_no).slice(0, 120) : null
  if ('driver_name' in clean) clean.driver_name = clean.driver_name ? String(clean.driver_name).slice(0, 200) : null
  if ('expiry_date' in clean) clean.expiry_date = clean.expiry_date || null
  if ('notes' in clean) clean.notes = clean.notes ? String(clean.notes).slice(0, 8000) : null
  return unwrap(await supabase.from('fuel_cards').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteFuelCard(id) {
  return unwrap(await supabase.from('fuel_cards').delete().eq('id', id))
}
