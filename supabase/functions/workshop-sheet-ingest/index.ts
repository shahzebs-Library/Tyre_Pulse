// workshop-sheet-ingest - receives changed rows from the shared workshop
// intake Google Sheet (Apps Script, docs/workshop-status/intake-sheet.gs).
//
// Security:
//   * No user JWT: the request is authenticated by an HMAC-SHA256 signature
//     over `${timestamp}.${body}` with WORKSHOP_SHEET_SECRET (>= 32 chars).
//     The secret is set by the owner as a Supabase secret and in the sheet's
//     Script Properties. It is never in code.
//   * The timestamp must be within 5 minutes, and the database refuses a
//     timestamp that does not move forward for that sheet (replay guard).
//   * Max 200 rows per call; the database skips rows whose content did not
//     change (server-side hash), so a re-send costs almost nothing.
//   * Deploy with verify_jwt = false (the signature is the authentication).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MAX_BODY = 512 * 1024
const MAX_SKEW_MS = 5 * 60 * 1000
const encoder = new TextEncoder()

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('')
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const secret = Deno.env.get('WORKSHOP_SHEET_SECRET') ?? ''
  if (secret.length < 32) return json(503, { error: 'Sheet intake is not configured' })

  const ts = req.headers.get('x-tp-timestamp') ?? ''
  const signature = (req.headers.get('x-tp-signature') ?? '').toLowerCase()
  const raw = await req.text()
  if (raw.length > MAX_BODY) return json(413, { error: 'Too large; send at most 200 rows' })
  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > MAX_SKEW_MS) {
    return json(401, { error: 'Request expired' })
  }
  const expected = await hmacHex(secret, `${ts}.${raw}`)
  if (!signature || !safeEqual(signature, expected)) return json(401, { error: 'Bad signature' })

  let body: { sheet_id?: string; rows?: unknown[] }
  try { body = JSON.parse(raw) } catch { return json(400, { error: 'Invalid JSON' }) }
  const rows = Array.isArray(body.rows) ? body.rows : []
  if (!body.sheet_id || !/^[0-9a-f-]{36}$/i.test(body.sheet_id)) return json(400, { error: 'sheet_id missing' })
  if (rows.length > 200) return json(413, { error: 'Send at most 200 rows' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const { data, error } = await admin.rpc('workshop_intake_sheet_ingest', {
    p_sheet_id: body.sheet_id, p_rows: rows, p_request_ts: Math.trunc(tsNum),
  })
  if (error) {
    const status = error.code === 'PT409' ? 409 : error.code === 'P0002' ? 404 : 400
    console.error('workshop-sheet-ingest', error.code)
    return json(status, { error: status === 409 ? 'Replayed request' : status === 404 ? 'Sheet not registered' : 'Could not save rows' })
  }
  return json(200, data)
})
