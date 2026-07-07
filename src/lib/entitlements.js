/**
 * entitlements.js — pure subscription/plan entitlement logic (Roadmap #6).
 *
 * Framework-free helpers shared by the Billing page, the useBilling hook and
 * any enforcement call site. They operate on the shape returned by the
 * `get_subscription_overview()` RPC (see MIGRATIONS_V105) so the exact same
 * limit maths runs in the UI and can be mirrored server-side.
 *
 * Model:
 *   - A plan carries numeric limits (vehicles/users/api_keys/storage_gb) where
 *     `null` means UNLIMITED, and a `features` map (feature-flag key → boolean).
 *   - Usage is a live count per resource.
 *   - "Utilisation" is usage / limit; unlimited resources report 0 (never full).
 *
 * Everything here is defensive: missing/garbage input degrades to safe,
 * non-blocking defaults (fail OPEN on unknowns, so billing maths never hides a
 * feature or hard-stops a legitimate action because of a stale payload).
 *
 * Unit-tested in src/test/entitlements.test.js.
 */

/** Resource keys that carry a numeric cap. */
export const LIMITED_RESOURCES = ['vehicles', 'users', 'api_keys', 'storage_gb']

/** Human labels for the four metered resources. */
export const RESOURCE_LABELS = {
  vehicles: 'Vehicles',
  users: 'Users',
  api_keys: 'API Keys',
  storage_gb: 'Storage (GB)',
}

/** Subscription status → display metadata (badge tone + label). */
export const STATUS_META = {
  trialing:  { label: 'Trial',      tone: 'blue' },
  active:    { label: 'Active',     tone: 'green' },
  past_due:  { label: 'Past Due',   tone: 'amber' },
  canceled:  { label: 'Canceled',   tone: 'gray' },
  expired:   { label: 'Expired',    tone: 'red' },
}

/** True when `n` is a finite number ≥ 0. */
function isCount(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0
}

/**
 * Normalise a raw limit into either a non-negative number or `null` (unlimited).
 * Strings (from JSON), negatives and garbage all collapse to `null` so an
 * unparseable cap never blocks an action.
 */
export function normalizeLimit(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** True when a resource has no cap (unlimited). */
export function isUnlimited(limit) {
  return normalizeLimit(limit) === null
}

/**
 * Utilisation fraction (0..1+) for one resource. Unlimited → 0. A zero limit
 * with any usage is fully consumed (→ 1). Values can exceed 1 when a fleet is
 * over an enforced cap (e.g. after a downgrade), which the UI surfaces in red.
 */
export function utilisation(usage, limit) {
  const lim = normalizeLimit(limit)
  if (lim === null) return 0
  const used = isCount(usage) ? usage : 0
  if (lim === 0) return used > 0 ? 1 : 0
  return used / lim
}

/** Utilisation as a clamped 0..100 integer, for progress bars. */
export function utilisationPct(usage, limit) {
  return Math.min(100, Math.round(utilisation(usage, limit) * 100))
}

/**
 * Remaining headroom for a resource. Unlimited → Infinity. Never negative.
 */
export function remaining(usage, limit) {
  const lim = normalizeLimit(limit)
  if (lim === null) return Infinity
  const used = isCount(usage) ? usage : 0
  return Math.max(0, lim - used)
}

/**
 * Can the org add `count` more of `resource` without exceeding its plan?
 * Unlimited or unknown resource → always true (fail open).
 */
export function canAdd(overview, resource, count = 1) {
  const limit = overview?.limits?.[resource]
  if (isUnlimited(limit)) return true
  const usage = overview?.usage?.[resource]
  return remaining(usage, limit) >= count
}

/** True when a resource is at or over its cap. */
export function isAtLimit(overview, resource) {
  return !canAdd(overview, resource, 1)
}

/**
 * Is a plan feature entitled? Missing map/key fails OPEN (true) so a plan that
 * predates a new feature key never hides it. Combine with the org feature flags
 * (an admin can still switch a plan-entitled feature off) at the call site.
 */
export function planAllows(overview, featureKey) {
  const features = overview?.plan?.features
  if (!features || typeof features !== 'object') return true
  const v = features[featureKey]
  return typeof v === 'boolean' ? v : true
}

/**
 * Days left in the trial (integer, ≥ 0) or null when not trialing / no date.
 */
export function trialDaysLeft(overview, now = Date.now()) {
  const sub = overview?.subscription
  if (!sub || sub.status !== 'trialing' || !sub.trial_ends_at) return null
  const ends = new Date(sub.trial_ends_at).getTime()
  if (!Number.isFinite(ends)) return null
  return Math.max(0, Math.ceil((ends - now) / 86_400_000))
}

/**
 * Build a per-resource usage summary for the UI:
 *   [{ resource, label, usage, limit, unlimited, remaining, pct, atLimit }]
 * Only resources present in `limits` are returned, in LIMITED_RESOURCES order.
 */
export function usageRows(overview) {
  const usage = overview?.usage || {}
  const limits = overview?.limits || {}
  return LIMITED_RESOURCES
    .filter((r) => r in limits)
    .map((resource) => {
      const limit = limits[resource]
      const used = isCount(usage[resource]) ? usage[resource] : 0
      const unlimited = isUnlimited(limit)
      return {
        resource,
        label: RESOURCE_LABELS[resource] || resource,
        usage: used,
        limit: normalizeLimit(limit),
        unlimited,
        remaining: remaining(used, limit),
        pct: utilisationPct(used, limit),
        atLimit: !unlimited && used >= (normalizeLimit(limit) ?? 0),
      }
    })
}

/**
 * Effective monthly-equivalent price of a plan for a billing interval, so a
 * pricing grid can show "$X/mo billed annually". Annual price / 12 when annual.
 */
export function monthlyEquivalent(plan, interval = 'monthly') {
  if (!plan) return 0
  if (interval === 'annual') {
    const annual = Number(plan.price_annual) || 0
    return annual > 0 ? annual / 12 : Number(plan.price_monthly) || 0
  }
  return Number(plan.price_monthly) || 0
}

/** Annual saving vs paying monthly, as a whole-number percent (0 when none). */
export function annualSavingPct(plan) {
  const monthly = Number(plan?.price_monthly) || 0
  const annual = Number(plan?.price_annual) || 0
  if (monthly <= 0 || annual <= 0) return 0
  const monthlyYear = monthly * 12
  if (annual >= monthlyYear) return 0
  return Math.round(((monthlyYear - annual) / monthlyYear) * 100)
}
