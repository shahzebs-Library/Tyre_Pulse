/**
 * AI Operations service — the single reader behind the Admin Console's AI
 * "Operations" and "Delivery & Jobs" tabs (AiAdministration.jsx).
 *
 * Surfaces what already exists in the database but was never shown:
 *  - ai_token_logs  → token usage, spend, model/feature breakdown, FAILED requests
 *                     (status/error/http_status added in V236)
 *  - ai_models      → the single source of truth for per-model pricing (V236 seed),
 *                     used to estimate cost only when a row has no stored cost_usd
 *  - report_send_log → scheduled-report / background-job delivery history + failures
 *                     (admin SELECT policy added in V237)
 *
 * Pure aggregation helpers are exported for unit testing; the fetchers stay thin.
 * Missing-relation / pre-migration states degrade to empty results (honest empty
 * states, never a raw error).
 */
import { supabase, applyCountry } from './_client'

/** True when the failure is "table/column does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === '42703' || code === 'PGRST205' || code === 'PGRST204' ||
    msg.includes('does not exist') ||
    msg.includes('could not find') ||
    msg.includes('schema cache')
  )
}

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v))

/* ── Pricing (single source: ai_models) ─────────────────────────────────────── */

/**
 * Map of model key → { input, output } price in USD per 1M tokens, from ai_models.
 * Both the base key ("claude-haiku-4-5") and the versioned model_id are keyed so
 * either identifier logged by the edge functions resolves.
 */
export async function getModelPricing({ country } = {}) {
  try {
    let q = supabase.from('ai_models').select('key,model_id,input_price,output_price,active')
    q = applyCountry(q, country)
    const { data, error } = await q
    if (error) throw error
    const map = {}
    for (const m of data || []) {
      const price = { input: num(m.input_price), output: num(m.output_price) }
      if (m.key) map[m.key] = price
      if (m.model_id) map[m.model_id] = price
    }
    return map
  } catch (err) {
    if (isMissingRelation(err)) return {}
    throw err
  }
}

/** USD cost for a token-log row: prefer stored cost, else estimate from pricing. */
export function estimateRowCost(row, pricing = {}) {
  if (row?.cost_usd != null && row.cost_usd !== '') return num(row.cost_usd)
  const p = pricing[row?.model] || {}
  return (num(row?.prompt_tokens) * num(p.input) + num(row?.completion_tokens) * num(p.output)) / 1_000_000
}

/* ── Usage summary (ai_token_logs) ──────────────────────────────────────────── */

const USAGE_COLS =
  'id,model,feature,prompt_tokens,completion_tokens,cost_usd,status,error,http_status,site,country,created_at'

/**
 * Fetch raw token-log rows for a trailing window. Returns [] pre-migration.
 * `status` column is only present post-V236, so we degrade gracefully.
 */
export async function listTokenLogs({ days = 30, country, limit = 5000 } = {}) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  try {
    let q = supabase.from('ai_token_logs').select(USAGE_COLS)
    q = applyCountry(q, country)
    const { data, error } = await q
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return data || []
  } catch (err) {
    if (isMissingRelation(err)) {
      // Retry without the V236 columns so a pre-migration DB still shows usage.
      try {
        let q = supabase.from('ai_token_logs')
          .select('id,model,feature,prompt_tokens,completion_tokens,cost_usd,site,country,created_at')
        q = applyCountry(q, country)
        const { data, error: e2 } = await q
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(limit)
        if (e2) throw e2
        return (data || []).map((r) => ({ ...r, status: 'success' }))
      } catch (e3) {
        if (isMissingRelation(e3)) return []
        throw e3
      }
    }
    throw err
  }
}

const isSuccess = (r) => !r.status || r.status === 'success'

/**
 * Aggregate token-log rows into the KPI + breakdown shape the Operations tab
 * renders. Pure — unit-testable with a fixed `rows` + `pricing`.
 */
export function summarizeUsage(rows = [], pricing = {}) {
  const ok = rows.filter(isSuccess)
  const failed = rows.filter((r) => !isSuccess(r))

  let totalCost = 0
  let promptTokens = 0
  let completionTokens = 0
  const byModel = {}
  const byFeature = {}
  const byDay = {}

  for (const r of ok) {
    const cost = estimateRowCost(r, pricing)
    const pt = num(r.prompt_tokens)
    const ct = num(r.completion_tokens)
    totalCost += cost
    promptTokens += pt
    completionTokens += ct

    const model = r.model || 'unknown'
    const feat = r.feature || 'other'
    const day = String(r.created_at || '').slice(0, 10)

    const m = (byModel[model] ||= { model, cost: 0, tokens: 0, calls: 0 })
    m.cost += cost; m.tokens += pt + ct; m.calls += 1

    const f = (byFeature[feat] ||= { feature: feat, cost: 0, tokens: 0, calls: 0 })
    f.cost += cost; f.tokens += pt + ct; f.calls += 1

    if (day) {
      const d = (byDay[day] ||= { date: day, cost: 0, tokens: 0, calls: 0, failures: 0 })
      d.cost += cost; d.tokens += pt + ct; d.calls += 1
    }
  }
  for (const r of failed) {
    const day = String(r.created_at || '').slice(0, 10)
    if (day) {
      const d = (byDay[day] ||= { date: day, cost: 0, tokens: 0, calls: 0, failures: 0 })
      d.failures += 1
    }
  }

  const totalCalls = ok.length
  const failureBreakdown = {}
  for (const r of failed) {
    const k = r.status || 'error'
    failureBreakdown[k] = (failureBreakdown[k] || 0) + 1
  }

  return {
    totalCost,
    totalTokens: promptTokens + completionTokens,
    promptTokens,
    completionTokens,
    totalCalls,
    failedCalls: failed.length,
    failureRate: rows.length ? failed.length / rows.length : 0,
    avgCostPerCall: totalCalls ? totalCost / totalCalls : 0,
    byModel: Object.values(byModel).sort((a, b) => b.cost - a.cost),
    byFeature: Object.values(byFeature).sort((a, b) => b.cost - a.cost),
    byDay: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
    failureBreakdown,
    recentFailures: failed.slice(0, 50),
  }
}

/** Convenience: fetch + price + summarize in one call. */
export async function getUsageOverview({ days = 30, country } = {}) {
  const [rows, pricing] = await Promise.all([
    listTokenLogs({ days, country }),
    getModelPricing({ country }),
  ])
  return { summary: summarizeUsage(rows, pricing), pricing, rows }
}

/* ── Delivery & background jobs (report_send_log) ───────────────────────────── */

const JOB_COLS = 'id,schedule_id,schedule_name,report_type,recipients,status,error,sent_at,organisation_id'

/** Recent scheduled-report / job delivery attempts. Returns [] if unreadable. */
export async function listJobRuns({ days = 30, limit = 500 } = {}) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  try {
    const { data, error } = await supabase
      .from('report_send_log')
      .select(JOB_COLS)
      .gte('sent_at', since)
      .order('sent_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return data || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Aggregate job runs into KPI counts + per-schedule health. Pure. */
export function summarizeJobs(rows = []) {
  const sent = rows.filter((r) => r.status === 'sent')
  const failed = rows.filter((r) => r.status && r.status !== 'sent')
  const bySchedule = {}
  for (const r of rows) {
    const key = r.schedule_id || r.schedule_name || 'unknown'
    const s = (bySchedule[key] ||= {
      schedule_id: r.schedule_id,
      name: r.schedule_name || 'Unnamed schedule',
      report_type: r.report_type,
      total: 0, sent: 0, failed: 0, lastRun: null, lastStatus: null, lastError: null,
    })
    s.total += 1
    if (r.status === 'sent') s.sent += 1
    else s.failed += 1
    if (!s.lastRun || String(r.sent_at) > String(s.lastRun)) {
      s.lastRun = r.sent_at; s.lastStatus = r.status; s.lastError = r.error || null
    }
  }
  return {
    total: rows.length,
    sent: sent.length,
    failed: failed.length,
    successRate: rows.length ? sent.length / rows.length : 0,
    bySchedule: Object.values(bySchedule).sort((a, b) => String(b.lastRun).localeCompare(String(a.lastRun))),
    recentFailures: failed.slice(0, 50),
  }
}
