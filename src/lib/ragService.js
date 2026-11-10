// ─────────────────────────────────────────────────────────────────────────────
// ragService.js - Retrieval-Augmented Generation service for TyrePulse AI OS
// Provides selective context retrieval to minimise AI token usage.
// No full-table scans. Always retrieve only relevant context.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase'
import { toLifetimeTyres, weightedCpk, lifetimeSummary, withOnePricePerTyre, CPK_KIND, CPK_KIND_LABEL } from './tyreLifetime'
import { citationLabel } from './knowledgeLifecycle'

/** tyre_changes carries the serial as tyre_serial; the lifetime layer reads serial_no. */
const withSerial = (r) => (r && !r.serial_no && r.tyre_serial ? { ...r, serial_no: r.tyre_serial } : r)

/**
 * Tyre KPIs for the AI context, per PHYSICAL tyre (src/lib/tyreLifetime.js):
 * purchase price counted once, km summed over every fitment by the shared km
 * rule, CPK WEIGHTED (total cost / total tyre-km). Replacements / failures stay
 * per fitment row (events). Coverage travels with the figure so the AI never
 * states a CPK more confidently than the data supports.
 * @param {Object[]} rows tyre change (fitment) rows
 */
export function summarizeTyreKpis(rows = []) {
  const list = (rows || []).filter(Boolean).map(withSerial)
  const tyres = toLifetimeTyres(list)
  const sum = lifetimeSummary(tyres)
  const lives = tyres.map(t => Number(t._life_km)).filter(v => Number.isFinite(v) && v > 0)
  const priced = tyres.filter(t => (Number(t._cost) || 0) > 0)
  const failureCount = list.filter(r => r.risk_level === 'High' || r.risk_level === 'Critical').length
  return {
    avgCpk: sum.measurable ? weightedCpk(tyres) : null,
    cpkKind: CPK_KIND.TYRE_LIFETIME,
    cpkKindLabel: CPK_KIND_LABEL[CPK_KIND.TYRE_LIFETIME],
    avgLifeKm: lives.length ? lives.reduce((s, v) => s + v, 0) / lives.length : null,
    totalTyreCost: priced.length ? priced.reduce((s, t) => s + t._cost * (t._qty || 1), 0) : null,
    physicalTyres: tyres.reduce((s, t) => s + (t._qty || 1), 0),
    measurableTyres: sum.measurable,
    provisionalTyres: sum.provisional,
    kmCoverage: sum.coverage,
    estimatedShare: sum.estimatedShare,
    totalReplacements: list.length,      // fitment rows (events)
    failureCount,                        // per fitment row (events)
    failureRate: list.length > 0 ? failureCount / list.length : 0,
  }
}

/** One plain sentence stating which CPK this is and what it rests on. */
export function describeCpkBasis(k) {
  if (!k || k.avgCpk == null) return 'CPK: N/A (no physical tyre with both a price and a measured life)'
  return `CPK is the ${k.cpkKindLabel ?? 'physical tyre lifetime CPK'}, weighted per tyre-km (each tyre priced once, km summed over its fitments): ` +
    `${k.measurableTyres} of ${k.physicalTyres} tyres measurable, ${k.provisionalTyres} provisional (still fitted or km incomplete)` +
    (k.estimatedShare != null && k.estimatedShare > 0 ? `, ${(k.estimatedShare * 100).toFixed(0)}% of the cost is an estimated price` : '')
}

// ── In-memory LRU-style cache ─────────────────────────────────────────────────

const _cache = new Map()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export function getCached(key) {
  const entry = _cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    _cache.delete(key)
    return null
  }
  return entry.value
}

export function setCache(key, value) {
  if (_cache.size >= 100) {
    const oldestKey = _cache.keys().next().value
    _cache.delete(oldestKey)
  }
  _cache.set(key, { value, ts: Date.now() })
}

export function clearCache() {
  _cache.clear()
}

// ── Vehicle Context Retrieval ─────────────────────────────────────────────────

/**
 * Retrieve full context for a single vehicle (asset).
 * Returns tyre history, recent inspections, corrective actions, and KPI summary.
 * @param {string} assetNo
 * @returns {Promise<Object|null>}
 */
export async function retrieveVehicleContext(assetNo) {
  if (!assetNo) return null

  const cacheKey = `vehicle:${assetNo}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const [tyreResult, inspResult, actionResult, fleetResult] = await Promise.all([
    supabase
      .from('tyre_changes')
      .select('asset_no, tyre_serial, brand, position, km_at_fitment, km_at_removal, cost_per_tyre, issue_date, removal_date, risk_level, category, site, removal_reason')
      .eq('asset_no', assetNo)
      .order('issue_date', { ascending: false })
      .limit(50),

    supabase
      .from('inspections')
      .select('asset_no, scheduled_date, completed_date, status, findings, site, inspector')
      .eq('asset_no', assetNo)
      .order('scheduled_date', { ascending: false })
      .limit(20),

    supabase
      .from('corrective_actions')
      .select('asset_no, description, status, priority, site, created_at, closed_at')
      .eq('asset_no', assetNo)
      .order('created_at', { ascending: false })
      .limit(10),

    supabase
      .from('vehicle_fleet')
      .select('asset_no, vehicle_type, make, model, registration:registration_no, site, fleet_number')
      .eq('asset_no', assetNo)
      .limit(1)
      .maybeSingle(),
  ])

  const tyreHistory = tyreResult.data ?? []
  const inspectionHistory = inspResult.data ?? []
  const actions = actionResult.data ?? []
  const fleetInfo = fleetResult.data ?? null

  // Per physical tyre (price once, km summed, weighted CPK). This history holds
  // only fitments on THIS vehicle, so km a tyre ran elsewhere is not included.
  const vehicleKpis = summarizeTyreKpis(tyreHistory)

  const result = {
    assetNo,
    fleetInfo,
    tyreHistory,
    inspectionHistory,
    actions,
    vehicleKpis,
    retrievedAt: new Date().toISOString(),
  }

  setCache(cacheKey, result)
  return result
}

// ── Fleet KPI Context Retrieval ───────────────────────────────────────────────

/**
 * Retrieve a recent subset of tyre change records for fleet-level KPI context.
 * Applies site filter and date window to keep token usage lean.
 * @param {string|null} site   - filter to specific site, or null for all
 * @param {number}      limit  - max records to retrieve (default 300)
 * @param {number}      months - how many months back (default 6)
 * @returns {Promise<Object[]>}
 */
export async function retrieveFleetKpiContext(site = null, limit = 300, months = 6) {
  const cacheKey = `fleet-kpi:${site ?? 'all'}:${limit}:${months}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const cutoffDate = new Date()
  cutoffDate.setMonth(cutoffDate.getMonth() - months)
  const cutoff = cutoffDate.toISOString().split('T')[0]

  let query = supabase
    .from('tyre_changes')
    .select('asset_no, tyre_serial, brand, position, km_at_fitment, km_at_removal, cost_per_tyre, issue_date, removal_date, risk_level, category, site, removal_reason, qty')
    .gte('issue_date', cutoff)
    .order('issue_date', { ascending: false })
    .limit(limit)

  if (site) query = query.eq('site', site)

  const { data, error } = await query
  if (error) {
    console.error('retrieveFleetKpiContext error:', error)
    return []
  }

  const result = data ?? []
  setCache(cacheKey, result)
  return result
}

/**
 * Retrieve inspections for fleet-level compliance context.
 * @param {string|null} site
 * @param {number}      limit
 * @param {number}      months
 * @returns {Promise<Object[]>}
 */
export async function retrieveInspectionContext(site = null, limit = 200, months = 3) {
  const cacheKey = `inspections:${site ?? 'all'}:${limit}:${months}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const cutoffDate = new Date()
  cutoffDate.setMonth(cutoffDate.getMonth() - months)
  const cutoff = cutoffDate.toISOString().split('T')[0]

  let query = supabase
    .from('inspections')
    .select('asset_no, scheduled_date, completed_date, status, findings, site, inspector')
    .gte('scheduled_date', cutoff)
    .order('scheduled_date', { ascending: false })
    .limit(limit)

  if (site) query = query.eq('site', site)

  const { data, error } = await query
  if (error) {
    console.error('retrieveInspectionContext error:', error)
    return []
  }

  const result = data ?? []
  setCache(cacheKey, result)
  return result
}

// ── Vector Similarity Search ──────────────────────────────────────────────────

/**
 * Search knowledge base documents by vector similarity.
 * Falls back gracefully if RPC is unavailable.
 * @param {number[]} queryEmbedding
 * @param {Object}   opts
 * @returns {Promise<Object[]>}
 */
export async function searchKnowledgeBase(queryEmbedding, {
  matchCount = 5,
  docType = null,
  site = null,
} = {}) {
  if (!queryEmbedding || !queryEmbedding.length) return []

  const { data, error } = await supabase.rpc('match_knowledge_documents', {
    query_embedding: queryEmbedding,
    match_count: matchCount,
    filter_doc_type: docType,
    filter_site: site,
  })
  if (error) {
    console.warn('Knowledge base vector search unavailable, falling back to keyword search.')
    return []
  }
  return data ?? []
}

/**
 * Search inspection findings by vector similarity.
 * @param {number[]} queryEmbedding
 * @param {Object}   opts
 * @returns {Promise<Object[]>}
 */
export async function searchInspectionFindings(queryEmbedding, {
  matchCount = 10,
  site = null,
} = {}) {
  if (!queryEmbedding || !queryEmbedding.length) return []

  const { data, error } = await supabase.rpc('match_inspection_findings', {
    query_embedding: queryEmbedding,
    match_count: matchCount,
    filter_site: site,
  })
  if (error) return []
  return data ?? []
}

// ── Alert Context Retrieval ───────────────────────────────────────────────────

/**
 * Retrieve high/critical risk records for alert context.
 * @param {string|null} severity - 'High' | 'Critical' | null for both
 * @param {number}      limit
 * @returns {Promise<Object[]>}
 */
export async function retrieveAlertContext(severity = null, limit = 50) {
  const cacheKey = `alerts:${severity ?? 'all'}:${limit}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  let query = supabase
    .from('tyre_changes')
    .select('asset_no, site, brand, position, risk_level, issue_date, removal_reason, category')
    .order('issue_date', { ascending: false })
    .limit(limit)

  if (severity) {
    query = query.eq('risk_level', severity)
  } else {
    query = query.in('risk_level', ['High', 'Critical'])
  }

  const { data, error } = await query
  if (error) {
    console.error('retrieveAlertContext error:', error)
    return []
  }

  const result = data ?? []
  setCache(cacheKey, result)
  return result
}

// ── Context Assembly ──────────────────────────────────────────────────────────

/**
 * Assemble a concise text context block from retrieved data.
 * Truncates intelligently to prevent token bloat.
 * @param {Object} params
 * @param {Object}   [params.vehicleContext]
 * @param {Object[]} [params.kpiData]
 * @param {Object[]} [params.knowledgeDocs]
 * @param {Object[]} [params.inspectionFindings]
 * @param {number}   [params.maxTokens=3000]
 * @returns {string}
 */
export function assembleContext({
  vehicleContext = null,
  kpiData = [],
  knowledgeDocs = [],
  inspectionFindings = [],
  maxTokens = 3000,
} = {}) {
  const sections = []

  // Vehicle-specific context
  if (vehicleContext) {
    const { assetNo, fleetInfo, vehicleKpis, tyreHistory, inspectionHistory } = vehicleContext
    const vehicleDesc = fleetInfo
      ? `${fleetInfo.vehicle_type ?? ''} ${fleetInfo.make ?? ''} ${fleetInfo.model ?? ''}`.trim()
      : ''
    sections.push(
      `VEHICLE: ${assetNo}${vehicleDesc ? ` | ${vehicleDesc}` : ''}\n` +
      `KPIs: CPK=${vehicleKpis.avgCpk?.toFixed(3) ?? 'N/A'} | Life=${vehicleKpis.avgLifeKm?.toFixed(0) ?? 'N/A'} km per physical tyre | ` +
      `TyrePurchaseCost=${vehicleKpis.totalTyreCost?.toFixed(0) ?? 'N/A'} | Fitments=${vehicleKpis.totalReplacements} | Failures=${vehicleKpis.failureCount}\n` +
      `${describeCpkBasis(vehicleKpis)} (fitments on this vehicle only)`
    )

    const recentChanges = (tyreHistory ?? []).slice(0, 5).map(r =>
      `  ${r.issue_date ?? 'N/A'} | ${r.brand ?? 'Unknown'} | Pos: ${r.position ?? '?'} | ${r.risk_level ?? 'N/A'} | ${r.removal_reason ?? ''}`
    )
    if (recentChanges.length) {
      sections.push(`RECENT TYRE CHANGES:\n${recentChanges.join('\n')}`)
    }

    const recentInspections = (inspectionHistory ?? []).slice(0, 3).map(i =>
      `  ${i.scheduled_date ?? 'N/A'} | ${i.status} | ${i.findings ? String(i.findings).slice(0, 120) : 'No findings'}`
    )
    if (recentInspections.length) {
      sections.push(`RECENT INSPECTIONS:\n${recentInspections.join('\n')}`)
    }
  }

  // Aggregate fleet context summary
  if (kpiData.length > 0) {
    const sites = [...new Set(kpiData.map(r => r.site).filter(Boolean))]
    const brands = [...new Set(kpiData.map(r => r.brand).filter(Boolean))]
    const assets = [...new Set(kpiData.map(r => r.asset_no).filter(Boolean))]
    // A refit of the same physical tyre is not a second purchase (rule T1).
    const totalCost = withOnePricePerTyre(kpiData.map(withSerial))
      .reduce((s, r) => s + (Number(r.cost_per_tyre) || 0) * (Number(r.qty) || 1), 0)
    const fleetKpis = summarizeTyreKpis(kpiData)
    const highRisk = kpiData.filter(r => r.risk_level === 'Critical' || r.risk_level === 'High').length
    const dateRange = kpiData.reduce((acc, r) => {
      if (r.issue_date) {
        if (!acc.min || r.issue_date < acc.min) acc.min = r.issue_date
        if (!acc.max || r.issue_date > acc.max) acc.max = r.issue_date
      }
      return acc
    }, { min: null, max: null })

    sections.push(
      `FLEET DATA SCOPE: ${kpiData.length} fitment records | ${fleetKpis.physicalTyres} physical tyres | ${assets.length} vehicles | ${sites.length} sites | ` +
      `Period: ${dateRange.min ?? 'N/A'} to ${dateRange.max ?? 'N/A'}\n` +
      `Fleet CPK=${fleetKpis.avgCpk?.toFixed(4) ?? 'N/A'}. ${describeCpkBasis(fleetKpis)}. Sample only, not the expense-grid total.\n` +
      `Tyre purchase cost in sample: ${totalCost.toFixed(0)} | High/Critical Risk: ${highRisk} (${kpiData.length > 0 ? ((highRisk / kpiData.length) * 100).toFixed(1) : 0}%)\n` +
      `Sites: ${sites.slice(0, 10).join(', ')}\n` +
      `Brands: ${brands.slice(0, 10).join(', ')}`
    )
  }

  // Inspection findings summary
  if (inspectionFindings.length > 0) {
    const pending = inspectionFindings.filter(i => i.status === 'Pending' || i.status === 'Overdue').length
    const done = inspectionFindings.filter(i => i.status === 'Done').length
    sections.push(`INSPECTIONS: ${inspectionFindings.length} total | Done: ${done} | Pending/Overdue: ${pending}`)
  }

  // Knowledge base documents (truncated for token efficiency)
  if (knowledgeDocs.length > 0) {
    // Cite by document id + title + version + page (approved, in-date
    // documents only - match_knowledge_documents filters by lifecycle).
    const docSummaries = knowledgeDocs.map(d =>
      `  [${d.doc_type ?? 'DOC'}] ${citationLabel(d)}: ${String(d.content ?? '').slice(0, 200)}`
    )
    sections.push(`KNOWLEDGE BASE (approved documents; cite the bracketed source, never invent policy):\n${docSummaries.join('\n')}`)
  }

  let context = sections.join('\n\n')
  // Enforce token limit: ~4 chars per token
  const maxChars = maxTokens * 4
  if (context.length > maxChars) {
    context = context.slice(0, maxChars) + '\n[Context truncated for token efficiency]'
  }
  return context || 'No additional context available.'
}
