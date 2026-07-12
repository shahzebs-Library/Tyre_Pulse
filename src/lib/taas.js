/**
 * TaaS (Tyre-as-a-Service) — pure, dependency-free domain logic for the TaaS
 * module (/taas). Turns a set of subscription contracts into the commercial KPIs
 * that drive the page: cost-per-km, km utilisation, monthly recurring revenue
 * (MRR), days-to-renewal, and a by-plan revenue breakdown.
 *
 * Kept here (no Supabase, no React, no `Date.now()` calls) so it stays
 * deterministic and unit-tested. Every "now"-dependent function accepts an
 * injected `nowMs` timestamp; the service (`src/lib/api/taas.js`) and page
 * (`src/pages/Taas.jsx`) build on these primitives so the roll-up logic lives in
 * exactly one place.
 */

/** Plan types recognised by the commercial layer. */
export const PLAN_TYPES = ['per_km', 'per_month', 'per_tyre', 'hybrid']

/** Subscription lifecycle states. */
export const STATUSES = ['active', 'trial', 'paused', 'cancelled', 'expired']

/** Statuses that contribute recurring revenue (billable, live contracts). */
const REVENUE_STATUSES = new Set(['active', 'trial'])

const DAY_MS = 86_400_000

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Cost per kilometre for a subscription: amount billed to date divided by the
 * actual distance run under the contract. Returns null when either input is
 * missing/non-numeric or when actual_km is zero (divide-by-zero guard) — the
 * caller renders "—" rather than Infinity/NaN.
 *
 * @param {object} sub
 * @returns {number|null}
 */
export function costPerKm(sub) {
  const billed = toFiniteNumber(sub?.billed_to_date)
  const km = toFiniteNumber(sub?.actual_km)
  if (billed == null || km == null || km === 0) return null
  return billed / km
}

/**
 * Kilometre utilisation as a percentage: actual_km / committed_km × 100. Values
 * above 100 are legitimate (the contract is over-committed / over-run) and are
 * returned as-is so the page can flag over-utilisation. Returns null when either
 * input is missing/non-numeric or when committed_km is zero (guard).
 *
 * @param {object} sub
 * @returns {number|null}  0..100+ or null
 */
export function kmUtilization(sub) {
  const actual = toFiniteNumber(sub?.actual_km)
  const committed = toFiniteNumber(sub?.committed_km)
  if (actual == null || committed == null || committed === 0) return null
  return (actual / committed) * 100
}

/**
 * Monthly Recurring Revenue: the summed monthly_fee across all live (active or
 * trial) subscriptions. Non-live contracts (paused/cancelled/expired) and
 * non-numeric fees contribute zero.
 *
 * @param {Array<object>} rows
 * @returns {number}
 */
export function mrr(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  return list.reduce((sum, r) => {
    if (!REVENUE_STATUSES.has(r?.status)) return sum
    const fee = toFiniteNumber(r?.monthly_fee)
    return sum + (fee != null ? fee : 0)
  }, 0)
}

/**
 * Whole days from `nowMs` until the subscription's renewal_date. Negative when
 * the renewal is already overdue; null when there is no valid renewal date.
 *
 * @param {object} sub
 * @param {number} nowMs  injected current time in ms (deterministic)
 * @returns {number|null}
 */
export function daysToRenewal(sub, nowMs) {
  const raw = sub?.renewal_date
  if (!raw) return null
  const t = new Date(raw).getTime()
  if (Number.isNaN(t)) return null
  const now = Number.isFinite(nowMs) ? nowMs : Date.now()
  return Math.ceil((t - now) / DAY_MS)
}

/**
 * Fleet-level KPI summary for the TaaS header.
 *   • totalSubscriptions — number of contracts
 *   • activeCount        — contracts in 'active' status
 *   • trialCount         — contracts in 'trial' status
 *   • mrr                — monthly recurring revenue (active + trial)
 *   • totalTyresCovered  — summed tyres_covered across all contracts
 *   • renewalsDue30d     — live contracts renewing within the next 30 days
 *                          (0..30 inclusive; overdue renewals excluded here as
 *                          they are surfaced separately as "overdue")
 *
 * @param {Array<object>} rows
 * @param {number} nowMs  injected current time in ms
 */
export function summariseTaas(rows = [], nowMs) {
  const list = Array.isArray(rows) ? rows : []
  const now = Number.isFinite(nowMs) ? nowMs : Date.now()

  let activeCount = 0
  let trialCount = 0
  let totalTyresCovered = 0
  let renewalsDue30d = 0

  for (const r of list) {
    if (r?.status === 'active') activeCount++
    else if (r?.status === 'trial') trialCount++

    const tyres = toFiniteNumber(r?.tyres_covered)
    if (tyres != null) totalTyresCovered += tyres

    if (REVENUE_STATUSES.has(r?.status)) {
      const d = daysToRenewal(r, now)
      if (d != null && d >= 0 && d <= 30) renewalsDue30d++
    }
  }

  return {
    totalSubscriptions: list.length,
    activeCount,
    trialCount,
    mrr: mrr(list),
    totalTyresCovered,
    renewalsDue30d,
  }
}

/**
 * Revenue breakdown by plan type. Returns one entry per distinct plan_type
 * present in the data, each with its contract count and summed MRR (live
 * contracts only, via `mrr`). Sorted by MRR descending, then count descending.
 *
 * @param {Array<object>} rows
 * @returns {Array<{ plan_type:string, count:number, mrr:number }>}
 */
export function byPlan(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const groups = new Map()
  for (const r of list) {
    const plan = r?.plan_type != null && r.plan_type !== '' ? String(r.plan_type) : 'unspecified'
    if (!groups.has(plan)) groups.set(plan, [])
    groups.get(plan).push(r)
  }
  return [...groups.entries()]
    .map(([plan_type, group]) => ({
      plan_type,
      count: group.length,
      mrr: mrr(group),
    }))
    .sort((a, b) => b.mrr - a.mrr || b.count - a.count)
}
