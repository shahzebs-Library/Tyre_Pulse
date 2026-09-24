// ============================================================================
// admin-revoke-sessions - super-admin "force sign-out everywhere".
//
// SOC 2 CC6.2 / CC6.3: immediate de-provisioning. Locking a profile alone only
// blocks the NEXT profile check; the user's refresh token keeps minting new
// access tokens. This function deletes every auth.sessions row for the target
// (refresh tokens cascade), optionally locks the account, and writes an
// access_audit + console_sessions record - all in ONE database transaction via
// public.admin_revoke_user_sessions (service_role EXECUTE only).
//
// LIMIT: an access token already issued stays valid until it expires (default
// 1 hour). Revocation stops renewal; it cannot recall a JWT already issued.
//
// Deployed with verify_jwt=false so the CORS-wrapped JSON errors below are
// readable by the browser. The caller is validated here AND re-validated in SQL.
//
// Request (POST): { user_id: uuid, reason: string, lock?: boolean }
// Response:       { ok, sessions_revoked, locked, note } | { ok:false, error }
// ============================================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = ['https://tyrepulse.app', 'https://www.tyrepulse.app', 'https://app.tyrepulse.app', 'https://admin.tyrepulse.app']
const VERCEL_ORIGIN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const NOTE =
  'All sign-ins for this user were ended. An access token already issued stays valid until it expires (up to 1 hour); it cannot be renewed.'

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  let allowOrigin = '*'
  if (origin) {
    allowOrigin = (ALLOWED_ORIGINS.includes(origin) || VERCEL_ORIGIN.test(origin) || origin.startsWith('http://localhost')) ? origin : 'null'
  }
  const requestedHeaders = req.headers.get('access-control-request-headers')
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': requestedHeaders || 'authorization, x-client-info, apikey, content-type, x-app-name',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin, Access-Control-Request-Headers',
  }
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

function fail(req: Request, status: number, error: string): Response {
  return json(req, { ok: false, error }, status)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return fail(req, 405, 'Method not allowed.')

  try {
    const url = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !anonKey || !serviceKey) return fail(req, 503, 'Session revocation is not configured.')

    // 1. Authenticate the caller.
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return fail(req, 401, 'Sign in required.')
    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userErr } = await authClient.auth.getUser(token)
    const callerId = userData?.user?.id
    if (userErr || !callerId) return fail(req, 401, 'Your session has expired. Please sign in again.')

    // 2. Authorize: super admin, not locked (read with the service role).
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: caller } = await admin
      .from('profiles').select('id, is_super_admin, locked').eq('id', callerId).maybeSingle()
    if (!caller || caller.is_super_admin !== true || caller.locked === true) {
      return fail(req, 403, 'Only a super admin can revoke sessions.')
    }

    // 3. Validate input.
    let body: Record<string, unknown> = {}
    try { body = await req.json() } catch { /* validated below */ }
    const targetId = typeof body.user_id === 'string' ? body.user_id.trim() : ''
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    const lock = body.lock === true
    if (!UUID_RE.test(targetId)) return fail(req, 400, 'A valid user is required.')
    if (reason.length < 3) return fail(req, 400, 'Please give a reason (at least 3 characters).')
    if (reason.length > 500) return fail(req, 400, 'The reason is too long (500 characters maximum).')
    if (targetId === callerId) return fail(req, 400, 'You cannot revoke your own sessions here. Use Sign out instead.')

    const { data: target } = await admin
      .from('profiles').select('id, is_super_admin, locked').eq('id', targetId).maybeSingle()
    if (!target) return fail(req, 404, 'User not found.')

    // 4. Never lock out the last active super admin (the DB trigger also refuses).
    if (lock && target.is_super_admin === true && target.locked !== true) {
      const { count } = await admin
        .from('profiles').select('id', { count: 'exact', head: true })
        .eq('is_super_admin', true).eq('locked', false).neq('id', targetId)
      if ((count ?? 0) === 0) return fail(req, 400, 'Cannot lock the last active super admin.')
    }

    // 5. Revoke + optional lock + audit, atomically.
    const { data, error } = await admin.rpc('admin_revoke_user_sessions', {
      p_actor: callerId,
      p_target: targetId,
      p_reason: reason,
      p_lock: lock,
    })
    if (error) {
      const code = (error as { code?: string }).code
      if (code === '42501') {
        const msg = /last/i.test(error.message || '') ? error.message : 'Not authorized to revoke these sessions.'
        return fail(req, 409, msg)
      }
      if (code === '22023') return fail(req, 400, error.message || 'Invalid request.')
      if (code === 'P0002') return fail(req, 404, 'User not found.')
      console.error('admin_revoke_user_sessions failed', code)
      return fail(req, 500, 'Could not revoke sessions. Please try again.')
    }

    const result = (data ?? {}) as { sessions_revoked?: number; locked?: boolean }
    return json(req, {
      ok: true,
      sessions_revoked: Number(result.sessions_revoked ?? 0),
      locked: result.locked === true,
      note: NOTE,
    })
  } catch (e) {
    console.error('admin-revoke-sessions fatal', e instanceof Error ? e.name : 'unknown')
    return fail(req, 500, 'Could not revoke sessions. Please try again.')
  }
})
