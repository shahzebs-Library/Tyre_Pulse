// ============================================================================
// email-dispatch - sends queued rows from public.email_outbox.
// Invoked by pg_cron (email_dispatch_kick) every minute, and kicked right after
// an instant email is queued. verify_jwt=false: the caller is Postgres/pg_net;
// the trust boundary is the shared secret x-email-dispatch-secret (env
// EMAIL_DISPATCH_SECRET, else cron_config.email_dispatch_secret). Never fails open.
//
// Mode: system_config.email_dispatch_mode ('dry_run' default | 'live').
// In dry_run every claimed row is RENDERED (proving the template works) and
// recorded as 'dry_run'; nothing is sent.
// Provider: EMAIL_PROVIDER (resend | smtp), see _shared/email/provider.ts.
// ============================================================================
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { providerFromEnv } from '../_shared/email/provider.ts'
import { dispatchRows, type OutboxRow } from '../_shared/email/dispatch.ts'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder(); const ab = enc.encode(a); const bb = enc.encode(b)
  let diff = ab.length ^ bb.length
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return json({ error: 'Service unavailable' }, 503)
  const admin = createClient(url, key, { auth: { persistSession: false } })

  let expected = Deno.env.get('EMAIL_DISPATCH_SECRET') || ''
  if (!expected) {
    const { data } = await admin.from('cron_config').select('value').eq('name', 'email_dispatch_secret').maybeSingle()
    expected = (data && typeof data.value === 'string') ? data.value : ''
  }
  if (!expected) return json({ error: 'Service unavailable' }, 503)
  if (!constantTimeEqual(req.headers.get('x-email-dispatch-secret') || '', expected)) return json({ error: 'Unauthorized' }, 401)

  const { data: modeRaw } = await admin.rpc('email_dispatch_mode')
  const mode = modeRaw === 'live' ? 'live' : 'dry_run'
  const { data: rows, error } = await admin.rpc('email_outbox_claim', { p_limit: 20 })
  if (error) return json({ error: 'claim failed' }, 500)

  const reports = await dispatchRows((rows || []) as OutboxRow[], {
    mode,
    provider: providerFromEnv(k => Deno.env.get(k)),
    appStoreUrl: Deno.env.get('APP_STORE_URL') || null,
    baseUrl: Deno.env.get('APP_BASE_URL') || null,
  })
  for (const r of reports) {
    await admin.rpc('email_outbox_report', {
      p_id: r.id, p_outcome: r.outcome, p_provider: r.provider ?? null, p_provider_id: r.providerId ?? null,
      p_error: r.error ?? null, p_retry_after: r.retryAfter ?? null,
    })
  }
  const tally: Record<string, number> = {}
  for (const r of reports) tally[r.outcome] = (tally[r.outcome] || 0) + 1
  return json({ mode, claimed: reports.length, ...tally })
})
