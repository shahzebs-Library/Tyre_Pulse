// device-ingest: hardware / telematics devices push readings into Tyre Pulse.
//
// STATUS: AUTHORED, NOT DEPLOYED. Needs migration 20261128100000_device_ingest
// applied first, then: supabase functions deploy device-ingest --no-verify-jwt
//
// Auth: an ingest key minted in Devices & Integrations (device_ingest_keys),
// sent as `x-device-key: tpd_xxxxxxxxxx.<secret>` or `Authorization: Bearer ...`.
// The key is looked up by its public prefix and the sha256 of the full key is
// compared in constant time. The key decides the organisation and which data
// types it may send. verify_jwt=false: devices have no Supabase session; the
// key IS the credential.
//
// Body: up to 512 KB, up to 500 messages. Vendor shape is picked from
// `?vendor=generic|teltonika|wialon|samsara`, the `x-device-vendor` header,
// the key's own vendor, or detected. See supabase/functions/_shared/deviceIngest.js.
//
// Response 200: { accepted, duplicates, quarantined, rejected, results:[{index,status,error?}] }
// Errors: 400 bad_json/too_many_messages, 401 invalid_key, 405, 413 too_large,
// 429 rate_limited, 503 not_configured. Never internals.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { MAX_BODY_BYTES, normalizeBatch, VENDORS } from '../_shared/deviceIngest.js'

const HEADERS = {
  'Content-Type': 'application/json',
  // Device-to-server only. CORS is irrelevant for devices; the browser test
  // helper uses the dry-run RPC instead, so no origin is allowed here.
  'Cache-Control': 'no-store',
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } })
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Constant-time comparison of two equal-length hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length, 64)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

export function readKey(req: Request): string {
  const h = req.headers.get('x-device-key') ?? ''
  if (h) return h.trim()
  const auth = req.headers.get('authorization') ?? ''
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
}

/**
 * Reads the body as a stream and stops as soon as it passes `max` bytes, so
 * an oversized (or lying Content-Length) request is never buffered whole.
 * Returns null when the cap is exceeded.
 */
export async function readBodyCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const buf = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.byteLength
  }
  return new TextDecoder().decode(buf)
}

// Best-effort brake on key guessing from one address (per isolate).
const failures = new Map<string, { n: number; at: number }>()
function tooManyFailures(ip: string): boolean {
  const f = failures.get(ip)
  return !!f && f.n >= 20 && Date.now() - f.at < 60_000
}
function noteFailure(ip: string) {
  const f = failures.get(ip)
  if (!f || Date.now() - f.at >= 60_000) failures.set(ip, { n: 1, at: Date.now() })
  else f.n++
  if (failures.size > 5000) failures.clear()
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' })

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ error: 'not_configured' }, 503)

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  if (tooManyFailures(ip)) return json({ error: 'rate_limited' }, 429, { 'Retry-After': '60' })

  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return json({ error: 'too_large', max_bytes: MAX_BODY_BYTES }, 413)

  const key = readKey(req)
  const dot = key.indexOf('.')
  if (!key.startsWith('tpd_') || dot < 5 || key.length > 200) {
    noteFailure(ip)
    return json({ error: 'invalid_key' }, 401)
  }

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: k, error: lookupErr } = await svc.rpc('device_ingest_key_lookup', { p_prefix: key.slice(0, dot) })
  if (lookupErr) return json({ error: 'temporarily_unavailable' }, 503)
  const presented = await sha256Hex(key)
  const ok = !!k?.found && timingSafeEqualHex(presented, String(k.key_hash ?? ''))
  if (!ok || !k.usable) {
    noteFailure(ip)
    return json({ error: 'invalid_key' }, 401)
  }

  // Size cap holds even without (or with a lying) Content-Length: the body is
  // streamed and reading stops at the cap.
  const text = await readBodyCapped(req, MAX_BODY_BYTES)
  if (text === null) return json({ error: 'too_large', max_bytes: MAX_BODY_BYTES }, 413)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const params = new URL(req.url).searchParams
  const hint = params.get('vendor') ?? req.headers.get('x-device-vendor') ?? k.vendor
  const batch = normalizeBatch(body, { vendor: VENDORS.includes(hint) ? hint : undefined })
  if (batch.error) return json({ error: batch.error }, 400)
  if (!batch.messages.length && !batch.rejected.length) return json({ error: 'empty_batch' }, 400)

  // Rejected-by-validation messages are passed through so the server ledger
  // records them for monitoring; they never reach a business table.
  const ordered: { index: number; payload: Record<string, unknown> }[] = [
    ...batch.messages.map((m) => ({ index: m.index, payload: m.message })),
    ...batch.rejected.map((r) => ({ index: r.index, payload: { type: r.type, _rejected: r.error } })),
  ].sort((a, b) => a.index - b.index)

  const { data: res, error: submitErr } = await svc.rpc('device_ingest_submit', {
    p_key_id: k.id,
    p_messages: ordered.map((o) => o.payload),
  })
  if (submitErr) return json({ error: 'temporarily_unavailable' }, 503)
  if (!res?.ok) {
    if (res?.error === 'rate_limited') return json({ error: 'rate_limited', limit: res.limit }, 429, { 'Retry-After': '60' })
    if (res?.error === 'invalid_key') return json({ error: 'invalid_key' }, 401)
    return json({ error: 'bad_batch' }, 400)
  }

  const results = (res.results as { index: number; status: string; error?: string; reason?: string }[]).map((r, i) => ({
    index: ordered[i]?.index ?? i,
    status: r.status,
    ...(r.error ? { error: r.error } : {}),
    ...(r.reason ? { reason: r.reason } : {}),
  }))
  const count = (s: string) => results.filter((r) => r.status === s).length
  return json({
    vendor: batch.vendor,
    accepted: count('accepted'),
    duplicates: count('duplicate'),
    quarantined: count('quarantined'),
    rejected: count('rejected'),
    results,
  })
})
