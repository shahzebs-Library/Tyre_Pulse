// tools.ts - read-only data tools for the ai-orchestrator.
//
// SECURITY: every tool runs on the CALLER'S client (their JWT), never the
// service role. Row-level security plus the country/site guards inside each
// RPC therefore decide what the model can see - a KSA-only manager gets KSA
// data, exactly as on screen. The service role is only used for logging.
//
// ACCURACY: numerical answers come from the same authoritative RPCs the app
// screens use (weighted CPK, running life, evidence audit...). No figures are
// recomputed here. Each result carries _provenance (rpc, params, time, rows,
// truncation) so the answer can state its coverage.
//
// Pure: no Deno imports, so vitest exercises it with a mock client.

import { sanitizeErrorText, safeRefusalReason, cleanPromptText } from '../_shared/aiSecurity.ts'

import { NO_KNOWLEDGE_MATCH, citation, pageRange } from './knowledge.ts'

export const MAX_TOOL_OUTPUT = 12000

type Db = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any
}

export type ToolContext = {
  orgId: string | null
  now?: () => Date
  embedQuery?: (text: string) => Promise<number[] | null>
}

const COUNTABLE: Record<string, { table: string; dateCol: string }> = {
  vehicles: { table: 'vehicle_fleet', dateCol: 'created_at' },
  tyres: { table: 'tyre_records', dateCol: 'issue_date' },
  inspections: { table: 'inspections', dateCol: 'inspection_date' },
  work_orders: { table: 'work_orders', dateCol: 'opened_at' },
  accidents: { table: 'accidents', dateCol: 'incident_date' },
  corrective_actions: { table: 'corrective_actions', dateCol: 'created_at' },
}

const scope = {
  country: { type: 'string', description: 'KSA, UAE or Egypt. Omit for every country the user can see.' },
  site: { type: 'string', description: 'Optional site name' },
  from: { type: 'string', description: 'Start date YYYY-MM-DD' },
  to: { type: 'string', description: 'End date YYYY-MM-DD' },
}

export const TOOL_DEFS = [
  { name: 'get_fleet_overview', description: 'Per-country tyre KPI summary: records, cost, average cost per tyre, high-risk count, average CPK, open/overdue corrective actions, latest data date.', input_schema: { type: 'object', properties: { country: scope.country } } },
  { name: 'get_cost_cpk_overview', description: 'Expense-grid cost split (tyre/spare/oil) with cost per km and comparison windows for a country and period. Authoritative spend source.', input_schema: { type: 'object', properties: scope } },
  { name: 'get_fleet_cpk', description: 'Authoritative weighted fleet CPK (total cost / total km) per vehicle type and per vehicle, movable (per km) and plant (per engine hour).', input_schema: { type: 'object', properties: scope } },
  { name: 'get_brand_size_cpk', description: 'Lifetime CPK by brand and size with sample sizes; use for brand/vendor comparison.', input_schema: { type: 'object', properties: scope } },
  { name: 'get_tyre_running_life', description: 'Active tyres against their current meters: km/hours run, expected life, remaining life, due state. Use for replacement planning and premature wear.', input_schema: { type: 'object', properties: { country: scope.country, asset: { type: 'string', description: 'Optional asset number' }, due_only: { type: 'boolean', description: 'Only tyres due or overdue (default true)' }, limit: { type: 'integer', description: 'Max rows (default 30, max 50)' } } } },
  { name: 'get_tyre_consumption', description: 'Tyres fitted per period (new, refit, transferred) by week and month.', input_schema: { type: 'object', properties: { country: scope.country, from: scope.from, to: scope.to } } },
  { name: 'get_tyre_evidence_audit', description: 'Evidence classification of tyre fitments from 2025-01-01: verified vs estimated, blank serials, duplicates, legacy actives, installs vs ERP issued quantity.', input_schema: { type: 'object', properties: { country: scope.country, from: scope.from, to: scope.to } } },
  { name: 'get_tyre_exceptions', description: 'Current tyre data exceptions: serials on two vehicles, double-active wheels, reversed dates, price anomalies.', input_schema: { type: 'object', properties: { country: scope.country } } },
  { name: 'get_maintenance_snapshot', description: 'Job card counts and maintenance spend by type, site and asset for a period.', input_schema: { type: 'object', properties: scope } },
  { name: 'get_data_trust_overview', description: 'Data-quality scores and reasons per KPI domain (completeness, validity, consistency).', input_schema: { type: 'object', properties: { country: scope.country, from: scope.from, to: scope.to } } },
  { name: 'count_records', description: 'Count records the user can see. Resources: ' + Object.keys(COUNTABLE).join(', ') + '. Optional site and since-date (business date).', input_schema: { type: 'object', properties: { resource: { type: 'string', enum: Object.keys(COUNTABLE) }, site: scope.site, since: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['resource'] } },
  { name: 'list_recent_events', description: 'Most recent business events (inspections, tyre changes, accidents, approvals).', input_schema: { type: 'object', properties: { event_type: { type: 'string' }, limit: { type: 'integer', description: 'Default 20, max 50' } } } },
  { name: 'search_knowledge_base', description: 'Search APPROVED, in-date company documents (SOPs, manuals, policies, RCA reports). Use for procedures and standards, never for operational figures. Quote the cite value for every policy statement.', input_schema: { type: 'object', properties: { query: { type: 'string' }, doc_type: { type: 'string', enum: ['sop', 'manual', 'policy', 'inspection', 'rca', 'vendor', 'other'] } }, required: ['query'] } },
]

export function toolDefsFor(names: string[]) {
  const set = new Set(names)
  return TOOL_DEFS.filter((t) => set.has(t.name))
}

// ── input sanitising ──────────────────────────────────────────────────────
const COUNTRIES = ['KSA', 'UAE', 'Egypt']

export function cleanCountry(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s || /^all$/i.test(s)) return null
  const hit = COUNTRIES.find((c) => c.toLowerCase() === s.toLowerCase())
  return hit ?? null
}

export function cleanDate(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(s + 'T00:00:00Z')
  return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s
}

// Control characters / line breaks are collapsed: these values are echoed into
// _provenance, which the model reads, so they must not carry fake prompt lines.
export function cleanText(v: unknown, max = 80): string | null {
  return cleanPromptText(v, max)
}

function clampInt(v: unknown, def: number, min: number, max: number) {
  const n = Math.trunc(Number(v))
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def
}

export function rowCount(data: unknown): number | null {
  if (Array.isArray(data)) return data.length
  if (data && typeof data === 'object') {
    for (const k of ['rows', 'items', 'per_vehicle', 'tyres', 'by_asset']) {
      const v = (data as Record<string, unknown>)[k]
      if (Array.isArray(v)) return v.length
    }
  }
  return null
}

export type ToolResult = { ok: boolean; output: string; provenance: Record<string, unknown> }

export function packResult(tool: string, source: string, params: Record<string, unknown>, data: unknown, now: Date, notes: string[] = []): ToolResult {
  const body = { _provenance: { tool, source, params, generated_at: now.toISOString(), rows: rowCount(data), notes }, data }
  let text = JSON.stringify(body)
  const truncated = text.length > MAX_TOOL_OUTPUT
  if (truncated) {
    body._provenance.notes = [...notes, 'Result truncated for length; figures shown are partial. Ask a narrower question (one country, site or asset).']
    text = JSON.stringify(body).slice(0, MAX_TOOL_OUTPUT)
  }
  return { ok: true, output: text, provenance: { ...body._provenance, truncated } }
}

function fail(tool: string, msg: string): ToolResult {
  return { ok: false, output: `${tool} unavailable: ${msg}`, provenance: { tool, error: msg } }
}

// Sanitise provider error text: never echo SQL / internals to the model.
function safeErr(e: { message?: string } | null | undefined): string {
  return sanitizeErrorText(e)
}

async function callRpc(db: Db, tool: string, fn: string, args: Record<string, unknown>, now: Date, notes: string[] = []): Promise<ToolResult> {
  const { data, error } = await db.rpc(fn, args)
  if (error) return fail(tool, safeErr(error))
  if (data && typeof data === 'object' && (data as Record<string, unknown>).ok === false) {
    return fail(tool, safeRefusalReason((data as Record<string, unknown>).reason))
  }
  return packResult(tool, fn, args, data, now, notes)
}

export async function runTool(db: Db, ctx: ToolContext, name: string, input: Record<string, unknown> = {}): Promise<ToolResult> {
  const now = ctx.now ? ctx.now() : new Date()
  const country = cleanCountry(input.country)
  const site = cleanText(input.site)
  const from = cleanDate(input.from)
  const to = cleanDate(input.to)
  const notes: string[] = []
  if (input.country && !country) notes.push(`Unknown country "${cleanPromptText(input.country, 20) ?? ''}" ignored; showing every country the user can see.`)
  if ((input.from && !from) || (input.to && !to)) notes.push('An invalid date was ignored (use YYYY-MM-DD).')
  if (from && to && from > to) return fail(name, 'start date is after end date')

  switch (name) {
    case 'get_fleet_overview':
      return callRpc(db, name, 'get_country_kpi', { p_country: country }, now, notes)
    case 'get_cost_cpk_overview':
      return callRpc(db, name, 'get_cost_cpk_overview', { p_country: country, p_site: site, p_from: from, p_to: to }, now, notes)
    case 'get_fleet_cpk':
      return callRpc(db, name, 'get_fleet_cpk', { p_country: country, p_from: from, p_to: to, p_site: site }, now, notes)
    case 'get_brand_size_cpk':
      return callRpc(db, name, 'get_brand_size_cpk', { p_country: country, p_from: from, p_to: to, p_site: site }, now, notes)
    case 'get_tyre_running_life':
      return callRpc(db, name, 'get_tyre_running_life', {
        p_country: country, p_limit: clampInt(input.limit, 30, 1, 50), p_offset: 0,
        p_asset: cleanText(input.asset, 30), p_due_only: input.due_only !== false,
      }, now, notes)
    case 'get_tyre_consumption':
      return callRpc(db, name, 'get_tyre_consumption', { p_country: country, p_from: from, p_to: to }, now, notes)
    case 'get_tyre_evidence_audit':
      return callRpc(db, name, 'get_tyre_evidence_audit', { p_country: country, p_from: from ?? '2025-01-01', p_to: to }, now, notes)
    case 'get_tyre_exceptions':
      return callRpc(db, name, 'get_tyre_exceptions', { p_country: country }, now, notes)
    case 'get_maintenance_snapshot':
      return callRpc(db, name, 'get_maintenance_snapshot', { p_site: site, p_country: country, p_from: from, p_to: to }, now, notes)
    case 'get_data_trust_overview':
      return callRpc(db, name, 'get_data_trust_overview', { p_country: country, p_from: from, p_to: to }, now, notes)
    case 'count_records': {
      const spec = COUNTABLE[String(input.resource ?? '')]
      if (!spec) return fail(name, 'unknown resource')
      let q = db.from(spec.table).select('id', { count: 'exact', head: true })
      if (site) q = q.eq('site', site)
      const since = cleanDate(input.since)
      if (since) q = q.gte(spec.dateCol, since)
      const { count, error } = await q
      if (error) return fail(name, safeErr(error))
      return packResult(name, spec.table, { resource: input.resource, site, since }, { count: count ?? 0 }, now, notes)
    }
    case 'list_recent_events': {
      const limit = clampInt(input.limit, 20, 1, 50)
      let q = db.from('domain_events').select('id,event_type,entity_type,entity_id,created_at').order('id', { ascending: false }).limit(limit)
      // Event types are dotted lower-case tokens (inspection.created ...); anything else is ignored.
      const etRaw = cleanText(input.event_type, 60)
      const et = etRaw && /^[a-z0-9_.]+$/.test(etRaw) ? etRaw : null
      if (etRaw && !et) notes.push('An invalid event type filter was ignored.')
      if (et) q = q.eq('event_type', et)
      const { data, error } = await q
      if (error) return fail(name, safeErr(error))
      return packResult(name, 'domain_events', { limit, event_type: et }, data ?? [], now, notes)
    }
    case 'search_knowledge_base': {
      if (!ctx.orgId) return fail(name, 'no organisation context')
      const query = cleanText(input.query, 500)
      if (!query) return fail(name, 'empty query')
      const embedding = ctx.embedQuery ? await ctx.embedQuery(query) : null
      if (!embedding) return fail(name, 'knowledge search is not configured')
      const { data, error } = await db.rpc('match_knowledge_documents', {
        query_embedding: embedding, match_count: 5,
        filter_doc_type: cleanText(input.doc_type, 20), filter_site: null, filter_org: ctx.orgId,
      })
      if (error) return fail(name, safeErr(error))
      // Approved, in-date documents only (lifecycle migration 20261112103000); rows
      // without status 'approved' are dropped again here as defence in depth.
      const docs = (Array.isArray(data) ? data : [])
        .filter((d: Record<string, unknown>) => String(d?.status ?? '').trim().toLowerCase() === 'approved')
        .map((d: Record<string, unknown>) => ({
          document_id: String(d.document_id ?? d.id ?? ''), title: d.title, version: d.version ?? null,
          page: pageRange(d), doc_type: d.doc_type, similarity: d.similarity, cite: citation(d),
          excerpt: String(d.content ?? '').slice(0, 800),
        }))
      if (!docs.length) notes.push(NO_KNOWLEDGE_MATCH)
      else notes.push('Cite each company policy fact with its "cite" value.')
      return packResult(name, 'knowledge_documents', { doc_type: input.doc_type ?? null }, docs, now, notes)
    }
    default:
      return fail(name, 'unknown tool')
  }
}

/** Deterministic coverage list built from provenance, never from model text. */
export function coverageFrom(results: Array<{ tool: string; ok: boolean; provenance: Record<string, unknown> }>) {
  return results.map((r) => ({
    tool: r.tool,
    ok: r.ok,
    source: r.provenance.source ?? null,
    generated_at: r.provenance.generated_at ?? null,
    rows: r.provenance.rows ?? null,
    truncated: r.provenance.truncated === true,
    notes: (r.provenance.notes as string[] | undefined) ?? [],
    error: r.ok ? null : (r.provenance.error ?? 'unavailable'),
  }))
}
