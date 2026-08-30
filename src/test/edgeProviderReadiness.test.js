import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const source = (name) => fs.readFileSync(
  path.resolve(`supabase/functions/${name}/index.ts`),
  'utf8',
)

describe('Edge provider readiness contracts', () => {
  it('keeps billing checkout admin-only and does not trust request origins for redirects', () => {
    const checkout = source('billing-checkout')
    expect(checkout).toContain("requireApprovedRole(req, ['admin'])")
    expect(checkout).toContain("Deno.env.get('STRIPE_SECRET_KEY')")
    expect(checkout).toContain("Deno.env.get('APP_URL')")
    expect(checkout).not.toMatch(/req\.headers\.get\(['"]origin['"]\)/)
    expect(checkout).toContain("if (!stripeKey) return jsonResponse(req, { configured: false }, 200)")
  })

  it('rejects unsigned and replayed Stripe webhooks before database writes', () => {
    const webhook = source('billing-webhook')
    const signatureGate = webhook.indexOf('verifyStripeSignature(secret, raw, sig)')
    const firstSubscriptionWrite = webhook.indexOf("admin.from('org_subscriptions')")
    expect(webhook).toContain("Deno.env.get('STRIPE_WEBHOOK_SECRET')")
    expect(webhook).toContain('Math.abs(Date.now() / 1000 - Number(t)) > 300')
    expect(signatureGate).toBeGreaterThan(-1)
    expect(firstSubscriptionWrite).toBeGreaterThan(signatureGate)
  })

  it('keeps interactive and scheduled embeddings gated and disabled without OpenAI', () => {
    const interactive = source('generate-embedding')
    const worker = source('embed-worker')
    expect(interactive).toContain("requireApprovedRole(req, ['admin', 'manager', 'director'])")
    expect(interactive).toContain('OPENAI_API_KEY not configured')
    expect(worker).toContain("req.headers.get('x-cron-secret')")
    expect(worker).toContain(".eq('name', 'cron_secret')")
    expect(worker).toContain('OPENAI_API_KEY not configured')
  })

  it('keeps Sentry access server-side and restricted to super admins or cron', () => {
    const issues = source('sentry-issues')
    const alerts = source('sentry-crash-alert')
    expect(issues).toContain("select('is_super_admin')")
    expect(issues).toContain('prof?.is_super_admin !== true')
    expect(issues).toContain(".in('name', ['sentry_auth_token', 'sentry_org', 'sentry_region_url'])")
    expect(alerts).toContain("req.headers.get('x-cron-secret')")
    expect(alerts).toContain("cfg['sentry_alerts_enabled'] !== 'true'")
  })
})
