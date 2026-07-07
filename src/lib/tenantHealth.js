/**
 * tenantHealth — SaaS-owner/admin platform usage + adoption metrics (roadmap #22).
 *
 * Sibling of systemHealth.js (subsystem reachability); this module answers
 * "is the tenant actually USING the platform?": active users, data growth,
 * AI spend, activity trends, and module adoption.
 *
 * Design rules (mirrors systemHealth.js):
 *  - Only queries tables/columns already used by existing page code
 *    (AiCostMonitor, AuditTrail, UserManagement, lib/api/*) — the live DB
 *    drifts from the migration files, so never guess columns.
 *  - Record counts use head-count queries (`select('id', { count:'exact',
 *    head:true })`) — zero rows transferred even at millions of records.
 *  - `runTenantReport` runs every slice in parallel via Promise.allSettled;
 *    one broken slice can never blank the whole dashboard.
 *  - Pure shaping helpers are exported separately for unit testing without
 *    a network (see src/test/tenantHealth.test.js).
 */
import { supabase } from './supabase'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Rolling analysis window (days). */
export const WINDOW_DAYS = 30

/** Row caps so a busy tenant can't pull unbounded payloads into the browser. */
export const ACTIVITY_ROW_LIMIT = 10_000
export const AI_LOG_ROW_LIMIT = 5_000
export const PROFILE_ROW_LIMIT = 2_000

/**
 * Approximate costs per 1K tokens (USD) — MUST stay in sync with
 * src/pages/AiCostMonitor.jsx TOKEN_COSTS so both screens report one number.
 */
export const TOKEN_COSTS = Object.freeze({
  'claude-opus-4-8':    { input: 0.015,   output: 0.075   },
  'claude-sonnet-4-6':  { input: 0.003,   output: 0.015   },
  'claude-haiku-4-5':   { input: 0.00025, output: 0.00125 },
  'text-embedding-3-small': { input: 0.00002, output: 0 },
  'text-embedding-3-large': { input: 0.00013, output: 0 },
  default:              { input: 0.003,   output: 0.015   },
})

/** Core data tables counted for growth (all read by existing app code). */
export const GROWTH_TABLES = Object.freeze([
  { table: 'vehicle_fleet',       label: 'Vehicles' },
  { table: 'tyre_records',        label: 'Tyre Records' },
  { table: 'inspections',         label: 'Inspections' },
  { table: 'work_orders',         label: 'Work Orders' },
  { table: 'accidents',           label: 'Accidents' },
  { table: 'alerts',              label: 'Alerts' },
  { table: 'import_batches',      label: 'Import Batches' },
  { table: 'knowledge_documents', label: 'Knowledge Docs' },
])

/**
 * audit_log_v2.table_name → human module label. Unknown tables fall back to
 * a humanized version of the table name so new modules appear automatically.
 */
export const TABLE_MODULE_MAP = Object.freeze({
  vehicle_fleet:       'Fleet Management',
  tyre_records:        'Tyre Records',
  inspections:         'Inspections',
  work_orders:         'Workshop',
  accidents:           'Accidents',
  alerts:              'Alerts',
  import_batches:      'Data Intake',
  upload_history:      'Data Intake',
  knowledge_documents: 'Knowledge Base',
  profiles:            'User Management',
  stock:               'Stock Management',
  gate_passes:         'Gate Pass',
})

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────

/** Local YYYY-MM-DD for a Date (matches how pages slice created_at). */
export function toDayKey(d) {
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return null
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Zero-fill a per-day series over the trailing `days` window (ending today).
 * `rows` is an array of objects with a `date` key ('YYYY-MM-DD'); numeric
 * fields present on any row default to 0 on missing days. Rows outside the
 * window are dropped. Returns days entries, oldest → newest.
 */
export function zeroFillDays(rows, days = WINDOW_DAYS, now = new Date()) {
  const span = Math.max(1, Math.floor(Number(days) || 1))
  const byDate = new Map()
  const numericFields = new Set()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.date !== 'string') continue
    byDate.set(row.date, row)
    for (const [k, v] of Object.entries(row)) {
      if (k !== 'date' && typeof v === 'number') numericFields.add(k)
    }
  }
  const out = []
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = toDayKey(d)
    const existing = byDate.get(key)
    const entry = { date: key }
    for (const f of numericFields) entry[f] = 0
    if (existing) {
      for (const [k, v] of Object.entries(existing)) {
        if (k !== 'date') entry[k] = v
      }
    }
    out.push(entry)
  }
  return out
}

/**
 * Percent change from prev → current, rounded to 1 decimal.
 * prev === 0 && current === 0 → 0; prev === 0 && current > 0 → null
 * (undefined growth — render as "new"). Non-finite input → null.
 */
export function pctChange(current, prev) {
  const c = Number(current)
  const p = Number(prev)
  if (!Number.isFinite(c) || !Number.isFinite(p)) return null
  if (p === 0) return c === 0 ? 0 : null
  return Math.round(((c - p) / p) * 1000) / 10
}

/**
 * Top-N entries of a key→count map (plain object or Map), sorted by count
 * desc then key asc for a stable order. Returns [{ key, count }].
 */
export function topN(map, n = 5) {
  const entries = map instanceof Map ? [...map.entries()] : Object.entries(map ?? {})
  return entries
    .filter(([, v]) => Number.isFinite(Number(v)))
    .map(([key, v]) => ({ key: String(key), count: Number(v) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, Math.max(0, n))
}

/** Humanize a snake_case table name: 'tyre_records' → 'Tyre Records'. */
export function humanizeTableName(name) {
  return String(name ?? '')
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** table_name → module label (mapped, or humanized fallback). */
export function mapTableToModule(tableName) {
  if (!tableName) return 'Other'
  return TABLE_MODULE_MAP[tableName] ?? humanizeTableName(tableName)
}

/**
 * Aggregate audit rows ({ table_name }) into module adoption:
 * [{ module, events, share }] sorted by events desc. share is 0–100 (1dp).
 */
export function buildModuleAdoption(rows) {
  const counts = new Map()
  let total = 0
  for (const row of Array.isArray(rows) ? rows : []) {
    const module = mapTableToModule(row?.table_name)
    counts.set(module, (counts.get(module) ?? 0) + 1)
    total += 1
  }
  return [...counts.entries()]
    .map(([module, events]) => ({
      module,
      events,
      share: total > 0 ? Math.round((events / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.events - a.events || a.module.localeCompare(b.module))
}

/** Mirror of AiCostMonitor.estimateCost — cost_usd wins, else token estimate. */
export function estimateAiCost(row) {
  if (row?.cost_usd != null) return Number(row.cost_usd)
  const rates = TOKEN_COSTS[row?.model] ?? TOKEN_COSTS.default
  return (((row?.prompt_tokens ?? 0) * rates.input) + ((row?.completion_tokens ?? 0) * rates.output)) / 1000
}

/** Shape raw profiles rows into the user-stats slice. */
export function shapeUserStats(rows, now = new Date()) {
  const list = Array.isArray(rows) ? rows : []
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000)
  const byRole = {}
  const pendingUsers = []
  let approved = 0
  let locked = 0
  let newLast30 = 0
  for (const p of list) {
    const role = p?.role || 'Unassigned'
    byRole[role] = (byRole[role] ?? 0) + 1
    if (p?.approved) approved += 1
    else pendingUsers.push({ id: p?.id, name: p?.full_name || p?.username || 'Unknown', role, createdAt: p?.created_at ?? null })
    if (p?.locked) locked += 1
    const created = p?.created_at ? new Date(p.created_at) : null
    if (created && !Number.isNaN(created.getTime()) && created >= since) newLast30 += 1
  }
  return {
    total: list.length,
    byRole,
    approved,
    pending: pendingUsers.length,
    pendingUsers,
    locked,
    newLast30,
  }
}

/** Shape raw audit rows into the activity slice (per-day, zero-filled). */
export function shapeActivityStats(rows, days = WINDOW_DAYS, now = new Date()) {
  const list = Array.isArray(rows) ? rows : []
  const perDay = new Map() // date → { events, users:Set }
  const actionCounts = {}
  const tableCounts = {}
  const allUsers = new Set()
  for (const row of list) {
    const day = typeof row?.created_at === 'string' ? row.created_at.slice(0, 10) : toDayKey(row?.created_at)
    if (day) {
      if (!perDay.has(day)) perDay.set(day, { events: 0, users: new Set() })
      const bucket = perDay.get(day)
      bucket.events += 1
      if (row?.user_id) bucket.users.add(row.user_id)
    }
    if (row?.user_id) allUsers.add(row.user_id)
    if (row?.action) actionCounts[row.action] = (actionCounts[row.action] ?? 0) + 1
    if (row?.table_name) tableCounts[row.table_name] = (tableCounts[row.table_name] ?? 0) + 1
  }
  const daily = [...perDay.entries()].map(([date, b]) => ({ date, events: b.events, activeUsers: b.users.size }))
  return {
    totalEvents: list.length,
    activeUsers: allUsers.size,
    eventsPerDay: zeroFillDays(daily, days, now),
    topActions: topN(actionCounts, 6),
    topTables: topN(tableCounts, 6),
  }
}

/** Shape raw ai_token_logs rows into the AI-usage slice. */
export function shapeAiUsage(rows, days = WINDOW_DAYS, now = new Date()) {
  const list = Array.isArray(rows) ? rows : []
  const byDay = new Map()
  const byFeature = new Map()
  let totalCost = 0
  let totalTokens = 0
  for (const log of list) {
    const cost = estimateAiCost(log)
    const tokens = (log?.prompt_tokens ?? 0) + (log?.completion_tokens ?? 0)
    totalCost += cost
    totalTokens += tokens
    const day = typeof log?.created_at === 'string' ? log.created_at.slice(0, 10) : toDayKey(log?.created_at)
    if (day) {
      if (!byDay.has(day)) byDay.set(day, { date: day, cost: 0, tokens: 0, calls: 0 })
      const d = byDay.get(day)
      d.cost += cost; d.tokens += tokens; d.calls += 1
    }
    const feature = log?.feature ?? 'other'
    if (!byFeature.has(feature)) byFeature.set(feature, { feature, cost: 0, tokens: 0, calls: 0 })
    const f = byFeature.get(feature)
    f.cost += cost; f.tokens += tokens; f.calls += 1
  }
  return {
    totalCost,
    totalTokens,
    totalCalls: list.length,
    costPerDay: zeroFillDays([...byDay.values()], days, now),
    byFeature: [...byFeature.values()].sort((a, b) => b.cost - a.cost),
  }
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

function sinceIso(days = WINDOW_DAYS) {
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

/** profiles: totals, role split, approval + lock state, 30-day signups. */
export async function fetchUserStats() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, username, role, approved, locked, created_at')
    .order('created_at', { ascending: false })
    .limit(PROFILE_ROW_LIMIT)
  if (error) throw error
  return shapeUserStats(data ?? [])
}

/** audit_log_v2 (last 30 days): events/day, active users, top actions/tables. */
export async function fetchActivityStats(days = WINDOW_DAYS) {
  const { data, error } = await supabase
    .from('audit_log_v2')
    .select('user_id, action, table_name, created_at')
    .gte('created_at', sinceIso(days))
    .order('created_at', { ascending: false })
    .limit(ACTIVITY_ROW_LIMIT)
  if (error) throw error
  return shapeActivityStats(data ?? [], days)
}

/**
 * ai_token_logs (last 30 days) — same columns AiCostMonitor selects.
 * An empty table is a valid state (feature not wired yet), not an error.
 */
export async function fetchAiUsage(days = WINDOW_DAYS) {
  const { data, error } = await supabase
    .from('ai_token_logs')
    .select('id, model, feature, prompt_tokens, completion_tokens, cost_usd, created_at')
    .gte('created_at', sinceIso(days))
    .order('created_at', { ascending: false })
    .limit(AI_LOG_ROW_LIMIT)
  if (error) throw error
  return shapeAiUsage(data ?? [], days)
}

/** Head-count every growth table in parallel; per-table failures isolated. */
export async function fetchDataGrowth() {
  const settled = await Promise.allSettled(
    GROWTH_TABLES.map(async ({ table, label }) => {
      const { count, error } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
      if (error) throw error
      return { table, label, count: count ?? 0, error: null }
    }),
  )
  const tables = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { ...GROWTH_TABLES[i], count: null, error: s.reason?.message ?? 'Query failed' },
  )
  const totalRecords = tables.reduce((sum, t) => sum + (t.count ?? 0), 0)
  return { tables, totalRecords }
}

/** Module adoption from 30-day audit activity (table_name → module). */
export async function fetchModuleAdoption(days = WINDOW_DAYS) {
  const { data, error } = await supabase
    .from('audit_log_v2')
    .select('table_name')
    .gte('created_at', sinceIso(days))
    .limit(ACTIVITY_ROW_LIMIT)
  if (error) throw error
  return buildModuleAdoption(data ?? [])
}

// ── Orchestration ─────────────────────────────────────────────────────────────

/**
 * Run every slice in parallel with per-slice isolation. Each slice resolves
 * to { status: 'ok', data } or { status: 'error', error }, so the page can
 * render every healthy section even when one query fails (RLS drift, missing
 * table, etc.). Returns { users, activity, ai, growth, adoption, generatedAt }.
 */
export async function runTenantReport(days = WINDOW_DAYS) {
  const slices = [
    ['users',    fetchUserStats()],
    ['activity', fetchActivityStats(days)],
    ['ai',       fetchAiUsage(days)],
    ['growth',   fetchDataGrowth()],
    ['adoption', fetchModuleAdoption(days)],
  ]
  const settled = await Promise.allSettled(slices.map(([, p]) => p))
  const report = { generatedAt: new Date().toISOString(), windowDays: days }
  slices.forEach(([key], i) => {
    const s = settled[i]
    report[key] = s.status === 'fulfilled'
      ? { status: 'ok', data: s.value, error: null }
      : { status: 'error', data: null, error: s.reason?.message ?? 'Query failed' }
  })
  return report
}
