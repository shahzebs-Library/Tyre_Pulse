/**
 * Billing service (Roadmap #6) — the single boundary for subscription_plans,
 * org_subscriptions and invoices, plus the aggregate overview RPC.
 *
 * Mirrors the src/lib/api/* conventions: explicit column lists (no SELECT *),
 * ServiceError via unwrap, one place per domain. RLS enforces org scoping and
 * Admin-only writes server-side (see MIGRATIONS_V105); this layer never trusts
 * the client for authorisation — it only shapes the calls.
 *
 * Stripe seam: `startCheckout` is where a hosted-checkout edge function will be
 * invoked once STRIPE keys exist. Until then `changePlan` applies the plan
 * change directly (correct for manual/enterprise billing).
 */
import { supabase, unwrap } from './_client'

const PLAN_COLS =
  'id,code,name,description,price_monthly,price_annual,currency,' +
  'max_vehicles,max_users,max_api_keys,max_storage_gb,features,is_public,sort_order,active'

const SUB_COLS =
  'id,organisation_id,plan_code,status,billing_interval,seats,trial_ends_at,' +
  'current_period_start,current_period_end,cancel_at_period_end,' +
  'external_customer_id,external_subscription_id,created_at,updated_at'

const INVOICE_COLS =
  'id,number,status,amount_due,amount_paid,currency,period_start,period_end,' +
  'issued_at,due_at,paid_at,line_items,external_invoice_id'

/** Public, active plans for the pricing grid — cheapest first. */
export async function listPlans() {
  return unwrap(
    await supabase
      .from('subscription_plans')
      .select(PLAN_COLS)
      .eq('active', true)
      .eq('is_public', true)
      .order('sort_order', { ascending: true }),
  )
}

/**
 * Aggregate overview: plan + subscription + live usage + limits in one call.
 * Returns the parsed jsonb object (never throws for "no subscription" — the RPC
 * synthesises a trial view). Throws ServiceError only on a transport/RPC error.
 */
export async function getOverview() {
  return unwrap(await supabase.rpc('get_subscription_overview'))
}

/** Ensure the org has a persisted subscription row; returns it. */
export async function ensureSubscription() {
  return unwrap(await supabase.rpc('ensure_org_subscription'))
}

/** The org's current subscription row (or null if not yet provisioned). */
export async function getSubscription() {
  return unwrap(
    await supabase.from('org_subscriptions').select(SUB_COLS).maybeSingle(),
  )
}

/**
 * Change the org's plan / billing interval. Provisions the row first (so a
 * brand-new org can subscribe), then upserts on organisation_id.
 *
 * SECURITY: a PAID plan can only be activated by the signature-verified Stripe
 * webhook after real payment (see billing-webhook). The client may only move to
 * the free/trial tier here (a downgrade or cancellation) — it must NEVER set a
 * paid subscription to 'active', which would hand out paid plans for free.
 * Use startCheckout() to begin a paid subscription. The DB still enforces
 * Admin-only writes via RLS.
 *
 * @param {{planCode:string, interval?:'monthly'|'annual', seats?:number}} opts
 */
export async function changePlan({ planCode, interval = 'monthly', seats } = {}) {
  if (!planCode) throw new Error('A plan code is required.')
  const isPaidPlan = planCode !== 'trial' && planCode !== 'free'
  if (isPaidPlan) {
    throw new Error('Paid plans must be activated through secure checkout, not applied directly.')
  }
  // Guarantee a row exists and capture its org so the upsert targets it.
  const current = await ensureSubscription()
  const orgId = current?.organisation_id ?? null
  const now = new Date()
  const periodEnd = new Date(now)
  if (interval === 'annual') periodEnd.setFullYear(periodEnd.getFullYear() + 1)
  else periodEnd.setMonth(periodEnd.getMonth() + 1)

  const patch = {
    plan_code: planCode,
    billing_interval: interval,
    status: 'trialing',
    cancel_at_period_end: false,
    current_period_start: now.toISOString(),
    current_period_end: periodEnd.toISOString(),
    ...(Number.isFinite(seats) ? { seats } : {}),
  }

  // Prefer a precise update by id (correct even for legacy NULL-org installs,
  // where UNIQUE(organisation_id) can't be an upsert conflict target because
  // Postgres treats NULLs as distinct). Fall back to an insert only if the row
  // somehow vanished between ensure and update.
  if (current?.id) {
    return unwrap(
      await supabase
        .from('org_subscriptions')
        .update(patch)
        .eq('id', current.id)
        .select(SUB_COLS)
        .single(),
    )
  }

  return unwrap(
    await supabase
      .from('org_subscriptions')
      .upsert({ organisation_id: orgId, ...patch }, { onConflict: 'organisation_id' })
      .select(SUB_COLS)
      .single(),
  )
}

/**
 * Schedule cancellation at period end (default) or reactivate a subscription
 * previously flagged to cancel.
 */
export async function setCancelAtPeriodEnd(subscriptionId, cancel) {
  if (!subscriptionId) throw new Error('A subscription id is required.')
  return unwrap(
    await supabase
      .from('org_subscriptions')
      .update({ cancel_at_period_end: !!cancel })
      .eq('id', subscriptionId)
      .select(SUB_COLS)
      .single(),
  )
}

/** Invoice history for the org, newest first. */
export async function listInvoices({ limit = 50 } = {}) {
  return unwrap(
    await supabase
      .from('invoices')
      .select(INVOICE_COLS)
      .order('issued_at', { ascending: false })
      .limit(limit),
  )
}

/**
 * Server-side entitlement check ("can this org add one more <resource>?").
 * Returns boolean; fails CLOSED (false) on any RPC error so a plan cap can
 * never be bypassed by triggering a transient failure. The UI shows a clean
 * "could not verify your plan limit" message rather than silently allowing.
 */
export async function canAddResource(resource) {
  try {
    return unwrap(await supabase.rpc('org_can_add', { p_resource: resource })) === true
  } catch {
    return false
  }
}

/**
 * Start Stripe self-serve checkout for a paid plan via the billing-checkout
 * edge function. Returns `{ configured, url }`:
 *   - configured:true + url  → redirect the browser to Stripe's hosted page.
 *   - configured:false       → Stripe keys not set; caller falls back to an
 *                              admin-applied plan change (changePlan).
 * Throws only on a real transport/function error.
 *
 * @param {{planCode:string, interval?:'monthly'|'annual'}} opts
 */
export async function startCheckout({ planCode, interval = 'monthly' } = {}) {
  if (!planCode || planCode === 'trial') throw new Error('A paid plan is required for checkout.')
  const { data, error } = await supabase.functions.invoke('billing-checkout', {
    body: { planCode, interval },
  })
  if (error) throw new Error(error.message || 'Checkout could not be started.')
  return data || { configured: false }
}
