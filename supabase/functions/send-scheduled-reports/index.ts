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

/* ── CORS + auth (inlined from _shared/auth.ts so the function deploys as a
      single file via MCP; keep in sync with that helper) ─────────────────── */

const DEFAULT_ALLOWED_ORIGINS = [
  'https://tyrepulse.app',
  'https://www.tyrepulse.app',
  'http://localhost:5173',
  'http://localhost:5174',
]
const VERCEL_ORIGIN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  const configured = Deno.env.get('ALLOWED_ORIGINS')?.split(',').map((v) => v.trim()).filter(Boolean)
  const allowedOrigins = configured?.length ? configured : DEFAULT_ALLOWED_ORIGINS
  let allowOrigin = '*'
  if (origin) {
    allowOrigin = (allowedOrigins.includes(origin) || VERCEL_ORIGIN.test(origin) || origin.startsWith('http://localhost'))
      ? origin
      : 'null'
  }
  const requestedHeaders = req.headers.get('access-control-request-headers')
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': requestedHeaders || 'authorization, x-client-info, apikey, content-type, x-app-name',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin, Access-Control-Request-Headers',
  }
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** User preference: no em/en dashes or fancy unicode punctuation anywhere in
 *  report output. Applied to every subject + html right before sending. */
function asciiSafe(t: string): string {
  return t
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2') // 0–30 → 0 to 30
    .replace(/\s+[–—]\s+/g, ' | ')              // " — " separators
    .replace(/[–—]/g, ' ')                      // any leftover dash
    .replace(/·/g, '|')                              // middle dot
    .replace(/→/g, 'to')                             // →
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
}

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
  // V86 — deeper analytics
  monthly_trend: Array<{ label: string; value: number; count: number }>
  worst_assets: Array<{ label: string; value: number; count: number }>
  by_position: TopItem[]
  by_category: Array<{ label: string; value: number; count: number }>
  by_country: Array<{ label: string; value: number; count: number }>
  projected_annual_spend: number | null
  brand_reliability: Array<{ label: string; value: number; risk_pct: number | null }>
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
  accidents: 'Accident & Incident Report',
  claims: 'Insurance Claims Summary',
  stock: 'Stock & Goods Receipts',
  vendor: 'Vendor / Procurement Report',
}

/** Friendly label for any report_type, incl. custom 'builder:<template-id>' layouts. */
function typeLabel(reportType: string): string {
  if ((reportType ?? '').startsWith('builder:')) return 'Custom Accident Report'
  return TYPE_LABEL[reportType] ?? reportType
}

/* ── Formatting helpers ─────────────────────────────────────────────────────── */

function num(n: number | null | undefined): string {
  return n == null || !Number.isFinite(Number(n)) ? 'N/A' : Number(n).toLocaleString('en-US')
}
function money(n: number | null | undefined, currency: string): string {
  if (n == null || !Number.isFinite(Number(n))) return 'N/A'
  const v = Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
  return currency ? `${currency} ${v}` : v
}
function dateShort(s: string | null | undefined): string {
  return s ? String(s).slice(0, 10) : 'N/A'
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

/** Horizontal spend bars for the 6-month trend (max-scaled). */
function monthlyTrendBars(items: Array<{ label: string; value: number; count: number }>, currency: string): string {
  const list = items ?? []
  if (!list.length) return `<div style="font-size:12px;color:#94a3b8;padding:6px 0">No tyre spend in the last 6 months.</div>`
  const max = Math.max(1, ...list.map((m) => Number(m.value) || 0))
  return `<table role="presentation" width="100%" cellspacing="0">${
    list.map((m) => {
      const v = Number(m.value) || 0
      const pct = Math.round((v / max) * 100)
      return `<tr>
        <td style="width:64px;font-size:11.5px;color:#64748b;padding:3px 8px 3px 0;white-space:nowrap">${m.label}</td>
        <td style="padding:3px 0">
          <div style="background:#e2e8f0;border-radius:4px;height:14px;width:100%">
            <div style="background:#0f172a;border-radius:4px;height:14px;width:${pct}%"></div>
          </div>
        </td>
        <td style="width:120px;text-align:right;font-size:11.5px;color:#0f172a;font-weight:700;padding:3px 0 3px 8px;white-space:nowrap">${money(v, currency)} <span style="color:#94a3b8;font-weight:400">· ${num(m.count)}</span></td>
      </tr>`
    }).join('')
  }</table>`
}

/** Brand reliability list: worst High/Critical risk-rate first. */
function brandReliabilityList(items: Array<{ label: string; value: number; risk_pct: number | null }>): string {
  const rows = (items ?? []).length
    ? items.map((it) => {
        const pct = it.risk_pct == null ? null : Number(it.risk_pct)
        const color = pct == null ? '#94a3b8' : pct >= 40 ? '#b91c1c' : pct >= 15 ? '#b45309' : '#047857'
        return `<tr>
          <td style="padding:6px 0;font-size:12.5px;color:#334155">${it.label} <span style="color:#94a3b8;font-size:11px">(${num(it.value)} tyres)</span></td>
          <td style="padding:6px 0;font-size:12.5px;font-weight:700;text-align:right;color:${color}">${pct == null ? 'N/A' : pct + '% risk'}</td>
        </tr>`
      }).join('')
    : `<tr><td style="padding:6px 0;font-size:12px;color:#94a3b8">Not enough records per brand yet</td></tr>`
  return `<td style="vertical-align:top;padding:6px 10px 6px 0">
      <div style="font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Brand reliability (worst risk first)</div>
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
  // Budget outlook: projected annual run-rate vs the fleet's annual budget.
  if (d.projected_annual_spend != null && d.monthly_budget > 0) {
    const bud = d.monthly_budget * 12
    if (d.projected_annual_spend > bud) {
      const over = Math.round(((d.projected_annual_spend - bud) / bud) * 100)
      recs.push(`Projected tyre spend is tracking <b>${over}% over</b> the annual budget — review procurement &amp; the highest-cost assets/brands below.`)
    }
  }
  // Worst-reliability brand (highest High/Critical rate with enough records).
  const worstBrand = (d.brand_reliability ?? []).find((b) => b.risk_pct != null && Number(b.risk_pct) >= 30)
  if (worstBrand) recs.push(`<b>${worstBrand.label}</b> shows a <b>${worstBrand.risk_pct}%</b> High/Critical risk rate — investigate as a candidate for de-listing or root-cause review.`)
  if (!recs.length) recs.push('No critical issues detected this period. Maintain inspection cadence and monitor high-risk positions.')
  return recs.slice(0, 8)
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
      <div style="font-size:19px;font-weight:800">TyrePulse — ${typeLabel(s.report_type)}</div>
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
          ${tile('Avg cost / km', d.all.cpk == null ? 'N/A' : money(d.all.cpk, currency))}
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

        ${sectionTitle('Cost Trend & Forecast · last 6 months')}
        <tr><td colspan="3" style="padding-top:4px">${monthlyTrendBars(d.monthly_trend, currency)}</td></tr>
        <tr>
          ${tile('Projected annual spend', d.projected_annual_spend == null ? 'N/A' : money(d.projected_annual_spend, currency), 'run-rate to date')}
          ${tile('Annual budget (12× monthly)', d.monthly_budget ? money(d.monthly_budget * 12, currency) : 'N/A')}
          ${(() => {
            const proj = d.projected_annual_spend
            const bud = d.monthly_budget ? d.monthly_budget * 12 : null
            if (proj == null || bud == null || bud === 0) return tile('Budget outlook', 'N/A', 'set a fleet budget')
            const over = proj > bud
            const pct = Math.round(Math.abs((proj - bud) / bud) * 100)
            return tile('Budget outlook', `${over ? 'Over' : 'Under'} by ${pct}%`, over ? 'projected spend exceeds budget' : 'within budget', over ? '#b91c1c' : '#047857')
          })()}
        </tr>

        ${sectionTitle('Asset & Position Intelligence')}
        <tr>
          ${topList('Highest-cost assets', d.worst_assets, (n) => money(n, currency))}
          ${topList('Removals by position', d.by_position, (n) => num(n))}
          ${topList('Spend by category', d.by_category, (n) => money(n, currency))}
        </tr>

        ${sectionTitle('Fleet Distribution & Reliability')}
        <tr>
          ${topList('Spend by country', d.by_country, (n) => money(n, currency))}
          ${brandReliabilityList(d.brand_reliability)}
          <td style="vertical-align:top;padding:6px 0 6px 0"></td>
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
        All figures are live from your fleet data. N/A means the metric could not be computed and
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

/* ── Insurance Claims Summary (report_type = 'claims') ──────────────────────── */
// A focused claims-desk digest built directly off the accidents table (service
// role, manually org-scoped since RLS is bypassed). Only incidents carrying a
// claim are counted. All figures are live — a dash means "not captured", never
// an estimate.

type ClaimRow = {
  incident_date: string | null
  asset_no: string | null
  site: string | null
  driver_name: string | null
  status: string | null
  claim_status: string | null
  insurer: string | null
  policy_no: string | null
  gcc_liability_ratio: number | null
  fault_status: string | null
  claim_amount: number | null
  claim_approved_amount: number | null
  deductible: number | null
  recovered_amount: number | null
  repair_cost: number | null
  estimated_damage_cost: number | null
  parts_cost: number | null
  expected_release_date: string | null
  release_date: string | null
  closure_status: string | null
}

type ClaimsDigest = {
  total: number
  open: number
  closed: number
  delayed: number
  claim_total: number
  approved_total: number
  recovered_total: number
  deductible_total: number
  net_exposure: number
  first_date: string | null
  last_date: string | null
  by_insurer: TopItem[]
  by_status: TopItem[]
  recent: Array<{
    date: string; asset: string; insurer: string; status: string
    claim: number; approved: number; recovered: number; state: 'Open' | 'Closed'; delayed: boolean
  }>
}

const n0 = (v: number | null | undefined): number => (Number.isFinite(Number(v)) ? Number(v) : 0)

function claimIsClosed(r: ClaimRow): boolean {
  if (r.release_date) return true
  const s = `${r.status ?? ''} ${r.closure_status ?? ''} ${r.claim_status ?? ''}`.toLowerCase()
  return /clos|settl|paid|recovered|complete|resolved/.test(s)
}

function claimIsDelayed(r: ClaimRow, today: string): boolean {
  if (claimIsClosed(r)) return false
  return !!r.expected_release_date && String(r.expected_release_date).slice(0, 10) < today
}

// deno-lint-ignore no-explicit-any
async function buildClaimsDigest(svc: any, orgId: string | null): Promise<ClaimsDigest> {
  let q = svc
    .from('accidents')
    .select(
      'incident_date,asset_no,site,driver_name,status,claim_status,insurer,policy_no,gcc_liability_ratio,fault_status,claim_amount,claim_approved_amount,deductible,recovered_amount,repair_cost,estimated_damage_cost,parts_cost,expected_release_date,release_date,closure_status',
    )
    .or('claim_amount.gt.0,claim_approved_amount.gt.0,claim_status.not.is.null,insurer.not.is.null')
    .order('incident_date', { ascending: false })
    .limit(5000)
  // Service role bypasses RLS, so scope to the schedule's org explicitly.
  if (orgId) q = q.eq('organisation_id', orgId)
  const { data, error } = await q
  if (error) throw new Error(`claims query failed: ${error.message}`)
  const rows = (data ?? []) as ClaimRow[]

  const today = new Date().toISOString().slice(0, 10)
  const insurerMap = new Map<string, number>()
  const statusMap = new Map<string, number>()
  let open = 0, closed = 0, delayed = 0
  let claim_total = 0, approved_total = 0, recovered_total = 0, deductible_total = 0, net_exposure = 0
  let first_date: string | null = null, last_date: string | null = null

  for (const r of rows) {
    const cl = claimIsClosed(r)
    if (cl) closed++; else open++
    if (claimIsDelayed(r, today)) delayed++
    claim_total += n0(r.claim_amount)
    approved_total += n0(r.claim_approved_amount)
    recovered_total += n0(r.recovered_amount)
    deductible_total += n0(r.deductible)
    net_exposure += Math.max(0, (n0(r.repair_cost) || n0(r.estimated_damage_cost)) + n0(r.parts_cost) - n0(r.recovered_amount))
    const ins = (r.insurer || '(no insurer)').trim() || '(no insurer)'
    insurerMap.set(ins, (insurerMap.get(ins) ?? 0) + n0(r.claim_amount))
    const st = (r.claim_status || '(unspecified)').trim() || '(unspecified)'
    statusMap.set(st, (statusMap.get(st) ?? 0) + 1)
    const d = r.incident_date ? String(r.incident_date).slice(0, 10) : null
    if (d) {
      if (!first_date || d < first_date) first_date = d
      if (!last_date || d > last_date) last_date = d
    }
  }

  const by_insurer = [...insurerMap.entries()].map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value).slice(0, 6)
  const by_status = [...statusMap.entries()].map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value).slice(0, 6)
  const recent = rows.slice(0, 12).map((r) => ({
    date: r.incident_date ? String(r.incident_date).slice(0, 10) : 'N/A',
    asset: r.asset_no || 'N/A',
    insurer: r.insurer || 'N/A',
    status: r.claim_status || r.status || 'N/A',
    claim: n0(r.claim_amount),
    approved: n0(r.claim_approved_amount),
    recovered: n0(r.recovered_amount),
    state: (claimIsClosed(r) ? 'Closed' : 'Open') as 'Open' | 'Closed',
    delayed: claimIsDelayed(r, today),
  }))

  return {
    total: rows.length, open, closed, delayed,
    claim_total, approved_total, recovered_total, deductible_total, net_exposure,
    first_date, last_date, by_insurer, by_status, recent,
  }
}

function renderClaimsHtml(s: Schedule, d: ClaimsDigest, appUrl: string, currency: string): string {
  const genAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const coverage = `${dateShort(d.first_date)} → ${dateShort(d.last_date)}`
  const recoveryRate = d.claim_total > 0 ? Math.round((d.recovered_total / d.claim_total) * 100) : null

  const summary = d.total === 0
    ? `No incidents carrying an insurance claim were found for this organisation. When a claim is opened on an accident record it will appear here automatically.`
    : `<b>${num(d.total)}</b> insurance claim(s) on record — <b>${num(d.open)}</b> open, <b>${num(d.closed)}</b> closed` +
      `${d.delayed ? `, with <b style="color:#b91c1c">${num(d.delayed)}</b> past the expected release date` : ''}. ` +
      `Total claimed <b>${money(d.claim_total, currency)}</b>, approved <b>${money(d.approved_total, currency)}</b>, ` +
      `recovered <b>${money(d.recovered_total, currency)}</b>${recoveryRate != null ? ` (<b>${recoveryRate}%</b> recovery rate)` : ''}. ` +
      `Net exposure after recoveries <b>${money(d.net_exposure, currency)}</b>.`

  const insurerRows = d.by_insurer.length
    ? d.by_insurer.map((it, i) => `<tr>
        <td style="padding:6px 0;font-size:12.5px;color:#334155"><span style="display:inline-block;width:18px;color:#94a3b8;font-weight:700">${i + 1}.</span>${it.label}</td>
        <td style="padding:6px 0;font-size:12.5px;color:#0f172a;font-weight:700;text-align:right">${money(it.value, currency)}</td></tr>`).join('')
    : `<tr><td style="padding:6px 0;font-size:12px;color:#94a3b8">No data</td></tr>`
  const statusRows = d.by_status.length
    ? d.by_status.map((it, i) => `<tr>
        <td style="padding:6px 0;font-size:12.5px;color:#334155"><span style="display:inline-block;width:18px;color:#94a3b8;font-weight:700">${i + 1}.</span>${it.label}</td>
        <td style="padding:6px 0;font-size:12.5px;color:#0f172a;font-weight:700;text-align:right">${num(it.value)}</td></tr>`).join('')
    : `<tr><td style="padding:6px 0;font-size:12px;color:#94a3b8">No data</td></tr>`

  const recentRows = d.recent.length
    ? d.recent.map((r) => `<tr>
        <td style="padding:7px 6px;font-size:11.5px;color:#334155;border-bottom:1px solid #eef2f7">${r.date}</td>
        <td style="padding:7px 6px;font-size:11.5px;color:#0f172a;font-weight:600;border-bottom:1px solid #eef2f7">${r.asset}</td>
        <td style="padding:7px 6px;font-size:11.5px;color:#334155;border-bottom:1px solid #eef2f7">${r.insurer}</td>
        <td style="padding:7px 6px;font-size:11.5px;border-bottom:1px solid #eef2f7"><span style="color:${r.state === 'Closed' ? '#047857' : '#b45309'};font-weight:700">${r.state}</span>${r.delayed ? ' <span style="color:#b91c1c;font-weight:700">· delayed</span>' : ''}</td>
        <td style="padding:7px 6px;font-size:11.5px;color:#0f172a;text-align:right;border-bottom:1px solid #eef2f7">${money(r.claim, currency)}</td>
        <td style="padding:7px 6px;font-size:11.5px;color:#0f172a;text-align:right;border-bottom:1px solid #eef2f7">${money(r.approved, currency)}</td>
        <td style="padding:7px 6px;font-size:11.5px;color:#047857;text-align:right;border-bottom:1px solid #eef2f7">${money(r.recovered, currency)}</td></tr>`).join('')
    : `<tr><td colspan="7" style="padding:10px 6px;font-size:12px;color:#94a3b8">No claims to list.</td></tr>`

  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:680px;margin:auto;color:#0f172a;background:#fff">
    <div style="background:#312e81;border-radius:12px 12px 0 0;padding:22px 26px;color:#fff">
      <div style="font-size:19px;font-weight:800">TyrePulse — Insurance Claims Summary</div>
      <div style="font-size:12px;color:#c7d2fe;margin-top:3px">
        Schedule “${s.name}” · generated ${genAt} UTC · incident coverage ${coverage}
      </div>
    </div>

    <div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:22px 26px">
      <div style="background:#eef2ff;border-left:4px solid #4f46e5;border-radius:8px;padding:12px 16px;font-size:13px;color:#334155;line-height:1.6">
        ${summary}
      </div>

      <table role="presentation" width="100%" cellspacing="8" style="margin-top:6px">
        ${sectionTitle('Claims Overview')}
        <tr>
          ${tile('Total claims', num(d.total))}
          ${tile('Open', num(d.open), '', d.open ? '#b45309' : '#047857')}
          ${tile('Closed', num(d.closed), '', '#047857')}
        </tr>
        <tr>
          ${tile('Delayed', num(d.delayed), 'past expected release', d.delayed ? '#b91c1c' : '#047857')}
          ${tile('Recovery rate', recoveryRate == null ? 'N/A' : `${recoveryRate}%`)}
          ${tile('Net exposure', money(d.net_exposure, currency), 'after recoveries', d.net_exposure ? '#b91c1c' : '#0f172a')}
        </tr>

        ${sectionTitle('Financials')}
        <tr>
          ${tile('Total claimed', money(d.claim_total, currency))}
          ${tile('Approved', money(d.approved_total, currency), '', '#047857')}
          ${tile('Recovered', money(d.recovered_total, currency), '', '#047857')}
        </tr>
        <tr>
          ${tile('Deductible exposure', money(d.deductible_total, currency))}
          ${tile('Outstanding vs approved', money(Math.max(0, d.approved_total - d.recovered_total), currency), 'approved not yet recovered', (d.approved_total - d.recovered_total) > 0 ? '#b45309' : '#047857')}
          ${tile('Avg claim', d.total ? money(Math.round(d.claim_total / d.total), currency) : 'N/A')}
        </tr>

        ${sectionTitle('Claims by Insurer & Status')}
        <tr>
          <td style="vertical-align:top;padding:6px 10px 6px 0">
            <div style="font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Top insurers by claim value</div>
            <table role="presentation" width="100%" cellspacing="0">${insurerRows}</table>
          </td>
          <td style="vertical-align:top;padding:6px 10px 6px 0">
            <div style="font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Claims by status</div>
            <table role="presentation" width="100%" cellspacing="0">${statusRows}</table>
          </td>
          <td style="vertical-align:top"></td>
        </tr>
      </table>

      <div style="margin-top:18px;font-size:13px;font-weight:800;color:#0f172a;text-transform:uppercase;letter-spacing:.6px;border-bottom:2px solid #312e81;padding-bottom:8px">
        Recent Claims
      </div>
      <table role="presentation" width="100%" cellspacing="0" style="margin-top:8px">
        <tr style="background:#f8fafc">
          <td style="padding:6px;font-size:10.5px;font-weight:700;color:#64748b;text-transform:uppercase">Date</td>
          <td style="padding:6px;font-size:10.5px;font-weight:700;color:#64748b;text-transform:uppercase">Asset</td>
          <td style="padding:6px;font-size:10.5px;font-weight:700;color:#64748b;text-transform:uppercase">Insurer</td>
          <td style="padding:6px;font-size:10.5px;font-weight:700;color:#64748b;text-transform:uppercase">State</td>
          <td style="padding:6px;font-size:10.5px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:right">Claim</td>
          <td style="padding:6px;font-size:10.5px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:right">Approved</td>
          <td style="padding:6px;font-size:10.5px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:right">Recovered</td>
        </tr>
        ${recentRows}
      </table>

      <p style="font-size:12px;color:#475569;line-height:1.6;margin-top:16px">
        All figures are live from your accident &amp; claims data. N/A means the value was not captured and is never estimated.
        "Delayed" flags open claims past their expected release date.
      </p>
      <a href="${appUrl}/accidents" style="display:inline-block;background:#4f46e5;color:#fff;font-weight:700;font-size:13px;padding:11px 20px;border-radius:8px;text-decoration:none;margin-top:4px">Open Claims in TyrePulse</a>
      <p style="font-size:11px;color:#94a3b8;margin-top:18px">
        You receive this because you are a recipient of the “${s.name}” schedule.
        Manage recipients &amp; frequency in TyrePulse → Scheduled Reports.
      </p>
    </div>
  </div>`
}

/** Render the correct digest e-mail (claims / builder / executive) for one schedule. */
// deno-lint-ignore no-explicit-any
async function renderForSchedule(svc: any, s: Schedule, appUrl: string, currency: string): Promise<{ subject: string; html: string }> {
  const isBuilder = (s.report_type ?? '').startsWith('builder:')
  const html = (s.report_type === 'claims' || isBuilder)
    ? renderClaimsHtml(s, await buildClaimsDigest(svc, s.org_id), appUrl, currency)
    : renderHtml(s, await buildDigest(svc, s.org_id), appUrl, currency)
  // No dash punctuation in report output (user preference) - sanitize both.
  return { subject: asciiSafe(`TyrePulse ${typeLabel(s.report_type) || 'Report'}: ${s.name}`), html: asciiSafe(html) }
}

// deno-lint-ignore no-explicit-any
async function systemCurrency(svc: any): Promise<string> {
  try {
    const { data: cur } = await svc.from('system_config').select('value').eq('key', 'default_currency').maybeSingle()
    return (cur?.value ?? '').toString().replace(/^"|"$/g, '').trim()
  } catch { return '' }
}

const SCHEDULE_COLS = 'id,name,report_type,frequency,day_of_week,day_of_month,time_of_day,recipients,last_sent_at,next_run_at,org_id'

/**
 * On-demand "Send now": an authenticated Admin/Manager/Director posts
 * { schedule_id } and the report is e-mailed to its recipients immediately.
 * The schedule row is fetched through the CALLER's own RLS client, so org and
 * country isolation are enforced by the database — a user can only send
 * schedules they can already see. Does NOT advance next_run_at or touch the
 * active flag; only last_sent_at + a report_send_log row.
 */
// deno-lint-ignore no-explicit-any
async function handleSendNow(req: Request, svc: any): Promise<Response> {
  if (req.method !== 'POST') return jsonResponse(req, { error: 'unauthorised' }, 401)

  let scheduleId = ''
  try { scheduleId = String((await req.json())?.schedule_id ?? '') } catch { /* fallthrough */ }
  if (!scheduleId) return jsonResponse(req, { error: 'schedule_id is required' }, 400)

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return jsonResponse(req, { error: 'Missing bearer token' }, 401)
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  )
  const { data: userData, error: userError } = await userClient.auth.getUser(token)
  if (userError || !userData?.user) return jsonResponse(req, { error: 'Invalid session' }, 401)
  const { data: profile } = await userClient
    .from('profiles').select('id, role, approved, locked').eq('id', userData.user.id).maybeSingle()
  if (!profile || profile.approved === false || profile.locked === true) {
    return jsonResponse(req, { error: 'Account is not approved for this action' }, 403)
  }
  const role = String(profile.role ?? '').trim().toLowerCase().replace(/\s+/g, '_')
  if (!['admin', 'manager', 'director'].includes(role)) {
    return jsonResponse(req, { error: 'Insufficient role for this action' }, 403)
  }

  // RLS-scoped read: invisible schedules 404 rather than leak.
  const { data: s, error: schedErr } = await userClient
    .from('report_schedules').select(SCHEDULE_COLS).eq('id', scheduleId).maybeSingle()
  if (schedErr) return jsonResponse(req, { error: schedErr.message }, 500)
  if (!s) return jsonResponse(req, { error: 'Schedule not found' }, 404)

  const recipients = ((s.recipients ?? []) as string[]).filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r))
  if (!recipients.length) return jsonResponse(req, { error: 'No valid recipients on the schedule' }, 400)
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  if (!RESEND_API_KEY) return jsonResponse(req, { error: 'E-mail provider is not configured' }, 500)
  const APP_URL = Deno.env.get('APP_URL') || 'https://tyrepulse.app'
  const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'reports@tyrepulse.app'

  const now = new Date()
  try {
    const { subject, html } = await renderForSchedule(svc, s as Schedule, APP_URL, await systemCurrency(svc))
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: recipients, subject, html }),
    })
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`)

    await svc.from('report_schedules')
      .update({ last_sent_at: now.toISOString(), updated_at: now.toISOString() })
      .eq('id', s.id)
    await svc.from('report_send_log').insert({
      schedule_id: s.id, schedule_name: `${s.name} (send now)`, report_type: s.report_type,
      recipients, status: 'sent',
    })
    return jsonResponse(req, { sent: true, recipients: recipients.length })
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300)
    await svc.from('report_send_log').insert({
      schedule_id: s.id, schedule_name: `${s.name} (send now)`, report_type: s.report_type,
      recipients, status: 'failed', error: msg,
    })
    return jsonResponse(req, { error: msg }, 502)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })

  const svc = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Two entry modes: the pg_cron job authenticates with x-cron-secret and
  // processes every due schedule; anything else must be an authenticated
  // on-demand "Send now" request for a single schedule.
  const given = req.headers.get('x-cron-secret') ?? ''
  const { data: cfg } = await svc.from('cron_config').select('value').eq('name', 'cron_secret').maybeSingle()
  if (!cfg?.value || given !== cfg.value) {
    return await handleSendNow(req, svc)
  }

  const now = new Date()
  const { data: due, error: dueErr } = await svc
    .from('report_schedules')
    .select(SCHEDULE_COLS)
    .eq('active', true)
    .or(`next_run_at.is.null,next_run_at.lte.${now.toISOString()}`)
    .limit(25)
  if (dueErr) {
    return new Response(JSON.stringify({ error: dueErr.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'reports@tyrepulse.app'
  const APP_URL = Deno.env.get('APP_URL') || 'https://tyrepulse.app'

  // System currency (best-effort; blank if unset - never blocks a send).
  const currency = await systemCurrency(svc)

  let sent = 0
  let failed = 0
  let first = true

  for (const s of (due ?? []) as Schedule[]) {
    const recipients = (s.recipients ?? []).filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r))
    try {
      if (!recipients.length) throw new Error('No valid recipients on the schedule')
      if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured for edge functions')

      // Resend allows 2 requests/second — pace consecutive sends so a batch of
      // due schedules never trips the 429 rate limit (observed 2026-07-11).
      if (!first) await sleep(650)
      first = false

      // Insurance Claims Summary + custom Report Builder layouts get the
      // claims-desk digest; every other type the executive digest.
      const { subject, html } = await renderForSchedule(svc, s, APP_URL, currency)
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM_EMAIL, to: recipients, subject, html }),
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
