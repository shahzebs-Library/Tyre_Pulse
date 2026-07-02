// send-scheduled-reports - cron-driven delivery of scheduled report digests.
//
// Invoked every 15 minutes by pg_cron (V61) with an `x-cron-secret` header.
// The secret lives in the service-role-only `cron_config` table, so only the
// database's own cron job can trigger real work - a stray anon call is a 401.
//
// For every ACTIVE schedule whose next_run_at has passed (or is null), it
// builds a live KPI digest for the schedule's report type, emails it to the
// recipients via Resend (same provider/env as send-email), records the outcome
// in report_send_log (sent/failed + provider error), and advances
// last_sent_at/next_run_at. Failures back off one hour instead of hammering
// the provider every 15 minutes.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RIYADH_OFFSET_MIN = 3 * 60 // Gulf standard time, no DST

type Schedule = {
  id: string
  name: string
  report_type: string
  frequency: string
  day_of_week: number | null
  day_of_month: number | null
  time_of_day: string | null
  recipients: string[]
  last_sent_at: string | null
  next_run_at: string | null
}

function toRiyadh(d: Date): Date {
  return new Date(d.getTime() + RIYADH_OFFSET_MIN * 60_000)
}
function fromRiyadh(d: Date): Date {
  return new Date(d.getTime() - RIYADH_OFFSET_MIN * 60_000)
}

/** Next run strictly after `now`, honouring frequency/day/time in Riyadh time. */
function computeNextRun(s: Schedule, now: Date): string {
  const [hh, mm] = (s.time_of_day || '08:00').split(':').map((n) => parseInt(n, 10) || 0)
  const local = toRiyadh(now)
  const candidate = new Date(local)
  candidate.setUTCHours(hh, mm, 0, 0)

  if (s.frequency === 'daily') {
    if (candidate <= local) candidate.setUTCDate(candidate.getUTCDate() + 1)
  } else if (s.frequency === 'weekly') {
    const target = s.day_of_week ?? 0
    let delta = (target - candidate.getUTCDay() + 7) % 7
    if (delta === 0 && candidate <= local) delta = 7
    candidate.setUTCDate(candidate.getUTCDate() + delta)
  } else { // monthly
    const dom = Math.min(Math.max(s.day_of_month ?? 1, 1), 28)
    candidate.setUTCDate(dom)
    if (candidate <= local) candidate.setUTCMonth(candidate.getUTCMonth() + 1, dom)
  }
  return fromRiyadh(candidate).toISOString()
}

/* ── Digest data (live, service-role reads) ─────────────────────────────────── */

// deno-lint-ignore no-explicit-any
async function buildDigest(svc: any) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)

  const count = async (table: string, mod?: (q: unknown) => unknown) => {
    let q = svc.from(table).select('id', { count: 'exact', head: true })
    if (mod) q = mod(q)
    const { count: c, error } = await q
    return error ? null : (c ?? 0)
  }

  const [tyres30d, highRisk, openWo, openCa, accidents30d] = await Promise.all([
    count('tyre_records', (q: any) => q.gte('issue_date', since)),
    count('tyre_records', (q: any) => q.gte('issue_date', since).in('risk_level', ['High', 'Critical'])),
    count('work_orders', (q: any) => q.not('status', 'in', '("Completed","Closed","Cancelled")')),
    count('corrective_actions', (q: any) => q.eq('status', 'Open')),
    count('accidents', (q: any) => q.gte('incident_date', since)),
  ])

  // Accurate 30-day spend via the server-side aggregate RPC.
  let spend: number | null = null
  try {
    const { data } = await svc.rpc('report_tyre_summary', { p_country: 'All', p_from: since, p_to: null })
    if (data) spend = Number(data.total_cost ?? data.total_amount ?? null)
    if (!Number.isFinite(spend)) spend = null
  } catch { /* keep null - never fabricate */ }

  return { since, tyres30d, highRisk, openWo, openCa, accidents30d, spend }
}

const TYPE_LABEL: Record<string, string> = {
  executive: 'Executive Report',
  kpi: 'KPI Scorecard',
  fleet: 'Fleet Analytics',
  inspection: 'Inspection Summary',
  cost: 'Cost Analysis',
}

function fmt(n: number | null): string {
  return n == null ? '-' : n.toLocaleString('en-US')
}

function renderHtml(s: Schedule, d: Awaited<ReturnType<typeof buildDigest>>, appUrl: string): string {
  const tile = (label: string, value: string, color = '#0f172a') => `
    <td style="padding:12px 16px;background:#f8fafc;border-radius:10px;text-align:center;">
      <div style="font-size:22px;font-weight:800;color:${color}">${value}</div>
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px">${label}</div>
    </td>`
  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:auto;color:#0f172a">
    <div style="background:#0f172a;border-radius:12px 12px 0 0;padding:20px 24px;color:#fff">
      <div style="font-size:18px;font-weight:800">TyrePulse - ${TYPE_LABEL[s.report_type] ?? s.report_type}</div>
      <div style="font-size:12px;color:#94a3b8">Scheduled digest “${s.name}” · last 30 days · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</div>
    </div>
    <div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:20px 24px">
      <table role="presentation" width="100%" cellspacing="8"><tr>
        ${tile('Tyre records (30d)', fmt(d.tyres30d))}
        ${tile('High/Critical risk', fmt(d.highRisk), d.highRisk ? '#b91c1c' : '#047857')}
        ${tile('30d tyre spend', d.spend == null ? '-' : d.spend.toLocaleString('en-US', { maximumFractionDigits: 0 }))}
      </tr><tr>
        ${tile('Open work orders', fmt(d.openWo))}
        ${tile('Open actions', fmt(d.openCa), d.openCa ? '#b45309' : '#047857')}
        ${tile('Accidents (30d)', fmt(d.accidents30d), d.accidents30d ? '#b91c1c' : '#047857')}
      </tr></table>
      <p style="font-size:13px;color:#475569;line-height:1.6">
        Values are live counts from your fleet data since ${d.since}. A dash means the
        metric could not be read at send time - nothing is ever estimated in this digest.
      </p>
      <a href="${appUrl}" style="display:inline-block;background:#16a34a;color:#fff;font-weight:700;font-size:13px;padding:10px 18px;border-radius:8px;text-decoration:none">Open TyrePulse</a>
      <p style="font-size:11px;color:#94a3b8;margin-top:16px">You receive this because you are a recipient of the “${s.name}” schedule. Manage schedules in TyrePulse → Scheduled Reports.</p>
    </div>
  </div>`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')

  const svc = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Gate: only the DB cron job knows the secret.
  const given = req.headers.get('x-cron-secret') ?? ''
  const { data: cfg } = await svc.from('cron_config').select('value').eq('name', 'cron_secret').maybeSingle()
  if (!cfg?.value || given !== cfg.value) {
    return new Response(JSON.stringify({ error: 'unauthorised' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }

  const now = new Date()
  const { data: due, error: dueErr } = await svc
    .from('report_schedules')
    .select('id,name,report_type,frequency,day_of_week,day_of_month,time_of_day,recipients,last_sent_at,next_run_at')
    .eq('active', true)
    .or(`next_run_at.is.null,next_run_at.lte.${now.toISOString()}`)
    .limit(25)
  if (dueErr) {
    return new Response(JSON.stringify({ error: dueErr.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'reports@tyrepulse.app'
  const APP_URL = Deno.env.get('APP_URL') || 'https://tyrepulse.app'

  let sent = 0
  let failed = 0

  for (const s of (due ?? []) as Schedule[]) {
    const recipients = (s.recipients ?? []).filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r))
    try {
      if (!recipients.length) throw new Error('No valid recipients on the schedule')
      if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured for edge functions')

      const digest = await buildDigest(svc)
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: recipients,
          subject: `TyrePulse ${TYPE_LABEL[s.report_type] ?? 'Report'} - ${s.name}`,
          html: renderHtml(s, digest, APP_URL),
        }),
      })
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`)

      await svc.from('report_schedules')
        .update({ last_sent_at: now.toISOString(), next_run_at: computeNextRun(s, now), updated_at: now.toISOString() })
        .eq('id', s.id)
      await svc.from('report_send_log').insert({
        schedule_id: s.id, schedule_name: s.name, report_type: s.report_type,
        recipients, status: 'sent',
      })
      sent++
    } catch (e) {
      // back off one hour so a broken schedule doesn't retry every 15 minutes
      await svc.from('report_schedules')
        .update({ next_run_at: new Date(now.getTime() + 3_600_000).toISOString(), updated_at: now.toISOString() })
        .eq('id', s.id)
      await svc.from('report_send_log').insert({
        schedule_id: s.id, schedule_name: s.name, report_type: s.report_type,
        recipients, status: 'failed', error: String((e as Error)?.message ?? e).slice(0, 500),
      })
      failed++
    }
  }

  return new Response(JSON.stringify({ processed: (due ?? []).length, sent, failed }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
