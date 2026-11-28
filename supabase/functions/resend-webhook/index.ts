// ============================================================================
// resend-webhook - Resend delivery events (bounced, complained, delivered ...).
// verify_jwt=false: Resend has no Supabase JWT. Trust boundary = Svix signature
// (RESEND_WEBHOOK_SECRET, whsec_...), 5-minute timestamp tolerance, and a replay
// table keyed on svix-id (email_webhook_record). A hard bounce or complaint adds
// the address to email_suppressions so it is never mailed again.
// ============================================================================
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifySvix } from '../_shared/email/svix.ts'

const MAX_BODY = 64 * 1024
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const raw = await req.text()
  if (raw.length > MAX_BODY) return json({ error: 'Too large' }, 413)
  const v = await verifySvix(Deno.env.get('RESEND_WEBHOOK_SECRET') || '', {
    id: req.headers.get('svix-id'), timestamp: req.headers.get('svix-timestamp'), signature: req.headers.get('svix-signature'),
  }, raw)
  if (!v.ok) return json({ error: 'Unauthorized' }, v.reason === 'not configured' ? 503 : 401)

  let evt: { type?: string; data?: { email_id?: string; to?: string[] | string; bounce?: { type?: string } } }
  try { evt = JSON.parse(raw) } catch { return json({ error: 'Invalid JSON' }, 400) }
  const type = String(evt.type || '')
  // Only a HARD (permanent) bounce suppresses; a soft bounce is just recorded.
  const hard = type !== 'email.bounced' || !evt.data?.bounce?.type || /permanent|hard/i.test(evt.data.bounce.type)
  const to = Array.isArray(evt.data?.to) ? evt.data?.to[0] : evt.data?.to
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return json({ error: 'Service unavailable' }, 503)
  const { data, error } = await createClient(url, key).rpc('email_webhook_record', {
    p_message_id: req.headers.get('svix-id'),
    p_type: hard ? type : `${type}.soft`,
    p_provider_message_id: evt.data?.email_id ?? null,
    p_address: to ?? null,
    p_payload: { type, bounce: evt.data?.bounce ?? null },
  })
  if (error) return json({ error: 'record failed' }, 500)
  return json({ ok: true, result: data })
})
