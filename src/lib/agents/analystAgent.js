// ─────────────────────────────────────────────────────────────────────────────
// analystAgent.js - KPI trends, cost breakdown, fleet comparison
// Routes queries about metrics, performance, and comparative analysis.
// ─────────────────────────────────────────────────────────────────────────────

import {
  computeAllKpis,
  computeCostTrend,
  computeVendorPerformance,
  computeCpkBySite,
  computeFailureRate,
  computeAvgTyreLife,
} from '../kpiEngine'
import { retrieveFleetKpiContext, assembleContext, getCached, setCache } from '../ragService'
import { callAiEdgeFunction } from './index'

const SYSTEM_PROMPT = `You are TyrePulse Analyst Agent - a senior fleet data analyst and tyre cost specialist.
Your role: analyse fleet tyre KPIs, cost trends, brand performance, and comparative site/fleet data.

For every analysis always provide exactly this structure:

1. Observation: Specific data observations with numbers (2-3 sentences)
2. Root Cause: Primary driver behind the pattern observed (1-2 sentences)
3. Risk Level: Low | Medium | High | Critical (one word + brief justification)
4. Action Plan: 3-5 specific, numbered, actionable steps for management
5. KPI Impact: Estimated cost or efficiency impact if action is taken

Rules:
- Reference actual data values from context (CPK, cost figures, percentages)
- Be concise - every sentence must add value
- Currency is the fleet's reporting currency (SAR unless otherwise indicated)
- Flag data coverage gaps honestly
- Do not fabricate data not present in context`

/**
 * Run the Analyst Agent for KPI, trend, and comparison queries.
 * @param {string} query
 * @param {Object} ctx
 * @param {Object[]} [ctx.records]      - pre-loaded tyre change records
 * @param {Object[]} [ctx.inspections]  - pre-loaded inspection records
 * @param {Object[]} [ctx.actions]      - pre-loaded corrective action records
 * @param {string|null} [ctx.site]      - site filter
 * @returns {Promise<{ response: string, agentType: string, kpis: Object }>}
 */
export async function runAnalystAgent(query, {
  records = [],
  inspections = [],
  actions = [],
  site = null,
} = {}) {
  const cacheKey = `analyst:${query}:${site ?? 'all'}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  // Use provided records or retrieve a fresh context window
  let data = records
  if (!data.length) {
    data = await retrieveFleetKpiContext(site, 400, 6)
  }

  // Compute all KPIs from available data
  const kpis = computeAllKpis(data, inspections, actions)
  const costTrend = computeCostTrend(data)
  const vendorRank = computeVendorPerformance(data).slice(0, 5)
  const siteCpk = computeCpkBySite(data).slice(0, 5)
  const failureRate = computeFailureRate(data)
  const tyreLife = computeAvgTyreLife(data)

  // Build a concise KPI summary for the AI prompt (not a full dump)
  const kpiSummary = [
    `Fleet CPK: ${kpis.cpk.fleetAvgCpk?.toFixed(3) ?? 'N/A'} (median: ${kpis.cpk.medianCpk?.toFixed(3) ?? 'N/A'})`,
    `Data Coverage: ${kpis.cpk.coveragePct?.toFixed(1) ?? 0}% (${kpis.cpk.validCount ?? 0} / ${kpis.cpk.totalCount ?? 0} records valid)`,
    `Avg Tyre Life: ${tyreLife.avgKm?.toFixed(0) ?? 'N/A'} km (median: ${tyreLife.medianKm?.toFixed(0) ?? 'N/A'} km)`,
    `Failure Rate: ${((failureRate.failureRate ?? 0) * 100).toFixed(1)}% | Critical: ${((failureRate.criticalRate ?? 0) * 100).toFixed(1)}%`,
    `Inspection Compliance: ${kpis.inspectionCompliance?.compliancePct?.toFixed(1) ?? 'N/A'}%`,
    `Monthly Cost Trend: ${costTrend.trend} (slope: ${costTrend.slope?.toFixed(0) ?? 'N/A'} / month, forecast: ${costTrend.forecastNextMonth?.toFixed(0) ?? 'N/A'})`,
    `Avg Monthly Cost: ${costTrend.avgMonthlyCost?.toFixed(0) ?? 'N/A'}`,
    `Scrap Rate: ${((kpis.scrapRate?.scrapRate ?? 0) * 100).toFixed(1)}% (est. cost: ${kpis.scrapRate?.estimatedScrapCost?.toFixed(0) ?? 'N/A'})`,
    `Fleet Availability: ${kpis.fleetAvailability?.availabilityPct?.toFixed(1) ?? 'N/A'}%`,
    vendorRank.length
      ? `Top Brands (CPK, best first): ${vendorRank.map(b => `${b.brand} (${b.avgCpk?.toFixed(3)})`).join(', ')}`
      : '',
    siteCpk.length
      ? `Worst Sites by CPK: ${siteCpk.map(s => `${s.site} (${s.avgCpk?.toFixed(3)})`).join(', ')}`
      : '',
  ].filter(Boolean).join('\n')

  const context = assembleContext({ kpiData: data.slice(0, 100) })
  const userPrompt = `## KPI Summary\n${kpiSummary}\n\n## Fleet Context\n${context}\n\n## User Query\n${query}`

  const response = await callAiEdgeFunction(SYSTEM_PROMPT, userPrompt)
  const result = { response, agentType: 'analyst', kpis, costTrend, vendorRank, siteCpk }

  setCache(cacheKey, result)
  return result
}
