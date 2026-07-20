// billing-webhook — reconcile org_subscriptions from Stripe events.
//
// Roadmap #6 payment reconciliation. Stripe calls this (no user JWT) after a
// checkout completes or a subscription changes. We verify the Stripe signature
// (HMAC-SHA256 over `${t}.${rawBody}` with STRIPE_WEBHOOK_SECRET) before trusting
// anything, then update the org's subscription with a service-role client.
//
// Handled events:
//   checkout.session.completed        → activate plan, store Stripe ids
//   customer.subscription.updated      → sync status + period window
//   customer.subscription.deleted      → mark canceled
//
// Deploy: verify_jwt = false. Secrets: STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY
// (optional, for fetching subscription period), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const enc = new TextEncoder()

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return out === 0
}

async function verifyStripeSignature(secret: string, payload: string, header: string): Promise<boolean> {
  const parts: Record<string, string> = {}
  for (const kv of header.split(',')) {
    const [k, v] = kv.split('=')
    if (k && v) parts[k.trim()] = v.trim()
  }
  const t = parts['t']
  const v1 = parts['v1']
  if (!t || !v1) return false
  // Reject stale timestamps (> 5 min) to blunt replay.
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`))
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return timingSafeEqual(hex, v1)
}

function periodEnd(interval: string): string {
  const d = new Date()
  if (interval === 'annual') d.setFullYear(d.getFullYear() + 1)
  else d.setMonth(d.getMonth() + 1)
  return d.toISOString()
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!secret) return new Response('Webhook not configured', { status: 503 })

  const raw = await req.text()
  const sig = req.headers.get('stripe-signature') ?? ''
  if (!(await verifyStripeSignature(secret, raw, sig))) {
    return new Response('Invalid signature', { status: 400 })
  }

  let event: any
  try { event = JSON.parse(raw) } catch { return new Response('Bad payload', { status: 400 }) }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const obj = event?.data?.object ?? {}

  try {
    if (event.type === 'checkout.session.completed') {
      const orgId = obj.metadata?.org_id || obj.client_reference_id || null
      const planCode = obj.metadata?.plan_code || null
      const interval = obj.metadata?.interval === 'annual' ? 'annual' : 'monthly'
      if (planCode) {
        await admin.from('org_subscriptions').upsert({
          organisation_id: orgId,
          plan_code: planCode,
          status: 'active',
          billing_interval: interval,
          cancel_at_period_end: false,
          current_period_start: new Date().toISOString(),
          current_period_end: periodEnd(interval),
          external_customer_id: obj.customer ?? null,
          external_subscription_id: obj.subscription ?? null,
        }, { onConflict: 'organisation_id' })
      }
    } else if (event.type === 'customer.subscription.updated') {
      const status = obj.cancel_at_period_end ? 'active'
        : obj.status === 'past_due' ? 'past_due'
        : obj.status === 'canceled' ? 'canceled'
        : obj.status === 'active' ? 'active' : 'active'
      const patch: Record<string, unknown> = {
        status,
        cancel_at_period_end: !!obj.cancel_at_period_end,
      }
      if (obj.current_period_end) patch.current_period_end = new Date(obj.current_period_end * 1000).toISOString()
      await admin.from('org_subscriptions').update(patch).eq('external_subscription_id', obj.id)
    } else if (event.type === 'customer.subscription.deleted') {
      await admin.from('org_subscriptions')
        .update({ status: 'canceled', cancel_at_period_end: false })
        .eq('external_subscription_id', obj.id)
    }
  } catch (e) {
    // A failed reconciliation must NOT be ACKed as success — return 5xx so Stripe
    // retries, otherwise a paid subscription can silently never activate (or a
    // cancellation never applies). The (signature-verified) error is logged.
    console.error('billing-webhook handler error', e)
    return new Response(JSON.stringify({ error: 'reconciliation_failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})
