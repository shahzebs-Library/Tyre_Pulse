/**
 * subscriptionAccess.js — pure subscription-STATUS access policy (Roadmap #6).
 *
 * Answers ONE question that the plan/entitlement layer (entitlements.js) does
 * NOT: given the lifecycle STATE of an org's subscription
 * (trialing / active / past_due / canceled / expired / suspended), what is the
 * org allowed to DO in the app right now — full use, read-only, billing-page-
 * only, or fully blocked?
 *
 *   entitlements.js  -> "how MUCH" (caps: vehicles/users/features per plan)
 *   subscriptionAccess.js -> "IS the subscription in good standing" (state gate)
 *
 * Both operate on the shape returned by `get_subscription_overview()` (V105):
 *   overview.subscription = { status, trial_ends_at, current_period_end, ... }
 * so the exact same gate can run in the UI and be mirrored server-side later.
 *
 * ---------------------------------------------------------------------------
 * POLICY (single source of truth — keep this table in sync with STATE_POLICY):
 *
 *   state       canUseApp canWrite readOnly billingOnly  meaning
 *   ---------   --------- -------- -------- -----------  -----------------------
 *   trialing      yes       yes      no        no        full access (in trial)
 *   active        yes       yes      no        no        full access
 *   past_due      yes       yes      no        no        full access + WARNING
 *                                                        banner; billing-sensitive
 *                                                        self-service is blocked
 *                                                        (blockSelfServiceBilling)
 *                                                        during the grace period
 *   canceled      yes       no       yes       no        read-only retention window
 *   expired       no        no       yes       yes       billing/export page only,
 *                                                        no app writes
 *   suspended     no        no       yes       no        fully blocked
 *   (unknown /    yes       yes      no        no        FAIL-OPEN — not loaded /
 *    missing)                                            unrecognised status must
 *                                                        never hard-stop a user
 * ---------------------------------------------------------------------------
 *
 * FAIL-OPEN, by design: a missing/undefined overview (billing not loaded yet),
 * a missing subscription, or an UNKNOWN status all resolve to permissive full
 * access. A stale or partial billing payload must never lock a legitimate user
 * out of the product; the authoritative boundary is server-side RLS, not this
 * client convenience gate.
 *
 * INTEGRATION NOTE (this pass is policy-only — nothing is wired to block yet):
 *   - useBilling() exposes the derived `subscriptionAccess` value (read-only).
 *   - A LATER pass may consume it to (a) render `banner` app-wide, (b) gate
 *     write actions on `canWrite` / `readOnly`, (c) redirect to Billing when
 *     `billingOnly`, and (d) hide billing-change self-service when
 *     `blockSelfServiceBilling`. Do NOT add hard blocks to routing/writes here.
 *   - Because the gate fails OPEN, any future enforcement MUST still rely on
 *     server-side checks for real security; this only shapes the UX.
 *
 * Pure: no imports of supabase/network/React. Unit-tested in
 * src/test/subscriptionAccess.test.js.
 */

/** Every subscription lifecycle state this policy recognises. */
export const SUBSCRIPTION_STATES = Object.freeze([
  'trialing',
  'active',
  'past_due',
  'canceled',
  'expired',
  'suspended',
])

/**
 * Full-access shape reused for the good-standing and fail-open cases so the
 * permissive default is defined in exactly one place.
 */
const FULL = Object.freeze({
  canUseApp: true,
  canWrite: true,
  readOnly: false,
  billingOnly: false,
  blockSelfServiceBilling: false,
})

/** Banner tones align with entitlements.STATUS_META (blue/green/amber/gray/red). */
function banner(tone, message) {
  return { tone, message }
}

/**
 * Per-state capability + banner. Each entry is a factory so the (rare) states
 * that vary on context (e.g. trialing may add a soft trial notice) can compute,
 * while the common ones stay constant. The object returned is spread into the
 * final result, so every key of the public shape is present for every state.
 */
const STATE_POLICY = Object.freeze({
  trialing: () => ({
    ...FULL,
    reason: 'Trial active — full access.',
    banner: null,
  }),
  active: () => ({
    ...FULL,
    reason: 'Subscription active.',
    banner: null,
  }),
  // Grace period: keep the app fully usable so operations are never disrupted by
  // a failed charge, but surface a clear warning and stop the org from making
  // billing-sensitive self-service changes until payment is resolved.
  past_due: () => ({
    ...FULL,
    blockSelfServiceBilling: true,
    reason: 'Payment past due — access continues during the grace period.',
    banner: banner(
      'amber',
      'Your last payment did not go through. Please update your billing details to avoid losing access.',
    ),
  }),
  // Retention window after cancellation: data stays visible (read-only) so the
  // org can export or reconsider, but no new writes are accepted.
  canceled: () => ({
    canUseApp: true,
    canWrite: false,
    readOnly: true,
    billingOnly: false,
    blockSelfServiceBilling: false,
    reason: 'Subscription canceled — read-only retention window.',
    banner: banner(
      'gray',
      'Your subscription is canceled. Your data is read-only. Reactivate a plan to resume editing.',
    ),
  }),
  // Expired: only the billing/export surface remains reachable so the org can
  // pay to reactivate or export its data. No app writes.
  expired: () => ({
    canUseApp: false,
    canWrite: false,
    readOnly: true,
    billingOnly: true,
    blockSelfServiceBilling: false,
    reason: 'Subscription expired — billing and export only.',
    banner: banner(
      'red',
      'Your subscription has expired. Renew a plan to restore access. You can still export your data.',
    ),
  }),
  // Suspended: administrative/compliance hold — fully blocked.
  suspended: () => ({
    canUseApp: false,
    canWrite: false,
    readOnly: true,
    billingOnly: false,
    blockSelfServiceBilling: false,
    reason: 'Subscription suspended — access is blocked.',
    banner: banner(
      'red',
      'Your account is suspended. Please contact support to restore access.',
    ),
  }),
})

/** Fail-open result for not-loaded / missing / unknown status. */
function failOpen(state) {
  return {
    state,
    ...FULL,
    reason: 'Subscription state not loaded or unrecognised — access permitted.',
    banner: null,
  }
}

/**
 * Extract the lifecycle status string from an overview payload, tolerating the
 * two shapes the RPC may emit (nested `subscription.status` or a flattened
 * `status`). Returns a lowercased trimmed string, or null when absent.
 */
function readStatus(overview) {
  if (!overview || typeof overview !== 'object') return null
  const raw =
    overview.subscription && typeof overview.subscription === 'object'
      ? overview.subscription.status
      : overview.status
  if (typeof raw !== 'string') return null
  const s = raw.trim().toLowerCase()
  return s || null
}

/**
 * Resolve what a subscription STATE permits.
 *
 * @param {object|null|undefined} overview - the `get_subscription_overview()`
 *   payload (or `{ status }` / `{ subscription: { status } }`). Missing,
 *   non-object, statusless or unknown-status inputs FAIL OPEN to full access.
 * @returns {{
 *   state: string,
 *   canUseApp: boolean,
 *   canWrite: boolean,
 *   readOnly: boolean,
 *   billingOnly: boolean,
 *   blockSelfServiceBilling: boolean,
 *   reason: string,
 *   banner: {tone:string,message:string}|null,
 * }}
 */
export function subscriptionAccess(overview) {
  const status = readStatus(overview)
  if (!status) return failOpen(status ?? 'unknown')
  const policy = STATE_POLICY[status]
  if (!policy) return failOpen(status)
  return { state: status, ...policy() }
}

export default subscriptionAccess
