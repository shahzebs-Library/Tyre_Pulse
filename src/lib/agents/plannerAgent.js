// ─────────────────────────────────────────────────────────────────────────────
// plannerAgent.js - Maintenance scheduling, forecasting, workshop load balancing
// Routes queries about future planning, replacement forecasts, and budgets.
// ─────────────────────────────────────────────────────────────────────────────

import { retrieveFleetKpiContext, assembleContext, getCached, setCache } from '../ragService'
import {
  computeReplacementRate,
  computeCostTrend,
  computeAvgTyreLife,
  computeCpkBySite,
  computeVendorPerformance,
} from '../kpiEngine'
import { callAiEdgeFunction } from './index'

const SYSTEM_PROMPT = `You are TyrePulse Planner Agent - a senior maintenance planner and fleet operations specialist.
Your role: maintenance scheduling, tyre replacement forecasting, budget planning, and workshop load balancing.

For every plan provide exactly this structure:

1. Timeline: Specific dates, weeks, or months - not vague timeframes
2. Resource Requirements: Number of tyres, estimated labour hours, projected cost
3. Priority Order: Which vehicles or sites to action first (with justification)
4. Budget Impact: Monthly and annual cost estimates with assumptions stated
5. Risk if Delayed: Specific operational and financial consequences of inaction

Planning principles:
- Base forecasts on actual replacement rate and tyre life trends
- Flag vehicles approaching tyre end-of-life based on km patterns
- Recommend procurement lead times (typically 2-4 weeks for standard tyres)
- Account for seasonal variations if data shows patterns
- Balance workshop capacity - avoid scheduling all replacements in same week
- Prioritise Critical and High risk vehicles
- Always provide confidence level for forecasts (High / Medium / Low) with reasoning

Be specific with numbers. State assumptions clearly. Currency is the fleet's reporting currency.`

/**
 * Run the Planner Agent for scheduling, forecasting, and budget planning queries.
 * @param {string} query
 * @param {Object} ctx
 * @param {Object[]} [ctx.records]  - pre-loaded tyre change records
 * @param {Object[]} [ctx.fleet]    - fleet master records
 * @param {string|null} [ctx.site]  - site filter
 * @returns {Promise<{ response: string, agentType: string, planningData: Object }>}
 */
export async function runPlannerAgent(query, {
  records = [],
  fleet = [],
  site = null,
} = {}) {
  const cacheKey = `planner:${query}:${site ?? 'all'}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  // Retrieve data if not pre-loaded - use 12-month window for planning context
  let data = records
  if (!data.length) {
    data = await retrieveFleetKpiContext(site, 600, 12)
  }

  // Compute planning-relevant KPIs
  const replacementRate = computeReplacementRate(data)
  const costTrend = computeCostTrend(data)
  const avgLife = computeAvgTyreLife(data)
  const siteCpk = computeCpkBySite(data)
  const vendorPerf = computeVendorPerformance(data)

  // Monthly cost forecast for next 3 months
  const forecasts = []
  for (let i = 1; i <= 3; i++) {
    const forecastMonth = new Date()
    forecastMonth.setMonth(forecastMonth.getMonth() + i)
    const monthLabel = forecastMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    const forecastCost = costTrend.intercept + costTrend.slope * (costTrend.byMonth.length + i - 1)
    forecasts.push({ month: monthLabel, forecastCost: Math.max(0, forecastCost) })
  }

  // Estimate annual budget
  const annualForecast = forecasts.length
    ? (costTrend.avgMonthlyCost ?? 0) * 12
    : 0

  // Sites with highest CPK - prioritise for intervention
  const highPrioritySites = siteCpk.slice(0, 3)

  // Best value brands for procurement recommendation
  const topBrands = vendorPerf.slice(0, 3)

  const planningContext = [
    `## Planning Data`,
    `Analysis period: 12 months | Records: ${data.length} | Active vehicles: ${replacementRate.activeVehicles}`,
    ``,
    `## Replacement Rate`,
    `- Avg replacements/vehicle/month: ${replacementRate.avgPerVehiclePerMonth?.toFixed(2) ?? 'N/A'}`,
    `- Total replacements in period: ${replacementRate.totalReplacements}`,
    replacementRate.byMonth?.length
      ? `- Recent monthly volumes: ${replacementRate.byMonth.slice(-3).map(m => `${m.month}: ${m.count}`).join(' | ')}`
      : '',
    ``,
    `## Tyre Life Analysis`,
    `- Average tyre life: ${avgLife.avgKm?.toFixed(0) ?? 'N/A'} km`,
    `- Median tyre life: ${avgLife.medianKm?.toFixed(0) ?? 'N/A'} km`,
    avgLife.byBrand?.length
      ? `- Longest life brands: ${avgLife.byBrand.slice(0, 3).map(b => `${b.brand}: ${b.avgKm?.toFixed(0)} km`).join(', ')}`
      : '',
    ``,
    `## Cost Forecast (Next 3 Months)`,
    forecasts.map(f => `- ${f.month}: ${f.forecastCost?.toFixed(0) ?? 'N/A'}`).join('\n'),
    `- Annual budget estimate: ${annualForecast?.toFixed(0) ?? 'N/A'}`,
    `- Cost trend: ${costTrend.trend} (slope: ${costTrend.slope?.toFixed(0) ?? 0} per month)`,
    ``,
    `## Site Priorities (Highest CPK - Act First)`,
    highPrioritySites.length
      ? highPrioritySites.map(s => `- ${s.site}: CPK ${s.avgCpk?.toFixed(3)}, ${s.count} records`).join('\n')
      : '- No site data available',
    ``,
    `## Procurement Recommendation (Best Value Brands)`,
    topBrands.length
      ? topBrands.map(b => `- ${b.brand}: CPK ${b.avgCpk?.toFixed(3)}, Life ${b.avgLife?.toFixed(0)} km (Rank #${b.rank})`).join('\n')
      : '- Insufficient brand data for recommendation',
  ].filter(s => s !== null).join('\n')

  const context = assembleContext({ kpiData: data.slice(0, 80) })
  const userPrompt = `${planningContext}\n\n## Additional Context\n${context}\n\n## Planning Query\n${query}`

  const response = await callAiEdgeFunction(SYSTEM_PROMPT, userPrompt, 'claude-haiku-4-5-20251001', 1800)

  const result = {
    response,
    agentType: 'planner',
    planningData: {
      replacementRate,
      costTrend,
      avgLife,
      forecasts,
      annualForecast,
      highPrioritySites,
      topBrands,
    },
  }

  setCache(cacheKey, result)
  return result
}
