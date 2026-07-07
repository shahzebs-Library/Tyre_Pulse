// billing-checkout — create a Stripe Checkout Session for a plan upgrade.
//
// Roadmap #6 (Subscription & Billing) self-serve payment seam. Admin-only
// (custom auth via requireApprovedRole). Reads the target plan from
// subscription_plans, builds an inline price (so no pre-created Stripe prices
// are required), and returns the hosted-checkout URL. The org id is stamped as
// client_reference_id + metadata so billing-webhook can reconcile on payment.
//
// Graceful degradation: if STRIPE_SECRET_KEY is unset the function returns
// { configured: false } (HTTP 200) so the client transparently falls back to an
// admin-applied plan change — the app never pretends a payment happened.
//
// Deploy: verify_jwt = false (custom auth inside). Secrets: STRIPE_SECRET_KEY
// (optional until go-live), SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse, requireApprovedRole } from '../_shared/auth.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405)

  // Only an approved Admin may initiate a paid plan change.
  const auth = await requireApprovedRole(req, ['admin'])
  if (auth instanceof Response) return auth

  let body: { planCode?: string; interval?: 'monthly' | 'annual' }
  try { body = await req.json() } catch { return jsonResponse(req, { error: 'Invalid JSON body' }, 400) }
  const planCode = (body.planCode ?? '').trim()
  const interval = body.interval === 'annual' ? 'annual' : 'monthly'
  if (!planCode || planCode === 'trial') {
    return jsonResponse(req, { error: 'A paid plan code is required' }, 400)
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!stripeKey) return jsonResponse(req, { configured: false }, 200)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  // Resolve the plan (price + currency) and the caller's org.
  const [{ data: plan }, { data: profile }] = await Promise.all([
    admin.from('subscription_plans').select('code,name,price_monthly,price_annual,currency').eq('code', planCode).maybeSingle(),
    admin.from('profiles').select('org_id').eq('id', auth.profile.id).maybeSingle(),
  ])
  if (!plan) return jsonResponse(req, { error: 'Unknown plan' }, 404)

  const amount = Number(interval === 'annual' ? plan.price_annual : plan.price_monthly)
  if (!Number.isFinite(amount) || amount <= 0) {
    // Enterprise / custom-priced plans are handled by sales, not self-serve.
    return jsonResponse(req, { error: 'This plan is not available for self-serve checkout. Contact sales.' }, 400)
  }

  const origin = req.headers.get('origin') ?? 'https://tyrepulse.app'
  const orgId = profile?.org_id ?? ''

  // Build the Checkout Session (form-encoded Stripe REST API — no SDK needed).
  const form = new URLSearchParams()
  form.set('mode', 'subscription')
  form.set('success_url', `${origin}/billing?checkout=success`)
  form.set('cancel_url', `${origin}/billing?checkout=cancel`)
  form.set('client_reference_id', orgId)
  form.set('metadata[plan_code]', planCode)
  form.set('metadata[interval]', interval)
  form.set('metadata[org_id]', orgId)
  form.set('line_items[0][quantity]', '1')
  form.set('line_items[0][price_data][currency]', (plan.currency ?? 'USD').toLowerCase())
  form.set('line_items[0][price_data][product_data][name]', `Tyre Pulse — ${plan.name} (${interval})`)
  form.set('line_items[0][price_data][unit_amount]', String(Math.round(amount * 100)))
  form.set('line_items[0][price_data][recurring][interval]', interval === 'annual' ? 'year' : 'month')

  const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })
  const session = await resp.json()
  if (!resp.ok) {
    return jsonResponse(req, { error: session?.error?.message ?? 'Stripe checkout failed' }, 502)
  }
  return jsonResponse(req, { configured: true, url: session.url }, 200)
})
