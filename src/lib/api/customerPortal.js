/**
 * Customer Portal service — the single seam between the Customer Portal page
 * (/customer-portal) and Supabase (table `customer_accounts`, V193). Keeps an
 * explicit column list (least-privilege selects), null-safe country scoping,
 * and input validation. RLS enforces org isolation; this layer never trusts
 * client input blindly.
 *
 * Mirrors odometerLogs.js. A missing `customer_accounts` relation (org has not
 * run the migration) degrades listing to an empty array so the page can render
 * its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber, isValidEmail } from '../customerPortal'

export const COLS =
  'id,organisation_id,country,account_code,company_name,contact_name,email,phone,' +
  'portal_enabled,tier,assets_linked,open_requests,contract_ref,sla_hours,' +
  'account_manager,status,notes,created_by,created_at,updated_at'

const TIERS = ['standard', 'premium', 'enterprise']
const STATUSES = ['active', 'suspended', 'onboarding', 'churned']

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('customer_accounts'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))

/** Coerce any truthy/loose value to a strict boolean for portal_enabled. */
const asBool = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'on'

/** Validate + whitelist a numeric counter/measure field; throws if negative. */
function asNonNegNumber(v, label) {
  if (v === undefined || v === null || v === '') return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error(`${label} must be a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

function asTier(v) {
  const t = v == null || v === '' ? null : String(v).trim().toLowerCase()
  if (t == null) return null
  if (!TIERS.includes(t)) throw new Error(`Tier must be one of: ${TIERS.join(', ')}.`)
  return t
}

function asStatus(v) {
  const s = v == null || v === '' ? null : String(v).trim().toLowerCase()
  if (s == null) return null
  if (!STATUSES.includes(s)) throw new Error(`Status must be one of: ${STATUSES.join(', ')}.`)
  return s
}

function asEmail(v) {
  const e = asText(v, 254)
  if (e == null) return null
  if (!isValidEmail(e)) throw new Error('A valid email address is required.')
  return e
}

/**
 * List customer accounts (company_name asc, then created_at desc). Optional
 * `country` filter. Returns [] when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listCustomerAccounts({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('customer_accounts').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('company_name', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getCustomerAccount(id) {
  return unwrap(await supabase.from('customer_accounts').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Create a customer account. Requires a company name. Email (when provided) is
 * validated; numeric counters must be non-negative; tier/status are whitelisted;
 * portal_enabled is coerced to a strict boolean.
 */
export async function createCustomerAccount(values = {}) {
  const company_name = asText(values.company_name, 200)
  if (!company_name) throw new Error('A company name is required.')

  const payload = {
    company_name,
    account_code: asText(values.account_code, 60),
    contact_name: asText(values.contact_name, 160),
    email: asEmail(values.email),
    phone: asText(values.phone, 60),
    portal_enabled: asBool(values.portal_enabled),
    tier: asTier(values.tier),
    assets_linked: asNonNegNumber(values.assets_linked, 'Linked assets'),
    open_requests: asNonNegNumber(values.open_requests, 'Open requests'),
    contract_ref: asText(values.contract_ref, 120),
    sla_hours: asNonNegNumber(values.sla_hours, 'SLA hours'),
    account_manager: asText(values.account_manager, 160),
    status: asStatus(values.status),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('customer_accounts').insert(payload).select(COLS).single())
}

/**
 * Patch a customer account. Strips immutable/ownership fields; coerces each
 * field present so the stored value never drifts from the validated shape.
 */
export async function updateCustomerAccount(id, patch = {}) {
  const clean = {}
  if (patch.company_name !== undefined) {
    const company_name = asText(patch.company_name, 200)
    if (!company_name) throw new Error('A company name is required.')
    clean.company_name = company_name
  }
  if (patch.account_code !== undefined) clean.account_code = asText(patch.account_code, 60)
  if (patch.contact_name !== undefined) clean.contact_name = asText(patch.contact_name, 160)
  if (patch.email !== undefined) clean.email = asEmail(patch.email)
  if (patch.phone !== undefined) clean.phone = asText(patch.phone, 60)
  if (patch.portal_enabled !== undefined) clean.portal_enabled = asBool(patch.portal_enabled)
  if (patch.tier !== undefined) clean.tier = asTier(patch.tier)
  if (patch.assets_linked !== undefined) clean.assets_linked = asNonNegNumber(patch.assets_linked, 'Linked assets')
  if (patch.open_requests !== undefined) clean.open_requests = asNonNegNumber(patch.open_requests, 'Open requests')
  if (patch.contract_ref !== undefined) clean.contract_ref = asText(patch.contract_ref, 120)
  if (patch.sla_hours !== undefined) clean.sla_hours = asNonNegNumber(patch.sla_hours, 'SLA hours')
  if (patch.account_manager !== undefined) clean.account_manager = asText(patch.account_manager, 160)
  if (patch.status !== undefined) clean.status = asStatus(patch.status)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('customer_accounts').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteCustomerAccount(id) {
  return unwrap(await supabase.from('customer_accounts').delete().eq('id', id))
}
