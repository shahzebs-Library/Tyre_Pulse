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
import { supabase, applyCountry, fetchAllPages, toServiceError } from './_client'

/** True when the failure is "table/column does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String((err?.cause?.message ?? err?.message) || '').toLowerCase()
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
    if (error) throw toServiceError(error)
    const map = {}
    for (const m of data || []) {
      const price = { input: num(m.input_price), output: num(m.output_price) }
      if (m.key) map[m.key] = price
      if (m.model_id) map[m.model_id] = price
    }
    return map
  } catch (err) {
    if (isMissingRelation(err)) return {}
    throw toServiceError(err)
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
  'id,model,feature,prompt_tokens,completion_tokens,cost_usd,status,error,http_status,latency_ms,site,country,organisation_id,created_at'

/**
 * Fetch raw token-log rows for a trailing window, PAGED past the 1,000-row
 * server cap (newest first, `id` tiebreak). The old `.limit(5000)` was silently
 * cut to 1,000 by PostgREST, so a busy month under-reported AI spend.
 * `limit` is a safety ceiling; hitting it sets `truncated`.
 * `status` column is only present post-V236, so we degrade gracefully.
 * @returns {Promise<{rows: object[], truncated: boolean}>}
 */
export async function readTokenLogs({ days = 30, country, limit = 50000 } = {}) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const read = (cols) => fetchAllPages((a, b) => applyCountry(
    supabase.from('ai_token_logs').select(cols), country,
  )
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(a, b), { max: limit })

  const first = await read(USAGE_COLS)
  if (!first.error) return { rows: first.data || [], truncated: !!first.truncated }
  if (!isMissingRelation(first.error)) throw toServiceError(first.error)
  // Retry without the V236 columns so a pre-migration DB still shows usage.
  const second = await read('id,model,feature,prompt_tokens,completion_tokens,cost_usd,site,country,created_at')
  if (second.error) {
    if (isMissingRelation(second.error)) return { rows: [], truncated: false }
    throw toServiceError(second.error)
  }
  return {
    rows: (second.data || []).map((r) => ({ ...r, status: 'success' })),
    truncated: !!second.truncated,
  }
}

/** Array form of readTokenLogs, kept for existing callers. */
export async function listTokenLogs(opts = {}) {
  return (await readTokenLogs(opts)).rows
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
  const [{ rows, truncated }, pricing] = await Promise.all([
    readTokenLogs({ days, country }),
    getModelPricing({ country }),
  ])
  return { summary: summarizeUsage(rows, pricing), pricing, rows, truncated }
}

/* ── Per-agent and per-organisation usage ───────────────────────────────────── */
//
// ai_usage_log carries the AGENT (e.g. "orchestrator:analyst", "chat:tyre"); ai_token_logs carries the
// organisation, status and latency. Both are read here so this module stays the ONE AI usage reader.

const AGENT_COLS = 'id,agent,model,input_tokens,output_tokens,total_tokens,cost_usd,source,organisation_id,country,created_at'

/**
 * Paged read of ai_usage_log for a trailing window (newest first, id tiebreak).
 * @returns {Promise<{rows: object[], truncated: boolean}>} [] when the table is unreadable pre-migration.
 */
export async function readUsageLog({ days = 30, country, limit = 50000 } = {}) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data, error, truncated } = await fetchAllPages((a, b) => applyCountry(
    supabase.from('ai_usage_log').select(AGENT_COLS), country,
  )
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(a, b), { max: limit })
  if (error) {
    if (isMissingRelation(error)) return { rows: [], truncated: false }
    throw toServiceError(error)
  }
  return { rows: data || [], truncated: !!truncated }
}

/** "orchestrator:analyst" -> "orchestrator:analyst"; blank -> "unknown". Kept verbatim otherwise. */
export function agentLabel(agent) {
  const a = String(agent ?? '').trim()
  return a || 'unknown'
}

/**
 * Group ai_usage_log rows by agent. Pure. Cost is the stored cost_usd (NOT NULL on that table).
 * Sorted by cost desc, then calls desc.
 */
export function summarizeByAgent(rows = []) {
  const map = {}
  for (const r of rows) {
    const key = agentLabel(r.agent)
    const a = (map[key] ||= { agent: key, calls: 0, tokens: 0, cost: 0 })
    a.calls += 1
    a.tokens += num(r.total_tokens) || (num(r.input_tokens) + num(r.output_tokens))
    a.cost += num(r.cost_usd)
  }
  return Object.values(map).sort((x, y) => y.cost - x.cost || y.calls - x.calls)
}

/**
 * Group ai_token_logs rows by organisation. Pure. Successful calls carry spend; failures are counted
 * separately; a failed call with an UNKNOWN cost (cost_usd null, status error) is flagged as
 * `unknownCostFailures` so an admin can see spend that may have been billed but is not in the total.
 * `orgNames` maps organisation_id -> display name; rows with no organisation are grouped as "No organisation".
 */
export function summarizeByOrg(rows = [], pricing = {}, orgNames = {}) {
  const map = {}
  for (const r of rows) {
    const id = r.organisation_id || null
    const key = id || '__none__'
    const o = (map[key] ||= {
      organisationId: id,
      name: id ? (orgNames[id] || 'Unknown organisation') : 'No organisation',
      calls: 0, failures: 0, unknownCostFailures: 0, cost: 0, tokens: 0, latencySum: 0, latencyCount: 0,
    })
    if (isSuccess(r)) {
      o.calls += 1
      o.cost += estimateRowCost(r, pricing)
      o.tokens += num(r.prompt_tokens) + num(r.completion_tokens)
    } else {
      o.failures += 1
      if (r.status === 'error' && (r.cost_usd == null || r.cost_usd === '')) o.unknownCostFailures += 1
      else if (r.cost_usd != null && r.cost_usd !== '') o.cost += num(r.cost_usd)
    }
    if (r.latency_ms != null && r.latency_ms !== '' && Number.isFinite(Number(r.latency_ms))) {
      o.latencySum += Number(r.latency_ms); o.latencyCount += 1
    }
  }
  return Object.values(map)
    .map(({ latencySum, latencyCount, ...o }) => ({
      ...o,
      avgLatencyMs: latencyCount ? Math.round(latencySum / latencyCount) : null,
    }))
    .sort((x, y) => y.cost - x.cost || y.calls - x.calls)
}

/** organisation id -> name. Best effort: unreadable (RLS / missing) returns {}. */
export async function getOrganisationNames() {
  try {
    const { data, error } = await supabase.from('organisations').select('id,name').limit(1000)
    if (error) return {}
    const out = {}
    for (const o of data || []) if (o?.id) out[o.id] = o.name || 'Unnamed organisation'
    return out
  } catch {
    return {}
  }
}

/** Fetch + summarise per-agent and per-organisation usage for the Operations tab. */
export async function getAgentOrgUsage({ days = 30, country } = {}) {
  const [agentRead, tokenRead, pricing, orgNames] = await Promise.all([
    readUsageLog({ days, country }),
    readTokenLogs({ days, country }),
    getModelPricing({ country }),
    getOrganisationNames(),
  ])
  return {
    byAgent: summarizeByAgent(agentRead.rows),
    byOrg: summarizeByOrg(tokenRead.rows, pricing, orgNames),
    truncated: agentRead.truncated || tokenRead.truncated,
  }
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
    if (error) throw toServiceError(error)
    return data || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw toServiceError(err)
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
