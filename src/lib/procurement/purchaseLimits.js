/**
 * Purchase order approval limits (owner decision A, 2026-11-24).
 *
 * Limits live in inventory_approval_limits with entity_type 'purchase_order'
 * and are written only through the admin RPC inv_approval_limit_upsert
 * (super admin / Admin, checked in the database). One row per role and
 * currency: SAR, AED and EGP are kept apart by tying each currency to its
 * country (KSA, UAE, Egypt), because the unique key of that table is
 * role + country + site. Removing a limit sets active = false.
 *
 * Rules mirrored from _po_limit_block (migration 20261124130000):
 *   - no active purchase_order row in the company = no threshold at all;
 *   - once ANY active row exists, a role without its own row cannot approve
 *     a purchase order;
 *   - a value above the amount, an unknown value or another currency blocks.
 */

export const LIMIT_CURRENCIES = Object.freeze([
  { currency: 'SAR', country: 'KSA', label: 'SAR (Saudi Arabia)' },
  { currency: 'AED', country: 'UAE', label: 'AED (United Arab Emirates)' },
  { currency: 'EGP', country: 'Egypt', label: 'EGP (Egypt)' },
])

export const currencyCountry = (cur) => LIMIT_CURRENCIES.find((c) => c.currency === String(cur || '').toUpperCase())?.country || null
export const countryCurrency = (country) => LIMIT_CURRENCIES.find((c) => c.country.toLowerCase() === String(country || '').trim().toLowerCase())?.currency || null

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/** Normalise stored rows into one entry per role + currency (newest wins). */
export function shapeLimits(rows = []) {
  const list = (Array.isArray(rows) ? rows : []).map((r) => ({
    id: r.id,
    role: String(r.approver_role || '').trim(),
    currency: (r.currency ? String(r.currency).toUpperCase() : countryCurrency(r.country)) || null,
    country: r.country || null,
    site: r.site || null,
    amount: num(r.max_value),
    active: r.active !== false,
    updated_at: r.updated_at || r.created_at || null,
  }))
  const active = list.filter((r) => r.active).sort((a, b) => a.role.localeCompare(b.role) || String(a.currency).localeCompare(String(b.currency)))
  const removed = list.filter((r) => !r.active)
  return { active, removed, thresholdOn: active.length > 0 }
}

/** Which approver roles have no active limit (they cannot approve once any limit exists). */
export function rolesWithoutLimit(roles = [], active = []) {
  const have = new Set((active || []).map((r) => r.role.toLowerCase()))
  return (roles || []).filter((r) => !have.has(String(r).toLowerCase()))
}

/** Validate the add / edit form. Returns an error message or null. */
export function validateLimitForm({ role, currency, amount, noUpperLimit } = {}, roles = []) {
  if (!role || !String(role).trim()) return 'Choose a role.'
  if (roles.length && !roles.includes(role)) return `${role} cannot approve purchase orders.`
  if (!currencyCountry(currency)) return 'Choose SAR, AED or EGP.'
  if (noUpperLimit) return null
  const n = num(amount)
  if (n === null) return 'Enter the highest order value this role may approve, or tick "No upper limit".'
  if (n <= 0) return 'The amount must be above zero.'
  return null
}

/** Payload for inv_approval_limit_upsert (entity_type purchase_order). */
export function limitPayload({ role, currency, amount, noUpperLimit, site } = {}, active = true) {
  return {
    entity_type: 'purchase_order',
    approver_role: String(role || '').trim(),
    country: currencyCountry(currency),
    site: site ? String(site).trim().toUpperCase() : null,
    currency: String(currency || '').toUpperCase(),
    max_value: noUpperLimit ? null : num(amount),
    max_qty: null,
    active,
  }
}

export function formatLimitAmount(row) {
  if (!row) return 'N/A'
  if (row.amount === null) return 'No upper limit'
  return `${row.currency || ''} ${row.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim()
}
