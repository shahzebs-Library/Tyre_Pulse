// ============================================================================
// qr-login - finish a QR sign-in.
//
// Flow: the sign-in page calls the qr_login_start RPC (anon) and shows the code
// as a QR. A signed-in phone scans it and calls qr_login_approve. The page polls
// qr_login_status; once 'approved' it POSTs { id, secret } here, where secret
// is the BROWSER secret (never shown in the QR; the QR carries the scan secret). This function
// (service role) checks the request is approved, unexpired and unused, marks it
// consumed in one conditional update (so a code works once), re-checks the
// approving account is approved and unlocked, and returns a one-time magic-link
// token hash. The page exchanges it with supabase.auth.verifyOtp for a session.
// The page never sees an email address or a password.
//
// verify_jwt = false: the caller is not signed in yet. The secret is the proof.
// Self-contained (no _shared import) so it deploys as one file.
// ============================================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DEFAULT_ALLOWED_ORIGINS = [
  'https://tyrepulse.app',
  'https://www.tyrepulse.app',
  'http://localhost:5173',
  'http://localhost:5174',
]

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  const configured = Deno.env.get('ALLOWED_ORIGINS')?.split(',').map((v) => v.trim()).filter(Boolean)
  const allowed = configured?.length ? configured : DEFAULT_ALLOWED_ORIGINS
  const allowOrigin = origin ? (allowed.includes(origin) ? origin : 'null') : '*'
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': req.headers.get('access-control-request-headers') || 'authorization, x-client-info, apikey, content-type, x-app-name',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin, Access-Control-Request-Headers',
  }
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function clientIp(req: Request): string | null {
  const raw = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || ''
  return raw.split(',')[0].trim().slice(0, 64) || null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

serve(async (req) => {
  const headers = { ...cors(req), 'Content-Type': 'application/json' }
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers })
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return reply(405, { ok: false, reason: 'method' })

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return reply(500, { ok: false, reason: 'unavailable' })
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  let body: { id?: string; secret?: string } = {}
  try { body = await req.json() } catch { return reply(400, { ok: false, reason: 'invalid' }) }
  const id = String(body.id || '')
  const secret = String(body.secret || '')
  if (!UUID_RE.test(id) || secret.length < 32 || secret.length > 128) return reply(400, { ok: false, reason: 'invalid' })

  const hash = await sha256Hex(secret)
  // Single use: only an approved, unexpired, matching row flips to consumed.
  const { data: rows, error } = await admin
    .from('qr_login_requests')
    .update({ status: 'consumed', consumed_at: new Date().toISOString(), redeem_ip: clientIp(req) })
    .eq('id', id)
    .eq('browser_hash', hash)
    .eq('status', 'approved')
    .gt('expires_at', new Date().toISOString())
    .select('approved_by')
  if (error) return reply(500, { ok: false, reason: 'unavailable' })
  const userId = rows?.[0]?.approved_by
  if (!userId) return reply(409, { ok: false, reason: 'not_approved' })

  const { data: profile } = await admin.from('profiles').select('approved, locked').eq('id', userId).maybeSingle()
  if (!profile || profile.approved !== true || profile.locked === true) return reply(403, { ok: false, reason: 'account' })

  // A QR session is single-factor. Users with 2FA enrolled must sign in with
  // their password and code instead, so QR never weakens their second factor.
  // Fail closed: if the factor list cannot be read, refuse rather than risk
  // issuing a single-factor session to an account that has 2FA.
  const { data: factors, error: factorErr } = await admin.auth.admin.mfa.listFactors({ userId })
  if (factorErr || !Array.isArray(factors?.factors)) return reply(503, { ok: false, reason: 'unavailable' })
  if (factors.factors.some((f: { status?: string }) => f.status === 'verified')) return reply(403, { ok: false, reason: 'mfa' })

  const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(userId)
  const email = userRes?.user?.email
  if (userErr || !email) return reply(403, { ok: false, reason: 'account' })

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = link?.properties?.hashed_token
  if (linkErr || !tokenHash) return reply(500, { ok: false, reason: 'unavailable' })

  return reply(200, { ok: true, token_hash: tokenHash })
})
