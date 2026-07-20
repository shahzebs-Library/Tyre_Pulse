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

/**
 * Known metered resources — the exact `limits` keys emitted by
 * `get_subscription_overview()` (V105) and understood by `org_can_add()`.
 * For any of these, a MISSING or unparseable cap must fail CLOSED (no headroom)
 * rather than be treated as unlimited: a metered resource with no readable cap
 * is a stale/broken payload, not a licence to add unlimited records.
 * (The plan schema exposes only these four caps — there is no sites/countries
 * limit today; add a key here only when the overview actually emits it.)
 */
export const KNOWN_METERED = ['vehicles', 'users', 'api_keys', 'storage_gb']

/**
 * Known plan feature-flag keys (mirrors the plan `features` map seeded in V105
 * and the Billing page FEATURE_LABELS). A KNOWN feature that is absent from a
 * present plan's feature map fails CLOSED (not entitled) instead of fail-open,
 * so a mis-seeded or partial plan payload can never silently unlock a gated
 * capability. Unknown keys stay permissive (forward-compatible).
 */
export const KNOWN_FEATURES = [
  'ai_tools',
  'automation_platform',
  'tv_display',
  'erp_sync',
  'report_scheduling',
]

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
 * True only when a raw limit is an EXPLICIT unlimited marker — a genuine `null`
 * cap or the literal string `'unlimited'`. Distinct from a MISSING/unparseable
 * value: both normalise to `null`, but only an explicit marker means the plan
 * really grants unlimited headroom. Used so `canAdd` can preserve genuine
 * unlimited plans while failing closed on a metered resource with no cap.
 */
export function isExplicitUnlimited(raw) {
  if (raw === null) return true
  if (typeof raw === 'string' && raw.trim().toLowerCase() === 'unlimited') return true
  return false
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
 *
 * Fail-CLOSED for a known metered resource whose cap is missing/unparseable —
 * a broken payload must not be read as unlimited headroom. Rules:
 *   - `overview` null/absent (not loaded yet) → true, so the UI does not
 *     flash-block a legitimate action before billing data has arrived.
 *   - explicit unlimited cap (null / `'unlimited'` marker) → true (genuine
 *     unlimited plans are preserved).
 *   - a numeric cap → compares against usage as before.
 *   - a KNOWN_METERED resource with a missing/unparseable cap → FALSE.
 *   - any other unknown resource with no cap → true (permissive).
 * Note: `org_can_add()` (server) remains the authoritative enforcement point;
 * this is the client-side convenience gate.
 */
export function canAdd(overview, resource, count = 1) {
  // Not loaded yet — stay permissive so the UI does not block before data loads.
  if (!overview) return true
  const raw = overview.limits?.[resource]
  const limit = normalizeLimit(raw)
  if (limit === null) {
    if (isExplicitUnlimited(raw)) return true          // genuine unlimited plan
    if (KNOWN_METERED.includes(resource)) return false // metered but no readable cap → no headroom
    return true                                        // unknown resource → permissive
  }
  const usage = overview.usage?.[resource]
  return remaining(usage, limit) >= count
}

/** True when a resource is at or over its cap. */
export function isAtLimit(overview, resource) {
  return !canAdd(overview, resource, 1)
}

/**
 * Is a plan feature entitled?
 *   - `overview` null/absent (not loaded yet) → true, so a gated capability is
 *     not hidden before billing data arrives.
 *   - a present plan whose feature map is absent OR omits the key → FALSE for a
 *     KNOWN_FEATURES key (fail closed: a mis-seeded/partial plan must not
 *     silently unlock a gated capability).
 *   - an unknown feature key → true (permissive; forward-compatible with new
 *     keys that predate the plan payload).
 * Combine with the org feature flags (an admin can still switch a plan-entitled
 * feature off) at the call site.
 */
export function planAllows(overview, featureKey) {
  // Not loaded yet — stay permissive so the UI does not hide before data loads.
  if (!overview) return true
  const plan = overview.plan
  if (!plan || typeof plan !== 'object') return true
  const features = plan.features
  const v = features && typeof features === 'object' ? features[featureKey] : undefined
  if (typeof v === 'boolean') return v
  // Map/key absent: fail closed for a known feature, permissive for unknowns.
  return !KNOWN_FEATURES.includes(featureKey)
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
