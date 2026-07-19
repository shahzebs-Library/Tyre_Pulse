// ============================================================================
// workflow-notify - Approval & Workflow Engine notification fan-out (Phase 3).
//
// Server-invoked (by the pg_cron deliverer in MIGRATIONS_V119_WORKFLOW_NOTIFY.sql).
// Deployed with verify_jwt=false because there is no end-user JWT on the invoking
// request - the caller is Postgres/pg_net. The trust boundary here is the shared
// secret header `x-workflow-secret`, validated against the WORKFLOW_NOTIFY_SECRET
// env var or, if that is unset, the DB-seeded cron_config.workflow_notify_secret
// (V119) - the exact value the deliverer sends. The gate is MANDATORY and never
// fails open (a fail-open would let any unauthenticated caller relay brand-domain
// email, push, and billable WhatsApp to attacker-supplied recipients).
//
// Self-contained single file (inlined CORS) - matches the deployed function.
// Fans one notification across three ENV-GATED channels, each independently
// optional (unconfigured env -> silent no-op, reported under `skipped`):
//   * Email    - Resend            (RESEND_API_KEY, FROM_EMAIL)
//   * Push     - Expo Push API      (no key; gated on presence of push_tokens)
//   * WhatsApp - Twilio Messages    (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
//                                     TWILIO_WHATSAPP_FROM)
// One channel failing never blocks the others.
//
// Response (200): { email: n, push: n, whatsapp: n, skipped: string[] }
// ============================================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Inlined CORS helpers (self-contained). This function is server-to-server only
// (no browser caller), so CORS is not a security boundary here.
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  let allowOrigin = '*'
  if (origin) {
    allowOrigin = (/^https:\/\//.test(origin) || origin.startsWith('http://localhost')) ? origin : 'null'
  }
  const requestedHeaders = req.headers.get('access-control-request-headers')
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': requestedHeaders || 'authorization, x-client-info, apikey, content-type, x-app-name, x-workflow-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin, Access-Control-Request-Headers',
  }
}
function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } })
}

type Recipient = { user_id?: string | null; email?: string | null; push_token?: string | null; phone?: string | null; role?: string | null }
type NotifyPayload = { event_type?: string; instance_id?: string; definition_name?: string; entity_type?: string; entity_label?: string; step_name?: string; comment?: string; recipients?: Recipient[] }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function buildMessage(p: NotifyPayload): { title: string; body: string } {
  const label = p.entity_label || p.entity_type || 'A document'
  const def = p.definition_name || 'workflow'
  const step = p.step_name || 'a step'
  const comment = p.comment ? ` Comment: ${p.comment}` : ''
  switch (p.event_type) {
    case 'workflow.approved': return { title: `Approved: ${def}`, body: `${label} ${def} completed all approval steps.` }
    case 'workflow.rejected': return { title: `Rejected: ${def}`, body: `${label} ${def} was rejected at step ${step}.${comment}` }
    case 'workflow.returned': return { title: `Returned for correction: ${def}`, body: `${label} ${def} was returned at step ${step}.${comment}` }
    default: return { title: `Approval required: ${def}`, body: `${label} ${def} is awaiting your approval at step ${step}.${comment}` }
  }
}

async function sendEmails(recipients: Recipient[], msg: { title: string; body: string }, skipped: string[]): Promise<number> {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'reports@tyrepulse.app'
  const emails = Array.from(new Set(recipients.map(r => (r.email || '').trim().toLowerCase()).filter(e => EMAIL_RE.test(e))))
  if (!RESEND_API_KEY) { if (emails.length) skipped.push('email: RESEND_API_KEY not configured'); return 0 }
  if (!emails.length) { skipped.push('email: no valid recipient addresses'); return 0 }
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px;color:#111"><h2 style="margin:0 0 12px">${escapeHtml(msg.title)}</h2><p style="margin:0 0 16px;line-height:1.5">${escapeHtml(msg.body)}</p><p style="margin:0;color:#666;font-size:12px">Tyre Pulse &mdash; Approval &amp; Workflow Engine</p></div>`
  let sent = 0
  for (const to of emails) {
    try {
      const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject: msg.title, html }) })
      if (res.ok) { sent++ } else { const data = await res.json().catch(() => ({})); skipped.push(`email(${to}): ${data?.message || `HTTP ${res.status}`}`) }
    } catch (err) { skipped.push(`email(${to}): ${errMsg(err)}`) }
  }
  return sent
}

async function sendPush(recipients: Recipient[], msg: { title: string; body: string }, instanceId: string | undefined, skipped: string[]): Promise<number> {
  const tokens = Array.from(new Set(recipients.map(r => (r.push_token || '').trim()).filter(t => /^Expo(nent)?PushToken\[/.test(t))))
  if (!tokens.length) return 0
  const messages = tokens.map(to => ({ to, sound: 'default', title: msg.title, body: msg.body, data: { type: 'workflow', instance_id: instanceId || null } }))
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip, deflate', 'Content-Type': 'application/json' }, body: JSON.stringify(messages) })
    if (!res.ok) { const text = await res.text().catch(() => ''); skipped.push(`push: HTTP ${res.status}${text ? ` ${text.slice(0, 200)}` : ''}`); return 0 }
    const json = await res.json().catch(() => null) as { data?: Array<{ status?: string; message?: string }> } | null
    const tickets = json?.data ?? []
    let ok = 0
    tickets.forEach((t, i) => { if (t?.status === 'ok') { ok++ } else if (t?.message) { skipped.push(`push(${tokens[i]}): ${t.message}`) } })
    return tickets.length ? ok : tokens.length
  } catch (err) { skipped.push(`push: ${errMsg(err)}`); return 0 }
}

async function sendWhatsApp(recipients: Recipient[], msg: { title: string; body: string }, skipped: string[]): Promise<number> {
  const SID = Deno.env.get('TWILIO_ACCOUNT_SID'); const TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN'); const FROM = Deno.env.get('TWILIO_WHATSAPP_FROM')
  const phones = Array.from(new Set(recipients.map(r => normalisePhone(r.phone)).filter((p): p is string => !!p)))
  if (!SID || !TOKEN || !FROM) { if (phones.length) skipped.push('whatsapp: Twilio env not configured'); return 0 }
  if (!phones.length) { skipped.push('whatsapp: no valid recipient phone numbers'); return 0 }
  const from = FROM.startsWith('whatsapp:') ? FROM : `whatsapp:${FROM}`
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(SID)}/Messages.json`
  const authHeader = `Basic ${btoa(`${SID}:${TOKEN}`)}`
  const bodyText = `${msg.title}\n\n${msg.body}`
  let sent = 0
  for (const phone of phones) {
    try {
      const form = new URLSearchParams(); form.set('To', `whatsapp:${phone}`); form.set('From', from); form.set('Body', bodyText)
      const res = await fetch(url, { method: 'POST', headers: { 'Authorization': authHeader, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() })
      if (res.ok) { sent++ } else { const data = await res.json().catch(() => ({})); skipped.push(`whatsapp(${phone}): ${data?.message || `HTTP ${res.status}`}`) }
    } catch (err) { skipped.push(`whatsapp(${phone}): ${errMsg(err)}`) }
  }
  return sent
}

function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim().replace(/^whatsapp:/i, '')
  const cleaned = (trimmed.startsWith('+') ? '+' : '') + trimmed.replace(/[^\d]/g, '')
  return /^\+?\d{8,15}$/.test(cleaned) ? cleaned : null
}
function escapeHtml(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') }
function errMsg(err: unknown): string { return err instanceof Error ? err.message : 'Unknown error' }

// Resolve the expected shared secret: prefer the env var, else fall back to the
// DB-seeded cron_config.workflow_notify_secret (V119) read with the service role
// (auto-injected into every edge function). Guarantees the gate is never open even
// when WORKFLOW_NOTIFY_SECRET was never configured in the function env.
async function resolveExpectedSecret(): Promise<string> {
  const envSecret = Deno.env.get('WORKFLOW_NOTIFY_SECRET') || ''
  if (envSecret) return envSecret
  try {
    const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !key) return ''
    const admin = createClient(url, key)
    const { data } = await admin.from('cron_config').select('value').eq('name', 'workflow_notify_secret').maybeSingle()
    return (data && typeof data.value === 'string') ? data.value : ''
  } catch { return '' }
}

// Global push switch (system_config.push_notifications). Returns true ONLY when
// the value is explicitly off, so the push channel can be skipped while email and
// WhatsApp are untouched. Fail-SAFE: any read error returns false (send push).
// Self-contained (no _shared import); service role is auto-injected.
async function pushNotificationsDisabled(): Promise<boolean> {
  try {
    const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !key) return false
    const admin = createClient(url, key)
    const { data } = await admin.from('system_config').select('value').eq('key', 'push_notifications').maybeSingle()
    const raw = data?.value
    if (raw === undefined || raw === null) return false
    const s = String(raw).trim().toLowerCase().replace(/^"|"$/g, '')
    return ['false', '0', 'off', 'no'].includes(s)
  } catch { return false }
}

// Constant-time comparison to avoid leaking the shared secret via timing.
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder(); const ab = enc.encode(a); const bb = enc.encode(b)
  let diff = ab.length ^ bb.length
  const n = Math.max(ab.length, bb.length)
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return jsonResponse(req, { error: 'Method not allowed' }, 405)

  // Mandatory shared-secret gate (never fails open).
  const expectedSecret = await resolveExpectedSecret()
  if (!expectedSecret) {
    console.error('workflow-notify: no shared secret configured (env or cron_config); refusing request')
    return jsonResponse(req, { error: 'Service unavailable' }, 503)
  }
  const provided = req.headers.get('x-workflow-secret') || ''
  if (!constantTimeEqual(provided, expectedSecret)) return jsonResponse(req, { error: 'Unauthorized' }, 401)

  let payload: NotifyPayload
  try { payload = await req.json() } catch { return jsonResponse(req, { error: 'Invalid JSON body' }, 400) }
  const recipients = Array.isArray(payload.recipients) ? payload.recipients : []
  if (!payload.event_type) return jsonResponse(req, { error: 'Missing required field: event_type' }, 400)
  if (!recipients.length) return jsonResponse(req, { email: 0, push: 0, whatsapp: 0, skipped: ['no recipients'] })
  const msg = buildMessage(payload)
  const skipped: string[] = []
  // Global push switch: when explicitly off, skip ONLY the push channel (email +
  // WhatsApp still go out). Fail-safe: a read error leaves push enabled.
  const pushDisabled = await pushNotificationsDisabled()
  if (pushDisabled) skipped.push('push: push_notifications disabled')
  const [email, push, whatsapp] = await Promise.all([
    sendEmails(recipients, msg, skipped).catch(err => { skipped.push(`email: ${errMsg(err)}`); return 0 }),
    pushDisabled ? Promise.resolve(0) : sendPush(recipients, msg, payload.instance_id, skipped).catch(err => { skipped.push(`push: ${errMsg(err)}`); return 0 }),
    sendWhatsApp(recipients, msg, skipped).catch(err => { skipped.push(`whatsapp: ${errMsg(err)}`); return 0 }),
  ])
  return jsonResponse(req, { email, push, whatsapp, skipped })
})
