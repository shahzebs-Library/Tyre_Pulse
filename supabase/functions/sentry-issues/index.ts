// ============================================================================
// sentry-issues - super-admin-only proxy to the Sentry API for the /console
// Crash Reports page (read -> assign -> comment -> resolve workflow).
//
// The Sentry auth token is a secret stored in the deny-all cron_config table and
// read here via the service role. The caller must present a valid JWT for a
// super-admin profile. The token never leaves the server.
//
// Request (POST): { action?, query?, period?, project?, issueId?, status?, assignee?, text? }
//   'list'     (default) -> org issues (query/period/project filters)
//   'projects'           -> the org's projects
//   'members'            -> org members (for the assignee picker)
//   'detail'  + issueId  -> issue meta + latest event (stacktrace, tags) + activity
//   'update'  + issueId + status ('resolved'|'ignored'|'unresolved')
//   'assign'  + issueId + assignee ('user:<id>' or '' to clear)
//   'comment' + issueId + text
// ============================================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = ['https://tyrepulse.app', 'https://www.tyrepulse.app']
const VERCEL_ORIGIN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/
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
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } })
}

const VALID_PERIODS = new Set(['24h', '7d', '14d', '30d', '90d'])
const VALID_STATUS = new Set(['resolved', 'ignored', 'unresolved'])

function assignee(a: any) {
  return a ? { type: a.type || 'user', id: a.id, name: a.name || a.email || '' } : null
}
function trimIssue(i: any) {
  return {
    id: i.id, shortId: i.shortId, title: i.title || i.metadata?.type || 'Issue', culprit: i.culprit || '',
    level: i.level || 'error', status: i.status || 'unresolved', count: Number(i.count) || 0,
    userCount: Number(i.userCount) || 0, firstSeen: i.firstSeen || null, lastSeen: i.lastSeen || null,
    permalink: i.permalink || '', platform: i.platform || '', value: i.metadata?.value || '',
    project: i.project?.slug || '', assignedTo: assignee(i.assignedTo),
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { ok: false, reason: 'error' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) return json(req, { ok: false, reason: 'error' }, 500)

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json(req, { ok: false, reason: 'unauthorized' }, 401)
  const authClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: userData, error: userErr } = await authClient.auth.getUser(token)
  if (userErr || !userData?.user) return json(req, { ok: false, reason: 'unauthorized' }, 401)
  const { data: prof } = await authClient.from('profiles').select('is_super_admin').eq('id', userData.user.id).maybeSingle()
  if (prof?.is_super_admin !== true) return json(req, { ok: false, reason: 'unauthorized' }, 403)

  const admin = createClient(url, serviceKey)
  const { data: cfgRows } = await admin.from('cron_config').select('name, value')
    .in('name', ['sentry_auth_token', 'sentry_org', 'sentry_region_url'])
  const cfg: Record<string, string> = {}
  for (const r of cfgRows ?? []) cfg[r.name] = r.value
  const sentryToken = cfg['sentry_auth_token']
  const org = cfg['sentry_org'] || 'shah-profile'
  const region = (cfg['sentry_region_url'] || 'https://de.sentry.io').replace(/\/+$/, '')
  if (!sentryToken) return json(req, { ok: false, reason: 'not_configured' })

  const authHeader = { Authorization: `Bearer ${sentryToken}` }
  const jsonHeader = { ...authHeader, 'Content-Type': 'application/json' }
  const base = `${region}/api/0/organizations/${encodeURIComponent(org)}`

  let body: any = {}
  try { body = await req.json() } catch { /* defaults */ }
  const action = typeof body.action === 'string' ? body.action : 'list'
  const issueUrl = (id: string) => `${base}/issues/${encodeURIComponent(id)}/`

  try {
    if (action === 'projects') {
      const res = await fetch(`${base}/projects/`, { headers: authHeader })
      if (res.status === 401 || res.status === 403) return json(req, { ok: false, reason: 'auth' })
      if (!res.ok) return json(req, { ok: false, reason: 'error', status: res.status })
      const raw = await res.json() as any[]
      return json(req, { ok: true, projects: (Array.isArray(raw) ? raw : []).map(p => ({ id: p.id, slug: p.slug, name: p.name, platform: p.platform || '' })) })
    }

    if (action === 'members') {
      const res = await fetch(`${base}/members/`, { headers: authHeader })
      if (res.status === 401 || res.status === 403) return json(req, { ok: false, reason: 'auth' })
      if (!res.ok) return json(req, { ok: false, reason: 'error', status: res.status })
      const raw = await res.json() as any[]
      const members = (Array.isArray(raw) ? raw : [])
        .map(m => ({ userId: m.user?.id || null, name: m.name || m.user?.name || m.email || 'member', email: m.email || '', role: m.role || '' }))
        .filter(m => m.userId)
      return json(req, { ok: true, members })
    }

    if (action === 'update') {
      const issueId = String(body.issueId || '')
      const status = String(body.status || '')
      if (!issueId || !VALID_STATUS.has(status)) return json(req, { ok: false, reason: 'error' }, 400)
      const res = await fetch(issueUrl(issueId), { method: 'PUT', headers: jsonHeader, body: JSON.stringify({ status }) })
      if (res.status === 401 || res.status === 403) return json(req, { ok: false, reason: 'auth' })
      if (!res.ok) return json(req, { ok: false, reason: 'error', status: res.status })
      return json(req, { ok: true, status })
    }

    if (action === 'assign') {
      const issueId = String(body.issueId || '')
      if (!issueId) return json(req, { ok: false, reason: 'error' }, 400)
      const assignTo = typeof body.assignee === 'string' ? body.assignee : ''  // 'user:<id>' or '' to clear
      const res = await fetch(issueUrl(issueId), { method: 'PUT', headers: jsonHeader, body: JSON.stringify({ assignedTo: assignTo }) })
      if (res.status === 401 || res.status === 403) return json(req, { ok: false, reason: 'auth' })
      if (!res.ok) return json(req, { ok: false, reason: 'error', status: res.status })
      const upd = await res.json().catch(() => ({}))
      return json(req, { ok: true, assignedTo: assignee(upd?.assignedTo) })
    }

    if (action === 'comment') {
      const issueId = String(body.issueId || '')
      const text = String(body.text || '').slice(0, 2000)
      if (!issueId || !text.trim()) return json(req, { ok: false, reason: 'error' }, 400)
      const res = await fetch(`${issueUrl(issueId)}comments/`, { method: 'POST', headers: jsonHeader, body: JSON.stringify({ text }) })
      if (res.status === 401 || res.status === 403) return json(req, { ok: false, reason: 'auth' })
      if (!res.ok) return json(req, { ok: false, reason: 'error', status: res.status })
      return json(req, { ok: true })
    }

    if (action === 'detail') {
      const issueId = String(body.issueId || '')
      if (!issueId) return json(req, { ok: false, reason: 'error' }, 400)
      const [issueRes, eventRes, actRes] = await Promise.all([
        fetch(issueUrl(issueId), { headers: authHeader }),
        fetch(`${issueUrl(issueId)}events/latest/`, { headers: authHeader }),
        fetch(`${issueUrl(issueId)}activities/`, { headers: authHeader }),
      ])
      if (issueRes.status === 401 || issueRes.status === 403) return json(req, { ok: false, reason: 'auth' })
      if (!issueRes.ok) return json(req, { ok: false, reason: 'error', status: issueRes.status })
      const issue = await issueRes.json()
      let event: any = null
      if (eventRes.ok) {
        const ev = await eventRes.json()
        const frames: any[] = []
        const exc = (ev.entries || []).find((e: any) => e.type === 'exception')
        for (const val of (exc?.data?.values || [])) {
          const fr = (val.stacktrace?.frames || []).slice(-25).reverse().map((f: any) => ({
            fn: f.function || '<anonymous>', file: f.filename || f.module || '', line: f.lineNo ?? null, inApp: !!f.inApp,
          }))
          frames.push({ type: val.type || '', value: val.value || '', frames: fr })
        }
        event = {
          dateCreated: ev.dateCreated || null,
          tags: (ev.tags || []).map((t: any) => ({ key: t.key, value: t.value })),
          user: ev.user ? { id: ev.user.id, username: ev.user.username, geo: ev.user.geo } : null,
          exceptions: frames,
        }
      }
      let activity: any[] = []
      if (actRes.ok) {
        const a = await actRes.json()
        activity = (a.activity || []).slice(0, 30).map((x: any) => ({
          type: x.type || '', dateCreated: x.dateCreated || null,
          user: x.user?.name || x.user?.email || 'system',
          text: x.data?.text || '',
        }))
      }
      return json(req, { ok: true, issue: trimIssue(issue), event, activity })
    }

    // list (default)
    const query = typeof body.query === 'string' && body.query.length <= 200 ? body.query : 'is:unresolved'
    const period = VALID_PERIODS.has(body.period || '') ? body.period : '14d'
    const projectParam = (body.project && /^\d+$/.test(String(body.project))) ? String(body.project) : '-1'
    const api = `${base}/issues/?query=${encodeURIComponent(query)}&statsPeriod=${period}&project=${projectParam}&limit=50`
    const res = await fetch(api, { headers: authHeader })
    if (res.status === 401 || res.status === 403) return json(req, { ok: false, reason: 'auth' })
    if (!res.ok) return json(req, { ok: false, reason: 'error', status: res.status })
    const raw = await res.json() as any[]
    return json(req, { ok: true, org, issues: (Array.isArray(raw) ? raw : []).map(trimIssue) })
  } catch {
    return json(req, { ok: false, reason: 'error' })
  }
})
