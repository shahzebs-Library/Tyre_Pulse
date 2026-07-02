// ─────────────────────────────────────────────────────────────────────────────
// tyreEngineerAgent.js - Wear patterns, pressure, alignment, root cause
// Routes technical tyre failure diagnosis and engineering analysis queries.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../supabase'
import { retrieveVehicleContext, assembleContext, getCached, setCache } from '../ragService'
import { computeCpkByAsset, computeFailureRate, computeCpkByBrand } from '../kpiEngine'
import { callAiEdgeFunction } from './index'

const SYSTEM_PROMPT = `You are TyrePulse Tyre Engineer Agent - a senior tyre engineer and reliability specialist with 20+ years of fleet tyre management experience.
Your expertise: root cause analysis, wear pattern diagnosis, pressure and inflation failure modes, wheel alignment issues, suspension problems, overloading, and driver behaviour impact.

For every diagnosis provide exactly this structure:

1. Observation: Specific tyre data observations - what the numbers and patterns indicate (2-3 sentences with actual values)
2. Root Cause: Primary cause and contributing factors - be specific about which failure mode applies (e.g., under-inflation, misalignment, overloading)
3. Risk Level: Low | Medium | High | Critical - include fleet safety and financial risk
4. Action Plan: Numbered, specific immediate actions, short-term corrective steps, and long-term preventive measures
5. Cost Impact: Estimated annual financial impact if root cause is not corrected

Tyre engineering principles to apply:
- Under-inflation → centre wear, heat buildup, ply separation, bead damage
- Over-inflation → centre wear, reduced traction, impact damage susceptibility
- Misalignment → shoulder wear (one-sided), feather wear
- Overloading → sidewall stress, bead damage, accelerated centre wear
- Driver behaviour → irregular wear, excessive scrap rates, rapid life reduction
- Poor rotation → uneven fleet wear, premature replacements

Reference actual data from context. Be technical but actionable.`

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
      ? `Records analysed: ${records.length} | Failure rate: ${((failureStats.failureRate ?? 0) * 100).toFixed(1)}% | Critical: ${((failureStats.criticalRate ?? 0) * 100).toFixed(1)}%`
      : '',
    failureStats.bySite?.length
      ? `Worst site by failure rate: ${failureStats.bySite[0]?.site} (${(failureStats.bySite[0]?.rate * 100).toFixed(1)}%)`
      : '',
    worstAssets.length
      ? `Worst vehicles by CPK: ${worstAssets.slice(0, 5).map(a => `${a.asset_no} (${a.avgCpk?.toFixed(3)})`).join(', ')}`
      : '',
    failureByBrand.length
      ? `Brand CPK ranking: ${failureByBrand.map(b => `${b.brand} (${b.avgCpk?.toFixed(3)})`).join(', ')}`
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
