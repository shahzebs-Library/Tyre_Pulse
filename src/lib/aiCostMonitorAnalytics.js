/**
 * AI Cost Monitor analytics - pure engine behind /ai-cost-monitor.
 *
 * Reuses the single AI usage engine (`summarizeUsage` / `estimateRowCost` in
 * src/lib/api/aiOps.js - the same maths the AI Administration Operations tab
 * uses) and adds what this page needs on top:
 *
 *  - client-side filters (feature / model / status / search). The old page
 *    re-queried per filter AND built its dropdown options from the filtered
 *    rows, so choosing a feature collapsed the list to that one feature and
 *    the filter could not be changed back without resetting it by hand;
 *  - honest headline figures: an average over zero calls is null (N/A), not
 *    $0.0000; a spend trend needs calls in both halves of the window;
 *  - failed requests (status / error, V236) are counted, never priced;
 *  - per-site spend, cost per million tokens and flat export rows.
 * No I/O; `now` is injectable for the window split.
 */
import { summarizeUsage, estimateRowCost } from './api/aiOps'

const DAY_MS = 86400000

export const STATUS_OPTIONS = ['success', 'error', 'rate_limited', 'blocked']

export function isSuccessRow(r) {
  return !r?.status || r.status === 'success'
}

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v))

export function rowTokens(r) {
  return num(r?.prompt_tokens) + num(r?.completion_tokens)
}

/** Cost of a row in USD; failed calls carry no spend. */
export function rowCost(r, pricing = {}) {
  return isSuccessRow(r) ? estimateRowCost(r, pricing) : 0
}

export function formatUSD(n) {
  if (n == null || !Number.isFinite(Number(n))) return 'N/A'
  const v = Number(n)
  if (v !== 0 && Math.abs(v) < 0.01) return `$${v.toFixed(4)}`
  return `$${v.toFixed(2)}`
}

export function formatTokens(n) {
  if (n == null || !Number.isFinite(Number(n))) return 'N/A'
  const v = Number(n)
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return String(Math.round(v))
}

/** Distinct option lists from the UNFILTERED rows, so filters never self-lock. */
export function filterOptions(rows = []) {
  const set = (fn) => [...new Set(rows.map(fn).filter(Boolean))].sort()
  return {
    features: set((r) => r.feature),
    models: set((r) => r.model),
    sites: set((r) => r.site),
    statuses: set((r) => r.status || 'success'),
  }
}

export function filterLogs(rows = [], { feature = 'all', model = 'all', status = 'all', site = 'all', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return rows.filter((r) => {
    if (feature !== 'all' && r.feature !== feature) return false
    if (model !== 'all' && r.model !== model) return false
    if (site !== 'all' && (r.site || '') !== site) return false
    if (status !== 'all' && (r.status || 'success') !== status) return false
    if (q && ![r.model, r.feature, r.site, r.error].some((v) => String(v || '').toLowerCase().includes(q))) return false
    return true
  })
}

function spendBySite(rows, pricing) {
  const map = new Map()
  for (const r of rows) {
    if (!isSuccessRow(r)) continue
    const key = r.site || 'No site'
    const s = map.get(key) || { site: key, cost: 0, calls: 0, tokens: 0 }
    s.cost += estimateRowCost(r, pricing)
    s.calls += 1
    s.tokens += rowTokens(r)
    map.set(key, s)
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost)
}

/**
 * Everything the page renders.
 * @param {object[]} rows filtered token-log rows
 * @param {{pricing?:object, days?:number, now?:number}} opts
 */
export function buildAiCostReport(rows = [], { pricing = {}, days = 30, now = Date.now() } = {}) {
  const u = summarizeUsage(rows, pricing)
  const total = rows.length

  // Spend trend: second half of the window vs the first half.
  const mid = now - (days * DAY_MS) / 2
  let first = 0; let second = 0; let firstCalls = 0; let secondCalls = 0
  for (const r of rows) {
    if (!isSuccessRow(r)) continue
    const t = new Date(r.created_at).getTime()
    if (!Number.isFinite(t)) continue
    const c = estimateRowCost(r, pricing)
    if (t < mid) { first += c; firstCalls += 1 } else { second += c; secondCalls += 1 }
  }
  const spendTrendPct = firstCalls > 0 && secondCalls > 0 && first > 0
    ? Math.round(((second - first) / first) * 100)
    : null

  const byModel = u.byModel.map((m) => ({ ...m, share: u.totalCost > 0 ? (m.cost / u.totalCost) * 100 : null }))
  const byFeature = u.byFeature.map((f) => ({ ...f, share: u.totalCost > 0 ? (f.cost / u.totalCost) * 100 : null }))
  const bySite = spendBySite(rows, pricing)

  return {
    totalCost: u.totalCalls > 0 ? u.totalCost : (total > 0 ? 0 : null),
    totalTokens: u.totalTokens,
    promptTokens: u.promptTokens,
    completionTokens: u.completionTokens,
    totalRequests: total,
    successCalls: u.totalCalls,
    failedCalls: u.failedCalls,
    failureRate: total > 0 ? (u.failedCalls / total) * 100 : null,
    failureBreakdown: Object.entries(u.failureBreakdown || {}).map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    avgCostPerCall: u.totalCalls > 0 ? u.totalCost / u.totalCalls : null,
    costPerMillionTokens: u.totalTokens > 0 ? (u.totalCost / u.totalTokens) * 1_000_000 : null,
    spendTrendPct,
    topModel: byModel[0]?.model ?? null,
    byModel,
    byFeature,
    bySite,
    byDay: u.byDay,
  }
}

export const LOG_EXPORT_COLUMNS = [
  { key: 'created_at', header: 'Timestamp' },
  { key: 'status', header: 'Status' },
  { key: 'model', header: 'Model' },
  { key: 'feature', header: 'Feature' },
  { key: 'site', header: 'Site' },
  { key: 'prompt_tokens', header: 'Prompt tokens' },
  { key: 'completion_tokens', header: 'Completion tokens' },
  { key: 'cost', header: 'Cost (USD)' },
  { key: 'error', header: 'Error' },
]

export function logExportRows(rows = [], pricing = {}) {
  return rows.map((r) => ({
    created_at: r.created_at ? String(r.created_at).slice(0, 16).replace('T', ' ') : 'N/A',
    status: r.status || 'success',
    model: r.model || 'N/A',
    feature: r.feature || 'N/A',
    site: r.site || 'N/A',
    prompt_tokens: num(r.prompt_tokens),
    completion_tokens: num(r.completion_tokens),
    cost: isSuccessRow(r) ? Number(estimateRowCost(r, pricing).toFixed(6)) : 'Not billed',
    error: r.error || '',
  }))
}
