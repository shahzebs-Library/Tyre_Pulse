/**
 * Retread Claims service — reads/writes the `retread_claims` table backing the
 * Retread Claims tracker (retread warranty / quality claims raised against
 * retread vendors). Single boundary for that table: explicit least-privilege
 * column list (no SELECT *), null-safe country scoping, and consistent
 * ServiceError handling via unwrap. Mirrors the insuranceClaims.js / support.js
 * style.
 *
 * The list method tolerates a not-yet-migrated database: if the table is
 * missing it resolves to [] so the page can prompt the operator to apply
 * MIGRATIONS_V145_RETREAD_CLAIMS.sql instead of crashing.
 */
import { supabase, unwrap, applyCountry } from './_client'

export const COLS =
  'id,organisation_id,country,claim_no,tyre_serial,asset_no,vendor,reason,' +
  'claim_date,cost,amount_recovered,status,notes,created_by,created_at,updated_at'

export const RETREAD_CLAIM_STATUSES = [
  'open', 'submitted', 'approved', 'rejected', 'settled',
]

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('could not find the table') ||
    m.includes('schema cache') ||
    (m.includes('relation') && m.includes('retread_claims'))
  )
}

const toNumberOrNull = (v) => {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

const emptyToNull = (v) => {
  const s = v == null ? '' : String(v).trim()
  return s ? s : null
}

/**
 * List retread claims (newest first). Optional status, vendor + null-safe
 * country filters. Returns [] when the backing table has not been migrated yet.
 * @param {{ country?:string, status?:string, vendor?:string, limit?:number }} [opts]
 */
export async function listRetreadClaims({ country, status, vendor, limit = 500 } = {}) {
  try {
    let q = supabase.from('retread_claims').select(COLS)
    if (status) q = q.eq('status', status)
    if (vendor) q = q.eq('vendor', vendor)
    q = applyCountry(q, country)
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Get one claim by id (or null if not found). */
export async function getRetreadClaim(id) {
  return unwrap(await supabase.from('retread_claims').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Create a retread claim. Requires at least a vendor or a tyre_serial so a claim
 * is always attributable to either the retread vendor or the affected casing.
 * Coerces amounts and normalises empty strings to NULL.
 */
export async function createRetreadClaim(values = {}) {
  const vendor = emptyToNull(values.vendor)
  const tyre_serial = emptyToNull(values.tyre_serial)
  if (!vendor && !tyre_serial) {
    throw new Error('Provide a vendor or a tyre serial for the claim.')
  }
  const status = RETREAD_CLAIM_STATUSES.includes(values.status) ? values.status : 'open'
  const payload = {
    country: emptyToNull(values.country),
    claim_no: emptyToNull(values.claim_no),
    tyre_serial,
    asset_no: emptyToNull(values.asset_no),
    vendor,
    reason: values.reason ? String(values.reason).slice(0, 8000) : null,
    claim_date: emptyToNull(values.claim_date),
    cost: toNumberOrNull(values.cost),
    amount_recovered: toNumberOrNull(values.amount_recovered),
    status,
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
  }
  return unwrap(await supabase.from('retread_claims').insert(payload).select(COLS).single())
}

/** Patch a claim by id. Strips immutable/managed columns; coerces amounts. */
export async function updateRetreadClaim(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.organisation_id
  delete clean.created_by
  delete clean.created_at
  delete clean.updated_at
  if ('cost' in clean) clean.cost = toNumberOrNull(clean.cost)
  if ('amount_recovered' in clean) clean.amount_recovered = toNumberOrNull(clean.amount_recovered)
  if ('claim_date' in clean) clean.claim_date = emptyToNull(clean.claim_date)
  if ('claim_no' in clean) clean.claim_no = emptyToNull(clean.claim_no)
  if ('tyre_serial' in clean) clean.tyre_serial = emptyToNull(clean.tyre_serial)
  if ('asset_no' in clean) clean.asset_no = emptyToNull(clean.asset_no)
  if ('vendor' in clean) clean.vendor = emptyToNull(clean.vendor)
  if (clean.status && !RETREAD_CLAIM_STATUSES.includes(clean.status)) delete clean.status
  return unwrap(await supabase.from('retread_claims').update(clean).eq('id', id).select(COLS).single())
}

/** Delete a claim by id. */
export async function deleteRetreadClaim(id) {
  return unwrap(await supabase.from('retread_claims').delete().eq('id', id))
}
