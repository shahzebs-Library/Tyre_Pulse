// send-scheduled-reports - cron-driven delivery of scheduled report digests.
//
// Invoked every 15 minutes by pg_cron (V61) with an `x-cron-secret` header.
// The secret lives in the service-role-only `cron_config` table, so only the
// database's own cron job can trigger real work - a stray anon call is a 401.
//
// For every ACTIVE schedule whose next_run_at has passed (or is null), it
// builds a live executive intelligence digest for the schedule's report type
// via the server-side aggregate RPC `report_exec_digest` (V85 - one round-trip,
// org-scoped, all-time + trailing-30-day windows) for COUNTS, and the
// per-country aggregate `report_exec_money_by_country` for MONEY (expense grid,
// each country in its own currency, never one blended total - see money.ts),
// emails it to the recipients
// via Resend (same provider/env as send-email), records the outcome in
// report_send_log (sent/failed + provider error), and advances
// last_sent_at/next_run_at. Failures back off one hour instead of hammering
// the provider every 15 minutes.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  type CountryMoney, type CurrencyMap, type ExecMoney, type MoneyPart,
  budgetOutlook, buildCurrencyMap, execMoneyFromLegacy, fmtField, fmtMoney, fmtMoneyParts,
  isMissingRpc, isMixedCurrency, normaliseExecMoney, partsFor, rowCurrency, sumByCurrency,
  sumRowsByCurrency,
} from './money.ts'

const RIYADH_OFFSET_MIN = 3 * 60 // Gulf standard time, no DST

/* ── CORS + auth (inlined from _shared/auth.ts so the function deploys as a
      single file via MCP; keep in sync with that helper) ─────────────────── */

const DEFAULT_ALLOWED_ORIGINS = [
  'https://tyrepulse.app',
  'https://www.tyrepulse.app',
  'https://app.tyrepulse.app',
  'http://localhost:5173',
  'http://localhost:5174',
]
// *.vercel.app preview wildcard dropped (same owner decision as tenant-export /
// sentry-issues): a preview host must be listed in ALLOWED_ORIGINS explicitly.
const LOCAL_DEV_ORIGIN = /^http:\/\/localhost(:\d{1,5})?$/

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  const configured = Deno.env.get('ALLOWED_ORIGINS')?.split(',').map((v) => v.trim()).filter(Boolean)
  const allowedOrigins = configured?.length ? configured : DEFAULT_ALLOWED_ORIGINS
  let allowOrigin = '*'
  if (origin) {
    allowOrigin = (allowedOrigins.includes(origin) || LOCAL_DEV_ORIGIN.test(origin))
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

function jsonResponse(req: Request, body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json', ...extraHeaders },
  })
}

// Constant-time comparison so the cron secret cannot be probed through response
// timing. Local copy on purpose: this function deploys as one self-contained file.
function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b) return false
  const enc = new TextEncoder(); const ab = enc.encode(a); const bb = enc.encode(b)
  let diff = ab.length ^ bb.length
  const n = Math.max(ab.length, bb.length)
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}

// Every digest in this file is built with the SERVICE ROLE, which bypasses row
// security, so the organisation filter in each query is the only tenant wall.
// A schedule with no organisation used to mean "no filter" = a digest across
// EVERY organisation. It is now refused everywhere a digest is built.
const NO_ORG_MESSAGE = 'This schedule has no organisation, so it cannot be sent. Edit and save it again, or ask an administrator.'
function requireOrg(orgId: string | null | undefined): string {
  const id = typeof orgId === 'string' ? orgId.trim() : ''
  if (!id) throw new Error(NO_ORG_MESSAGE)
  return id
}

// "Send now" cooldown per schedule. Each call builds a digest with the service
// role and e-mails every recipient, so it must not be callable in a loop.
const SEND_NOW_COOLDOWN_SECONDS = 300

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
  period: string | null
  period_from: string | null
  period_to: string | null
}

function toRiyadh(d: Date): Date {
  return new Date(d.getTime() + RIYADH_OFFSET_MIN * 60_000)
}
function fromRiyadh(d: Date): Date {
  return new Date(d.getTime() - RIYADH_OFFSET_MIN * 60_000)
}

/** YYYY-MM-DD from a date that has already been through toRiyadh() - its UTC
 *  fields then read as Riyadh wall-clock time, the same trick computeNextRun
 *  above relies on. Never call this on a plain, unshifted Date. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * The coverage window a schedule was actually configured for - same
 * vocabulary as the client (src/lib/api/scheduledReports.js resolvePeriod):
 * yesterday / last_7 / last_30 / last_90 / mtd / ytd / custom. Computed in
 * Riyadh calendar days, consistent with computeNextRun's own local-time
 * handling in this file (there is no "browser timezone" server-side, so
 * Riyadh - this app's home region - is the deliberate, fixed reference,
 * never UTC-via-toISOString() on an unshifted date - that mismatch is
 * exactly the class of bug already fixed client-side for this same period
 * vocabulary; PROJECT_MEMORY.md, 2026-09-13).
 * Returns {from,to} as null when the period cannot be resolved (missing
 * custom bounds) - callers then read the whole table, the prior behaviour,
 * never a silent narrowing to zero rows.
 */
function resolvePeriodBounds(s: Schedule, now: Date): { from: string | null; to: string | null; label: string } {
  const nowLocal = toRiyadh(now)
  const today = isoDay(nowLocal)
  const period = s.period || 'last_30'

  if (period === 'custom') {
    return {
      from: s.period_from || null,
      to: s.period_to || null,
      label: `${s.period_from || '...'} to ${s.period_to || '...'}`,
    }
  }
  if (period === 'yesterday') {
    const y = new Date(nowLocal)
    y.setUTCDate(y.getUTCDate() - 1)
    const day = isoDay(y)
    return { from: day, to: day, label: `Yesterday (${day})` }
  }
  const from = new Date(nowLocal)
  if (period === 'last_7') from.setUTCDate(from.getUTCDate() - 7)
  else if (period === 'last_90') from.setUTCDate(from.getUTCDate() - 90)
  else if (period === 'mtd') from.setUTCDate(1)
  else if (period === 'ytd') from.setUTCMonth(0, 1)
  else from.setUTCDate(from.getUTCDate() - 30) // last_30 and any unrecognised value
  return { from: isoDay(from), to: today, label: `${isoDay(from)} to ${today}` }
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
  orgId = requireOrg(orgId)
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
  tyre_stock_alert: 'Tyre Low-Stock Alert',
  vendor: 'Vendor / Procurement Report',
  pm: 'Preventive Maintenance due',
  workshop: 'Workshop Summary',
  workshop_status: 'Workshop Vehicle Status',
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
  return fmtMoney(n, currency)
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
      <div style="font-size:${value.length > 18 ? 13 : 20}px;font-weight:800;color:${color};line-height:1.25">${value}</div>
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

/** Country to currency lookup plus the system default currency. */
type CurrencyContext = { map: CurrencyMap; fallback: string }

/**
 * Money for the executive digest, per country, each in its own currency.
 *
 * Source of truth is the expense grid (parts_consumption.tyre_cost), the same
 * source the Expenses screens read, through the service-role aggregate
 * `report_exec_money_by_country`. Until that function is installed the digest
 * falls back to the legacy per-country list (tyre record prices): still never
 * blended, but labelled as the weaker source, with the other money figures N/A.
 */
// deno-lint-ignore no-explicit-any
async function buildExecMoney(svc: any, orgId: string | null, legacy: Digest, cur: CurrencyContext): Promise<ExecMoney> {
  orgId = requireOrg(orgId)
  const { data, error } = await svc.rpc('report_exec_money_by_country', { p_org: orgId, p_days: 30 })
  if (!error && data) return normaliseExecMoney(data)
  if (error && !isMissingRpc(error)) throw new Error(`money digest RPC failed: ${error.message}`)
  return execMoneyFromLegacy(legacy, cur.map, cur.fallback)
}

function buildRecommendations(d: Digest, m: ExecMoney): string[] {
  const recs: string[] = []
  if (d.dup_serials > 0) recs.push(`Resolve <b>${num(d.dup_serials)}</b> duplicate tyre serial(s). They distort life &amp; CPK analysis.`)
  if (d.missing_cost > 0) recs.push(`<b>${num(d.missing_cost)}</b> tyre record(s) have no price. Per-tyre cost KPIs understate until filled (tyre spend totals come from the expense grid and are not affected).`)
  if (d.wo_overdue > 0) recs.push(`<b>${num(d.wo_overdue)}</b> work order(s) past target completion. Expedite to cut downtime.`)
  if (d.ca_overdue > 0) recs.push(`<b>${num(d.ca_overdue)}</b> corrective action(s) overdue. Reassign or escalate.`)
  const siteUnknown = (d.top_sites ?? []).length === 1 && d.top_sites[0].label === '(unknown)'
  if (siteUnknown) recs.push(`Tyre <b>site</b> is blank across records. Populate it to unlock branch cost comparison.`)
  if (d.all.cpk == null) recs.push(`Cost per km cannot be computed. Capture <b>fitment and removal km</b> to enable CPK &amp; life forecasting.`)
  if (d.win.tyres.cur === 0) recs.push(`No tyre records in the last ${d.period_days} days. Confirm data imports are current (latest record ${dateShort(d.all.last_date)}).`)
  // Budget outlook, one country at a time (never a cross-currency comparison).
  for (const c of m.countries) {
    const o = budgetOutlook(c)
    if (o && o.over) {
      recs.push(`<b>${c.country}</b>: tyre spend over the last 12 months (${money(o.run_rate, c.currency)}) is <b>${o.pct}% over</b> the annual tyre budget (${money(o.annual_budget, c.currency)}). Review procurement and the highest-cost assets below.`)
    }
  }
  // Worst-reliability brand (highest High/Critical rate with enough records).
  const worstBrand = (d.brand_reliability ?? []).find((b) => b.risk_pct != null && Number(b.risk_pct) >= 30)
  if (worstBrand) recs.push(`<b>${worstBrand.label}</b> shows a <b>${worstBrand.risk_pct}%</b> High/Critical risk rate. Investigate as a candidate for de-listing or root-cause review.`)
  if (!recs.length) recs.push('No critical issues detected this period. Maintain inspection cadence and monitor high-risk positions.')
  return recs.slice(0, 8)
}

/** One row per country: every amount in that country's own currency. */
function countryMoneyTable(m: ExecMoney): string {
  if (!m.countries.length) {
    return `<div style="font-size:12px;color:#94a3b8;padding:6px 0">No cost lines are recorded for this organisation yet.</div>`
  }
  const th = (t: string, right = false) =>
    `<td style="padding:6px;font-size:10.5px;font-weight:700;color:#64748b;text-transform:uppercase${right ? ';text-align:right' : ''}">${t}</td>`
  const td = (t: string, right = false, bold = false) =>
    `<td style="padding:7px 6px;font-size:11.5px;color:#0f172a;border-bottom:1px solid #eef2f7${right ? ';text-align:right' : ''}${bold ? ';font-weight:700' : ''}">${t}</td>`
  const rows = m.countries.map((c: CountryMoney) => {
    const tr = c.tyre_spend_cur != null && c.tyre_spend_prev != null ? ` ${trend(c.tyre_spend_cur, c.tyre_spend_prev, true)}` : ''
    return `<tr>
      ${td(c.country, false, true)}
      ${td(c.currency || 'not set')}
      ${td(money(c.tyre_spend_all, c.currency), true, true)}
      ${td(`${money(c.tyre_spend_cur, c.currency)}${tr}`, true)}
      ${td(money(c.tyre_spend_prev, c.currency), true)}
      ${td(money(c.wo_cost, c.currency), true)}
      ${td(money(c.accident_cost, c.currency), true)}
    </tr>`
  }).join('')
  return `<table role="presentation" width="100%" cellspacing="0">
    <tr style="background:#f8fafc">
      ${th('Country')}${th('Currency')}${th('Tyre spend, all time', true)}${th(`Last ${m.period_days} days`, true)}${th(`Prior ${m.period_days} days`, true)}${th('Work order cost', true)}${th('Accident cost', true)}
    </tr>
    ${rows}
  </table>`
}

/** Per-country trend, forecast and cost drivers (expense grid only). */
function countryDetailBlocks(m: ExecMoney): string {
  return m.countries.map((c: CountryMoney) => {
    const o = budgetOutlook(c)
    const outlook = o == null
      ? tile('Budget outlook', 'N/A', 'set a fleet tyre budget')
      : tile('Budget outlook', `${o.over ? 'Over' : 'Under'} by ${o.pct}%`, o.over ? 'last 12 months exceed budget' : 'within budget', o.over ? '#b91c1c' : '#047857')
    return `
        ${sectionTitle(`${c.country} (${c.currency || 'currency not set'}): cost trend and drivers`)}
        <tr><td colspan="3" style="padding-top:4px">${monthlyTrendBars(c.monthly_trend, c.currency)}</td></tr>
        <tr>
          ${tile('Tyre spend, last 12 months', money(c.tyre_spend_12m, c.currency))}
          ${tile('Annual tyre budget (12 x monthly)', c.monthly_budget ? money(c.monthly_budget * 12, c.currency) : 'N/A')}
          ${outlook}
        </tr>
        <tr>
          ${topList('Top sites by tyre spend (issuing store)', c.top_sites, (n) => money(n, c.currency))}
          ${topList('Highest tyre spend assets', c.top_assets, (n) => money(n, c.currency))}
          <td style="vertical-align:top;padding:6px 0 6px 0"></td>
        </tr>`
  }).join('')
}

function renderHtml(s: Schedule, d: Digest, appUrl: string, m: ExecMoney, windowLabel = ''): string {
  const genAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const coverage = `${dateShort(d.all.first_date)} to ${dateShort(d.all.last_date)}`
  const riskColor = d.all.high_risk > 0 ? '#b91c1c' : '#047857'
  const recs = buildRecommendations(d, m)
  const mixed = isMixedCurrency(partsFor(m, 'tyre_spend_all'))
  const single = m.countries.length === 1 ? m.countries[0] : null
  const perCurrency = mixed ? 'per currency, not added together' : ''
  const fromGrid = m.basis === 'expense_grid'
  const basisNote = fromGrid
    ? 'Tyre spend is taken from the expense grid, the same source as the Expenses screens, for each country in its own currency.'
    : 'Tyre spend here uses tyre record prices because the expense grid summary is not installed yet. Work order cost, accident cost, trends and budgets per country will appear once it is.'

  const summary =
    `Across the full dataset (${coverage}) the fleet has <b>${num(d.all.tyres)}</b> tyre transactions, ` +
    `with tyre spend of <b>${fmtField(m, 'tyre_spend_all')}</b>${mixed ? ' (one figure per currency; currencies are never added together)' : ''}, ` +
    `<b>${num(d.wo_open)}</b> work order(s) open` +
    `${d.wo_overdue ? ` (<b style="color:#b91c1c">${num(d.wo_overdue)} overdue</b>)` : ''} ` +
    `and <b>${num(d.ca_open)}</b> corrective action(s) outstanding. ` +
    (d.win.tyres.cur > 0
      ? `In the last ${d.period_days} days, <b>${num(d.win.tyres.cur)}</b> tyre record(s) were added.`
      : `No new tyre records were logged in the last ${d.period_days} days.`)

  // Cost per km from tyre record prices is only meaningful inside one currency.
  const cpkTile = single && d.all.cpk != null
    ? tile('Avg cost / km', `${single.currency ? single.currency + ' ' : ''}${Number(d.all.cpk).toFixed(3)}`, 'from tyre record prices')
    : tile('Avg cost / km', 'N/A', m.countries.length > 1 ? 'see CPK screens per country' : '')
  const spendTrend = single && single.tyre_spend_cur != null && single.tyre_spend_prev != null
    ? trend(single.tyre_spend_cur, single.tyre_spend_prev, true)
    : perCurrency

  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:680px;margin:auto;color:#0f172a;background:#fff">
    <div style="background:#0f172a;border-radius:12px 12px 0 0;padding:22px 26px;color:#fff">
      <div style="font-size:19px;font-weight:800">TyrePulse ${typeLabel(s.report_type)}</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:3px">
        Schedule "${s.name}" | generated ${genAt} UTC | data coverage ${coverage}
      </div>
      ${windowLabel ? `<div style="font-size:12px;color:#cbd5e1;margin-top:4px">
        Report window: all-time totals plus the last ${d.period_days} days compared to the prior ${d.period_days} days.
        The schedule's selected period (${windowLabel}) does not narrow this executive digest.
      </div>` : ''}
    </div>

    <div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:22px 26px">

      <!-- Executive summary -->
      <div style="background:#f1f5f9;border-left:4px solid #0f172a;border-radius:8px;padding:12px 16px;font-size:13px;color:#334155;line-height:1.6">
        ${summary}
      </div>

      <table role="presentation" width="100%" cellspacing="8" style="margin-top:6px">

        ${sectionTitle('Fleet Intelligence: all time')}
        <tr>
          ${tile('Tyre transactions', num(d.all.tyres))}
          ${tile('Total tyre spend', fmtField(m, 'tyre_spend_all'), perCurrency)}
          ${cpkTile}
        </tr>
        <tr>
          ${tile('High / Critical risk', num(d.all.high_risk), '', riskColor)}
          ${tile('Tyre removals', num(d.all.removals))}
          ${tile('Active vehicles', num(d.fleet_active))}
        </tr>

        ${sectionTitle(`Recent Activity: last ${d.period_days} days`)}
        <tr>
          ${tile('Tyre records', num(d.win.tyres.cur), trend(d.win.tyres.cur, d.win.tyres.prev, false))}
          ${tile('Tyre spend', fmtField(m, 'tyre_spend_cur'), spendTrend)}
          ${tile('High/Critical', num(d.win.high_risk.cur), trend(d.win.high_risk.cur, d.win.high_risk.prev, true), d.win.high_risk.cur ? '#b91c1c' : '#0f172a')}
        </tr>
        <tr>
          ${tile('Removals', num(d.win.removals))}
          ${tile('Inspections', num(d.win.inspections))}
          ${tile('Accidents (all)', num(d.accidents), '', d.accidents ? '#b91c1c' : '#047857')}
        </tr>

        ${sectionTitle('Money by country (each in its own currency)')}
        <tr><td colspan="3" style="padding-top:4px">
          ${countryMoneyTable(m)}
          <div style="font-size:11.5px;color:#64748b;line-height:1.6;margin-top:8px">
            ${basisNote} Amounts in different currencies are never added together, so there is no combined total across countries.
          </div>
        </td></tr>

        ${sectionTitle('Operations & Reliability')}
        <tr>
          ${tile('Open work orders', num(d.wo_open), `of ${num(d.wo_total)} total`)}
          ${tile('Overdue work orders', num(d.wo_overdue), '', d.wo_overdue ? '#b91c1c' : '#047857')}
          ${tile('Work order cost', fmtField(m, 'wo_cost'), isMixedCurrency(partsFor(m, 'wo_cost')) ? 'per currency, not added together' : '')}
        </tr>
        <tr>
          ${tile('Open actions', num(d.ca_open), '', d.ca_open ? '#b45309' : '#047857')}
          ${tile('Overdue actions', num(d.ca_overdue), '', d.ca_overdue ? '#b91c1c' : '#047857')}
          ${tile('Breakdown hours', num(d.breakdown_hours))}
        </tr>
        <tr>
          ${tile('RCAs logged', num(d.rca))}
          ${tile('Inspections (all)', num(d.inspections))}
          ${tile('Accident cost', fmtField(m, 'accident_cost'), isMixedCurrency(partsFor(m, 'accident_cost')) ? 'per currency, not added together' : '', partsFor(m, 'accident_cost').length ? '#b91c1c' : '#0f172a')}
        </tr>

        ${fromGrid ? countryDetailBlocks(m) : ''}

        ${sectionTitle('Removals & Reliability')}
        <tr>
          ${topList('Top removal reasons', d.top_removal_reasons, (n) => num(n))}
          ${topList('Removals by position', d.by_position, (n) => num(n))}
          ${brandReliabilityList(d.brand_reliability)}
        </tr>

        ${sectionTitle('Data Quality')}
        <tr>
          ${tile('Duplicate serials', num(d.dup_serials), '', d.dup_serials ? '#b91c1c' : '#047857')}
          ${tile('Tyre records with no price', num(d.missing_cost), '', d.missing_cost ? '#b45309' : '#047857')}
          ${tile('Monthly tyre budget', fmtField(m, 'monthly_budget'), isMixedCurrency(partsFor(m, 'monthly_budget')) ? 'per currency, not added together' : '')}
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
        You receive this because you are a recipient of the "${s.name}" schedule.
        Manage recipients &amp; frequency in TyrePulse, Scheduled Reports.
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
  country: string | null
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
  // Money is carried PER CURRENCY (one part per currency, never added across
  // currencies). An organisation working in one currency has one part.
  claim_total: MoneyPart[]
  approved_total: MoneyPart[]
  recovered_total: MoneyPart[]
  deductible_total: MoneyPart[]
  net_exposure: MoneyPart[]
  outstanding: MoneyPart[]
  mixed: boolean
  first_date: string | null
  last_date: string | null
  by_insurer: Array<TopItem & { currency: string }>
  by_status: TopItem[]
  recent: Array<{
    date: string; asset: string; insurer: string; status: string; currency: string
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
async function buildClaimsDigest(svc: any, orgId: string | null, win: { from: string | null; to: string | null } = { from: null, to: null }, cur: CurrencyContext = { map: {}, fallback: '' }): Promise<ClaimsDigest> {
  // PostgREST caps every response at 1000 rows whatever .limit() says, so the
  // digest pages with .range() (id tiebreak keeps page boundaries stable) up to
  // a hard ceiling rather than silently summarising the newest 1000 claims.
  const PAGE = 1000
  const CEILING = 20000
  const buildQuery = () => {
    let q = svc
      .from('accidents')
      .select(
        'id,country,incident_date,asset_no,site,driver_name,status,claim_status,insurer,policy_no,gcc_liability_ratio,fault_status,claim_amount,claim_approved_amount,deductible,recovered_amount,repair_cost,estimated_damage_cost,parts_cost,expected_release_date,release_date,closure_status',
      )
      .or('claim_amount.gt.0,claim_approved_amount.gt.0,claim_status.not.is.null,insurer.not.is.null')
      .order('incident_date', { ascending: false })
      .order('id', { ascending: true })
    // Service role bypasses RLS, so scope to the schedule's org explicitly.
    q = q.eq('organisation_id', requireOrg(orgId))
    // The schedule's own coverage window on the incident date (same rule as the
    // dataset digests: a missing bound leaves that side open, never narrows to
    // nothing).
    if (win.from) q = q.gte('incident_date', win.from)
    if (win.to)   q = q.lte('incident_date', win.to)
    return q
  }
  const rows: ClaimRow[] = []
  for (let offset = 0; offset < CEILING; offset += PAGE) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE - 1)
    if (error) throw new Error(`claims query failed: ${error.message}`)
    const page = (data ?? []) as ClaimRow[]
    rows.push(...page)
    if (page.length < PAGE) break
  }

  const today = new Date().toISOString().slice(0, 10)
  const insurerMap = new Map<string, { label: string; currency: string; value: number }>()
  const statusMap = new Map<string, number>()
  let open = 0, closed = 0, delayed = 0
  // One accumulator per currency: a claim in AED is never added to one in SAR.
  type Acc = { claim: number; approved: number; recovered: number; deductible: number; net: number }
  const byCur = new Map<string, Acc>()
  const anyCountry = rows.some((r) => String(r.country ?? '').trim() !== '')
  const curOf = (r: ClaimRow) => rowCurrency(r as unknown as Record<string, unknown>, 'country', cur.map, cur.fallback, anyCountry)
  let first_date: string | null = null, last_date: string | null = null

  for (const r of rows) {
    const cl = claimIsClosed(r)
    if (cl) closed++; else open++
    if (claimIsDelayed(r, today)) delayed++
    const c = curOf(r)
    const a = byCur.get(c) ?? { claim: 0, approved: 0, recovered: 0, deductible: 0, net: 0 }
    a.claim += n0(r.claim_amount)
    a.approved += n0(r.claim_approved_amount)
    a.recovered += n0(r.recovered_amount)
    a.deductible += n0(r.deductible)
    a.net += Math.max(0, (n0(r.repair_cost) || n0(r.estimated_damage_cost)) + n0(r.parts_cost) - n0(r.recovered_amount))
    byCur.set(c, a)
    const ins = (r.insurer || '(no insurer)').trim() || '(no insurer)'
    const insKey = `${ins}|${c}`
    const insAcc = insurerMap.get(insKey) ?? { label: ins, currency: c, value: 0 }
    insAcc.value += n0(r.claim_amount)
    insurerMap.set(insKey, insAcc)
    const st = (r.claim_status || '(unspecified)').trim() || '(unspecified)'
    statusMap.set(st, (statusMap.get(st) ?? 0) + 1)
    const d = r.incident_date ? String(r.incident_date).slice(0, 10) : null
    if (d) {
      if (!first_date || d < first_date) first_date = d
      if (!last_date || d > last_date) last_date = d
    }
  }

  // Ranked inside each currency first (currency code, then value) so an EGP
  // figure is never ranked above a SAR one just because the number is bigger.
  const by_insurer = [...insurerMap.values()]
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.value - a.value).slice(0, 8)
  const part = (pick: (a: Acc) => number): MoneyPart[] =>
    sumByCurrency([...byCur.entries()].map(([currency, a]) => ({ currency, amount: pick(a) })))
  const by_status = [...statusMap.entries()].map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value).slice(0, 6)
  const recent = rows.slice(0, 12).map((r) => ({
    date: r.incident_date ? String(r.incident_date).slice(0, 10) : 'N/A',
    asset: r.asset_no || 'N/A',
    insurer: r.insurer || 'N/A',
    status: r.claim_status || r.status || 'N/A',
    currency: curOf(r),
    claim: n0(r.claim_amount),
    approved: n0(r.claim_approved_amount),
    recovered: n0(r.recovered_amount),
    state: (claimIsClosed(r) ? 'Closed' : 'Open') as 'Open' | 'Closed',
    delayed: claimIsDelayed(r, today),
  }))

  return {
    total: rows.length, open, closed, delayed,
    claim_total: part((a) => a.claim), approved_total: part((a) => a.approved),
    recovered_total: part((a) => a.recovered), deductible_total: part((a) => a.deductible),
    net_exposure: part((a) => a.net), outstanding: part((a) => Math.max(0, a.approved - a.recovered)),
    mixed: byCur.size > 1,
    first_date, last_date, by_insurer, by_status, recent,
  }
}

function renderClaimsHtml(s: Schedule, d: ClaimsDigest, appUrl: string, windowLabel = ''): string {
  const genAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const coverage = `${dateShort(d.first_date)} → ${dateShort(d.last_date)}`
  // A rate or an average across currencies would divide unlike amounts, so
  // both are shown only when every claim is in one currency.
  const one = (parts: MoneyPart[]): number | null => (d.mixed ? null : (parts[0]?.amount ?? 0))
  const claimOne = one(d.claim_total)
  const recoveredOne = one(d.recovered_total)
  const recoveryRate = claimOne != null && recoveredOne != null && claimOne > 0 ? Math.round((recoveredOne / claimOne) * 100) : null
  const p = (parts: MoneyPart[]) => fmtMoneyParts(parts, fmtMoney(0, ''))
  const mixedNote = d.mixed ? ' Claims are in more than one currency, so each figure is listed per currency and nothing is added across currencies.' : ''

  const summary = d.total === 0
    ? `No incidents carrying an insurance claim were found for ${windowLabel ? `the requested period (${windowLabel})` : 'this organisation'}. When a claim is opened on an accident record it will appear here automatically.`
    : `<b>${num(d.total)}</b> insurance claim(s) on record — <b>${num(d.open)}</b> open, <b>${num(d.closed)}</b> closed` +
      `${d.delayed ? `, with <b style="color:#b91c1c">${num(d.delayed)}</b> past the expected release date` : ''}. ` +
      `Total claimed <b>${p(d.claim_total)}</b>, approved <b>${p(d.approved_total)}</b>, ` +
      `recovered <b>${p(d.recovered_total)}</b>${recoveryRate != null ? ` (<b>${recoveryRate}%</b> recovery rate)` : ''}. ` +
      `Net exposure after recoveries <b>${p(d.net_exposure)}</b>.${mixedNote}`

  const insurerRows = d.by_insurer.length
    ? d.by_insurer.map((it, i) => `<tr>
        <td style="padding:6px 0;font-size:12.5px;color:#334155"><span style="display:inline-block;width:18px;color:#94a3b8;font-weight:700">${i + 1}.</span>${it.label}</td>
        <td style="padding:6px 0;font-size:12.5px;color:#0f172a;font-weight:700;text-align:right">${money(it.value, it.currency)}</td></tr>`).join('')
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
        <td style="padding:7px 6px;font-size:11.5px;color:#0f172a;text-align:right;border-bottom:1px solid #eef2f7">${money(r.claim, r.currency)}</td>
        <td style="padding:7px 6px;font-size:11.5px;color:#0f172a;text-align:right;border-bottom:1px solid #eef2f7">${money(r.approved, r.currency)}</td>
        <td style="padding:7px 6px;font-size:11.5px;color:#047857;text-align:right;border-bottom:1px solid #eef2f7">${money(r.recovered, r.currency)}</td></tr>`).join('')
    : `<tr><td colspan="7" style="padding:10px 6px;font-size:12px;color:#94a3b8">No claims to list.</td></tr>`

  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:680px;margin:auto;color:#0f172a;background:#fff">
    <div style="background:#312e81;border-radius:12px 12px 0 0;padding:22px 26px;color:#fff">
      <div style="font-size:19px;font-weight:800">TyrePulse — Insurance Claims Summary</div>
      <div style="font-size:12px;color:#c7d2fe;margin-top:3px">
        Schedule “${s.name}” · generated ${genAt} UTC · ${windowLabel ? `requested period ${windowLabel} · ` : ''}incident coverage ${coverage}
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
          ${tile('Net exposure', p(d.net_exposure), 'after recoveries', d.net_exposure.length ? '#b91c1c' : '#0f172a')}
        </tr>

        ${sectionTitle('Financials')}
        <tr>
          ${tile('Total claimed', p(d.claim_total))}
          ${tile('Approved', p(d.approved_total), '', '#047857')}
          ${tile('Recovered', p(d.recovered_total), '', '#047857')}
        </tr>
        <tr>
          ${tile('Deductible exposure', p(d.deductible_total))}
          ${tile('Outstanding vs approved', p(d.outstanding), 'approved not yet recovered', d.outstanding.length ? '#b45309' : '#047857')}
          ${tile('Avg claim', d.total && claimOne != null ? money(Math.round(claimOne / d.total), d.claim_total[0]?.currency ?? '') : 'N/A', d.mixed ? 'not shown across currencies' : '')}
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

/* ── Per-type dataset digest (kpi / fleet / cost / inspection / accidents /
      stock / vendor) ─────────────────────────────────────────────────────────
   Each report type is backed by a DIFFERENT table + focused projection, mirror-
   ing the app's scheduledReports.js DATASETS so the emailed digest matches the
   "Generate now" PDF. Previously every non-claims type fell through to the one
   executive digest, so cost/fleet/kpi/inspection/etc. all emailed identical
   numbers - this gives each its own live, type-specific figures. */

type DatasetDigestCfg = {
  table: string
  dateCol: string
  money: string | null
  accent: string
  groups: Array<[string, string]> // [label, column]
  recent: Array<[string, string]> // [column, header]
  moneyCols: string[]             // recent-table columns rendered as money
  eqFilter?: Record<string, string | boolean> // optional exact-match filters (e.g. status='active')
  nullFilter?: string[]             // columns that must be NULL (e.g. soft-delete deleted_at)
  orderAscending?: boolean          // sort dateCol ascending (forward-looking dates like next_due)
  snapshot?: boolean                // a current-state list: the coverage window is NOT applied
}

const DATASET_DIGEST: Record<string, DatasetDigestCfg> = {
  kpi: {
    table: 'tyre_records', dateCol: 'issue_date', money: 'cost_per_tyre', accent: '#0e7490',
    groups: [['Brand', 'brand'], ['Category', 'category'], ['Risk level', 'risk_level']],
    recent: [['issue_date', 'Date'], ['asset_no', 'Asset'], ['brand', 'Brand'], ['category', 'Category'], ['risk_level', 'Risk'], ['total_km', 'Total KM'], ['cost_per_tyre', 'Cost']],
    moneyCols: ['cost_per_tyre'],
  },
  fleet: {
    table: 'tyre_records', dateCol: 'issue_date', money: null, accent: '#1d4ed8',
    groups: [['Vehicle type', 'vehicle_type'], ['Site', 'site'], ['Status', 'status'], ['Brand', 'brand']],
    recent: [['issue_date', 'Date'], ['asset_no', 'Asset'], ['vehicle_type', 'Vehicle Type'], ['brand', 'Brand'], ['site', 'Site'], ['position', 'Position'], ['status', 'Status'], ['risk_level', 'Risk']],
    moneyCols: [],
  },
  cost: {
    table: 'tyre_records', dateCol: 'issue_date', money: 'cost_per_tyre', accent: '#b45309',
    groups: [['Brand', 'brand'], ['Site', 'site'], ['Category', 'category'], ['Supplier', 'supplier']],
    recent: [['issue_date', 'Date'], ['asset_no', 'Asset'], ['brand', 'Brand'], ['site', 'Site'], ['category', 'Category'], ['supplier', 'Supplier'], ['qty', 'Qty'], ['cost_per_tyre', 'Cost']],
    moneyCols: ['cost_per_tyre'],
  },
  inspection: {
    table: 'inspections', dateCol: 'inspection_date', money: null, accent: '#047857',
    groups: [['Type', 'inspection_type'], ['Site', 'site'], ['Status', 'status'], ['Severity', 'severity']],
    recent: [['inspection_date', 'Date'], ['inspection_type', 'Type'], ['site', 'Site'], ['asset_no', 'Asset'], ['inspector', 'Inspector'], ['status', 'Status'], ['severity', 'Severity'], ['pressure_reading', 'Pressure']],
    moneyCols: [],
  },
  accidents: {
    table: 'accidents', dateCol: 'incident_date', money: 'estimated_damage_cost', accent: '#b91c1c',
    groups: [['Type', 'accident_type'], ['Severity', 'severity'], ['Status', 'status'], ['Site', 'site']],
    recent: [['incident_date', 'Date'], ['site', 'Site'], ['asset_no', 'Asset'], ['accident_type', 'Type'], ['severity', 'Severity'], ['status', 'Status'], ['estimated_damage_cost', 'Est. Damage'], ['claim_amount', 'Claim']],
    moneyCols: ['estimated_damage_cost', 'claim_amount'],
  },
  stock: {
    table: 'goods_receipts', dateCol: 'received_date', money: null, accent: '#7c3aed',
    groups: [['Supplier', 'supplier'], ['Condition', 'condition'], ['Status', 'status'], ['Site', 'site']],
    recent: [['received_date', 'Received'], ['grn_no', 'GRN'], ['po_ref', 'PO Ref'], ['supplier', 'Supplier'], ['item', 'Item'], ['qty_ordered', 'Ordered'], ['qty_received', 'Received'], ['condition', 'Condition'], ['status', 'Status']],
    moneyCols: [],
  },
  vendor: {
    table: 'purchase_orders', dateCol: 'order_date', money: 'total_amount', accent: '#0f766e',
    groups: [['Vendor', 'vendor_name'], ['Status', 'status'], ['Priority', 'priority'], ['Site', 'site']],
    recent: [['order_date', 'Order Date'], ['po_number', 'PO No'], ['vendor_name', 'Vendor'], ['status', 'Status'], ['priority', 'Priority'], ['site', 'Site'], ['total_amount', 'Amount'], ['expected_delivery', 'Expected']],
    moneyCols: ['total_amount'],
  },
  // Preventive Maintenance due / overdue: active PM programs grouped by asset
  // category / site / priority, with the soonest-due plans listed. Only live
  // (active) programs are counted so paused/completed plans never read as due.
  pm: {
    table: 'pm_programs', dateCol: 'next_due', money: 'estimated_cost', accent: '#0e7490',
    groups: [['Asset category', 'asset_category'], ['Site', 'site'], ['Priority', 'priority']],
    recent: [['next_due', 'Next Due'], ['name', 'Program'], ['asset_no', 'Asset'], ['asset_category', 'Category'], ['site', 'Site'], ['priority', 'Priority'], ['status', 'Status'], ['estimated_cost', 'Est. Cost']],
    moneyCols: ['estimated_cost'],
    eqFilter: { status: 'active' },
    orderAscending: true,
  },
  // Workshop summary: job cards grouped by status / work type / site / priority,
  // with the most recent jobs and their total cost. Backs the 'workshop'
  // scheduled report (V298 widened the report_schedules CHECK to allow it).
  workshop: {
    table: 'work_orders', dateCol: 'opened_at', money: 'total_cost', accent: '#4f46e5',
    groups: [['Status', 'status'], ['Work type', 'work_type'], ['Site', 'site'], ['Priority', 'priority']],
    recent: [['opened_at', 'Opened'], ['work_order_no', 'WO No'], ['asset_no', 'Asset'], ['work_type', 'Type'], ['status', 'Status'], ['priority', 'Priority'], ['technician_name', 'Technician'], ['site', 'Site'], ['total_cost', 'Cost']],
    moneyCols: ['total_cost'],
  },
  // Workshop Status (Daily Ops): vehicles currently in the workshop per the
  // latest confirmed daily file plus manual updates. A current-state snapshot
  // (snapshot: true), oldest out-of-service first, never money.
  workshop_status: {
    table: 'workshop_status_records', dateCol: 'ooc_since', money: null, accent: '#4338ca',
    groups: [['Site', 'site'], ['Stage', 'current_stage'], ['Delay reason', 'delay_reason'], ['Parts', 'parts_status']],
    recent: [['ooc_since', 'Out Since'], ['asset_no', 'Asset'], ['site', 'Site'], ['vehicle_category', 'Category'], ['current_stage', 'Stage'], ['delay_reason', 'Delay Reason'], ['parts_status', 'Parts'], ['expected_release_date', 'Expected Release']],
    moneyCols: [],
    eqFilter: { current_active: true },
    nullFilter: ['deleted_at'],
    orderAscending: true,
    snapshot: true,
  },
}

type DatasetDigest = {
  count: number
  // Per-currency parts (each row's currency comes from its own country). Never
  // one number across currencies.
  moneyParts: MoneyPart[]
  anyCountry: boolean
  recent30: number
  first: string | null
  last: string | null
  groups: Array<{ label: string; items: TopItem[] }>
  recent: Record<string, unknown>[]
}

type LowTyreStockRow = {
  site: string
  country: string
  size: string
  brand: string
  description: string
  quantity: number
  unit: string
  minimum: number
  critical: number
  level: 'Critical' | 'Low'
}

function emailText(value: unknown): string {
  const escaped: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }
  return String(value ?? '').replace(/[&<>"']/g, (ch) => escaped[ch] ?? ch)
}

function sizeFromDescription(description: string): string {
  return description.match(/\d{3}\s*\/\s*\d{2}\s*r?\s*\d{2}(?:\.\d)?|\d{2}\.\d{1,2}\s*[-r]\s*\d{2}|\d{4}\s*r\s*\d{2}/i)?.[0] ?? ''
}

/** A service-role read must always have an explicit tenant; page through the
 *  whole tenant inventory so the alert cannot silently miss lines after 1,000. */
// deno-lint-ignore no-explicit-any
async function lowTyreStock(svc: any, orgId: string | null): Promise<LowTyreStockRow[]> {
  if (!orgId) throw new Error('Tyre stock alerts require an organisation-scoped schedule.')
  const columns = 'id,site,country,description,stock_qty,min_level,critical_level,brand,tyre_size,custom_data'
  const rows: Record<string, any>[] = []
  const pageSize = 1000
  for (let from = 0; from < 25_000; from += pageSize) {
    const { data, error } = await svc.from('stock_records').select(columns)
      .eq('organisation_id', orgId).order('id').range(from, from + pageSize - 1)
    if (error) throw new Error(`stock_records query failed: ${error.message}`)
    const page = (data ?? []) as Record<string, any>[]
    rows.push(...page)
    if (page.length < pageSize) break
    if (from + pageSize >= 25_000) throw new Error('This organisation has more than 25,000 stock lines; the tyre alert was stopped to avoid an incomplete email.')
  }
  return rows.flatMap((row) => {
    const meta = row.custom_data?.stock_item ?? {}
    const kind = String(meta.kind ?? '').toLowerCase()
    const description = String(row.description ?? '')
    const size = String(meta.size || row.tyre_size || sizeFromDescription(description)).trim()
    const inferredTyre = Boolean(size) || /\b(tyre|tire)\b/i.test(description)
    if (kind ? kind !== 'tyre' : !inferredTyre) return []
    const quantity = Number(row.stock_qty)
    const minimum = Number(row.min_level)
    const critical = Number(row.critical_level)
    if (!Number.isFinite(quantity) || !Number.isFinite(minimum) || quantity > minimum) return []
    return [{
      site: String(row.site || 'Unassigned'),
      country: String(row.country || 'N/A'),
      size: size || 'Size not recorded',
      brand: String(row.brand || meta.brand || ''),
      description,
      quantity,
      unit: String(meta.unit || 'units'),
      minimum,
      critical: Number.isFinite(critical) ? critical : 0,
      level: quantity <= (Number.isFinite(critical) ? critical : 0) ? 'Critical' as const : 'Low' as const,
    }]
  }).sort((a, b) => (a.level === b.level ? 0 : a.level === 'Critical' ? -1 : 1)
    || a.quantity - b.quantity || a.country.localeCompare(b.country) || a.site.localeCompare(b.site) || a.size.localeCompare(b.size))
}

function renderTyreStockAlert(s: Schedule, rows: LowTyreStockRow[], appUrl: string): string {
  const genAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const bySize = new Map<string, { count: number; quantity: number; gap: number }>()
  for (const row of rows) {
    const agg = bySize.get(row.size) ?? { count: 0, quantity: 0, gap: 0 }
    agg.count++
    agg.quantity += row.quantity
    agg.gap += Math.max(0, row.minimum - row.quantity)
    bySize.set(row.size, agg)
  }
  const sizeRows = [...bySize].sort((a, b) => b[1].count - a[1].count).map(([size, v]) =>
    `<tr><td style="padding:7px;border-bottom:1px solid #eef2f7">${emailText(size)}</td><td style="padding:7px;text-align:right;border-bottom:1px solid #eef2f7">${num(v.count)}</td><td style="padding:7px;text-align:right;border-bottom:1px solid #eef2f7">${num(v.quantity)}</td><td style="padding:7px;text-align:right;border-bottom:1px solid #eef2f7">${num(v.gap)}</td></tr>`).join('')
  const rowsHtml = rows.map((row) => {
    const tone = row.level === 'Critical' ? '#b91c1c' : '#b45309'
    return `<tr><td style="padding:7px;border-bottom:1px solid #eef2f7">${emailText(row.country)}</td><td style="padding:7px;border-bottom:1px solid #eef2f7">${emailText(row.site)}</td><td style="padding:7px;border-bottom:1px solid #eef2f7">${emailText(row.size)}</td><td style="padding:7px;border-bottom:1px solid #eef2f7">${emailText(row.brand || row.description || 'N/A')}</td><td style="padding:7px;text-align:right;border-bottom:1px solid #eef2f7;font-weight:700">${num(row.quantity)} ${emailText(row.unit)}</td><td style="padding:7px;text-align:right;border-bottom:1px solid #eef2f7">${num(row.minimum)} ${emailText(row.unit)}</td><td style="padding:7px;color:${tone};font-weight:800;border-bottom:1px solid #eef2f7">${row.level}</td></tr>`
  }).join('')
  return `<div style="font-family:Arial,sans-serif;max-width:760px;margin:auto;color:#0f172a;background:#fff"><div style="background:#111827;border-radius:12px 12px 0 0;padding:22px 26px;color:#fff"><div style="font-size:19px;font-weight:800">TyrePulse Tyre Low-Stock Alert</div><div style="font-size:12px;color:#d1d5db;margin-top:4px">Schedule: ${emailText(s.name)} | generated ${genAt} UTC</div></div><div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:22px 26px"><div style="background:#fff7ed;border-left:4px solid #f59e0b;border-radius:8px;padding:12px 16px;font-size:14px;line-height:1.6"><b>${num(rows.length)} tyre stock line(s)</b> are at or below their minimum reorder level. Review the listed size and site, then arrange replenishment.</div><h2 style="font-size:13px;margin:20px 0 8px;text-transform:uppercase">Low stock by tyre size</h2><table role="presentation" width="100%" cellspacing="0" style="font-size:12px;border-collapse:collapse"><tr style="background:#f8fafc;font-weight:700"><td style="padding:7px">Tyre size</td><td style="padding:7px;text-align:right">Low lines</td><td style="padding:7px;text-align:right">On hand</td><td style="padding:7px;text-align:right">Below minimum</td></tr>${sizeRows}</table><h2 style="font-size:13px;margin:20px 0 8px;text-transform:uppercase">Items to reorder</h2><div style="overflow-x:auto"><table role="presentation" width="100%" cellspacing="0" style="font-size:11px;border-collapse:collapse"><tr style="background:#f8fafc;font-weight:700"><td style="padding:7px">Country</td><td style="padding:7px">Site</td><td style="padding:7px">Size</td><td style="padding:7px">Brand / item</td><td style="padding:7px;text-align:right">On hand</td><td style="padding:7px;text-align:right">Minimum</td><td style="padding:7px">Level</td></tr>${rowsHtml}</table></div><p style="font-size:11px;color:#64748b;margin-top:16px">An alert is sent only when a tyre stock line is at or below its saved minimum level. Current stock is read from TyrePulse Stock Management.</p><a href="${emailText(appUrl)}" style="display:inline-block;background:#facc15;color:#111827;font-weight:700;font-size:13px;padding:11px 20px;border-radius:8px;text-decoration:none;margin-top:4px">Open Stock Management</a></div></div>`
}

/** Apply the schedule's own eq/org/date-window filters to a query - shared by
 *  the exact head-count and the row-fetching query below so they can never
 *  disagree about which rows are in scope. */
// deno-lint-ignore no-explicit-any
function scopeDatasetQuery(q: any, cfg: DatasetDigestCfg, orgId: string | null, win: { from: string | null; to: string | null }) {
  if (cfg.eqFilter) for (const [col, val] of Object.entries(cfg.eqFilter)) q = q.eq(col, val)
  if (cfg.nullFilter) for (const col of cfg.nullFilter) q = q.is(col, null)
  // Service role bypasses RLS, so scope to the schedule's org explicitly.
  q = q.eq('organisation_id', requireOrg(orgId))
  // The schedule's configured coverage window (see resolvePeriodBounds). Prior
  // to this, every digest read the WHOLE table regardless of the period the
  // owner picked - "Yesterday" or a 3-day custom range would still show
  // all-time data. Missing bounds (custom with no dates set) leave the query
  // unfiltered rather than narrowing it to nothing.
  // A snapshot dataset (vehicles in the workshop RIGHT NOW) is a current-state
  // list: filtering it by the period would drop every vehicle that went out of
  // service before the window started, which is exactly the long-waiting ones.
  if (cfg.snapshot) return q
  if (win.from) q = q.gte(cfg.dateCol, win.from)
  if (win.to)   q = q.lte(cfg.dateCol, win.to)
  return q
}

// deno-lint-ignore no-explicit-any
async function buildDatasetDigest(svc: any, cfg: DatasetDigestCfg, orgId: string | null, win: { from: string | null; to: string | null }, cur: CurrencyContext = { map: {}, fallback: '' }): Promise<DatasetDigest> {
  const cols = new Set<string>([cfg.dateCol])
  if (cfg.money) cols.add(cfg.money)
  // Every table that carries money here also carries `country`; it decides the
  // currency of each row. Tables with no money column are left untouched.
  const hasMoney = !!cfg.money || cfg.moneyCols.length > 0
  if (hasMoney) cols.add('country')
  cfg.groups.forEach(([, c]) => cols.add(c))
  cfg.recent.forEach(([c]) => cols.add(c))
  let q = svc.from(cfg.table).select([...cols].join(','))
    .order(cfg.dateCol, { ascending: cfg.orderAscending === true, nullsFirst: false }).limit(5000)
  q = scopeDatasetQuery(q, cfg, orgId, win)
  const { data, error } = await q
  if (error) throw new Error(`${cfg.table} query failed: ${error.message}`)
  // deno-lint-ignore no-explicit-any
  const rows = (data ?? []) as Record<string, any>[]

  // The TRUE row count for the window, not rows.length - PostgREST caps any
  // single response (including this one's .limit(5000)) at its own configured
  // max rows, so a real count above that ceiling would otherwise silently
  // read as "exactly 1000/whatever-the-cap-is" instead of the honest total.
  let countQ = svc.from(cfg.table).select(cfg.dateCol, { count: 'exact', head: true })
  countQ = scopeDatasetQuery(countQ, cfg, orgId, win)
  const { count: exactCount, error: countErr } = await countQ
  if (countErr) throw new Error(`${cfg.table} count failed: ${countErr.message}`)

  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  let recent30 = 0
  let first: string | null = null, last: string | null = null
  const maps = cfg.groups.map(() => new Map<string, number>())
  const anyCountry = hasMoney && rows.some((r) => String(r.country ?? '').trim() !== '')
  const moneyParts = cfg.money ? sumRowsByCurrency(rows, cfg.money, 'country', cur.map, cur.fallback) : []
  for (const r of rows) {
    const d = r[cfg.dateCol] ? String(r[cfg.dateCol]).slice(0, 10) : null
    if (d) {
      if (!first || d < first) first = d
      if (!last || d > last) last = d
      if (d >= cutoff) recent30++
    }
    cfg.groups.forEach(([, col], i) => {
      const k = (r[col] == null || String(r[col]).trim() === '') ? '(unknown)' : String(r[col])
      maps[i].set(k, (maps[i].get(k) ?? 0) + 1)
    })
  }
  const groups = cfg.groups.map(([label], i) => ({
    label,
    items: [...maps[i].entries()].map(([l, v]) => ({ label: l, value: v })).sort((a, b) => b.value - a.value).slice(0, 6),
  }))
  // rows.length is only ever used as a last-resort fallback if the exact count
  // request itself failed to return a number (should not happen; head counts
  // do not hit the same row-payload cap the data query does).
  return { count: exactCount ?? rows.length, moneyParts, anyCountry, recent30, first, last, groups, recent: rows.slice(0, 12) }
}

function renderDatasetHtml(s: Schedule, cfg: DatasetDigestCfg, d: DatasetDigest, appUrl: string, cur: CurrencyContext, windowLabel: string): string {
  const totalValue = fmtMoneyParts(d.moneyParts, fmtMoney(0, ''))
  const mixed = isMixedCurrency(d.moneyParts)
  const genAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
  // The window the schedule was actually configured for - never inferred from
  // the data alone, or an empty window would print "N/A" instead of naming
  // the period that legitimately found nothing.
  // A snapshot dataset ignores the coverage window entirely, so it must never
  // be labelled with that window: it describes the list as of this send.
  const coverage = cfg.snapshot
    ? `the current snapshot (${genAt} UTC)`
    : (windowLabel || ((d.first || d.last) ? `${dateShort(d.first)} to ${dateShort(d.last)}` : 'N/A'))
  const label = typeLabel(s.report_type)

  const summary = d.count === 0
    ? (cfg.snapshot ? `No ${label.toLowerCase()} records are in ${coverage}.` : `No ${label.toLowerCase()} records were found for ${coverage}. Widen the schedule's coverage period to see more.`)
    : cfg.snapshot
      ? `<b>${num(d.count)}</b> record(s) in ${coverage}. ` +
        `<b>${num(d.recent30)}</b> of those started in the last 30 days.`
      : `<b>${num(d.count)}</b> record(s) in ${coverage}` +
        `${cfg.money ? `, totalling <b>${totalValue}</b>${mixed ? ' (listed per currency, not added together)' : ''}` : ''}. ` +
        `<b>${num(d.recent30)}</b> of those were added in the last 30 days.`

  // Group breakdowns, three columns per row.
  const groupRows: string[] = []
  for (let i = 0; i < d.groups.length; i += 3) {
    const slice = d.groups.slice(i, i + 3)
    const cells = slice.map((g) => topList(g.label, g.items, (n) => num(n))).join('')
    groupRows.push(`<tr>${cells}${'<td></td>'.repeat((3 - slice.length + 3) % 3)}</tr>`)
  }

  const headerCells = cfg.recent.map(([, h]) =>
    `<td style="padding:6px;font-size:10.5px;font-weight:700;color:#64748b;text-transform:uppercase">${h}</td>`).join('')
  const bodyRows = d.recent.length
    ? d.recent.map((r) => `<tr>${cfg.recent.map(([c]) => {
        const raw = (r as Record<string, unknown>)[c]
        const val = cfg.moneyCols.includes(c)
          ? money(n0(raw as number), rowCurrency(r as Record<string, unknown>, 'country', cur.map, cur.fallback, d.anyCountry))
          : (raw == null || String(raw).trim() === '') ? 'N/A'
          : /_date$/.test(c) ? String(raw).slice(0, 10)
          : String(raw)
        return `<td style="padding:7px 6px;font-size:11.5px;color:#334155;border-bottom:1px solid #eef2f7">${val}</td>`
      }).join('')}</tr>`).join('')
    : `<tr><td colspan="${cfg.recent.length}" style="padding:10px 6px;font-size:12px;color:#94a3b8">No records to list.</td></tr>`

  const kpis = [
    tile('Total records', num(d.count)),
    cfg.money ? tile('Total value', totalValue, mixed ? 'per currency, not added' : '') : tile('Added last 30d', num(d.recent30)),
    cfg.money ? tile('Added last 30d', num(d.recent30)) : tile('Coverage', coverage),
  ].join('')

  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:680px;margin:auto;color:#0f172a;background:#fff">
    <div style="background:${cfg.accent};border-radius:12px 12px 0 0;padding:22px 26px;color:#fff">
      <div style="font-size:19px;font-weight:800">TyrePulse ${label}</div>
      <div style="font-size:12px;color:#e2e8f0;margin-top:3px">Schedule "${s.name}" | generated ${genAt} UTC | coverage ${coverage}</div>
    </div>
    <div style="border:1px solid #e2e8f0;border-top:0;border-radius:0 0 12px 12px;padding:22px 26px">
      <div style="background:#f1f5f9;border-left:4px solid ${cfg.accent};border-radius:8px;padding:12px 16px;font-size:13px;color:#334155;line-height:1.6">${summary}</div>
      <table role="presentation" width="100%" cellspacing="8" style="margin-top:6px">
        ${sectionTitle(`${label} overview`)}
        <tr>${kpis}</tr>
        ${sectionTitle('Breakdown')}
        ${groupRows.join('')}
      </table>
      <div style="margin-top:18px;font-size:13px;font-weight:800;color:#0f172a;text-transform:uppercase;letter-spacing:.6px;border-bottom:2px solid ${cfg.accent};padding-bottom:8px">Recent records</div>
      <table role="presentation" width="100%" cellspacing="0" style="margin-top:8px">
        <tr style="background:#f8fafc">${headerCells}</tr>
        ${bodyRows}
      </table>
      <p style="font-size:12px;color:#475569;line-height:1.6;margin-top:16px">All figures are live from your ${label.toLowerCase()} data. N/A means the value was not captured and is never estimated.</p>
      <a href="${appUrl}" style="display:inline-block;background:${cfg.accent};color:#fff;font-weight:700;font-size:13px;padding:11px 20px;border-radius:8px;text-decoration:none;margin-top:4px">Open TyrePulse</a>
      <p style="font-size:11px;color:#94a3b8;margin-top:18px">You receive this because you are a recipient of the "${s.name}" schedule. Manage recipients and frequency in TyrePulse, Scheduled Reports.</p>
    </div>
  </div>`
}

/** Render the correct digest e-mail for one schedule. Each report type gets its
 *  own focused digest: claims -> claims desk; executive -> full exec intel;
 *  kpi/fleet/cost/inspection/accidents/stock/vendor -> their own dataset digest,
 *  scoped to the schedule's own coverage period; builder:<id> custom layouts ->
 *  the accident dataset digest, same scoping.
 *
 *  The claims digest is scoped to the schedule's window on accidents.incident_date
 *  and names the requested period in its header. The executive digest reads the
 *  report_exec_digest RPC (all-time + trailing 30 days) and is NOT narrowed by
 *  the period; its header says so, so a reader never mistakes it for a
 *  period-scoped figure. The fallback branch (unknown report type) keeps the
 *  old header with no window claim. */
// deno-lint-ignore no-explicit-any
async function renderForSchedule(svc: any, s: Schedule, appUrl: string, cur: CurrencyContext): Promise<{ subject: string; html: string; shouldSend?: boolean }> {
  const type = s.report_type ?? ''
  const win = resolvePeriodBounds(s, new Date())
  let html: string
  if (type === 'tyre_stock_alert') {
    const rows = await lowTyreStock(svc, s.org_id)
    const subject = asciiSafe(`TyrePulse Tyre Low-Stock Alert: ${s.name}`)
    if (!rows.length) return { subject, html: '', shouldSend: false }
    return { subject, html: asciiSafe(renderTyreStockAlert(s, rows, `${appUrl.replace(/\/+$/, '')}/stock`)), shouldSend: true }
  } else if (type === 'claims') {
    html = renderClaimsHtml(s, await buildClaimsDigest(svc, s.org_id, win, cur), appUrl, win.label)
  } else if (type === 'executive') {
    const d = await buildDigest(svc, s.org_id)
    html = renderHtml(s, d, appUrl, await buildExecMoney(svc, s.org_id, d, cur), win.label)
  } else if (type.startsWith('builder:')) {
    const cfg = DATASET_DIGEST.accidents
    html = renderDatasetHtml(s, cfg, await buildDatasetDigest(svc, cfg, s.org_id, win, cur), appUrl, cur, win.label)
  } else if (DATASET_DIGEST[type]) {
    const cfg = DATASET_DIGEST[type]
    html = renderDatasetHtml(s, cfg, await buildDatasetDigest(svc, cfg, s.org_id, win, cur), appUrl, cur, win.label)
  } else {
    const d = await buildDigest(svc, s.org_id)
    html = renderHtml(s, d, appUrl, await buildExecMoney(svc, s.org_id, d, cur))
  }
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

/** Country to currency lookup (country_currency table) plus the system default
 *  that applies ONLY to rows of an organisation that records no country at all.
 *  Best-effort: a failed read yields an empty map, which renders amounts with
 *  no currency code rather than a wrong one. */
// deno-lint-ignore no-explicit-any
async function loadCurrencyContext(svc: any): Promise<CurrencyContext> {
  let map: CurrencyMap = {}
  try {
    const { data } = await svc.from('country_currency').select('country,currency')
    map = buildCurrencyMap(data ?? [])
  } catch { /* empty map: amounts print without a code */ }
  return { map, fallback: await systemCurrency(svc) }
}

const SCHEDULE_COLS = 'id,name,report_type,frequency,day_of_week,day_of_month,time_of_day,recipients,last_sent_at,next_run_at,org_id,period,period_from,period_to'

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
  // Fail closed: a NULL / missing approval must not pass (same rule as _shared/auth.ts).
  if (!profile || profile.approved !== true || profile.locked === true) {
    return jsonResponse(req, { error: 'Account is not approved for this action' }, 403)
  }
  const role = String(profile.role ?? '').trim().toLowerCase().replace(/\s+/g, '_')
  if (!['admin', 'manager', 'director'].includes(role)) {
    return jsonResponse(req, { error: 'Insufficient role for this action' }, 403)
  }

  // RLS-scoped read: invisible schedules 404 rather than leak.
  const { data: s, error: schedErr } = await userClient
    .from('report_schedules').select(SCHEDULE_COLS).eq('id', scheduleId).maybeSingle()
  if (schedErr) {
    console.error('send-now: schedule read failed', schedErr)
    return jsonResponse(req, { error: 'Could not load this schedule.' }, 500)
  }
  if (!s) return jsonResponse(req, { error: 'Schedule not found' }, 404)
  if (!s.org_id) return jsonResponse(req, { error: NO_ORG_MESSAGE }, 422)

  // Cooldown: refuse when this schedule was sent, or a send was attempted, inside
  // the window. report_send_log records both outcomes, so a failing schedule
  // cannot be hammered either. Fails CLOSED when the log cannot be read.
  {
    const windowStart = new Date(Date.now() - SEND_NOW_COOLDOWN_SECONDS * 1000)
    const { data: recent, error: recentErr } = await svc
      .from('report_send_log').select('sent_at')
      .eq('schedule_id', s.id).gte('sent_at', windowStart.toISOString())
      .order('sent_at', { ascending: false }).limit(1)
    if (recentErr) {
      console.error('send-now: cooldown read failed', recentErr)
      return jsonResponse(req, { error: 'The report could not be sent right now. Please try again shortly.' }, 503)
    }
    const lastLog = recent?.[0]?.sent_at ? new Date(recent[0].sent_at).getTime() : 0
    const lastSent = s.last_sent_at ? new Date(s.last_sent_at).getTime() : 0
    const last = Math.max(lastLog || 0, lastSent || 0)
    const waitMs = last + SEND_NOW_COOLDOWN_SECONDS * 1000 - Date.now()
    if (last > 0 && waitMs > 0) {
      const retryAfter = Math.max(1, Math.ceil(waitMs / 1000))
      return jsonResponse(
        req,
        { error: 'This report was sent a moment ago. Please wait a few minutes before sending it again.', retry_after_seconds: retryAfter },
        429,
        { 'Retry-After': String(retryAfter) },
      )
    }
  }

  const recipients = ((s.recipients ?? []) as string[]).filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r))
  if (!recipients.length) return jsonResponse(req, { error: 'No valid recipients on the schedule' }, 400)
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  if (!RESEND_API_KEY) return jsonResponse(req, { error: 'E-mail provider is not configured' }, 500)
  const APP_URL = Deno.env.get('APP_URL') || 'https://tyrepulse.app'
  const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'reports@tyrepulse.app'

  const now = new Date()
  try {
    const rendered = await renderForSchedule(svc, s as Schedule, APP_URL, await loadCurrencyContext(svc))
    if (rendered.shouldSend === false) {
      await svc.from('report_schedules').update({ last_status: 'no_alert', last_error: null, updated_at: now.toISOString() }).eq('id', s.id)
      return jsonResponse(req, { sent: false, skipped: true, recipients: 0, reason: 'No tyre stock is at or below its minimum level.' })
    }
    const { subject, html } = rendered
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: recipients, subject, html }),
    })
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`)

    await svc.from('report_schedules')
      .update({ last_sent_at: now.toISOString(), last_status: 'sent', last_error: null, updated_at: now.toISOString() })
      .eq('id', s.id)
    await svc.from('report_send_log').insert({
      schedule_id: s.id, schedule_name: `${s.name} (send now)`, report_type: s.report_type,
      recipients, status: 'sent',
    })
    return jsonResponse(req, { sent: true, recipients: recipients.length })
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300)
    console.error('send-now: report send failed', e)
    await svc.from('report_schedules').update({ last_status: 'failed', last_error: msg, updated_at: now.toISOString() }).eq('id', s.id)
    await svc.from('report_send_log').insert({
      schedule_id: s.id, schedule_name: `${s.name} (send now)`, report_type: s.report_type,
      recipients, status: 'failed', error: msg,
    })
    // The full reason (which can name tables and query failures) stays in the
    // admin-only delivery log; the caller gets a clean sentence.
    return jsonResponse(req, { error: 'The report could not be sent. The reason is recorded in the delivery history.' }, 502)
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
  if (!cfg?.value || !constantTimeEqual(given, String(cfg.value))) {
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
    console.error('cron: due schedules read failed', dueErr)
    return new Response(JSON.stringify({ error: 'Could not load due schedules.' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'reports@tyrepulse.app'
  const APP_URL = Deno.env.get('APP_URL') || 'https://tyrepulse.app'

  // Country to currency lookup (best-effort; never blocks a send).
  const currency = await loadCurrencyContext(svc)

  let sent = 0
  let failed = 0
  let skipped = 0
  let first = true

  for (const s of (due ?? []) as Schedule[]) {
    const recipients = (s.recipients ?? []).filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r))
    try {
      // A schedule with no organisation is never sent (it would be a digest across
      // every organisation). It lands in the failed branch below: logged, marked
      // failed with the reason, and backed off for an hour.
      requireOrg(s.org_id)
      if (!recipients.length) throw new Error('No valid recipients on the schedule')
      if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured for edge functions')

      // Resend allows 2 requests/second — pace consecutive sends so a batch of
      // due schedules never trips the 429 rate limit (observed 2026-07-11).
      if (!first) await sleep(650)
      first = false

      // Insurance Claims Summary + custom Report Builder layouts get the
      // claims-desk digest; every other type the executive digest.
      const rendered = await renderForSchedule(svc, s, APP_URL, currency)
      if (rendered.shouldSend === false) {
        await svc.from('report_schedules')
          .update({ last_status: 'no_alert', last_error: null, next_run_at: computeNextRun(s, now), updated_at: now.toISOString() })
          .eq('id', s.id)
        skipped++
        continue
      }
      const { subject, html } = rendered
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM_EMAIL, to: recipients, subject, html }),
      })
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`)

      await svc.from('report_schedules')
        .update({ last_sent_at: now.toISOString(), last_status: 'sent', last_error: null, next_run_at: computeNextRun(s, now), updated_at: now.toISOString() })
        .eq('id', s.id)
      await svc.from('report_send_log').insert({
        schedule_id: s.id, schedule_name: s.name, report_type: s.report_type,
        recipients, status: 'sent',
      })
      sent++
    } catch (e) {
      // back off one hour so a broken schedule doesn't retry every 15 minutes
      const errMsg = String((e as Error)?.message ?? e).slice(0, 500)
      await svc.from('report_schedules')
        .update({ last_status: 'failed', last_error: errMsg, next_run_at: new Date(now.getTime() + 3_600_000).toISOString(), updated_at: now.toISOString() })
        .eq('id', s.id)
      await svc.from('report_send_log').insert({
        schedule_id: s.id, schedule_name: s.name, report_type: s.report_type,
        recipients, status: 'failed', error: errMsg,
      })
      failed++
    }
  }

  return new Response(JSON.stringify({ processed: (due ?? []).length, sent, failed, skipped }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
