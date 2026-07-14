/**
 * Accident Report catalog — the single source of truth for the block-based
 * Accident Report Builder (charts, KPIs, table columns, block types, starter
 * and pre-built library layouts).
 *
 * Pure data + functions only (no React) so the same catalog powers:
 *   1. the WYSIWYG builder tab in Accidents (live preview),
 *   2. the headless PDF renderer (accidentReportPdf.js) used by the builder's
 *      export AND by Scheduled Reports when a saved layout is generated, and
 *   3. tests.
 *
 * All chart/KPI/insight values are computed from the live accident record set —
 * nothing is fabricated; empty data degrades to honest empty states.
 */
import { analyzeClaims } from './claimsAnalytics'

// ── WYSIWYG paper theme (dark-on-white so on-screen preview == exported PDF) ──
export const PAPER = { ink: '#0f172a', muted: '#475569', grid: 'rgba(15,23,42,0.08)' }
export const PALETTE = ['#ea580c', '#2563eb', '#16a34a', '#9333ea', '#dc2626', '#ca8a04', '#0891b2', '#64748b', '#db2777', '#4f46e5']

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function last12() {
  const out = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) }
  return out
}
const mKey = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const mLabel = (k) => { const [y, m] = k.split('-'); return `${MONTHS[(+m) - 1]} ${y.slice(2)}` }
const N = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
export const canonSev = (s) => { const v = String(s || '').toLowerCase(); if (v.includes('total')) return 'Total Loss'; if (v.startsWith('maj')) return 'Major'; if (v.startsWith('min')) return 'Minor'; return s || 'Unspecified' }

export function buildReportContext(records, currency = 'SAR') {
  return { records: records || [], claims: analyzeClaims(records || []), currency }
}

// ── Chart catalog: key → { label, description, kind, build(ctx) → chartjs data } ──
export const CHARTS = {
  severity: { label: 'Severity distribution', description: 'Minor / Major / Total-loss mix', kind: 'doughnut', build: ({ records }) => byCount(records, (r) => canonSev(r.severity), { Minor: '#64748b', Major: '#ea580c', 'Total Loss': '#dc2626' }) },
  status: { label: 'Status distribution', description: 'Incident workflow status mix', kind: 'doughnut', build: ({ records }) => byCount(records, (r) => r.status || 'Reported') },
  fault: {
    label: 'Fault status (GCC)', description: 'Faulty vs non-faulty vs under review', kind: 'doughnut', build: ({ records }) => {
      const c = { Faulty: 0, 'Non-faulty': 0, 'Under review': 0, Unknown: 0 }
      records.forEach((r) => { const f = String(r.fault_status || '').toLowerCase(); if (/non[-\s]?fault/.test(f)) c['Non-faulty']++; else if (/review/.test(f)) c['Under review']++; else if (/fault/.test(f)) c.Faulty++; else c.Unknown++ })
      return doughnut(c, { Faulty: '#dc2626', 'Non-faulty': '#16a34a', 'Under review': '#ca8a04', Unknown: '#cbd5e1' })
    },
  },
  liability: {
    label: 'GCC liability split', description: '0% / 50% / 100% liability shares', kind: 'doughnut', build: ({ claims }) => {
      const l = claims.liability
      return { labels: ['0% not liable', '50% shared', '100% at fault', 'Unknown'], datasets: [{ data: [l[0].count, l[50].count, l[100].count, l.unknown.count], backgroundColor: ['#16a34a', '#ca8a04', '#dc2626', '#cbd5e1'], borderWidth: 0 }] }
    },
  },
  trend: {
    label: 'Incident trend (12 mo)', description: 'Monthly incident count, last 12 months', kind: 'line', build: ({ records }) => {
      const keys = last12(); const t = Object.fromEntries(keys.map((k) => [k, 0]))
      records.forEach((r) => { const k = mKey(r.incident_date); if (k && t[k] != null) t[k]++ })
      return { labels: keys.map(mLabel), datasets: [{ label: 'Incidents', data: keys.map((k) => t[k]), borderColor: '#ea580c', backgroundColor: 'rgba(234,88,12,0.18)', fill: true }] }
    },
  },
  topAssets: { label: 'Top assets by incidents', description: 'Most incident-prone vehicles', kind: 'bar-h', build: ({ records }) => rank(records, (r) => r.asset_no, 6, '#ea580c') },
  bySite: { label: 'Incidents by site', description: 'Site / branch comparison', kind: 'bar-h', build: ({ records }) => rank(records, (r) => r.site, 8, '#2563eb') },
  sevMonthly: {
    label: 'Monthly severity (12 mo)', description: 'Stacked severity mix by month', kind: 'bar-stack', build: ({ records }) => {
      const keys = last12(); const sev = ['Minor', 'Major', 'Total Loss']; const map = {}
      sev.forEach((s) => { map[s] = Object.fromEntries(keys.map((k) => [k, 0])) })
      records.forEach((r) => { const k = mKey(r.incident_date); const s = canonSev(r.severity); if (k && map[s] && map[s][k] != null) map[s][k]++ })
      const col = { Minor: '#94a3b8', Major: '#ea580c', 'Total Loss': '#dc2626' }
      return { labels: keys.map(mLabel), datasets: sev.map((s) => ({ label: s, data: keys.map((k) => map[s][k]), backgroundColor: col[s] })) }
    },
  },
  claimStatus: {
    label: 'Claim status', description: 'Insurance claim status mix', kind: 'doughnut', build: ({ claims }) => {
      const e = claims.byStatus
      return { labels: e.map((x) => x.label), datasets: [{ data: e.map((x) => x.count), backgroundColor: e.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 0 }] }
    },
  },
  insurerValue: {
    label: 'Claim value by insurer', description: 'Claimed value ranked by insurer', kind: 'bar-h', build: ({ claims, currency }) => {
      const e = claims.byInsurer
      return { labels: e.map((x) => x.label), datasets: [{ label: `Value (${currency})`, data: e.map((x) => Math.round(x.value)), backgroundColor: '#4f46e5', borderRadius: 3 }] }
    },
  },
  recovery: {
    label: 'Recovery funnel', description: 'Claimed → approved → recovered', kind: 'bar', build: ({ claims }) => ({ labels: ['Claimed', 'Approved', 'Recovered'], datasets: [{ data: [Math.round(claims.claimed), Math.round(claims.approved), Math.round(claims.recovered)], backgroundColor: ['#2563eb', '#9333ea', '#16a34a'], borderRadius: 3 }] }),
  },
  aging: {
    label: 'Open-claim ageing', description: 'Open claims by days outstanding', kind: 'bar', build: ({ claims }) => ({ labels: ['0–30d', '31–60d', '61–90d', '90+d'], datasets: [{ data: [claims.aging['0-30'].count, claims.aging['31-60'].count, claims.aging['61-90'].count, claims.aging['90+'].count], backgroundColor: ['#16a34a', '#ca8a04', '#fb923c', '#dc2626'], borderRadius: 3 }] }),
  },
  caseAge: {
    label: 'Open cases by days open', description: 'Open incidents bucketed by days since the accident (Days Open)', kind: 'bar', build: ({ records }) => {
      const buckets = { '0–15d': 0, '16–30d': 0, '31–60d': 0, '60+d': 0 }
      records.filter((r) => !isClosedRow(r)).forEach((r) => {
        const d = caseAgeDays(r)
        if (d == null) return
        if (d <= 15) buckets['0–15d']++
        else if (d <= 30) buckets['16–30d']++
        else if (d <= 60) buckets['31–60d']++
        else buckets['60+d']++
      })
      return { labels: Object.keys(buckets), datasets: [{ data: Object.values(buckets), backgroundColor: ['#16a34a', '#ca8a04', '#fb923c', '#dc2626'], borderRadius: 3 }] }
    },
  },
}

function byCount(records, keyFn, colorMap) {
  const c = {}; records.forEach((r) => { const k = keyFn(r) || 'Unspecified'; c[k] = (c[k] || 0) + 1 })
  return doughnut(c, colorMap)
}
function doughnut(counts, colorMap) {
  const entries = Object.entries(counts).filter(([, v]) => v > 0)
  return { labels: entries.map(([k]) => k), datasets: [{ data: entries.map(([, v]) => v), backgroundColor: entries.map(([k], i) => (colorMap && colorMap[k]) || PALETTE[i % PALETTE.length]), borderWidth: 0 }] }
}
function rank(records, keyFn, n, color) {
  const c = {}; records.forEach((r) => { const k = keyFn(r); if (k) c[k] = (c[k] || 0) + 1 })
  const sorted = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n)
  return { labels: sorted.map(([k]) => k), datasets: [{ label: 'Incidents', data: sorted.map(([, v]) => v), backgroundColor: color, borderRadius: 3 }] }
}

// Chart.js option sets per chart kind (paper theme) — shared by the live
// preview (react-chartjs-2) and the headless offscreen renderer so the export
// always matches the screen.
const AXIS = { ticks: { color: PAPER.muted, font: { size: 11 } }, grid: { color: PAPER.grid } }
const OPT_BASE = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: AXIS, y: { ...AXIS, beginAtZero: true } } }
export const CHART_OPTS = {
  bar: OPT_BASE,
  'bar-h': { ...OPT_BASE, indexAxis: 'y' },
  'bar-stack': { ...OPT_BASE, plugins: { legend: { display: true, labels: { color: PAPER.muted, font: { size: 10 } } }, tooltip: { enabled: false } }, scales: { x: { ...AXIS, stacked: true }, y: { ...AXIS, stacked: true } } },
  doughnut: { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'right', labels: { color: PAPER.ink, boxWidth: 12, padding: 10, font: { size: 11 } } }, tooltip: { enabled: false } } },
  line: { ...OPT_BASE, elements: { line: { tension: 0.35 }, point: { radius: 2 } } },
}
export const CHART_JS_TYPE = { doughnut: 'doughnut', line: 'line', bar: 'bar', 'bar-h': 'bar', 'bar-stack': 'bar' }

export function isChartEmpty(data) {
  return !data?.labels?.length || (data.datasets || []).every((ds) => (ds.data || []).every((v) => !v))
}

// ── KPI catalog ───────────────────────────────────────────────────────────────
export const KPIS = {
  total: { label: 'Total incidents', get: ({ records }) => records.length },
  open: { label: 'Open', get: ({ records }) => records.filter((r) => !isClosedRow(r)).length },
  closed: { label: 'Closed', get: ({ records }) => records.filter(isClosedRow).length },
  repairCost: { label: 'Repair cost', money: true, get: ({ records }) => records.reduce((s, r) => s + N(r.repair_cost) + N(r.parts_cost), 0) },
  claimed: { label: 'Total claimed', money: true, get: ({ claims }) => claims.claimed },
  approved: { label: 'Approved', money: true, get: ({ claims }) => claims.approved },
  recovered: { label: 'Recovered', money: true, get: ({ claims }) => claims.recovered },
  netExposure: { label: 'Net exposure', money: true, get: ({ claims }) => claims.netExposure },
  recoveryRate: { label: 'Recovery rate', get: ({ claims }) => (claims.recoveryRate == null ? '—' : `${claims.recoveryRate}%`) },
  delayed: { label: 'Delayed claims', get: ({ claims }) => claims.delayed },
  deductible: { label: 'Deductible', money: true, get: ({ claims }) => claims.deductible },
  claimsCount: { label: 'Claims', get: ({ claims }) => claims.total },
  avgDaysOpen: { label: 'Avg days open', get: ({ records }) => avgDays(records, (r) => !isClosedRow(r)) },
  avgCaseDuration: { label: 'Avg case duration', get: ({ records }) => avgDays(records, isClosedRow) },
}
export function isClosedRow(r) {
  if (r.release_date) return true
  const b = `${r.status || ''} ${r.closure_status || ''} ${r.claim_status || ''}`.toLowerCase()
  return /clos|settl|paid|recovered|complete|resolved/.test(b)
}

/** Whole days a case has been running: incident_date → release_date when closed,
 *  otherwise → now. null when incident_date is missing/invalid — never fabricated.
 *  Same semantics as the Accidents page "Days Open" column. */
export function caseAgeDays(r, now = Date.now()) {
  if (!r?.incident_date) return null
  const start = new Date(r.incident_date)
  if (isNaN(start)) return null
  let end = new Date(now)
  if (isClosedRow(r) && r.release_date) {
    const rel = new Date(r.release_date)
    if (!isNaN(rel)) end = rel
  }
  return Math.max(0, Math.floor((end - start) / 86400000))
}

function avgDays(records, filterFn) {
  const vals = records.filter(filterFn).map((r) => caseAgeDays(r)).filter((v) => v != null)
  return vals.length ? `${Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)}d` : '—'
}

// ── Detail-table columns ──────────────────────────────────────────────────────
export const TABLE_COLS = {
  incident_date: 'Date', asset_no: 'Asset', site: 'Site', driver_name: 'Driver',
  severity: 'Severity', status: 'Status', fault_status: 'Fault', gcc_liability_ratio: 'GCC %',
  insurer: 'Insurer', claim_amount: 'Claimed', claim_approved_amount: 'Approved',
  recovered_amount: 'Recovered', repair_cost: 'Repair', expected_release_date: 'Expected release',
  days_open: 'Days Open',
}

/** Resolve a table cell — supports VIRTUAL computed columns (days_open) on top
 *  of plain record fields. Table renderers (preview + PDF) must use this
 *  instead of reading r[col] directly. */
export function cellValue(col, r, now = Date.now()) {
  if (col === 'days_open') return caseAgeDays(r, now)
  return r[col]
}

export function fmtCell(col, v, money) {
  if (v == null || v === '') return '—'
  if (['claim_amount', 'claim_approved_amount', 'recovered_amount', 'repair_cost'].includes(col)) return money(v)
  if (col === 'gcc_liability_ratio') return `${Number(v)}%`
  if (col === 'days_open') return `${Number(v)}d`
  if (col === 'incident_date' || col === 'expected_release_date') return String(v).slice(0, 10)
  return String(v)
}

// ── Auto insights (honest — derived only from the live record set; [] when empty) ──
export function buildInsights(ctx) {
  const { records, claims } = ctx
  if (!records.length) return []
  const out = []
  out.push(`${records.length} incident${records.length === 1 ? '' : 's'} in scope — ${claims.open} open, ${claims.closed} closed.`)

  const serious = records.filter((r) => { const s = canonSev(r.severity); return s === 'Major' || s === 'Total Loss' }).length
  if (serious > 0) out.push(`${serious} serious incident${serious === 1 ? '' : 's'} (Major / Total Loss) — ${Math.round((serious / records.length) * 100)}% of all incidents.`)

  const keys = last12(); const t = Object.fromEntries(keys.map((k) => [k, 0]))
  records.forEach((r) => { const k = mKey(r.incident_date); if (k && t[k] != null) t[k]++ })
  const worst = keys.reduce((a, k) => (t[k] > t[a] ? k : a), keys[0])
  if (t[worst] > 0) out.push(`Peak month in the last 12: ${mLabel(worst)} with ${t[worst]} incident${t[worst] === 1 ? '' : 's'}.`)

  if (claims.bySite?.length) {
    const top = claims.bySite[0]
    if (top?.label && top.label !== 'Unknown') out.push(`Highest-incident site: ${top.label} (${top.count} incident${top.count === 1 ? '' : 's'}).`)
  }
  if (claims.claimed > 0) {
    out.push(`Claims position: ${Math.round(claims.claimed).toLocaleString()} claimed, ${Math.round(claims.recovered).toLocaleString()} recovered${claims.recoveryRate != null ? ` (${claims.recoveryRate}% recovery rate)` : ''}.`)
  }
  if (claims.delayed > 0) out.push(`${claims.delayed} claim${claims.delayed === 1 ? '' : 's'} past the expected release date — follow up with the insurer.`)
  const stale = claims.aging?.['90+']?.count || 0
  if (stale > 0) out.push(`${stale} open claim${stale === 1 ? '' : 's'} older than 90 days.`)
  return out
}

// ── Block registry ────────────────────────────────────────────────────────────
let _seq = 0
export const uid = () => `b${Date.now().toString(36)}${(_seq++).toString(36)}`

export const BLOCK_TYPES = {
  header: { label: 'Header / Logo', description: 'Report title, subtitle, company logo and generation date.' },
  kpis: { label: 'KPI row', description: 'A row of headline metrics — pick from 12 accident & claims KPIs.' },
  chart: { label: 'Chart', description: `One of ${Object.keys(CHARTS).length} live charts: severity, trend, fault, liability, claims, ageing…` },
  insights: { label: 'Key findings', description: 'Auto-generated bullet summary computed from the live data (peaks, exposure, delays).' },
  text: { label: 'Text section', description: 'Free-form commentary, findings or recommendations with an optional heading.' },
  table: { label: 'Detail table', description: 'Incident register — choose columns and a row cap.' },
  divider: { label: 'Section divider', description: 'A labelled rule to separate report sections.' },
  pagebreak: { label: 'Page break', description: 'Forces the following blocks onto a new PDF page.' },
}

export const BLOCK_DEFAULTS = {
  header: () => ({ logo: '', title: 'Accident & Claims Report', subtitle: '', showDate: true }),
  kpis: () => ({ items: ['total', 'open', 'repairCost', 'claimed', 'recovered', 'netExposure'] }),
  chart: () => ({ chart: 'severity', title: '', height: 240 }),
  insights: () => ({ title: 'Key findings' }),
  text: () => ({ title: '', body: '' }),
  table: () => ({ title: 'Incident detail', columns: ['incident_date', 'asset_no', 'site', 'severity', 'status', 'claim_amount'], limit: 25 }),
  divider: () => ({ label: '' }),
  pagebreak: () => ({}),
}

export const makeBlock = (type, extra = {}) => ({ id: uid(), type, ...BLOCK_DEFAULTS[type](), ...extra })

export const STARTER = () => [
  makeBlock('header'),
  makeBlock('kpis'),
  makeBlock('chart', { chart: 'severity', title: 'Severity distribution' }),
  makeBlock('chart', { chart: 'trend', title: 'Incident trend' }),
  makeBlock('table'),
]

// ── Pre-built layout library (one-click professional report packs) ────────────
export const REPORT_LIBRARY = [
  {
    key: 'executive',
    name: 'Executive Summary Pack',
    description: 'One-page management view: headline KPIs, auto key findings, severity mix and the 12-month trend.',
    orientation: 'portrait',
    build: () => [
      makeBlock('header', { title: 'Executive Accident Summary' }),
      makeBlock('kpis', { items: ['total', 'open', 'avgDaysOpen', 'repairCost', 'netExposure', 'recoveryRate'] }),
      makeBlock('insights'),
      makeBlock('chart', { chart: 'severity', title: 'Severity distribution' }),
      makeBlock('chart', { chart: 'trend', title: 'Incident trend (12 months)' }),
    ],
  },
  {
    key: 'claimsDesk',
    name: 'Claims Desk Pack',
    description: 'Insurance-focused: claim KPIs, status & recovery funnel, insurer exposure, ageing and the claims register.',
    orientation: 'portrait',
    build: () => [
      makeBlock('header', { title: 'Insurance Claims Report' }),
      makeBlock('kpis', { items: ['claimsCount', 'claimed', 'approved', 'recovered', 'deductible', 'delayed'] }),
      makeBlock('chart', { chart: 'claimStatus', title: 'Claim status' }),
      makeBlock('chart', { chart: 'recovery', title: 'Recovery funnel' }),
      makeBlock('chart', { chart: 'insurerValue', title: 'Claim value by insurer' }),
      makeBlock('chart', { chart: 'aging', title: 'Open-claim ageing' }),
      makeBlock('pagebreak'),
      makeBlock('table', { title: 'Claims register', columns: ['incident_date', 'asset_no', 'insurer', 'claim_amount', 'claim_approved_amount', 'recovered_amount', 'expected_release_date'], limit: 50 }),
    ],
  },
  {
    key: 'insurer',
    name: 'Insurer Submission',
    description: 'For the insurer/broker: liability & fault splits, GCC case detail and the full incident register.',
    orientation: 'landscape',
    build: () => [
      makeBlock('header', { title: 'Insurer Claims Submission' }),
      makeBlock('kpis', { items: ['claimsCount', 'claimed', 'approved', 'recovered', 'deductible'] }),
      makeBlock('chart', { chart: 'liability', title: 'GCC liability split' }),
      makeBlock('chart', { chart: 'fault', title: 'Fault status' }),
      makeBlock('pagebreak'),
      makeBlock('table', { title: 'Case detail', columns: ['incident_date', 'asset_no', 'driver_name', 'fault_status', 'gcc_liability_ratio', 'insurer', 'claim_amount', 'claim_approved_amount', 'recovered_amount'], limit: 100 }),
    ],
  },
  {
    key: 'safety',
    name: 'Safety Review Pack',
    description: 'Operations & HSE: severity trend, hotspot sites and assets, plus auto findings for the safety meeting.',
    orientation: 'portrait',
    build: () => [
      makeBlock('header', { title: 'Fleet Safety Review' }),
      makeBlock('kpis', { items: ['total', 'open', 'avgDaysOpen', 'repairCost'] }),
      makeBlock('insights'),
      makeBlock('chart', { chart: 'caseAge', title: 'Open cases by days open' }),
      makeBlock('chart', { chart: 'sevMonthly', title: 'Monthly severity mix' }),
      makeBlock('chart', { chart: 'bySite', title: 'Incidents by site' }),
      makeBlock('chart', { chart: 'topAssets', title: 'Top assets by incidents' }),
    ],
  },
  {
    key: 'board',
    name: 'Monthly Board Report',
    description: 'Full narrative pack: cover, KPIs, findings, trend & claims charts, commentary section and detail annex.',
    orientation: 'portrait',
    build: () => [
      makeBlock('header', { title: 'Monthly Accident & Claims Board Report' }),
      makeBlock('kpis', { items: ['total', 'open', 'repairCost', 'claimed', 'recovered', 'netExposure'] }),
      makeBlock('insights'),
      makeBlock('divider', { label: 'Performance' }),
      makeBlock('chart', { chart: 'trend', title: 'Incident trend (12 months)' }),
      makeBlock('chart', { chart: 'recovery', title: 'Claims recovery funnel' }),
      makeBlock('text', { title: 'Management commentary', body: '' }),
      makeBlock('pagebreak'),
      makeBlock('divider', { label: 'Annex — incident register' }),
      makeBlock('table', { title: 'Incident detail', columns: ['incident_date', 'asset_no', 'site', 'driver_name', 'severity', 'status', 'days_open', 'claim_amount', 'recovered_amount'], limit: 60 }),
    ],
  },
  {
    key: 'register',
    name: 'Full Detail Register',
    description: 'Everything on record: landscape register with the widest column set for audits and hand-overs.',
    orientation: 'landscape',
    build: () => [
      makeBlock('header', { title: 'Accident Register — Full Detail' }),
      makeBlock('kpis', { items: ['total', 'open', 'closed', 'claimsCount'] }),
      makeBlock('table', { title: 'Incident register', columns: Object.keys(TABLE_COLS), limit: 200 }),
    ],
  },
]

/** Validate/repair a persisted builder config so old or hand-edited layouts never crash the UI. */
export function normalizeConfig(cfg) {
  const blocks = Array.isArray(cfg?.blocks) ? cfg.blocks : []
  const safe = blocks
    .filter((b) => b && BLOCK_TYPES[b.type])
    .map((b) => ({ ...BLOCK_DEFAULTS[b.type](), ...b, id: b.id || uid() }))
  return {
    blocks: safe,
    orientation: cfg?.orientation === 'landscape' ? 'landscape' : 'portrait',
  }
}
