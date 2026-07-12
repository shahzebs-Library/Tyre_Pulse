/**
 * TaaS (Tyre-as-a-Service) service — the single seam between the TaaS page
 * (/taas) and Supabase (table `taas_subscriptions`, V195). Keeps an explicit
 * column list (least-privilege selects), null-safe country scoping, whitelisted
 * enums, and numeric validation. RLS enforces org isolation; this layer never
 * trusts client input blindly.
 *
 * Mirrors odometerLogs.js. A missing `taas_subscriptions` relation (org has not
 * run the migration) degrades listing to an empty array so the page can render
 * its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber, PLAN_TYPES, STATUSES } from '../taas'

export const COLS =
  'id,organisation_id,country,subscription_no,customer_name,asset_no,plan_type,' +
  'tyres_covered,rate,rate_unit,committed_km,actual_km,monthly_fee,currency,' +
  'start_date,renewal_date,billed_to_date,status,notes,created_by,created_at,updated_at'

const PLAN_SET = new Set(PLAN_TYPES)
const STATUS_SET = new Set(STATUSES)

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('taas_subscriptions'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))
const asDate = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
const asInt = (v) => {
  const n = toFiniteNumber(v)
  return n == null ? null : Math.trunc(n)
}

/** Validate a non-negative numeric field, throwing on a negative value. */
function nonNegative(v, label) {
  const n = toFiniteNumber(v)
  if (n == null) return null
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

/** Whitelist a plan_type; null when absent, throw when present-but-invalid. */
function cleanPlanType(v) {
  if (v == null || v === '') return null
  const s = String(v).trim()
  if (!PLAN_SET.has(s)) throw new Error(`Invalid plan type "${s}".`)
  return s
}

/** Whitelist a status; null when absent, throw when present-but-invalid. */
function cleanStatus(v) {
  if (v == null || v === '') return null
  const s = String(v).trim()
  if (!STATUS_SET.has(s)) throw new Error(`Invalid status "${s}".`)
  return s
}

/**
 * List subscriptions (renewal_date ascending — soonest renewals first — then
 * created_at descending). Optional `country` filter. Returns [] when the table
 * has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listTaasSubscriptions({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('taas_subscriptions').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('renewal_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getTaasSubscription(id) {
  return unwrap(
    await supabase.from('taas_subscriptions').select(COLS).eq('id', id).maybeSingle(),
  )
}

/**
 * Create a subscription. Requires a customer name. Numeric fields are validated
 * non-negative; plan_type and status are whitelisted against the allowed enums.
 */
export async function createTaasSubscription(values = {}) {
  const customer_name = asText(values.customer_name, 200)
  if (!customer_name) throw new Error('A customer name is required.')

  const payload = {
    customer_name,
    subscription_no: asText(values.subscription_no, 120),
    asset_no: asText(values.asset_no, 120),
    plan_type: cleanPlanType(values.plan_type),
    tyres_covered: (() => {
      const n = asInt(values.tyres_covered)
      if (n != null && n < 0) throw new Error('Tyres covered cannot be negative.')
      return n
    })(),
    rate: nonNegative(values.rate, 'Rate'),
    rate_unit: asText(values.rate_unit, 40),
    committed_km: nonNegative(values.committed_km, 'Committed km'),
    actual_km: nonNegative(values.actual_km, 'Actual km'),
    monthly_fee: nonNegative(values.monthly_fee, 'Monthly fee'),
    currency: asText(values.currency, 8),
    start_date: asDate(values.start_date),
    renewal_date: asDate(values.renewal_date),
    billed_to_date: nonNegative(values.billed_to_date, 'Billed to date'),
    status: cleanStatus(values.status),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(
    await supabase.from('taas_subscriptions').insert(payload).select(COLS).single(),
  )
}

/**
 * Patch a subscription. Strips immutable/ownership fields (id, organisation_id,
 * created_by, created_at, updated_at); coerces and validates each field present
 * so the stored value never drifts from the validated shape.
 */
export async function updateTaasSubscription(id, patch = {}) {
  const clean = {}
  if (patch.customer_name !== undefined) {
    const customer_name = asText(patch.customer_name, 200)
    if (!customer_name) throw new Error('A customer name is required.')
    clean.customer_name = customer_name
  }
  if (patch.subscription_no !== undefined) clean.subscription_no = asText(patch.subscription_no, 120)
  if (patch.asset_no !== undefined) clean.asset_no = asText(patch.asset_no, 120)
  if (patch.plan_type !== undefined) clean.plan_type = cleanPlanType(patch.plan_type)
  if (patch.tyres_covered !== undefined) {
    const n = asInt(patch.tyres_covered)
    if (n != null && n < 0) throw new Error('Tyres covered cannot be negative.')
    clean.tyres_covered = n
  }
  if (patch.rate !== undefined) clean.rate = nonNegative(patch.rate, 'Rate')
  if (patch.rate_unit !== undefined) clean.rate_unit = asText(patch.rate_unit, 40)
  if (patch.committed_km !== undefined) clean.committed_km = nonNegative(patch.committed_km, 'Committed km')
  if (patch.actual_km !== undefined) clean.actual_km = nonNegative(patch.actual_km, 'Actual km')
  if (patch.monthly_fee !== undefined) clean.monthly_fee = nonNegative(patch.monthly_fee, 'Monthly fee')
  if (patch.currency !== undefined) clean.currency = asText(patch.currency, 8)
  if (patch.start_date !== undefined) clean.start_date = asDate(patch.start_date)
  if (patch.renewal_date !== undefined) clean.renewal_date = asDate(patch.renewal_date)
  if (patch.billed_to_date !== undefined) clean.billed_to_date = nonNegative(patch.billed_to_date, 'Billed to date')
  if (patch.status !== undefined) clean.status = cleanStatus(patch.status)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(
    await supabase.from('taas_subscriptions').update(clean).eq('id', id).select(COLS).single(),
  )
}

export async function deleteTaasSubscription(id) {
  return unwrap(await supabase.from('taas_subscriptions').delete().eq('id', id))
}
