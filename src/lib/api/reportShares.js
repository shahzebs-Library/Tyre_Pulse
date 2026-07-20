/**
 * reportShares - shareable public/TV report links (V251/V252).
 *
 * Mirrors displayTokens.js: elevated users mint / list / revoke share tokens;
 * the PUBLIC TV viewer reads an org-scoped aggregate snapshot by token via a
 * SECURITY DEFINER RPC that any (even anonymous) client may call. No table is
 * ever exposed to anon; the org is embedded in the token row so nothing leaks.
 */
import { supabase } from '../supabase'

// The report "pages" a share can rotate through (choose any). This is the SINGLE
// catalog of public TV / kiosk report views: the admin panel renders it as the
// page picker and the public viewer (ReportShare.jsx) renders whatever a share
// lists. To add a rotatable page: add an entry here + a render branch in the
// viewer. Every page below is built from the get_report_snapshot aggregate, so
// no schema change is needed to add one within that data.
export const REPORT_PAGES = [
  { key: 'exec_summary',   group: 'Overview',   label: 'Executive Summary', desc: 'One screen board room view: headline KPIs, the spend vs accidents trend, recovery and open-accident gauges, and the severity mix.' },
  { key: 'board_kpis',     group: 'Overview',   label: 'KPIs',            desc: 'Headline KPIs across every module.' },
  { key: 'fleet_overview', group: 'Overview',   label: 'Fleet Overview',  desc: 'Fleet and tyre volumes, inspections and open work orders, tyres by site.' },
  { key: 'board_trends',   group: 'Trends',     label: 'Trends',          desc: '12-month spend, accidents, claims and inspection trend lines.' },
  { key: 'spend_trend',    group: 'Trends',     label: 'Spend Trend',     desc: 'Tyre spend against accidents, with the monthly spend focus.' },
  { key: 'cost_claims',    group: 'Trends',     label: 'Cost & Claims',   desc: 'Finance board: tyre spend and claims KPIs, claimed vs recovered trend, recovery rate and the claim status mix.' },
  { key: 'cost_unit',      group: 'Trends',     label: 'Cost per Unit',   desc: 'Unit-aware operating cost: cost per km, engine hour and m3, tyre CPK, total tyre and maintenance cost, and the monthly cost vs production trend.' },
  { key: 'ops_command',    group: 'Operations', label: 'Operations Command', desc: 'Command board: today activity, work-order status and type mix, PM compliance gauge, work-order trend and a site x status heatmap.' },
  { key: 'risk_activity',  group: 'Risk',       label: 'Risk & Activity', desc: 'Accidents, severity mix and incident sites.' },
  { key: 'claims_desk',    group: 'Risk',       label: 'Claims Desk',     desc: 'Claimed against recovered value and the claim status mix.' },
  { key: 'board_charts',   group: 'Breakdowns', label: 'Breakdowns',      desc: 'Severity, claim status and by-site breakdown charts.' },
  { key: 'ops_today',      group: 'Operations', label: 'Open Job Cards',  desc: 'Live open job cards plus today activity: job cards, tyre changes, inspections, accidents.' },
  { key: 'pm_due',         group: 'Operations', label: 'Maintenance Due', desc: 'Overdue and upcoming preventive-maintenance plans.' },
]
// Ordered list of the group labels, for a grouped picker UI.
export const PAGE_GROUPS = REPORT_PAGES.reduce((acc, p) => {
  if (!acc.includes(p.group)) acc.push(p.group)
  return acc
}, [])
export const DEFAULT_PAGES = REPORT_PAGES.map((p) => p.key)

/** Missing-relation guard so the UI degrades gracefully before the migration. */
function isBackendMissing(err) {
  const m = String(err?.message || err?.code || '').toLowerCase()
  return m.includes('does not exist') || m.includes('could not find') || m.includes('schema cache') || m === '42p01' || m === 'pgrst202'
}

const COLS = 'id, name, token, pages, layout, rotate_seconds, refresh_seconds, active, expires_at, created_at, last_viewed_at, view_count'

/** List this org's report shares (elevated RLS). [] when not provisioned. */
export async function listReportShares() {
  const { data, error } = await supabase
    .from('report_shares').select(COLS).eq('active', true).order('created_at', { ascending: false })
  if (error) { if (isBackendMissing(error)) return []; throw error }
  return data ?? []
}

/**
 * Mint a share. Returns { id, token } - the plaintext token is shown ONCE.
 * @param {{name:string, pages?:string[], rotate?:number, refresh?:number, password?:string, expires?:string}} o
 */
export async function createReportShare(o = {}) {
  const { data, error } = await supabase.rpc('create_report_share', {
    p_name: o.name || 'Shared report',
    p_pages: (o.pages && o.pages.length) ? o.pages : DEFAULT_PAGES,
    p_rotate: o.rotate ?? 30,
    p_refresh: o.refresh ?? 300,
    p_password: o.password || null,
    p_expires: o.expires || null,
  })
  if (error) throw error
  return data
}

/** Revoke (deactivate) a share by id. */
export async function revokeReportShare(id) {
  const { error } = await supabase.rpc('revoke_report_share', { p_id: id })
  if (error) throw error
}

/**
 * Edit an existing share in place (keeps the SAME link/token). Reconfigures the
 * rotating page set, name and timing without minting a new URL. RLS restricts
 * this to elevated own-org users (report_shares_update policy); rotate/refresh
 * are clamped here and re-validated by the table CHECK constraints.
 * @param {string} id
 * @param {{name?:string, pages?:string[], rotate?:number, refresh?:number,
 *          layout?:object|null}} patch layout = a custom board design (V264);
 *          pass null to clear it (revert to the fixed page catalog).
 */
export async function updateReportShare(id, patch = {}) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v)))
  const row = {}
  if (patch.name != null) row.name = String(patch.name).trim() || 'Shared report'
  if (Array.isArray(patch.pages)) row.pages = patch.pages
  if (patch.rotate != null && Number.isFinite(Number(patch.rotate))) row.rotate_seconds = clamp(patch.rotate, 5, 600)
  if (patch.refresh != null && Number.isFinite(Number(patch.refresh))) row.refresh_seconds = clamp(patch.refresh, 30, 3600)
  if ('layout' in patch) row.layout = patch.layout ?? null
  if (Object.keys(row).length === 0) return
  const { error } = await supabase.from('report_shares').update(row).eq('id', id)
  if (error) throw error
}

/**
 * PUBLIC read: aggregate snapshot for a share token (callable by anon).
 *
 * @param {string} token         share token from the URL
 * @param {string|null} password optional viewer password
 * @param {{site?:string, country?:string, from?:string, to?:string}} opts server-side
 *   filters. site / country (V262); from / to = an inclusive reporting-period date
 *   window (V263, YYYY-MM-DD) applied to the event-dated aggregates. Empty / omitted
 *   values mean "all" and are sent as null.
 */
export async function getReportSnapshot(token, password = null, opts = {}) {
  const { data, error } = await supabase.rpc('get_report_snapshot', {
    p_token: token,
    p_password: password,
    p_site: opts.site || null,
    p_country: opts.country || null,
    p_from: opts.from || null,
    p_to: opts.to || null,
  })
  if (error) { if (isBackendMissing(error)) return { ok: false, reason: 'unavailable' }; throw error }
  return data || { ok: false, reason: 'invalid' }
}

/** Absolute public share URL for a token. */
export function buildShareUrl(token) {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `${base}/report/${token}`
}

// ── Workshop live TV board (V293) ─────────────────────────────────────────────
// Reuses the SAME report_shares token infrastructure (token + bcrypt password +
// expiry + active/revoke + rotate/refresh + view_count). A workshop board is a
// report_shares row tagged with pages = ['workshop_live']; its anon viewer reads
// PII-free org-scoped workshop aggregates via the get_workshop_snapshot RPC.

/** The single page key that tags a share as a workshop live TV board. */
export const WORKSHOP_PAGE = 'workshop_live'

/**
 * PUBLIC read: workshop aggregate snapshot for a share token (callable by anon).
 * Returns { ok, company, generated_at, rotate_seconds, refresh_seconds, kpis,
 * jobs_by_status, open_job_cards, vor_list, safety_alerts } or { ok:false, reason }.
 * Degrades to an "unavailable" reason before the migration is applied.
 * @param {string} token
 * @param {string|null} password
 */
export async function getWorkshopSnapshot(token, password = null) {
  const { data, error } = await supabase.rpc('get_workshop_snapshot', {
    p_token: token,
    p_password: password,
  })
  if (error) { if (isBackendMissing(error)) return { ok: false, reason: 'unavailable' }; throw error }
  return data || { ok: false, reason: 'invalid' }
}

/**
 * Mint a workshop TV board share. Reuses create_report_share with pages fixed to
 * ['workshop_live'] so the row is tagged as a workshop board. Returns { id, token }
 * (the plaintext token is shown ONCE).
 * @param {{name?:string, password?:string, expires?:string, rotate?:number, refresh?:number}} o
 */
export async function createWorkshopShare(o = {}) {
  const { data, error } = await supabase.rpc('create_report_share', {
    p_name: o.name || 'Workshop live board',
    p_pages: [WORKSHOP_PAGE],
    p_rotate: o.rotate ?? 30,
    p_refresh: o.refresh ?? 60,
    p_password: o.password || null,
    p_expires: o.expires || null,
  })
  if (error) throw error
  return data
}

/** Absolute public workshop TV URL for a token. */
export function buildWorkshopTvUrl(token) {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `${base}/workshop-tv/${token}`
}
