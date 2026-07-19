// ============================================================================
// sentry-crash-alert - scheduled poll that alerts on NEW fatal Sentry crashes.
//
// Invoked by pg_cron (every 15 min) with the x-cron-secret header, validated
// against cron_config.cron_secret (deny-all, service role). Reads the Sentry
// connection from cron_config, fetches unresolved level:fatal issues, and for
// each one not seen before:
//   - records it in sentry_alert_log (dedupe -> never alerts twice)
//   - writes a critical row to system_logs (shows in Console -> System Health)
//   - includes it in a single summary email (if an alert email + Resend are set)
//
// Alerts only run when the operator has enabled them (sentry_alerts_enabled) and
// a token is configured. The Sentry token never leaves the server.
// ============================================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function ct(a: string, b: string): boolean {
  const e = new TextEncoder(); const x = e.encode(a); const y = e.encode(b)
  let d = x.length ^ y.length
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return d === 0
}
function esc(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method' }), { status: 405 })

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return new Response(JSON.stringify({ error: 'env' }), { status: 500 })
  const admin = createClient(url, serviceKey)

  // Cron-secret gate.
  const { data: secretRow } = await admin.from('cron_config').select('value').eq('name', 'cron_secret').maybeSingle()
  const expected = secretRow?.value || ''
  const provided = req.headers.get('x-cron-secret') || ''
  if (!expected || !ct(provided, expected)) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })

  // Sentry connection + alert config.
  const { data: cfgRows } = await admin.from('cron_config').select('name, value')
    .in('name', ['sentry_auth_token', 'sentry_org', 'sentry_region_url', 'sentry_alert_email', 'sentry_alerts_enabled'])
  const cfg: Record<string, string> = {}
  for (const r of cfgRows ?? []) cfg[r.name] = r.value
  const token = cfg['sentry_auth_token']
  if (!token || cfg['sentry_alerts_enabled'] !== 'true') {
    return new Response(JSON.stringify({ ok: true, skipped: 'disabled or not configured' }), { status: 200 })
  }
  const org = cfg['sentry_org'] || 'shah-profile'
  const region = (cfg['sentry_region_url'] || 'https://de.sentry.io').replace(/\/+$/, '')
  const base = `${region}/api/0/organizations/${encodeURIComponent(org)}`

  // Fetch unresolved fatal issues.
  let issues: any[] = []
  try {
    const res = await fetch(`${base}/issues/?query=${encodeURIComponent('is:unresolved level:fatal')}&statsPeriod=24h&project=-1&limit=25`,
      { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return new Response(JSON.stringify({ ok: false, reason: res.status === 401 ? 'auth' : 'error' }), { status: 200 })
    const raw = await res.json()
    issues = Array.isArray(raw) ? raw : []
  } catch {
    return new Response(JSON.stringify({ ok: false, reason: 'fetch' }), { status: 200 })
  }
  if (!issues.length) return new Response(JSON.stringify({ ok: true, new: 0 }), { status: 200 })

  // Which have we already alerted?
  const ids = issues.map(i => String(i.id))
  const { data: known } = await admin.from('sentry_alert_log').select('issue_id').in('issue_id', ids)
  const seen = new Set((known ?? []).map((r: any) => r.issue_id))
  const fresh = issues.filter(i => !seen.has(String(i.id)))
  if (!fresh.length) return new Response(JSON.stringify({ ok: true, new: 0 }), { status: 200 })

  // Record + log each new fatal crash.
  for (const i of fresh) {
    const title = i.title || i.metadata?.type || 'Fatal crash'
    await admin.from('sentry_alert_log').insert({
      issue_id: String(i.id), short_id: i.shortId || null, title, permalink: i.permalink || null,
      level: i.level || 'fatal', first_seen: i.firstSeen || null,
    }).select().maybeSingle()
    await admin.from('system_logs').insert({
      organisation_id: null, severity: 'critical', source: 'sentry', module_id: 'crash_alert',
      message: `Fatal crash: ${title}`.slice(0, 500),
      detail: { issue_id: String(i.id), short_id: i.shortId, culprit: i.culprit, count: i.count, userCount: i.userCount, platform: i.platform, permalink: i.permalink },
      url: i.permalink || null,
    })
  }

  // Email summary (best-effort).
  const alertEmail = (cfg['sentry_alert_email'] || '').split(',').map(s => s.trim()).filter(Boolean)
  const RESEND = Deno.env.get('RESEND_API_KEY')
  const FROM = Deno.env.get('FROM_EMAIL') || 'reports@tyrepulse.app'
  let emailed = 0
  if (alertEmail.length && RESEND) {
    const rows = fresh.map(i => {
      const title = i.title || i.metadata?.type || 'Fatal crash'
      return `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee"><b>${esc(title)}</b>`
        + `<div style="color:#666;font-size:12px">${esc(i.culprit || '')} &middot; ${i.count || 0} events &middot; ${i.userCount || 0} users`
        + `${i.permalink ? ` &middot; <a href="${esc(i.permalink)}">open</a>` : ''}</div></td></tr>`
    }).join('')
    const html = `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;color:#111">`
      + `<h2 style="margin:0 0 12px;color:#b91c1c">${fresh.length} new fatal crash${fresh.length > 1 ? 'es' : ''} detected</h2>`
      + `<table style="border-collapse:collapse;width:100%">${rows}</table>`
      + `<p style="margin:14px 0 0;color:#666;font-size:12px">Tyre Pulse - Crash Alerts. Manage in Console -> Crash Reports.</p></div>`
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: alertEmail, subject: `[Tyre Pulse] ${fresh.length} new fatal crash${fresh.length > 1 ? 'es' : ''}`, html }),
      })
      if (r.ok) emailed = alertEmail.length
    } catch { /* logged to system_logs regardless */ }
  }

  return new Response(JSON.stringify({ ok: true, new: fresh.length, emailed }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
