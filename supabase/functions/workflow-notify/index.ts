// ============================================================================
// workflow-notify — Approval & Workflow Engine notification fan-out (Phase 3).
//
// Server-invoked (by the pg_cron deliverer in MIGRATIONS_V119_WORKFLOW_NOTIFY.sql).
// Deploy with `--no-verify-jwt` (verify_jwt=false) because there is no end-user
// JWT on the invoking request — the caller is Postgres/pg_net. The trust
// boundary here is the shared secret header `x-workflow-secret`, compared to
// the WORKFLOW_NOTIFY_SECRET env var when that var is set.
//
// Fans a single workflow notification out across three ENV-GATED channels,
// each independently optional (a channel with unconfigured env is a silent
// no-op, reported under `skipped`):
//   * Email    — Resend            (RESEND_API_KEY, FROM_EMAIL)
//   * Push     — Expo Push API      (no key; gated on presence of push_tokens)
//   * WhatsApp — Twilio Messages    (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
//                                     TWILIO_WHATSAPP_FROM)
//
// One channel failing NEVER blocks the others (each is caught independently).
// Mirrors the structure/CORS of supabase/functions/send-email/index.ts.
//
// Request  (POST, application/json):
//   {
//     event_type: 'workflow.step_advanced' | 'workflow.approved'
//               | 'workflow.rejected' | 'workflow.returned',
//     instance_id: string,
//     definition_name: string,
//     entity_type: string,
//     entity_label: string,
//     step_name: string,
//     comment?: string,
//     recipients: Array<{
//       user_id?: string, email?: string, push_token?: string,
//       phone?: string, role?: string
//     }>
//   }
//
// Response (200): { email: n, push: n, whatsapp: n, skipped: string[] }
// ============================================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders, jsonResponse } from '../_shared/auth.ts'

type Recipient = {
  user_id?: string | null
  email?: string | null
  push_token?: string | null
  phone?: string | null
  role?: string | null
}

type NotifyPayload = {
  event_type?: string
  instance_id?: string
  definition_name?: string
  entity_type?: string
  entity_label?: string
  step_name?: string
  comment?: string
  recipients?: Recipient[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Human-readable one-liners per event type. Kept intentionally short so they
// render cleanly across email subjects, push titles and WhatsApp bodies.
function buildMessage(p: NotifyPayload): { title: string; body: string } {
  const label = p.entity_label || p.entity_type || 'A document'
  const def = p.definition_name || 'workflow'
  const step = p.step_name || 'a step'
  const comment = p.comment ? ` Comment: ${p.comment}` : ''

  switch (p.event_type) {
    case 'workflow.approved':
      return {
        title: `Approved: ${def}`,
        body: `${label} ${def} completed all approval steps.`,
      }
    case 'workflow.rejected':
      return {
        title: `Rejected: ${def}`,
        body: `${label} ${def} was rejected at step ${step}.${comment}`,
      }
    case 'workflow.returned':
      return {
        title: `Returned for correction: ${def}`,
        body: `${label} ${def} was returned at step ${step}.${comment}`,
      }
    case 'workflow.step_advanced':
    default:
      return {
        title: `Approval required: ${def}`,
        body: `${label} ${def} is awaiting your approval at step ${step}.${comment}`,
      }
  }
}

// ── Channel: Email (Resend) ────────────────────────────────────────────────
async function sendEmails(
  recipients: Recipient[],
  msg: { title: string; body: string },
  skipped: string[],
): Promise<number> {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'reports@tyrepulse.app'

  const emails = Array.from(
    new Set(
      recipients
        .map(r => (r.email || '').trim().toLowerCase())
        .filter(e => EMAIL_RE.test(e)),
    ),
  )

  if (!RESEND_API_KEY) {
    if (emails.length) skipped.push('email: RESEND_API_KEY not configured')
    return 0
  }
  if (!emails.length) {
    skipped.push('email: no valid recipient addresses')
    return 0
  }

  const html =
    `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px;color:#111">` +
    `<h2 style="margin:0 0 12px">${escapeHtml(msg.title)}</h2>` +
    `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(msg.body)}</p>` +
    `<p style="margin:0;color:#666;font-size:12px">Tyre Pulse — Approval &amp; Workflow Engine</p>` +
    `</div>`

  let sent = 0
  // Send per-recipient so one bad address does not fail the whole batch.
  for (const to of emails) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject: msg.title, html }),
      })
      if (res.ok) {
        sent++
      } else {
        const data = await res.json().catch(() => ({}))
        skipped.push(`email(${to}): ${data?.message || `HTTP ${res.status}`}`)
      }
    } catch (err) {
      skipped.push(`email(${to}): ${errMsg(err)}`)
    }
  }
  return sent
}

// ── Channel: Push (Expo) ───────────────────────────────────────────────────
async function sendPush(
  recipients: Recipient[],
  msg: { title: string; body: string },
  instanceId: string | undefined,
  skipped: string[],
): Promise<number> {
  // Expo accepts anonymous sends; a token starting with ExponentPushToken[...]
  // or ExpoPushToken[...]. We batch valid tokens into one call (Expo supports
  // up to 100 messages per request).
  const tokens = Array.from(
    new Set(
      recipients
        .map(r => (r.push_token || '').trim())
        .filter(t => /^Expo(nent)?PushToken\[/.test(t)),
    ),
  )

  if (!tokens.length) {
    // Not an error — simply nobody has a registered device.
    return 0
  }

  const messages = tokens.map(to => ({
    to,
    sound: 'default',
    title: msg.title,
    body: msg.body,
    data: { type: 'workflow', instance_id: instanceId || null },
  }))

  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      skipped.push(`push: HTTP ${res.status}${text ? ` ${text.slice(0, 200)}` : ''}`)
      return 0
    }

    const json = await res.json().catch(() => null) as
      | { data?: Array<{ status?: string; message?: string }> }
      | null
    const tickets = json?.data ?? []
    let ok = 0
    tickets.forEach((t, i) => {
      if (t?.status === 'ok') {
        ok++
      } else if (t?.message) {
        skipped.push(`push(${tokens[i]}): ${t.message}`)
      }
    })
    // If Expo returned no per-message tickets (unexpected), count optimistically.
    return tickets.length ? ok : tokens.length
  } catch (err) {
    skipped.push(`push: ${errMsg(err)}`)
    return 0
  }
}

// ── Channel: WhatsApp (Twilio) ─────────────────────────────────────────────
async function sendWhatsApp(
  recipients: Recipient[],
  msg: { title: string; body: string },
  skipped: string[],
): Promise<number> {
  const SID = Deno.env.get('TWILIO_ACCOUNT_SID')
  const TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')
  const FROM = Deno.env.get('TWILIO_WHATSAPP_FROM') // e.g. 'whatsapp:+14155238886'

  const phones = Array.from(
    new Set(
      recipients
        .map(r => normalisePhone(r.phone))
        .filter((p): p is string => !!p),
    ),
  )

  if (!SID || !TOKEN || !FROM) {
    if (phones.length) skipped.push('whatsapp: Twilio env not configured')
    return 0
  }
  if (!phones.length) {
    skipped.push('whatsapp: no valid recipient phone numbers')
    return 0
  }

  const from = FROM.startsWith('whatsapp:') ? FROM : `whatsapp:${FROM}`
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(SID)}/Messages.json`
  const authHeader = `Basic ${btoa(`${SID}:${TOKEN}`)}`
  const bodyText = `${msg.title}\n\n${msg.body}`

  let sent = 0
  for (const phone of phones) {
    try {
      const form = new URLSearchParams()
      form.set('To', `whatsapp:${phone}`)
      form.set('From', from)
      form.set('Body', bodyText)

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      })

      if (res.ok) {
        sent++
      } else {
        const data = await res.json().catch(() => ({}))
        skipped.push(`whatsapp(${phone}): ${data?.message || `HTTP ${res.status}`}`)
      }
    } catch (err) {
      skipped.push(`whatsapp(${phone}): ${errMsg(err)}`)
    }
  }
  return sent
}

// ── Helpers ────────────────────────────────────────────────────────────────
function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim().replace(/^whatsapp:/i, '')
  // Keep a leading '+' then digits only. Require E.164-ish (8–15 digits).
  const cleaned = (trimmed.startsWith('+') ? '+' : '') + trimmed.replace(/[^\d]/g, '')
  return /^\+?\d{8,15}$/.test(cleaned) ? cleaned : null
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error'
}

// ── Handler ────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }
  if (req.method !== 'POST') {
    return jsonResponse(req, { error: 'Method not allowed' }, 405)
  }

  // Shared-secret gate (only enforced when the secret is configured). The
  // function is deployed with verify_jwt=false, so this header is the trust
  // boundary for the server-to-server caller.
  const requiredSecret = Deno.env.get('WORKFLOW_NOTIFY_SECRET')
  if (requiredSecret) {
    const provided = req.headers.get('x-workflow-secret') || ''
    if (provided !== requiredSecret) {
      return jsonResponse(req, { error: 'Unauthorized' }, 401)
    }
  }

  let payload: NotifyPayload
  try {
    payload = await req.json()
  } catch {
    return jsonResponse(req, { error: 'Invalid JSON body' }, 400)
  }

  const recipients = Array.isArray(payload.recipients) ? payload.recipients : []
  if (!payload.event_type) {
    return jsonResponse(req, { error: 'Missing required field: event_type' }, 400)
  }
  if (!recipients.length) {
    return jsonResponse(req, { email: 0, push: 0, whatsapp: 0, skipped: ['no recipients'] })
  }

  const msg = buildMessage(payload)
  const skipped: string[] = []

  // Run the three channels concurrently; each is independently guarded so a
  // failure in one never blocks the others.
  const [email, push, whatsapp] = await Promise.all([
    sendEmails(recipients, msg, skipped).catch(err => {
      skipped.push(`email: ${errMsg(err)}`)
      return 0
    }),
    sendPush(recipients, msg, payload.instance_id, skipped).catch(err => {
      skipped.push(`push: ${errMsg(err)}`)
      return 0
    }),
    sendWhatsApp(recipients, msg, skipped).catch(err => {
      skipped.push(`whatsapp: ${errMsg(err)}`)
      return 0
    }),
  ])

  return jsonResponse(req, { email, push, whatsapp, skipped })
})
