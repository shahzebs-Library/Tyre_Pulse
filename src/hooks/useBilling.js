/**
 * useBilling — React binding for the billing service (Roadmap #6).
 *
 * Loads the subscription overview + plan catalogue + invoices together and
 * exposes entitlement helpers derived from src/lib/entitlements.js so any
 * component can answer "is this org over its vehicle cap?" without re-deriving
 * the maths. Uses TanStack Query (already the app default) for caching,
 * background refresh and de-duped fetches.
 *
 * `useEntitlements()` is the lightweight variant for enforcement call sites that
 * only need `canAdd(resource)` / `planAllows(feature)` — it shares the same
 * query cache key, so mounting it is free when the Billing page is also open.
 */
import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as billing from '../lib/api/billing'
import { canAdd, isAtLimit, planAllows, usageRows, trialDaysLeft } from '../lib/entitlements'
import { subscriptionAccess } from '../lib/subscriptionAccess'

const OVERVIEW_KEY = ['billing', 'overview']
const PLANS_KEY = ['billing', 'plans']
const INVOICES_KEY = ['billing', 'invoices']

/** Full billing state for the Billing page. */
export function useBilling() {
  const qc = useQueryClient()

  const overviewQ = useQuery({
    queryKey: OVERVIEW_KEY,
    queryFn: billing.getOverview,
    staleTime: 60_000,
  })
  const plansQ = useQuery({
    queryKey: PLANS_KEY,
    queryFn: billing.listPlans,
    staleTime: 5 * 60_000,
  })
  const invoicesQ = useQuery({
    queryKey: INVOICES_KEY,
    queryFn: () => billing.listInvoices(),
    staleTime: 60_000,
  })

  const overview = overviewQ.data ?? null

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['billing'] })
  }, [qc])

  return {
    overview,
    plans: plansQ.data ?? [],
    invoices: invoicesQ.data ?? [],
    rows: usageRows(overview),
    trialDaysLeft: trialDaysLeft(overview),
    // Derived subscription-STATE access policy (read-only; not wired to block
    // routing/writes yet). Fails open when overview is null/not-loaded.
    subscriptionAccess: subscriptionAccess(overview),
    loading: overviewQ.isLoading || plansQ.isLoading,
    invoicesLoading: invoicesQ.isLoading,
    error: overviewQ.error || plansQ.error || null,
    invoicesError: invoicesQ.error || null,
    refresh,
    // entitlement helpers bound to the current overview
    canAdd: (resource, count = 1) => canAdd(overview, resource, count),
    isAtLimit: (resource) => isAtLimit(overview, resource),
    planAllows: (feature) => planAllows(overview, feature),
  }
}

/**
 * Lightweight entitlement hook for enforcement points (e.g. an "Add Vehicle"
 * button). Returns `{ canAdd, isAtLimit, planAllows, loading }`. Shares the
 * overview cache with useBilling, so it costs one background fetch at most.
 */
export function useEntitlements() {
  const { data: overview, isLoading } = useQuery({
    queryKey: OVERVIEW_KEY,
    queryFn: billing.getOverview,
    staleTime: 60_000,
  })
  return {
    loading: isLoading,
    canAdd: useCallback((resource, count = 1) => canAdd(overview ?? null, resource, count), [overview]),
    isAtLimit: useCallback((resource) => isAtLimit(overview ?? null, resource), [overview]),
    planAllows: useCallback((feature) => planAllows(overview ?? null, feature), [overview]),
  }
}

export default useBilling
