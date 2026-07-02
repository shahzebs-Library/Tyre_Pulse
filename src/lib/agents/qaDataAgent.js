// ─────────────────────────────────────────────────────────────────────────────
// qaDataAgent.js - Data cleaning, duplicate detection, validation
// Routes queries about data quality, anomalies, and record integrity.
// ─────────────────────────────────────────────────────────────────────────────

import { getCached, setCache } from '../ragService'
import { callAiEdgeFunction } from './index'

const SYSTEM_PROMPT = `You are TyrePulse QA Data Agent - a senior data quality engineer specialising in fleet management data integrity.
Your role: identify data quality issues, validate records, detect anomalies, and recommend corrections to improve data reliability.

For every data quality finding provide exactly this structure:

1. Issue: Specific data problem identified - type, scope, severity
2. Affected Records: How many records and what percentage of the dataset
3. Root Cause: Why this data quality issue exists (process failure, system error, human error)
4. Fix Recommendation: Specific, step-by-step correction procedure
5. Prevention: Process or system change to prevent recurrence

Data quality rules for fleet tyre data:
- Odometer at removal must be greater than odometer at fitment
- Tyre life should be between 5,000 km and 350,000 km (flag outside this range)
- Cost per tyre must be a positive number above 100 (flag zero or negative)
- Duplicate serial numbers indicate fitment recording errors
- Missing removal dates with valid fitment dates suggest incomplete records
- Same tyre serial appearing on two different vehicles simultaneously is a critical error
- Risk levels must be one of: Low, Medium, High, Critical

Be specific with counts and percentages. Prioritise issues by severity.`

/**
 * Run the QA Data Agent for data quality and validation queries.
 * @param {string} query
 * @param {Object} ctx
 * @param {Object[]} [ctx.records]  - tyre change records to validate
 * @returns {Promise<{ response: string, agentType: string, checks: Object }>}
 */
export async function runQaDataAgent(query, { records = [] } = {}) {
  const cacheKey = `qa:${query}:${records.length}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  // ── Automated Data Quality Checks ─────────────────────────────────────────

  // 1. Invalid odometer (removal < fitment)
  const invalidOdometer = records.filter(r => {
    const fit = Number(r.km_at_fitment)
    const rem = Number(r.km_at_removal)
    return r.km_at_removal && isFinite(fit) && isFinite(rem) && rem <= fit
  })

  // 2. Unrealistic tyre life (< 5,000 km or > 350,000 km)
  const unrealisticLife = records.filter(r => {
    const fit = Number(r.km_at_fitment)
    const rem = Number(r.km_at_removal)
    if (!r.km_at_removal || !isFinite(fit) || !isFinite(rem) || rem <= fit) return false
    const life = rem - fit
    return life < 5000 || life > 350000
  })

  // 3. Missing or zero cost
  const missingCost = records.filter(r => {
    const cost = Number(r.cost_per_tyre)
    return !r.cost_per_tyre || !isFinite(cost) || cost <= 0
  })

  // 4. Duplicate serial numbers
  const serialCounts = {}
  records.forEach(r => {
    if (r.tyre_serial && String(r.tyre_serial).trim()) {
      const serial = String(r.tyre_serial).trim()
      serialCounts[serial] = (serialCounts[serial] || 0) + 1
    }
  })
  const duplicateSerials = Object.entries(serialCounts)
    .filter(([, count]) => count > 1)
    .map(([serial, count]) => ({ serial, count }))
    .sort((a, b) => b.count - a.count)

  // 5. Missing fitment date
  const missingFitmentDate = records.filter(r => !r.issue_date)

  // 6. Missing asset number
  const missingAsset = records.filter(r => !r.asset_no || String(r.asset_no).trim() === '')

  // 7. Missing brand
  const missingBrand = records.filter(r => !r.brand || String(r.brand).trim() === '' || r.brand === 'Unknown')

  // 8. Invalid risk level
  const validRiskLevels = new Set(['Low', 'Medium', 'High', 'Critical'])
  const invalidRiskLevel = records.filter(r => r.risk_level && !validRiskLevels.has(r.risk_level))

  // 9. Suspiciously low cost (below 100 - likely data entry error)
  const suspiciouslyLowCost = records.filter(r => {
    const cost = Number(r.cost_per_tyre)
    return isFinite(cost) && cost > 0 && cost < 100
  })

  // 10. Very short tyre life (< 5,000 km and NOT scrap category) - probable bad data
  const avgLife = (() => {
    const valid = records.filter(r => {
      const fit = Number(r.km_at_fitment)
      const rem = Number(r.km_at_removal)
      return isFinite(fit) && isFinite(rem) && rem > fit
    })
    if (!valid.length) return 0
    return valid.reduce((s, r) => s + (Number(r.km_at_removal) - Number(r.km_at_fitment)), 0) / valid.length
  })()

  const checks = {
    totalRecords:       records.length,
    invalidOdometer:    { count: invalidOdometer.length,    records: invalidOdometer.slice(0, 10) },
    unrealisticLife:    { count: unrealisticLife.length,    records: unrealisticLife.slice(0, 10) },
    missingCost:        { count: missingCost.length,        records: missingCost.slice(0, 10) },
    duplicateSerials:   { count: duplicateSerials.length,   serials: duplicateSerials.slice(0, 10) },
    missingFitmentDate: { count: missingFitmentDate.length, records: missingFitmentDate.slice(0, 5) },
    missingAsset:       { count: missingAsset.length,       records: missingAsset.slice(0, 5) },
    missingBrand:       { count: missingBrand.length },
    invalidRiskLevel:   { count: invalidRiskLevel.length,   records: invalidRiskLevel.slice(0, 5) },
    suspiciouslyLowCost:{ count: suspiciouslyLowCost.length },
    avgTyreLifeKm:      avgLife,
  }

  const totalIssues =
    checks.invalidOdometer.count +
    checks.unrealisticLife.count +
    checks.missingCost.count +
    checks.duplicateSerials.count +
    checks.missingFitmentDate.count +
    checks.missingAsset.count +
    checks.invalidRiskLevel.count

  const dataQualityScore = records.length > 0
    ? Math.max(0, 100 - (totalIssues / records.length) * 100).toFixed(1)
    : 'N/A'

  const summary = [
    `## Data Quality Report`,
    `Total records analysed: ${records.length}`,
    `Data quality score: ${dataQualityScore}%`,
    `Total issues found: ${totalIssues}`,
    ``,
    `Issue Breakdown:`,
    `- Invalid odometer readings (removal < fitment): ${checks.invalidOdometer.count}`,
    `- Unrealistic tyre life (< 5,000 km or > 350,000 km): ${checks.unrealisticLife.count}`,
    `- Missing or zero cost records: ${checks.missingCost.count}`,
    `- Duplicate serial numbers: ${checks.duplicateSerials.count} serials (${duplicateSerials.reduce((s, d) => s + d.count - 1, 0)} extra records)`,
    `- Missing fitment date: ${checks.missingFitmentDate.count}`,
    `- Missing asset number: ${checks.missingAsset.count}`,
    `- Missing brand: ${checks.missingBrand.count}`,
    `- Invalid risk level values: ${checks.invalidRiskLevel.count}`,
    `- Suspiciously low cost (< 100): ${checks.suspiciouslyLowCost.count}`,
    ``,
    `Fleet average tyre life: ${avgLife > 0 ? `${avgLife.toFixed(0)} km` : 'Cannot compute (insufficient valid data)'}`,
    duplicateSerials.length > 0
      ? `Top duplicate serials: ${duplicateSerials.slice(0, 5).map(d => `${d.serial} (${d.count}x)`).join(', ')}`
      : '',
  ].filter(s => s !== null).join('\n')

  const userPrompt = `${summary}\n\n## QA Query\n${query}`

  const response = await callAiEdgeFunction(SYSTEM_PROMPT, userPrompt)
  const result = {
    response,
    agentType: 'qa_data',
    checks,
    dataQualityScore,
    totalIssues,
  }

  setCache(cacheKey, result)
  return result
}
