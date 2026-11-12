import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse, requireApprovedRole } from '../_shared/auth.ts'

// Global email switch (system_config.email_notifications). Returns true ONLY when
// the value is explicitly off. Fail-SAFE: any read error returns false (send).
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected into edge functions.
async function emailNotificationsDisabled(): Promise<boolean> {
  try {
    const url = Deno.env.get('SUPABASE_URL')
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !key) return false
    const client = createClient(url, key, { auth: { persistSession: false } })
    const { data } = await client.from('system_config').select('value').eq('key', 'email_notifications').maybeSingle()
    const raw = data?.value
    if (raw === undefined || raw === null) return false
    const s = String(raw).trim().toLowerCase().replace(/^"|"$/g, '')
    return ['false', '0', 'off', 'no'].includes(s)
  } catch {
    return false
  }
}

class ProviderError extends Error {}

/* ── Limits (API-1) ───────────────────────────────────────────────────────────
   This function sends mail from the product domain, so it must not be usable as
   an open relay or a quota burner by one signed-in account. */
const MAX_RECIPIENTS = 20
const MAX_EMAIL_LENGTH = 254
const MAX_SUBJECT_LENGTH = 200
const MAX_BODY_BYTES = 200 * 1024               // HTML body
const MAX_ATTACHMENT_BYTES = 7 * 1024 * 1024    // decoded attachment
const MAX_ATTACHMENT_NAME = 150
// base64 grows by 4/3; allow the attachment, the body and JSON overhead.
const MAX_REQUEST_BYTES = Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3) + MAX_BODY_BYTES + 64 * 1024
const ATTACHMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'image/png',
  'image/jpeg',
]
// Per-user send limit, counted in the database so it holds across function
// instances. Same count-then-act pattern chat-ai uses against ai_token_logs;
// here the ledger is audit_log_v2 (one row per send, written BEFORE the provider
// call so parallel requests see each other as early as possible).
const RATE_LIMIT_PER_HOUR = 20
const RATE_LIMIT_WINDOW_SECONDS = 3600
// One row per send ATTEMPT (written before the provider call), so a failing send still counts.
const AUDIT_ACTION = 'EMAIL_REPORT_SEND'
const EMAIL_RE = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+$/

function hasControlChars(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i)
    if (c < 32 || c === 127) return true
  }
  return false
}

function byteLength(v: string): number {
  return new TextEncoder().encode(v).length
}

/** Decoded size of a base64 string without decoding it. */
function base64DecodedBytes(b64: string): number {
  const len = b64.length
  if (len === 0) return 0
  let padding = 0
  if (b64.charCodeAt(len - 1) === 61) padding++
  if (len > 1 && b64.charCodeAt(len - 2) === 61) padding++
  return Math.floor(len * 3 / 4) - padding
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }

  try {
    const auth = await requireApprovedRole(req, ['admin', 'manager', 'director'])
    if (auth instanceof Response) return auth

    // Total request size cap, checked on the declared length first and again on
    // the bytes actually read (a chunked body carries no Content-Length).
    const declared = Number(req.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
      return jsonResponse(req, { error: 'The email is too large. Narrow the report or remove the attachment.' }, 413)
    }
    const rawText = await req.text()
    if (rawText.length > MAX_REQUEST_BYTES) {
      return jsonResponse(req, { error: 'The email is too large. Narrow the report or remove the attachment.' }, 413)
    }
    let parsed: Record<string, unknown>
    try {
      const value = JSON.parse(rawText)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object')
      parsed = value as Record<string, unknown>
    } catch {
      return jsonResponse(req, { error: 'Invalid request body' }, 400)
    }
    const { to, subject, body, attachmentBase64, attachmentName, attachmentType } = parsed

    // Validate required fields
    if (!to || !subject || !body) {
      return jsonResponse(req, { error: 'Missing required fields: to, subject, body' }, 400)
    }
    if (typeof subject !== 'string' || typeof body !== 'string') {
      return jsonResponse(req, { error: 'Subject and body must be text' }, 400)
    }

    // Recipients: strings only, trimmed, de-duplicated, capped, no header injection.
    const rawRecipients = Array.isArray(to) ? to : [to]
    if (rawRecipients.length > MAX_RECIPIENTS * 5) {
      return jsonResponse(req, { error: `Too many recipients. The limit is ${MAX_RECIPIENTS} per email.` }, 400)
    }
    const seen = new Set<string>()
    const recipients: string[] = []
    let invalidCount = 0
    for (const entry of rawRecipients) {
      const email = typeof entry === 'string' ? entry.trim() : ''
      if (!email || email.length > MAX_EMAIL_LENGTH || hasControlChars(email) || !EMAIL_RE.test(email)) {
        invalidCount++
        continue
      }
      const key = email.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      recipients.push(email)
    }
    if (invalidCount > 0 || recipients.length === 0) {
      // The addresses are not echoed back: the response must not repeat caller input.
      return jsonResponse(req, { error: `${invalidCount || 1} recipient address(es) are not valid email addresses.` }, 400)
    }
    if (recipients.length > MAX_RECIPIENTS) {
      return jsonResponse(req, { error: `Too many recipients. The limit is ${MAX_RECIPIENTS} per email.` }, 400)
    }

    const cleanSubject = subject.trim()
    if (!cleanSubject || cleanSubject.length > MAX_SUBJECT_LENGTH || hasControlChars(cleanSubject)) {
      return jsonResponse(req, { error: `The subject must be one line of at most ${MAX_SUBJECT_LENGTH} characters.` }, 400)
    }
    if (byteLength(body) > MAX_BODY_BYTES) {
      return jsonResponse(req, { error: 'The email body is too large.' }, 413)
    }

    let attachment: { filename: string; content: string; type: string } | null = null
    if (attachmentBase64 || attachmentName) {
      if (typeof attachmentBase64 !== 'string' || typeof attachmentName !== 'string' || !attachmentBase64 || !attachmentName) {
        return jsonResponse(req, { error: 'An attachment needs both a file name and content.' }, 400)
      }
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(attachmentBase64)) {
        return jsonResponse(req, { error: 'The attachment is not valid.' }, 400)
      }
      if (base64DecodedBytes(attachmentBase64) > MAX_ATTACHMENT_BYTES) {
        return jsonResponse(req, { error: 'The attachment is too large. The limit is 7 MB.' }, 413)
      }
      const name = attachmentName.trim()
      if (!name || name.length > MAX_ATTACHMENT_NAME || hasControlChars(name) || /[\\/]/.test(name)) {
        return jsonResponse(req, { error: 'The attachment file name is not valid.' }, 400)
      }
      const type = typeof attachmentType === 'string' && attachmentType ? attachmentType : 'application/pdf'
      if (!ATTACHMENT_TYPES.includes(type)) {
        return jsonResponse(req, { error: 'This attachment type is not allowed.' }, 400)
      }
      attachment = { filename: name, content: attachmentBase64, type }
    }

    // Global email switch (console System Configuration -> email_notifications).
    // When explicitly OFF, skip sending and return a clean 200 (not an error).
    // Fail-SAFE: any read error proceeds to send so a transient failure never
    // silently disables email delivery.
    if (await emailNotificationsDisabled()) {
      return jsonResponse(req, { skipped: true, reason: 'email_notifications disabled' })
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
    const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'reports@tyrepulse.app'

    if (!RESEND_API_KEY) {
      return jsonResponse(req, { error: 'Email delivery is not configured. Please contact an administrator.' }, 503)
    }

    // ── Per-user rate limit + audit row (both fail CLOSED) ─────────────────────
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse(req, { error: 'Email delivery is not configured. Please contact an administrator.' }, 503)
    }
    const svc = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
    const userId = auth.profile.id
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString()
    const { data: recentRows, error: recentErr } = await svc
      .from('audit_log_v2')
      .select('created_at')
      .eq('user_id', userId)
      .eq('action', AUDIT_ACTION)
      .gte('created_at', windowStart)
      .order('created_at', { ascending: true })
      .limit(RATE_LIMIT_PER_HOUR)
    if (recentErr) {
      console.error('[send-email] rate-limit read failed (blocking):', recentErr.message)
      return jsonResponse(req, { error: 'Email delivery is temporarily unavailable. Please try again shortly.' }, 503)
    }
    if ((recentRows?.length ?? 0) >= RATE_LIMIT_PER_HOUR) {
      const oldest = new Date(String(recentRows![0].created_at)).getTime()
      const waitMs = oldest + RATE_LIMIT_WINDOW_SECONDS * 1000 - Date.now()
      const retryAfter = Math.max(1, Math.ceil((Number.isFinite(waitMs) ? waitMs : RATE_LIMIT_WINDOW_SECONDS * 1000) / 1000))
      return jsonResponse(
        req,
        { error: 'You have sent the maximum number of emails for this hour. Please try again later.', retry_after_seconds: retryAfter },
        429,
        { 'Retry-After': String(retryAfter) },
      )
    }

    // The caller's organisation, for the audit row (service role has no session org).
    const { data: actor } = await svc.from('profiles').select('org_id, email').eq('id', userId).maybeSingle()
    const { error: auditErr } = await svc.from('audit_log_v2').insert({
      user_id: userId,
      user_email: actor?.email ?? null,
      user_role: auth.role,
      org_id: actor?.org_id ?? null,
      action: AUDIT_ACTION,
      table_name: 'send-email',
      new_values: {
        to: recipients,
        subject: cleanSubject,
        has_attachment: !!attachment,
        attachment_name: attachment?.filename ?? null,
      },
    })
    if (auditErr) {
      // No audit row = no rate-limit count and no trace of who sent what, so the send is refused.
      console.error('[send-email] audit insert failed (blocking):', auditErr.message)
      return jsonResponse(req, { error: 'Email delivery is temporarily unavailable. Please try again shortly.' }, 503)
    }

    const payload: Record<string, unknown> = {
      from: FROM_EMAIL,
      to: recipients,
      subject: cleanSubject,
      html: body,
    }

    if (attachment) {
      payload.attachments = [attachment]
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await res.json()

    if (!res.ok) {
      // The provider's own sentence (e.g. an unverified sending domain) is
      // actionable for an admin and carries no database internals, so it is the
      // one message passed through; anything else below is generic.
      throw new ProviderError(String(data?.message || `Email provider error (${res.status})`).slice(0, 300))
    }

    return jsonResponse(req, { success: true, id: data.id })
  } catch (err) {
    console.error('[send-email] failed:', err instanceof Error ? err.message : err)
    const message = err instanceof ProviderError ? err.message : 'The email could not be sent.'
    return jsonResponse(req, { error: message }, 500)
  }
})
