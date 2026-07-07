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
 * brand-new org can subscribe), then upserts on organisation_id. Moving onto a
 * paid plan flips status trialing → active and opens a fresh period window; the
 * DB still enforces Admin-only via RLS.
 *
 * @param {{planCode:string, interval?:'monthly'|'annual', seats?:number}} opts
 */
export async function changePlan({ planCode, interval = 'monthly', seats } = {}) {
  if (!planCode) throw new Error('A plan code is required.')
  // Guarantee a row exists and capture its org so the upsert targets it.
  const current = await ensureSubscription()
  const orgId = current?.organisation_id ?? null
  const isPaidPlan = planCode !== 'trial'
  const now = new Date()
  const periodEnd = new Date(now)
  if (interval === 'annual') periodEnd.setFullYear(periodEnd.getFullYear() + 1)
  else periodEnd.setMonth(periodEnd.getMonth() + 1)

  const patch = {
    plan_code: planCode,
    billing_interval: interval,
    status: isPaidPlan ? 'active' : 'trialing',
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
 * Returns boolean; falls back to true (fail open) on any RPC error so a
 * transient failure never hard-stops a legitimate action.
 */
export async function canAddResource(resource) {
  try {
    return unwrap(await supabase.rpc('org_can_add', { p_resource: resource })) === true
  } catch {
    return true
  }
}

/**
 * Stripe checkout seam. Throws a clear, non-crashing error until a checkout
 * edge function + STRIPE keys are configured, so the UI can show an actionable
 * message instead of pretending a payment happened.
 */
export async function startCheckout() {
  throw new Error(
    'Online payment is not configured yet. Set the Stripe keys and deploy the ' +
    'billing-checkout edge function, then plan upgrades can be paid self-serve. ' +
    'For now an administrator applies the plan directly.',
  )
}
