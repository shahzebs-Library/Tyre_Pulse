// ragService.js — Retrieval-Augmented Generation service for TyrePulse
// Handles: structured DB search + vector similarity search + context assembly
import { supabase } from './supabase'

// ── Structured Data Retrieval ─────────────────────────────────────────────────

export async function retrieveVehicleContext(assetNo, limit = 20) {
  const [records, inspections] = await Promise.all([
    supabase
      .from('tyre_records')
      .select('*')
      .eq('asset_no', assetNo)
      .order('issue_date', { ascending: false })
      .limit(limit),
    supabase
      .from('inspections')
      .select('*')
      .eq('asset_no', assetNo)
      .order('scheduled_date', { ascending: false })
      .limit(10),
  ])
  return {
    tyreHistory: records.data ?? [],
    inspectionHistory: inspections.data ?? [],
  }
}

export async function retrieveFleetKpiContext(site = null, limit = 500) {
  let query = supabase
    .from('tyre_records')
    .select('asset_no, site, brand, position, risk_level, category, km_at_fitment, km_at_removal, cost_per_tyre, issue_date')
    .order('issue_date', { ascending: false })
    .limit(limit)
  if (site) query = query.eq('site', site)
  const { data } = await query
  return data ?? []
}

export async function retrieveAlertContext(severity = null, limit = 50) {
  let query = supabase
    .from('tyre_records')
    .select('asset_no, site, brand, position, risk_level, issue_date, findings')
    .order('issue_date', { ascending: false })
    .limit(limit)
  if (severity) query = query.eq('risk_level', severity)
  const { data } = await query
  return data ?? []
}

// ── Vector Similarity Search ──────────────────────────────────────────────────

export async function searchKnowledgeBase(queryEmbedding, {
  matchCount = 5,
  docType = null,
  site = null,
} = {}) {
  const { data, error } = await supabase.rpc('match_knowledge_documents', {
    query_embedding: queryEmbedding,
    match_count: matchCount,
    filter_doc_type: docType,
    filter_site: site,
  })
  if (error) {
    console.error('Knowledge base search error:', error)
    return []
  }
  return data ?? []
}

export async function searchInspectionFindings(queryEmbedding, {
  matchCount = 10,
  site = null,
} = {}) {
  const { data, error } = await supabase.rpc('match_inspection_findings', {
    query_embedding: queryEmbedding,
    match_count: matchCount,
    filter_site: site,
  })
  if (error) return []
  return data ?? []
}

// ── Context Assembly ──────────────────────────────────────────────────────────

export function assembleContext({
  vehicleContext = null,
  kpiData = [],
  knowledgeDocs = [],
  inspectionFindings = [],
  maxTokens = 4000,
}) {
  const sections = []

  if (vehicleContext) {
    const recentTyres = vehicleContext.tyreHistory.slice(0, 5)
    sections.push(`## Vehicle History (${vehicleContext.tyreHistory[0]?.asset_no})\n` +
      recentTyres.map(r =>
        `- ${r.issue_date}: ${r.brand} ${r.position} — ${r.risk_level} risk, ` +
        `${r.km_at_removal ? `${r.km_at_removal - r.km_at_fitment}km life, ` : ''}` +
        `${r.cost_per_tyre ? `cost ${r.cost_per_tyre}` : ''}`
      ).join('\n')
    )
  }

  if (kpiData.length > 0) {
    const totalCost = kpiData.reduce((s, r) => s + (Number(r.cost_per_tyre) || 0), 0)
    const highRisk = kpiData.filter(r => r.risk_level === 'Critical' || r.risk_level === 'High').length
    sections.push(`## Fleet Summary\n- Records: ${kpiData.length}\n- Total cost: ${totalCost.toFixed(0)}\n- High/Critical risk: ${highRisk} (${kpiData.length > 0 ? ((highRisk/kpiData.length)*100).toFixed(1) : 0}%)`)
  }

  if (knowledgeDocs.length > 0) {
    sections.push('## Relevant Knowledge\n' +
      knowledgeDocs.map(d => `### ${d.title}\n${d.content.slice(0, 400)}...`).join('\n\n')
    )
  }

  if (inspectionFindings.length > 0) {
    sections.push('## Related Inspection Findings\n' +
      inspectionFindings.slice(0, 5).map(f =>
        `- ${f.asset_no} (${f.site}): ${f.content.slice(0, 150)}`
      ).join('\n')
    )
  }

  // Rough token limit: 1 token ≈ 4 chars
  let context = sections.join('\n\n')
  if (context.length > maxTokens * 4) {
    context = context.slice(0, maxTokens * 4) + '\n[Context truncated for token efficiency]'
  }
  return context
}

// ── Cache Layer ───────────────────────────────────────────────────────────────

const _cache = new Map()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export function getCached(key) {
  const entry = _cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > CACHE_TTL) { _cache.delete(key); return null }
  return entry.value
}

export function setCache(key, value) {
  _cache.set(key, { value, ts: Date.now() })
}

export function clearCache() {
  _cache.clear()
}
