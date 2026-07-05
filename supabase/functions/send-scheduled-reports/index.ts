// send-scheduled-reports - cron-driven delivery of scheduled report digests.
//
// Invoked every 15 minutes by pg_cron (V61) with an `x-cron-secret` header.
// The secret lives in the service-role-only `cron_config` table, so only the
// database's own cron job can trigger real work - a stray anon call is a 401.
//
// For every ACTIVE schedule whose next_run_at has passed (or is null), it
// builds a live executive intelligence digest for the schedule's report type
// via the server-side aggregate RPC `report_exec_digest` (V85 - one round-trip,
// org-scoped, all-time + trailing-30-day windows), emails it to the recipients
// via Resend (same provider/env as send-email), records the outcome in
// report_send_log (sent/failed + provider error), and advances
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
  org_id: string | null
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

type TopItem = { label: string; value: number }
type Digest = {
  period_days: number
  win_from: string
  win_to: string
  win: {
    tyres: { cur: number; prev: number }
    spend: { cur: number; prev: number }
    high_risk: { cur: number; prev: number }
    removals: number
    inspections: number
  }
  all: {
    tyres: number
    spend: number
    high_risk: number
    critical: number
    removals: number
    cpk: number | null
    first_date: string | null
    last_date: string | null
  }
  wo_open: number
  wo_overdue: number
  wo_total: number
  wo_cost: number
  breakdown_hours: number
  ca_open: number
  ca_overdue: number
  accidents: number
  accident_cost: number
  inspections: number
  rca: number
  fleet_active: number
  monthly_budget: number
  missing_cost: number
  dup_serials: number
  top_brands: TopItem[]
  top_sites: TopItem[]
  top_removal_reasons: TopItem[]
}

// deno-lint-ignore no-explicit-any
async function buildDigest(svc: any, orgId: string | null): Promise<Digest> {
  // Single server-side aggregate. A null org_id yields a global/admin digest;
  // a tenant org_id stays strictly scoped to that organisation.
  const { data, error } = await svc.rpc('report_exec_digest', { p_org: orgId, p_days: 30 })
  if (error || !data) throw new Error(`digest RPC failed: ${error?.message ?? 'no data'}`)
  return data as Digest
}

const TYPE_LABEL: Record<string, string> = {
  executive: 'Executive Report',
  kpi: 'KPI Scorecard',
  fleet: 'Fleet Analytics',
  inspection: 'Inspection Summary',
  cost: 'Cost Analysis',
}

/* ── Formatting helpers ─────────────────────────────────────────────────────── */

function num(n: number | null | undefined): string {
  return n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('en-US')
}
function money(n: number | null | undefined, currency: string): string {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
  return currency ? `${currency} ${v}` : v
}
function dateShort(s: string | null | undefined): string {
  return s ? String(s).slice(0, 10) : '—'
}

/** Trend badge vs the prior window. `higherIsWorse` colours cost/risk rises red. */
function trend(cur: number, prev: number, higherIsWorse: boolean): string {
  if (prev === 0 && cur === 0) return `<span style="color:#94a3b8;font-size:11px">no prior activity</span>`
  const pct = prev === 0 ? 100 : Math.round(((cur - prev) / prev) * 100)
  const up = cur > prev
  const flat = cur === prev
  const arrow = flat ? '±' : up ? '▲' : '▼'
  const good = flat ? false : (up ? !higherIsWorse : higherIsWorse)
  const color = flat ? '#64748b' : good ? '#047857' : '#b91c1c'
  const label = flat ? '0%' : `${Math.abs(pct)}%`
  return `<span style="color:${color};font-size:11px;font-weight:700">${arrow} ${label}</span>`
}

/* ── Email rendering ────────────────────────────────────────────────────────── */

function tile(label: string, value: string, sub = '', color = '#0f172a'): string {
  return `
    <td style="padding:12px 14px;background:#f8fafc;border:1px solid #eef2f7;border-radius:10px;text-align:center;vertical-align:top">
      <div style="font-size:20px;font-weight:800;color:${color};line-height:1.1">${value}</div>
      <div style="font-size:10.5px;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-top:4px">${label}</div>
      ${sub ? `<div style="margin-top:5px">${sub}</div>` : ''}
    </td>`
}

function sectionTitle(t: string): string {
  return `<tr><td colspan="3" style="padding:22px 0 8px;font-size:13px;font-weight:800;color:#0f172a;text-transform:uppercase;letter-spacing:.6px;border-bottom:2px solid #0f172a">${t}</td></tr>`
}

function topList(title: string, items: TopItem[], fmt: (n: number) => string): string {
  const rows = (items ?? []).length
    ? items.map((it, i) => `
        <tr>
          <td style="padding:6px 0;font-size:12.5px;color:#334155">
            <span style="display:inline-block;width:18px;color:#94a3b8;font-weight:700">${i + 1}.</span>${it.label}
          </td>
          <td style="padding:6px 0;font-size:12.5px;color:#0f172a;font-weight:700;text-align:right">${fmt(it.value)}</td>
        </tr>`).join('')
    : `<tr><td style="padding:6px 0;font-size:12px;color:#94a3b8">No data</td></tr>`
  return `
    <td style="vertical-align:top;padding:6px 10px 6px 0">
      <div style="font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">${title}</div>
      <table role="presentation" width="100%" cellspacing="0">${rows}</table>
    </td>`
}

function buildRecommendations(d: Digest): string[] {
  const recs: string[] = []
  if (d.dup_serials > 0) recs.push(`Resolve <b>${num(d.dup_serials)}</b> duplicate tyre serial(s) — they distort life &amp; CPK analysis.`)
  if (d.missing_cost > 0) recs.push(`<b>${num(d.missing_cost)}</b> tyre record(s) have no cost — cost KPIs understate true spend until filled.`)
  if (d.wo_overdue > 0) recs.push(`<b>${num(d.wo_overdue)}</b> work order(s) past target completion — expedite to cut downtime.`)
  if (d.ca_overdue > 0) recs.push(`<b>${num(d.ca_overdue)}</b> corrective action(s) overdue — reassign or escalate.`)
  const brandUnknown = (d.top_brands ?? []).length === 1 && d.top_brands[0].label === '(unknown)'
  if (brandUnknown) recs.push(`Tyre <b>brand</b> is blank across records — populate it to unlock vendor performance ranking.`)
  const siteUnknown = (d.top_sites ?? []).length === 1 && d.top_sites[0].label === '(unknown)'
  if (siteUnknown) recs.push(`Tyre <b>site</b> is blank across records — populate it to unlock branch cost comparison.`)
  if (d.all.cpk == null) recs.push(`Cost-per-km can't be computed — capture <b>fitment/removal km</b> to enable CPK &amp; life forecasting.`)
  if (d.win.tyres.cur === 0) recs.push(`No tyre records in the last ${d.period_days} days — confirm data imports are current (latest record ${dateShort(d.all.last_date)}).`)
  if (!recs.length) recs.push('No critical issues detected this period. Maintain inspection cadence and monitor high-risk positions.')
  return recs.slice(0, 6)
}

function renderHtml(s: Schedule, d: Digest, appUrl: string, currency: string): string {
  const genAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const coverage = `${dateShort(d.all.first_date)} → ${dateShort(d.all.last_date)}`
  const riskColor = d.all.high_risk > 0 ? '#b91c1c' : '#047857'
  const recs = buildRecommendations(d)

  const summary =
    `Across the full dataset (${coverage}) the fleet has <b>${num(d.all.tyres)}</b> tyre transactions ` +
    `totalling <b>${money(d.all.spend, currency)}</b>, with <b>${num(d.wo_open)}</b> work order(s) open` +
    `${d.wo_overdue ? ` (<b style="color:#b91c1c">${num(d.wo_overdue)} overdue</b>)` : ''} ` +
    `and <b>${num(d.ca_open)}</b> corrective action(s) outstanding. ` +
    (d.win.tyres.cur > 0
      ? `In the last ${d.period_days} days, <b>${num(d.win.tyres.cur)}</b> tyre record(s) were added.`
      : `No new tyre records were logged in the last ${d.period_days} days.`)

  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:680px;margin:auto;color:#0f172a;background:#fff">
    <div style="background:#0f172a;border-radius:12px 12px 0 0;padding:22px 26px;color:#fff">
      <div style="font-size:19px;font-weight:800">TyrePulse — ${TYPE_LABEL[s.report_type] ?? s.report_type}</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:3px">
        Schedule “${s.name}” · generated ${genAt} UTC · data coverage ${coverage}
      </div>
    </div>

    <div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:22px 26px">

      <!-- Executive summary -->
      <div style="background:#f1f5f9;border-left:4px solid #0f172a;border-radius:8px;padding:12px 16px;font-size:13px;color:#334155;line-height:1.6">
        ${summary}
      </div>

      <table role="presentation" width="100%" cellspacing="8" style="margin-top:6px">

        ${sectionTitle('Fleet Intelligence · All-time')}
        <tr>
          ${tile('Tyre transactions', num(d.all.tyres))}
          ${tile('Total tyre spend', money(d.all.spend, currency))}
          ${tile('Avg cost / km', d.all.cpk == null ? '—' : money(d.all.cpk, currency))}
        </tr>
        <tr>
          ${tile('High / Critical risk', num(d.all.high_risk), '', riskColor)}
          ${tile('Tyre removals', num(d.all.removals))}
          ${tile('Active vehicles', num(d.fleet_active))}
        </tr>

        ${sectionTitle(`Recent Activity · last ${d.period_days} days`)}
        <tr>
          ${tile('Tyre records', num(d.win.tyres.cur), trend(d.win.tyres.cur, d.win.tyres.prev, false))}
          ${tile('Tyre spend', money(d.win.spend.cur, currency), trend(d.win.spend.cur, d.win.spend.prev, true))}
          ${tile('High/Critical', num(d.win.high_risk.cur), trend(d.win.high_risk.cur, d.win.high_risk.prev, true), d.win.high_risk.cur ? '#b91c1c' : '#0f172a')}
        </tr>
        <tr>
          ${tile('Removals', num(d.win.removals))}
          ${tile('Inspections', num(d.win.inspections))}
          ${tile('Accidents (all)', num(d.accidents), '', d.accidents ? '#b91c1c' : '#047857')}
        </tr>

        ${sectionTitle('Operations & Reliability')}
        <tr>
          ${tile('Open work orders', num(d.wo_open), `of ${num(d.wo_total)} total`)}
          ${tile('Overdue work orders', num(d.wo_overdue), '', d.wo_overdue ? '#b91c1c' : '#047857')}
          ${tile('Work order cost', money(d.wo_cost, currency))}
        </tr>
        <tr>
          ${tile('Open actions', num(d.ca_open), '', d.ca_open ? '#b45309' : '#047857')}
          ${tile('Overdue actions', num(d.ca_overdue), '', d.ca_overdue ? '#b91c1c' : '#047857')}
          ${tile('Breakdown hours', num(d.breakdown_hours))}
        </tr>
        <tr>
          ${tile('RCAs logged', num(d.rca))}
          ${tile('Inspections (all)', num(d.inspections))}
          ${tile('Accident cost', money(d.accident_cost, currency), '', d.accident_cost ? '#b91c1c' : '#0f172a')}
        </tr>

        ${sectionTitle('Cost Drivers')}
        <tr>
          ${topList('Top brands by spend', d.top_brands, (n) => money(n, currency))}
          ${topList('Top sites by spend', d.top_sites, (n) => money(n, currency))}
          ${topList('Top removal reasons', d.top_removal_reasons, (n) => num(n))}
        </tr>

        ${sectionTitle('Data Quality')}
        <tr>
          ${tile('Duplicate serials', num(d.dup_serials), '', d.dup_serials ? '#b91c1c' : '#047857')}
          ${tile('Records missing cost', num(d.missing_cost), '', d.missing_cost ? '#b45309' : '#047857')}
          ${tile('Monthly tyre budget', money(d.monthly_budget, currency))}
        </tr>
      </table>

      <!-- Recommendations -->
      <div style="margin-top:20px;font-size:13px;font-weight:800;color:#0f172a;text-transform:uppercase;letter-spacing:.6px;border-bottom:2px solid #0f172a;padding-bottom:8px">
        Recommended Actions
      </div>
      <ol style="margin:12px 0 4px;padding-left:20px;font-size:12.5px;color:#334155;line-height:1.7">
        ${recs.map((r) => `<li>${r}</li>`).join('')}
      </ol>

      <p style="font-size:12px;color:#475569;line-height:1.6;margin-top:16px">
        All figures are live from your fleet data — a dash (—) means the metric could not be computed and
        is never estimated. Trend arrows compare the last ${d.period_days} days to the prior ${d.period_days} days.
      </p>
      <a href="${appUrl}" style="display:inline-block;background:#16a34a;color:#fff;font-weight:700;font-size:13px;padding:11px 20px;border-radius:8px;text-decoration:none;margin-top:4px">Open TyrePulse Dashboard</a>
      <p style="font-size:11px;color:#94a3b8;margin-top:18px">
        You receive this because you are a recipient of the “${s.name}” schedule.
        Manage recipients &amp; frequency in TyrePulse → Scheduled Reports.
      </p>
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
    .select('id,name,report_type,frequency,day_of_week,day_of_month,time_of_day,recipients,last_sent_at,next_run_at,org_id')
    .eq('active', true)
    .or(`next_run_at.is.null,next_run_at.lte.${now.toISOString()}`)
    .limit(25)
  if (dueErr) {
    return new Response(JSON.stringify({ error: dueErr.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'reports@tyrepulse.app'
  const APP_URL = Deno.env.get('APP_URL') || 'https://tyre-pulse-peach.vercel.app'

  // System currency (best-effort; blank if unset - never blocks a send).
  let currency = ''
  try {
    const { data: cur } = await svc.from('system_config').select('value').eq('key', 'default_currency').maybeSingle()
    currency = (cur?.value ?? '').toString().replace(/^"|"$/g, '').trim()
  } catch { /* ignore */ }

  let sent = 0
  let failed = 0

  for (const s of (due ?? []) as Schedule[]) {
    const recipients = (s.recipients ?? []).filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r))
    try {
      if (!recipients.length) throw new Error('No valid recipients on the schedule')
      if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured for edge functions')

      const digest = await buildDigest(svc, s.org_id)
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: recipients,
          subject: `TyrePulse ${TYPE_LABEL[s.report_type] ?? 'Report'} — ${s.name}`,
          html: renderHtml(s, digest, APP_URL, currency),
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
