/**
 * Insurance Claims service — reads/writes the `insurance_claims` table backing
 * the Insurance Claims tracker (Accident & Insurance). Single boundary for that
 * table: explicit least-privilege column list (no SELECT *), null-safe country
 * scoping, and consistent ServiceError handling via unwrap. Mirrors the
 * support.js / recalls.js style.
 *
 * The list method tolerates a not-yet-migrated database: if the table is
 * missing it resolves to [] so the page can prompt the operator to apply
 * MIGRATIONS_V134_INSURANCE_CLAIMS.sql instead of crashing.
 */
import { supabase, unwrap, applyCountry } from './_client'

export const COLS =
  'id,organisation_id,country,claim_no,asset_no,insurer,policy_no,incident_date,' +
  'claim_date,amount_claimed,amount_settled,status,description,created_by,created_at,updated_at'

export const CLAIM_STATUSES = [
  'open', 'submitted', 'under_review', 'approved', 'rejected', 'settled', 'closed',
]

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('could not find the table') ||
    m.includes('schema cache') ||
    (m.includes('relation') && m.includes('insurance_claims'))
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
 * List claims (newest first). Optional status + null-safe country filters.
 * Returns [] when the backing table has not been migrated yet.
 * @param {{ country?:string, status?:string, limit?:number }} [opts]
 */
export async function listClaims({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('insurance_claims').select(COLS)
    if (status) q = q.eq('status', status)
    q = applyCountry(q, country)
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Get one claim by id (or null if not found). */
export async function getClaim(id) {
  return unwrap(await supabase.from('insurance_claims').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Create a claim. Requires at least an insurer or an asset_no so a claim is
 * always attributable to either the covering policy or the affected asset.
 * Coerces amounts and normalises empty strings to NULL.
 */
export async function createClaim(values = {}) {
  const insurer = emptyToNull(values.insurer)
  const asset_no = emptyToNull(values.asset_no)
  if (!insurer && !asset_no) {
    throw new Error('Provide an insurer or an asset number for the claim.')
  }
  const status = CLAIM_STATUSES.includes(values.status) ? values.status : 'open'
  const payload = {
    country: emptyToNull(values.country),
    claim_no: emptyToNull(values.claim_no),
    asset_no,
    insurer,
    policy_no: emptyToNull(values.policy_no),
    incident_date: emptyToNull(values.incident_date),
    claim_date: emptyToNull(values.claim_date),
    amount_claimed: toNumberOrNull(values.amount_claimed),
    amount_settled: toNumberOrNull(values.amount_settled),
    status,
    description: values.description ? String(values.description).slice(0, 8000) : null,
  }
  return unwrap(await supabase.from('insurance_claims').insert(payload).select(COLS).single())
}

/** Patch a claim by id. Strips immutable/managed columns; coerces amounts. */
export async function updateClaim(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.organisation_id
  delete clean.created_by
  delete clean.created_at
  delete clean.updated_at
  if ('amount_claimed' in clean) clean.amount_claimed = toNumberOrNull(clean.amount_claimed)
  if ('amount_settled' in clean) clean.amount_settled = toNumberOrNull(clean.amount_settled)
  if ('incident_date' in clean) clean.incident_date = emptyToNull(clean.incident_date)
  if ('claim_date' in clean) clean.claim_date = emptyToNull(clean.claim_date)
  if ('claim_no' in clean) clean.claim_no = emptyToNull(clean.claim_no)
  if ('policy_no' in clean) clean.policy_no = emptyToNull(clean.policy_no)
  if ('asset_no' in clean) clean.asset_no = emptyToNull(clean.asset_no)
  if ('insurer' in clean) clean.insurer = emptyToNull(clean.insurer)
  if (clean.status && !CLAIM_STATUSES.includes(clean.status)) delete clean.status
  return unwrap(await supabase.from('insurance_claims').update(clean).eq('id', id).select(COLS).single())
}

/** Delete a claim by id. */
export async function deleteClaim(id) {
  return unwrap(await supabase.from('insurance_claims').delete().eq('id', id))
}
