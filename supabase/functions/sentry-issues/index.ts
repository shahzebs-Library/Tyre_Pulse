// ============================================================================
// sentry-issues - super-admin-only proxy to the Sentry issues API for the
// in-app /console Crash Reports page.
//
// The Sentry auth token is a secret; it is stored in the deny-all cron_config
// table (never granted to anon/authenticated) and read here via the service
// role. The caller must present a valid JWT for a super-admin profile. The
// token never leaves the server.
//
// Request (POST): { query?: string, period?: '24h'|'7d'|'14d'|'30d'|'90d' }
// Response: { ok:true, issues:[...] } | { ok:false, reason:'not_configured'|'auth'|'unauthorized'|'error' }
// ============================================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  let allowOrigin = '*'
  if (origin) allowOrigin = (/^https:\/\//.test(origin) || origin.startsWith('http://localhost')) ? origin : 'null'
  const requestedHeaders = req.headers.get('access-control-request-headers')
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': requestedHeaders || 'authorization, x-client-info, apikey, content-type, x-app-name',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin, Access-Control-Request-Headers',
  }
}
function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } })
}

const VALID_PERIODS = new Set(['24h', '7d', '14d', '30d', '90d'])

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { ok: false, reason: 'error' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) return json(req, { ok: false, reason: 'error' }, 500)

  // 1. Authenticate the caller and require super-admin.
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json(req, { ok: false, reason: 'unauthorized' }, 401)
  const authClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: userData, error: userErr } = await authClient.auth.getUser(token)
  if (userErr || !userData?.user) return json(req, { ok: false, reason: 'unauthorized' }, 401)
  const { data: prof } = await authClient
    .from('profiles').select('is_super_admin').eq('id', userData.user.id).maybeSingle()
  if (prof?.is_super_admin !== true) return json(req, { ok: false, reason: 'unauthorized' }, 403)

  // 2. Read the Sentry connection from the deny-all config (service role).
  const admin = createClient(url, serviceKey)
  const { data: cfgRows } = await admin
    .from('cron_config').select('name, value')
    .in('name', ['sentry_auth_token', 'sentry_org', 'sentry_region_url'])
  const cfg: Record<string, string> = {}
  for (const r of cfgRows ?? []) cfg[r.name] = r.value
  const sentryToken = cfg['sentry_auth_token']
  const org = cfg['sentry_org'] || 'shah-profile'
  const region = (cfg['sentry_region_url'] || 'https://de.sentry.io').replace(/\/+$/, '')
  if (!sentryToken) return json(req, { ok: false, reason: 'not_configured' })

  // 3. Query Sentry.
  let body: { query?: string; period?: string } = {}
  try { body = await req.json() } catch { /* defaults */ }
  const query = typeof body.query === 'string' && body.query.length <= 200 ? body.query : 'is:unresolved'
  const period = VALID_PERIODS.has(body.period || '') ? body.period : '14d'
  const api = `${region}/api/0/organizations/${encodeURIComponent(org)}/issues/`
    + `?query=${encodeURIComponent(query)}&statsPeriod=${period}&project=-1&limit=50`

  try {
    const res = await fetch(api, { headers: { Authorization: `Bearer ${sentryToken}` } })
    if (res.status === 401 || res.status === 403) return json(req, { ok: false, reason: 'auth' })
    if (!res.ok) return json(req, { ok: false, reason: 'error', status: res.status })
    const raw = await res.json() as any[]
    const issues = (Array.isArray(raw) ? raw : []).map((i) => ({
      id: i.id,
      shortId: i.shortId,
      title: i.title || i.metadata?.type || 'Issue',
      culprit: i.culprit || '',
      level: i.level || 'error',
      status: i.status || 'unresolved',
      count: Number(i.count) || 0,
      userCount: Number(i.userCount) || 0,
      firstSeen: i.firstSeen || null,
      lastSeen: i.lastSeen || null,
      permalink: i.permalink || '',
      platform: i.platform || '',
      value: i.metadata?.value || '',
    }))
    return json(req, { ok: true, org, issues })
  } catch {
    return json(req, { ok: false, reason: 'error' })
  }
})
