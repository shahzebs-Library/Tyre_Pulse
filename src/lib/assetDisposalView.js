/**
 * assetDisposalView - PURE view engine for the redesigned /asset-disposals page.
 *
 * The register maths (economics, summary, filters, findings) stay in
 * `assetDisposal`. This module only answers the questions the new layout asks:
 * the six headline tiles, the stage pipeline, the reasons list, the recovery
 * trend, the "next action" each row needs, and the valuation request sheet.
 *
 * HONESTY RULES
 *  1. A VALUE OF ZERO IS NOT A VALUATION. The committee sheet loaded 0 into
 *     `estimated_value` and `sale_proceeds` on rows nobody has valued, so only a
 *     strictly positive figure counts as valued or as money recovered.
 *  2. NO STAGE IS INVENTED. The register records proposed, approved, rejected
 *     and disposed, plus whether a valuation exists. The pipeline uses exactly
 *     those; there is no "in process" or "valuation requested" column to read.
 *  3. MONEY IS NEVER BLENDED. Recovery totals come back per currency.
 *  4. The table has no disposal reason column; the committee's recorded
 *     condition is what the reasons card groups, and the card says so.
 *
 * Deterministic: `now` is injected.
 */
import { assetAge, conditionMeta } from './assetDisposal'

const txt = (v) => (v == null ? '' : String(v).trim())
const num = (v) => {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
const positive = (v) => {
  const n = num(v)
  return n != null && n > 0 ? n : null
}
const dayMs = (v) => {
  const s = txt(v)
  if (!s) return null
  const t = Date.parse(s.length <= 10 ? `${s}T00:00:00Z` : s)
  return Number.isFinite(t) ? t : null
}

export const statusOf = (r) => txt(r?.status) || 'proposed'
const currencyOf = (r) => txt(r?.currency) || 'SAR'

/** A strictly positive estimated value. 0 and blank both read "Not valued". */
export const valuationOf = (r) => positive(r?.estimated_value)
export const isValued = (r) => valuationOf(r) != null
/** Money recovered: positive sale proceeds only. */
export const proceedsOf = (r) => positive(r?.sale_proceeds)

const OPEN = (r) => !['disposed', 'rejected'].includes(statusOf(r))

/**
 * What still has to happen outside this register before a machine can go.
 * The fleet register still counting it as Active, and tyres still recorded as
 * fitted, are the two things the data can actually show.
 */
export function complianceIssues(r) {
  if (statusOf(r) === 'rejected') return []
  const out = []
  if (txt(r?.fleet_status) === 'Active') out.push('register_active')
  if ((num(r?.tyres_active) ?? 0) > 0) out.push('tyres_fitted')
  return out
}

/** The six headline tiles, over the rows handed in. */
export function disposalKpis(rows) {
  const list = Array.isArray(rows) ? rows : []
  const byCurrency = new Map()
  let recoveredMachines = 0
  for (const r of list) {
    if (statusOf(r) !== 'disposed') continue
    const p = proceedsOf(r)
    if (p == null) continue
    recoveredMachines += 1
    const c = currencyOf(r)
    byCurrency.set(c, (byCurrency.get(c) || 0) + p)
  }
  return {
    total: list.length,
    candidates: list.filter((r) => statusOf(r) === 'proposed').length,
    approved: list.filter((r) => statusOf(r) === 'approved').length,
    pendingValuation: list.filter((r) => OPEN(r) && !isValued(r)).length,
    sold: list.filter((r) => statusOf(r) === 'disposed' && txt(r?.disposition) === 'sell').length,
    disposed: list.filter((r) => statusOf(r) === 'disposed').length,
    compliancePending: list.filter((r) => complianceIssues(r).length > 0).length,
    recovery: [...byCurrency.entries()].map(([currency, total]) => ({ currency, total })).sort((a, b) => a.currency.localeCompare(b.currency)),
    recoveredMachines,
  }
}

/** "SAR 12,000" or "SAR 12,000 | AED 300", or null when nothing is recorded. */
export function recoveryLabel(recovery) {
  const list = Array.isArray(recovery) ? recovery : []
  if (!list.length) return null
  return list.map((x) => `${x.currency} ${Math.round(x.total).toLocaleString('en-US')}`).join(' | ')
}

export const PIPELINE_STAGES = [
  { key: 'identified', label: 'Identified, not valued', color: '#16a34a', test: (r) => statusOf(r) === 'proposed' && !isValued(r) },
  { key: 'valued', label: 'Valued, awaiting decision', color: '#4ade80', test: (r) => statusOf(r) === 'proposed' && isValued(r) },
  { key: 'approved', label: 'Approved', color: '#86efac', test: (r) => statusOf(r) === 'approved' },
  { key: 'disposed', label: 'Sold / disposed', color: '#15803d', test: (r) => statusOf(r) === 'disposed' },
  { key: 'rejected', label: 'Kept in service', color: '#eab308', test: (r) => statusOf(r) === 'rejected' },
]

/** Stage counts. An unknown status token lands in its own "Other" stage. */
export function pipeline(rows, { site = '' } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => !site || txt(r?.site) === site)
  const stages = PIPELINE_STAGES.map((s) => ({ key: s.key, label: s.label, color: s.color, count: list.filter(s.test).length }))
  const known = stages.reduce((s, x) => s + x.count, 0)
  if (known < list.length) stages.push({ key: 'other', label: 'Other status', color: '#94a3b8', count: list.length - known })
  const max = Math.max(0, ...stages.map((s) => s.count))
  return { stages, total: list.length, max }
}

/** Within the last N months of `now`, by the date a row joined the list. */
function withinMonths(r, months, now) {
  if (!months) return true
  const t = dayMs(r?.created_at)
  if (t == null) return false
  const d = new Date(now)
  const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate())
  return t >= from
}

/** Reasons = the committee's recorded condition, counted with a share. */
export function topReasons(rows, { months = 0, now = Date.now(), limit = 6 } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => withinMonths(r, months, now))
  const map = new Map()
  for (const r of list) {
    const meta = conditionMeta(r?.condition)
    const key = meta.label
    const cur = map.get(key) || { label: key, tone: meta.tone, count: 0 }
    cur.count += 1
    map.set(key, cur)
  }
  const total = list.length
  const all = [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  return {
    total,
    reasons: all.slice(0, limit).map((x) => ({ ...x, pct: total ? Math.round((x.count / total) * 100) : null })),
    more: Math.max(0, all.length - limit),
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Machines disposed per month (by disposed_at) and the proceeds recorded on
 * them, per currency. A month with disposals but no proceeds has value null.
 */
export function recoveryTrend(rows, { months = 12, now = Date.now() } = {}) {
  const d = new Date(now)
  const series = []
  for (let i = months - 1; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1))
    series.push({ key: `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`, label: MONTHS[m.getUTCMonth()], count: 0, values: {} })
  }
  const index = new Map(series.map((s, i) => [s.key, i]))
  const currencies = new Set()
  let undated = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    if (statusOf(r) !== 'disposed') continue
    const t = dayMs(r?.disposed_at)
    if (t == null) { undated += 1; continue }
    const dt = new Date(t)
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`
    const i = index.get(key)
    if (i == null) continue
    series[i].count += 1
    const p = proceedsOf(r)
    if (p != null) {
      const c = currencyOf(r)
      currencies.add(c)
      series[i].values[c] = (series[i].values[c] || 0) + p
    }
  }
  const disposed = series.reduce((s, x) => s + x.count, 0)
  return { series, currencies: [...currencies].sort(), disposed, undated, hasValue: currencies.size > 0 }
}

/** The single next step the data says a row needs. */
export function nextAction(r) {
  const s = statusOf(r)
  const issues = complianceIssues(r)
  if (s === 'rejected') return { label: 'Kept in service', tone: 'muted' }
  if (s === 'disposed') {
    if (issues.includes('register_active')) return { label: 'Retire in fleet register', tone: 'bad' }
    if (issues.includes('tyres_fitted')) return { label: 'Close tyre records', tone: 'warn' }
    return { label: 'Complete', tone: 'good' }
  }
  if (s === 'approved') {
    if (issues.includes('tyres_fitted')) return { label: 'Recover tyres', tone: 'warn' }
    return { label: 'Arrange disposal', tone: 'info' }
  }
  if (!isValued(r)) return { label: 'Record valuation', tone: 'warn' }
  return { label: 'Committee decision', tone: 'info' }
}

export const approvalPill = (r) => ({
  proposed: { label: 'Pending decision', tone: 'warn' },
  approved: { label: 'Approved', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'muted' },
  disposed: { label: 'Disposed', tone: 'info' },
}[statusOf(r)] || { label: statusOf(r), tone: 'muted' })

export const CONDITION_TONE = { danger: 'bad', warning: 'warn', good: 'good', info: 'info', quiet: 'muted' }

export function makeModel(r) {
  const s = [txt(r?.fleet_make), txt(r?.fleet_model)].filter(Boolean).join(' ')
  return s || txt(r?.brand) || null
}

export const ageOf = (r, now = Date.now()) => assetAge(r, { now }).ageYears

export const ADDED_WINDOWS = [
  { key: '', label: 'Any date added' },
  { key: '30', label: 'Added in the last 30 days' },
  { key: '90', label: 'Added in the last 90 days' },
  { key: '365', label: 'Added in the last 12 months' },
]

/**
 * The filters the new layout adds on top of `filterDisposals`: when a row was
 * added to the list, whether it still needs a valuation, and whether anything
 * outside the register is still pending.
 */
export function applyViewFilters(rows, { added = '', valuation = '', compliance = '', sold = false } = {}, now = Date.now()) {
  const days = Number(added) || 0
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (days) {
      const t = dayMs(r?.created_at)
      if (t == null || now - t > days * 86400000) return false
    }
    if (valuation === 'pending' && !(OPEN(r) && !isValued(r))) return false
    if (compliance === 'pending' && complianceIssues(r).length === 0) return false
    if (sold && !(statusOf(r) === 'disposed' && txt(r?.disposition) === 'sell')) return false
    return true
  })
}

/** Rows for the valuation request sheet: open machines with no valuation. */
export function valuationRequestRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => OPEN(r) && !isValued(r))
    .map((r) => ({
      asset_no: txt(r?.asset_no),
      asset_type: txt(r?.asset_type),
      model_year: num(r?.model_year) ?? '',
      disposition: txt(r?.disposition) || 'undecided',
      condition: txt(r?.condition),
      site: txt(r?.site),
      estimated_value: '',
      currency: currencyOf(r),
    }))
}
export const VALUATION_COLUMNS = ['asset_no', 'asset_type', 'model_year', 'disposition', 'condition', 'site', 'estimated_value', 'currency']
export const VALUATION_HEADERS = ['Asset', 'Asset type', 'Model year', 'Disposition', 'Condition', 'Site', 'Estimated value', 'Currency']
