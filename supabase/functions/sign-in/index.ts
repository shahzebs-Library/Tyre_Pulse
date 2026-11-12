// ============================================================================
// sign-in - username / employee-id password sign-in WITHOUT revealing the
// account's email address to the browser or the phone.
//
// Why this exists: the anonymous RPC get_email_by_identifier used to return
// the real auth email for any username, so anyone who knew a username learned
// that person's email. The clients now POST { identifier, password } here and
// this function, with the service role, resolves the email, checks the
// server-side lockout (V287), and exchanges the password with GoTrue itself.
// The caller only ever receives a session (after a correct password) or ONE
// generic refusal.
//
// Responses:
//   200 { access_token, refresh_token, expires_in, expires_at, token_type, user: { id } }
//   401 { error: 'invalid_credentials' }   unknown user AND wrong password (identical)
//   429 { error: 'locked', retry_after_seconds }
//   400 { error: 'invalid_request' } / 405 { error: 'method_not_allowed' }
//   503 { error: 'unavailable' }           auth backend busy or down (not counted)
//
// Failures are recorded server-side via record_login_failure, so the client
// must NOT record them again (it would double count).
//
// verify_jwt = false: the caller is not signed in yet; the password is the
// proof. Self-contained single file so it deploys as one file.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DEFAULT_ALLOWED_ORIGINS = [
  'https://tyrepulse.app',
  'https://www.tyrepulse.app',
  'https://app.tyrepulse.app',
  'http://localhost:5173',
  'http://localhost:5174',
]

const MAX_BODY_BYTES = 4096
const MAX_IDENTIFIER = 254
const MAX_PASSWORD = 1024
// Every refusal takes at least this long so "unknown user" (no GoTrue call)
// cannot be told apart from "wrong password" by timing.
const MIN_REFUSAL_MS = 700

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  const configured = Deno.env.get('ALLOWED_ORIGINS')?.split(',').map((v) => v.trim()).filter(Boolean)
  const allowed = configured?.length ? configured : DEFAULT_ALLOWED_ORIGINS
  // A native app sends no Origin header; '*' there is harmless (no cookies).
  const allowOrigin = origin ? (allowed.includes(origin) ? origin : 'null') : '*'
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': req.headers.get('access-control-request-headers') || 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin, Access-Control-Request-Headers',
  }
}

function clientIp(req: Request): string | null {
  const raw = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || ''
  return raw.split(',')[0].trim().slice(0, 64) || null
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m)
}

/** Optional sb_secret_ key: only a secret key may carry Sb-Forwarded-For. */
function secretKey(): string | null {
  const direct = Deno.env.get('SB_SECRET_KEY')
  if (direct?.startsWith('sb_secret_')) return direct
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const v = typeof parsed === 'object' && parsed ? (parsed.default ?? Object.values(parsed)[0]) : null
    return typeof v === 'string' && v.startsWith('sb_secret_') ? v : null
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

Deno.serve(async (req) => {
  const started = Date.now()
  const headers = { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  // A 429 carries Retry-After (seconds) taken from the body's own retry_after_seconds.
  const reply = (status: number, body: unknown) => {
    const wait = Number((body as { retry_after_seconds?: unknown } | null)?.retry_after_seconds)
    const extra: Record<string, string> = status === 429 && Number.isFinite(wait) && wait > 0
      ? { 'Retry-After': String(Math.ceil(wait)) }
      : {}
    return new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } })
  }
  const refuse = async (status: number, body: unknown) => {
    const wait = MIN_REFUSAL_MS - (Date.now() - started)
    if (wait > 0) await sleep(wait + Math.floor(Math.random() * 120))
    return reply(status, body)
  }

  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' })

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !serviceKey || !anonKey) return reply(503, { error: 'unavailable' })

  // ---- body: size cap, JSON, types ---------------------------------------
  const declared = Number(req.headers.get('content-length') || '0')
  if (declared > MAX_BODY_BYTES) return reply(413, { error: 'invalid_request' })
  let text = ''
  try { text = await req.text() } catch { return reply(400, { error: 'invalid_request' }) }
  if (text.length > MAX_BODY_BYTES) return reply(413, { error: 'invalid_request' })
  let body: Record<string, unknown>
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape')
    body = parsed as Record<string, unknown>
  } catch {
    return reply(400, { error: 'invalid_request' })
  }
  if (typeof body.identifier !== 'string' || typeof body.password !== 'string') {
    return reply(400, { error: 'invalid_request' })
  }
  const identifier = body.identifier.trim()
  const password = body.password
  const captcha = typeof body.captcha_token === 'string' ? body.captcha_token.slice(0, 4096) : null
  if (!identifier || !password || identifier.length > MAX_IDENTIFIER || password.length > MAX_PASSWORD) {
    return reply(400, { error: 'invalid_request' })
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // ---- lockout gate (fail safe: an RPC error never blocks a sign-in) -----
  try {
    const { data } = await admin.rpc('login_attempt_status', { p_identifier: identifier })
    if (data?.locked) {
      return refuse(429, { error: 'locked', retry_after_seconds: Number(data.retry_after_seconds) || 0 })
    }
  } catch { /* fail safe */ }

  const recordFailure = async () => {
    try {
      const { data } = await admin.rpc('record_login_failure', { p_identifier: identifier })
      if (data?.locked) {
        return refuse(429, { error: 'locked', retry_after_seconds: Number(data.retry_after_seconds) || 0 })
      }
    } catch { /* fail safe */ }
    return refuse(401, { error: 'invalid_credentials' })
  }

  // ---- resolve the email server-side (same order as get_email_by_identifier)
  let email: string | null = null
  if (identifier.includes('@')) {
    email = identifier
  } else if (!identifier.includes('*')) {
    // PostgREST treats '*' as a LIKE wildcard; no username or employee id
    // carries one, so such an identifier simply matches nobody.
    try {
      const pattern = escapeLike(identifier)
      let userId: string | null = null
      for (const col of ['username', 'employee_id']) {
        const { data, error } = await admin.from('profiles').select('id').ilike(col, pattern).limit(1)
        if (error) return reply(503, { error: 'unavailable' })
        if (data?.length) { userId = data[0].id as string; break }
      }
      if (userId) {
        const { data, error } = await admin.auth.admin.getUserById(userId)
        if (error) return reply(503, { error: 'unavailable' })
        email = data?.user?.email ?? null
      }
    } catch {
      return reply(503, { error: 'unavailable' })
    }
  }
  if (!email) return recordFailure() // no-op count for unknown ids (V287), same answer

  // ---- password grant ----------------------------------------------------
  const secret = secretKey()
  const forward = Deno.env.get('AUTH_FORWARD_CLIENT_IP') === 'true' && secret
  const ip = clientIp(req)
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: forward ? secret! : anonKey,
  }
  if (forward && ip) authHeaders['Sb-Forwarded-For'] = ip

  let res: Response
  try {
    res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        email,
        password,
        ...(captcha ? { gotrue_meta_security: { captcha_token: captcha } } : {}),
      }),
    })
  } catch {
    return reply(503, { error: 'unavailable' })
  }

  if (res.status === 429 || res.status >= 500) {
    // The backend is busy or down: not the person's fault, not counted.
    return reply(503, { error: 'unavailable' })
  }
  let session: Record<string, unknown> = {}
  try { session = await res.json() } catch { session = {} }
  if (!res.ok) {
    const code = String(session.error_code || session.code || '')
    if (/captcha/i.test(code)) return refuse(400, { error: 'captcha_failed' })
    return recordFailure()
  }

  const user = session.user as { id?: string } | undefined
  if (typeof session.access_token !== 'string' || typeof session.refresh_token !== 'string' || !user?.id) {
    return reply(503, { error: 'unavailable' })
  }
  return reply(200, {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type,
    user: { id: user.id },
  })
})
