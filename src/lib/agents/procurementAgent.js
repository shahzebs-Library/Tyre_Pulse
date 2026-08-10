// ─────────────────────────────────────────────────────────────────────────────
// procurementAgent.js - Procurement & Vendor specialist.
// Handles "which brand/supplier is best value", brand ranking and purchase
// planning questions. Grounds every recommendation in realized fleet CPK, life
// and failure rate (kpiEngine) over the loaded tyre records - never a generic
// opinion.
// ─────────────────────────────────────────────────────────────────────────────
import { computeCpkByBrand, computeAvgTyreLife, computeFailureRate, computeVendorPerformance } from '../kpiEngine'
import { getCached, setCache } from '../ragService'
import { callAiEdgeFunction } from './index'

const SYSTEM_PROMPT = `You are TyrePulse Procurement Agent - a senior fleet procurement and vendor-performance specialist.
Your role: rank tyre brands/suppliers by REALIZED value (cost per km, average life, failure rate) and advise what to buy.

Always answer in exactly this structure:
1. Observation: the brand/vendor ranking with concrete CPK, life and failure numbers
2. Best value: the brand(s) offering the best realized value, and the worst to avoid
3. Risk Level: Low | Medium | High | Critical (data confidence + concentration risk)
4. Action Plan: 3-5 numbered procurement actions (what to order, from where, in what share)
5. Savings Impact: estimated CPK/cost benefit of shifting the mix

Rules:
- Use only the realized figures provided; if a brand has too few records, say so - do not rank on thin data.
- Value = cost per km first, then life and failure rate; cheapest unit price is not best value.
- Currency is the fleet's reporting currency (SAR unless indicated).`

/**
 * Run the Procurement & Vendor agent.
 * @param {string} query
 * @param {object} ctx { records, site }
 * @returns {Promise<{response:string, agentType:string, vendorRank:Array}>}
 */
export async function runProcurementAgent(query, { records = [], site = null } = {}) {
  const cacheKey = `procurement:${query}:${site ?? 'all'}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const data = Array.isArray(records) ? records : []
  const byBrand = computeCpkByBrand(data)
  const vendorRank = computeVendorPerformance(data).slice(0, 8)
  const life = computeAvgTyreLife(data)
  const failure = computeFailureRate(data)

  const brandLines = vendorRank.length
    ? vendorRank.map((b) => `- ${b.brand}: CPK ${b.avgCpk?.toFixed?.(3) ?? 'N/A'}, records ${b.count ?? b.records ?? 'N/A'}`).join('\n')
    : 'No brand-level records available (brand is blank on the loaded records).'

  const digest = [
    `Records in context: ${data.length}`,
    `Fleet avg tyre life: ${life.avgKm?.toFixed?.(0) ?? 'N/A'} km | failure rate: ${failure.failureRate == null ? 'not measured' : ((failure.failureRate * 100).toFixed(1) + '%')}`,
    `Distinct brands: ${byBrand.length}`,
    'Brand ranking (best CPK first):',
    brandLines,
  ].join('\n')

  const userPrompt = `## Procurement context\n${digest}\n\n## User query\n${query}`
  const response = await callAiEdgeFunction(SYSTEM_PROMPT, userPrompt)
  const result = { response, agentType: 'procurement', vendorRank }
  setCache(cacheKey, result)
  return result
}
