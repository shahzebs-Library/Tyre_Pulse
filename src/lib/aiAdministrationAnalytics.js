/**
 * aiAdministrationAnalytics - pure engine behind the AI Administration page's
 * catalogue tabs (Models, Prompts, Budgets, Feedback). The Operations and
 * Delivery & Jobs tabs keep their own engines (aiOps.summarizeUsage /
 * summarizeJobs); budget utilisation reuses aiAdmin.budgetStatus.
 *
 * No I/O. Anything time-dependent takes `now`.
 */
import { budgetStatus, summariseModels } from './aiAdmin'

export const BUDGET_PERIOD_DAYS = { daily: 1, weekly: 7, monthly: 30 }
const DAY = 86_400_000

const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Case-insensitive contains over the listed fields. */
export function searchRecords(rows = [], query = '', fields = []) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return rows
  return rows.filter(r => fields.some(f => String(r?.[f] ?? '').toLowerCase().includes(q)))
}

/** Spend and tokens per budget period window from raw ai_token_logs rows. */
export function spendWindows(logs = [], now = Date.now()) {
  const t = typeof now === 'number' ? now : new Date(now).getTime()
  const acc = {}
  for (const p of Object.keys(BUDGET_PERIOD_DAYS)) acc[p] = { cost: 0, tokens: 0, calls: 0 }
  for (const r of logs) {
    const at = Date.parse(r?.created_at)
    if (!Number.isFinite(at)) continue
    const age = t - at
    if (age < 0) continue
    const cost = num(r.cost_usd) || 0
    const toks = (num(r.prompt_tokens) || 0) + (num(r.completion_tokens) || 0)
    for (const [p, days] of Object.entries(BUDGET_PERIOD_DAYS)) {
      if (age <= days * DAY) { acc[p].cost += cost; acc[p].tokens += toks; acc[p].calls += 1 }
    }
  }
  return acc
}

/**
 * Utilisation of one budget against the matching spend window. Returns null
 * when spend is unknown (never a fabricated 0%). A cost cap compares cost; a
 * token-only cap compares tokens.
 */
export function budgetUtilisation(budget, windows) {
  if (!windows) return null
  const w = windows[budget?.period] || { cost: 0, tokens: 0 }
  const byCost = (num(budget?.cost_cap_usd) || 0) > 0
  const spend = byCost ? w.cost : w.tokens
  const status = budgetStatus(budget, spend)
  if (!status || !(status.cap > 0)) return null
  return { ...status, basis: byCost ? 'cost' : 'tokens', spend }
}

export function modelKpis(rows = []) {
  const s = summariseModels(rows)
  const priced = rows.filter(r => num(r.input_price) != null && num(r.output_price) != null).length
  return { ...s, priced }
}

export function promptKpis(rows = []) {
  const agents = new Set(rows.map(r => r.agent).filter(Boolean))
  const locales = new Set(rows.map(r => r.locale).filter(Boolean))
  // Agents that have more than one active prompt in the same locale: ambiguous.
  const seen = new Map()
  for (const r of rows) {
    if (r.active === false || !r.agent) continue
    const k = `${r.agent}|${r.locale || ''}`
    seen.set(k, (seen.get(k) || 0) + 1)
  }
  return {
    total: rows.length,
    active: rows.filter(r => r.active !== false).length,
    agents: agents.size,
    locales: locales.size,
    conflicts: [...seen.values()].filter(c => c > 1).length,
  }
}

export function budgetKpis(rows = [], windows = null) {
  const util = rows.map(b => budgetUtilisation(b, windows)).filter(Boolean)
  return {
    total: rows.length,
    active: rows.filter(r => r.active !== false).length,
    hardStops: rows.filter(r => r.hard_stop === true).length,
    overCap: windows ? util.filter(u => u.over).length : null,
    spend30d: windows ? windows.monthly.cost : null,
  }
}

export function feedbackKpis(rows = []) {
  const rated = rows.map(r => num(r.rating)).filter(v => v != null)
  const judged = rows.filter(r => r.correct === true || r.correct === false)
  const correct = judged.filter(r => r.correct === true).length
  return {
    total: rows.length,
    avgRating: rated.length ? rated.reduce((s, v) => s + v, 0) / rated.length : null,
    rated: rated.length,
    correct,
    judged: judged.length,
    // Share correct among entries that were actually judged; null when none.
    correctPct: judged.length ? (correct / judged.length) * 100 : null,
  }
}

/** Rating histogram 1..5 (entries without a rating are not counted). */
export function ratingDistribution(rows = []) {
  const out = [1, 2, 3, 4, 5].map(r => ({ rating: r, count: 0 }))
  for (const r of rows) {
    const v = num(r.rating)
    if (v != null && v >= 1 && v <= 5) out[Math.round(v) - 1].count += 1
  }
  return out
}
