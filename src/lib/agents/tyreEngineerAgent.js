// ─────────────────────────────────────────────────────────────────────────────
// tyreEngineerAgent.js - Wear patterns, pressure, alignment, root cause
// Routes technical tyre failure diagnosis and engineering analysis queries.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../supabase'
import { retrieveVehicleContext, assembleContext, getCached, setCache } from '../ragService'
import { computeCpkByAsset, computeFailureRate, computeCpkByBrand } from '../kpiEngine'
import { callAiEdgeFunction } from './index'
import { wearRulesText } from '../../../supabase/functions/_shared/aiAgents.ts'

// Wear guidance comes from the shared registry (WEAR_RULES) used by the server
// orchestrator too. It previously said under-inflation causes CENTRE wear, which
// is wrong: under-inflation points to SHOULDER wear, over-inflation to centre wear.
const SYSTEM_PROMPT = `You are TyrePulse Tyre Engineer Agent - a senior tyre engineer and reliability specialist.
Wear patterns are INDICATORS, not proof. Never state a root cause as confirmed unless the required evidence is in the context.

For every diagnosis use exactly this structure:
1. Facts: what the data shows, with actual values
2. Possible causes: hypotheses ranked by likelihood, not proof
3. Missing evidence: pressure, load, alignment or inspection data that is absent
4. Recommended verification: the checks that would confirm or rule out each cause
5. Risk level: Low | Medium | High | Critical, with the reason

Tyre engineering indicators:
${wearRulesText()}

Missing data is not zero. You cannot certify a tyre as safe.`

/**
 * Run the Tyre Engineer Agent for technical diagnosis and root cause queries.
 * @param {string} query
 * @param {Object} ctx
 * @param {string|null} [ctx.assetNo]      - specific vehicle to diagnose
 * @param {Object[]}    [ctx.records]      - fleet tyre records for pattern analysis
 * @param {Object[]}    [ctx.inspections]  - inspection records
 * @param {string|null} [ctx.site]         - site context
 * @returns {Promise<{ response: string, agentType: string, vehicleData: Object|null }>}
 */
export async function runTyreEngineerAgent(query, {
  assetNo = null,
  records = [],
  inspections = [],
  site = null,
} = {}) {
  const cacheKey = `engineer:${query}:${assetNo ?? 'fleet'}:${site ?? 'all'}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  // Retrieve vehicle-specific context if assetNo provided
  let vehicleData = null
  if (assetNo) {
    vehicleData = await retrieveVehicleContext(assetNo)
  }

  // Knowledge base keyword search (graceful fallback if table doesn't exist)
  let knowledgeDocs = []
  try {
    const keywords = query
      .split(/\s+/)
      .filter(w => w.length > 4)
      .slice(0, 5)
      .join(' & ')

    if (keywords) {
      const { data: docs } = await supabase
        .from('knowledge_documents')
        .select('title, content, doc_type')
        .textSearch('content', keywords, { type: 'websearch', config: 'english' })
        .limit(3)
      knowledgeDocs = docs ?? []
    }
  } catch (_) {
    // Knowledge base table may not exist yet - continue without it
    knowledgeDocs = []
  }

  // Compute engineering KPIs from available records
  const worstAssets = computeCpkByAsset(records).slice(0, 10)
  const failureByBrand = computeCpkByBrand(records).slice(0, 5)
  const failureStats = computeFailureRate(records)

  // Build engineering context summary
  const engineeringSummary = [
    records.length
      ? `Records analysed: ${records.length} | Failure rate: ${failureStats.failureRate == null ? 'not measured' : ((failureStats.failureRate * 100).toFixed(1) + '%')} | Critical: ${failureStats.criticalRate == null ? 'not measured' : ((failureStats.criticalRate * 100).toFixed(1) + '%')}`
      : '',
    failureStats.bySite?.length
      ? `Worst site by failure rate: ${failureStats.bySite[0]?.site} (${(failureStats.bySite[0]?.rate * 100).toFixed(1)}%)`
      : '',
    worstAssets.length
      ? `Worst vehicles by lifetime tyre CPK (weighted): ${worstAssets.slice(0, 5).map(a => `${a.asset_no} (${(a.avgCpk != null ? a.avgCpk.toFixed(3) : 'N/A')})`).join(', ')}`
      : '',
    failureByBrand.length
      ? `Brand lifetime CPK ranking (weighted): ${failureByBrand.map(b => `${b.brand} (${(b.avgCpk != null ? b.avgCpk.toFixed(3) : 'N/A')})`).join(', ')}`
      : '',
  ].filter(Boolean).join('\n')

  const context = assembleContext({
    vehicleContext: vehicleData,
    kpiData: records.slice(0, 80),
    knowledgeDocs,
    inspectionFindings: vehicleData?.inspectionHistory ?? inspections.slice(0, 20),
  })

  const userPrompt = [
    engineeringSummary ? `## Engineering Data\n${engineeringSummary}` : '',
    `## Context\n${context}`,
    `## Engineer Query\n${query}`,
  ].filter(Boolean).join('\n\n')

  const response = await callAiEdgeFunction(SYSTEM_PROMPT, userPrompt, 'claude-haiku-4-5-20251001', 1800)
  const result = { response, agentType: 'tyre_engineer', vehicleData, failureStats, worstAssets }

  setCache(cacheKey, result)
  return result
}
