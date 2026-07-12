/**
 * Customer Portal — pure, dependency-free domain logic for the Customer Portal
 * module (/customer-portal). Reduces a set of external customer accounts into
 * adoption, tier, and attention roll-ups used by the admin surface.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/customerPortal.js`) and page
 * (`src/pages/CustomerPortal.jsx`) both build on these primitives so the
 * roll-up logic lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * RFC-lite email validation — a pragmatic, deterministic check (not full
 * RFC 5322). Requires a single "@", a non-empty local part with no spaces, and
 * a domain with at least one dot and a 2+ char TLD. Returns a boolean.
 *
 * @param {string} s
 * @returns {boolean}
 */
export function isValidEmail(s) {
  if (typeof s !== 'string') return false
  const v = s.trim()
  if (!v || v.length > 254) return false
  if (/\s/.test(v)) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)
}

/** True when a row has portal access explicitly enabled. */
function isPortalEnabled(r) {
  const v = r?.portal_enabled
  return v === true || v === 'true' || v === 1 || v === '1'
}

const normStatus = (r) => String(r?.status || '').trim().toLowerCase()
const normTier = (r) => String(r?.tier || '').trim().toLowerCase()

/**
 * Portal adoption rate — the percentage of accounts with portal access enabled,
 * as a whole number in [0, 100]. Returns 0 for an empty/invalid set.
 *
 * @param {Array<object>} rows
 * @returns {number}
 */
export function portalAdoptionRate(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length === 0) return 0
  const enabled = list.reduce((n, r) => n + (isPortalEnabled(r) ? 1 : 0), 0)
  return Math.round((enabled / list.length) * 100)
}

/**
 * Summarise a set of customer accounts for the KPI header:
 *   • totalAccounts       — number of rows
 *   • activeCount         — accounts with status 'active'
 *   • portalEnabledCount  — accounts with portal access enabled
 *   • onboardingCount     — accounts with status 'onboarding'
 *   • totalLinkedAssets   — sum of assets_linked across all rows
 *   • totalOpenRequests   — sum of open_requests across all rows
 *
 * @param {Array<object>} rows
 * @returns {{ totalAccounts:number, activeCount:number, portalEnabledCount:number,
 *             onboardingCount:number, totalLinkedAssets:number, totalOpenRequests:number }}
 */
export function summariseAccounts(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let activeCount = 0
  let portalEnabledCount = 0
  let onboardingCount = 0
  let totalLinkedAssets = 0
  let totalOpenRequests = 0

  for (const r of list) {
    const status = normStatus(r)
    if (status === 'active') activeCount++
    if (status === 'onboarding') onboardingCount++
    if (isPortalEnabled(r)) portalEnabledCount++
    totalLinkedAssets += toFiniteNumber(r?.assets_linked) ?? 0
    totalOpenRequests += toFiniteNumber(r?.open_requests) ?? 0
  }

  return {
    totalAccounts: list.length,
    activeCount,
    portalEnabledCount,
    onboardingCount,
    totalLinkedAssets,
    totalOpenRequests,
  }
}

/**
 * Break accounts down by commercial tier. Returns an array of
 * { tier, count, linkedAssets } sorted by count descending (tier ascending as a
 * stable tiebreaker). Accounts without a tier are grouped under 'unspecified'.
 *
 * @param {Array<object>} rows
 * @returns {Array<{ tier:string, count:number, linkedAssets:number }>}
 */
export function byTier(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()
  for (const r of list) {
    const tier = normTier(r) || 'unspecified'
    const prev = map.get(tier) || { tier, count: 0, linkedAssets: 0 }
    prev.count += 1
    prev.linkedAssets += toFiniteNumber(r?.assets_linked) ?? 0
    map.set(tier, prev)
  }
  return [...map.values()].sort(
    (a, b) => b.count - a.count || a.tier.localeCompare(b.tier),
  )
}

/**
 * Accounts that need admin attention — those with status 'suspended' or
 * 'onboarding', or more than 5 open service requests. Sorted by open_requests
 * descending so the heaviest support load surfaces first.
 *
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
export function needsAttention(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  return list
    .filter((r) => {
      const status = normStatus(r)
      const open = toFiniteNumber(r?.open_requests) ?? 0
      return status === 'suspended' || status === 'onboarding' || open > 5
    })
    .sort(
      (a, b) =>
        (toFiniteNumber(b?.open_requests) ?? 0) -
        (toFiniteNumber(a?.open_requests) ?? 0),
    )
}
