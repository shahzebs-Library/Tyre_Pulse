/**
 * continuousImprovementAnalytics - pure, no-I/O engine behind /continuous-improvement.
 *
 * Derives the improvement KPIs, the 0-100 programme score, the auto-generated
 * improvement opportunities (cost, reliability, process, inspection,
 * maintenance, procurement), the 12-month trends, the KPI-vs-target scorecard,
 * corrective-action statistics and export rows.
 *
 * Honesty rules:
 *   - a metric with no measurable basis is null (N/A), never 0 or 100,
 *   - savings use MEASURED tyre life (removal km - fitment km) and the observed
 *     replacement rate; when either is unmeasurable the saving is null, never
 *     an assumed mileage,
 *   - a score component with no data is null and the total is rescaled over the
 *     measured components,
 *   - every time-dependent function takes an explicit `now`.
 */

import { isCompletedInspection } from './inspectionCoverage'

// An inspection's status CHECK allows Scheduled|In Progress|Done|Overdue|Cancelled
// - 'Completed' is not a value the database can hold, so testing only for it
// counted every Done inspection without a completed_date as NOT done (a site
// looked non-compliant, a finished inspection looked overdue). Completion is
// decided by the shared rule; 'Completed' is kept for legacy/imported rows.
// A Cancelled inspection is neither done nor overdue.
const inspectionDone = (i) => isCompletedInspection(i) || i?.status === 'Completed'
const inspectionCancelled = (i) => i?.status === 'Cancelled'

export const OVERDUE_ACTION_DAYS = 14
export const RETREAD_TARGET_SHARE = 0.25
export const VENDOR_CONSOLIDATION_SAVING = 0.05
const DAY_MS = 86400000
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmt(n, decimals = 0) {
  if (n == null || Number.isNaN(Number(n))) return 'N/A'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function fmtCur(n, currency, decimals = 0) {
  if (n == null || Number.isNaN(Number(n))) return 'N/A'
  return `${currency} ${fmt(n, decimals)}`
}

/** Whole days an action has been open; null when there is no valid creation date. */
export function daysOpen(createdAt, now = new Date()) {
  if (!createdAt) return null
  const t = new Date(createdAt).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS))
}

export function monthKey(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function last12MonthKeys(now = new Date()) {
  const keys = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

export function monthLabel(key) {
  const [yr, mo] = String(key || '').split('-')
  if (!yr || !mo) return String(key || '')
  return `${MONTH_LABELS[parseInt(mo, 10) - 1]} ${yr.slice(2)}`
}

// 'Critical' (blowout/separation) is the MOST severe failure; the fleet-wide
// definition (analyticsEngine / kpiEngine) is High + Critical. Leaving it out
// reported a fleet whose tyres all blew out as 0% failure.
const isFailure = (r) => r?.risk_level === 'High' || r?.risk_level === 'Critical' || r?.category === 'Scrap'
const isInspectionDone = (i) => inspectionDone(i)

/** Measured tyre life in km, or null. */
export function lifeKmOf(r) {
  if (r?.km_at_fitment == null || r?.km_at_removal == null) return null
  const km = Number(r.km_at_removal) - Number(r.km_at_fitment)
  return Number.isFinite(km) && km > 0 ? km : null
}

/** Mean cost per km over tyres with a measured life and a price; null when none. */
export function avgCpkOf(records = []) {
  const cpks = records.map((r) => {
    const km = lifeKmOf(r)
    const cost = Number(r?.cost_per_tyre)
    return km && cost > 0 ? cost / km : null
  }).filter((v) => v != null)
  return cpks.length ? cpks.reduce((a, b) => a + b, 0) / cpks.length : null
}

/** High-risk-or-scrap share in %, null with no records. */
export function failureRateOf(records = []) {
  if (!records.length) return null
  return (records.filter(isFailure).length / records.length) * 100
}

/** Mean measured tyre life (km), null when none is measurable. */
export function meanLifeKm(records = []) {
  const lives = records.map(lifeKmOf).filter((v) => v != null)
  return lives.length ? lives.reduce((a, b) => a + b, 0) / lives.length : null
}

/** Observed replacements per year from the issue_date span; null with fewer than 2 dated rows. */
export function replacementsPerYearOf(records = []) {
  const dates = records.map((r) => (r?.issue_date ? new Date(r.issue_date).getTime() : NaN))
    .filter(Number.isFinite).sort((a, b) => a - b)
  if (dates.length < 2) return null
  const years = (dates[dates.length - 1] - dates[0]) / (365 * DAY_MS)
  if (!(years > 0)) return null
  return dates.length / Math.max(years, 1 / 12)
}

export function periodStart(period, now = new Date()) {
  const months = period === '3mo' ? 3 : period === '1yr' ? 12 : 6
  return new Date(now.getFullYear(), now.getMonth() - months, 1)
}

/** Records issued on or after the period start. */
export function filterByPeriod(records = [], period, now = new Date()) {
  const cutoff = periodStart(period, now)
  return records.filter((r) => r?.issue_date && new Date(r.issue_date) >= cutoff)
}

/** Headline improvement KPIs. */
export function computeMetrics(records = [], inspections = [], actions = []) {
  const totalCost = records.reduce((s, r) => s + (Number(r.cost_per_tyre) || 0) * (Number(r.qty) > 0 ? Number(r.qty) : 1), 0)
  const priced = records.filter((r) => Number(r.cost_per_tyre) > 0)
  return {
    avgCpk: avgCpkOf(records),
    avgCostPerTyre: priced.length ? priced.reduce((s, r) => s + Number(r.cost_per_tyre), 0) / priced.length : null,
    totalCost,
    failureRate: failureRateOf(records),
    inspectionCompliance: (() => {
      const live = inspections.filter((i) => !inspectionCancelled(i))
      return live.length ? (live.filter(isInspectionDone).length / live.length) * 100 : null
    })(),
    closeRate: actions.length ? (actions.filter((a) => a.status === 'Closed').length / actions.length) * 100 : null,
    records: records.length,
  }
}

const trendPoints = (older, recent) => {
  if (recent == null || older == null || older <= 0) return null
  return Math.min(25, Math.max(0, 12.5 + ((older - recent) / older) * 100))
}

/**
 * Programme score out of 100 from four 25-point components. A component with
 * no data is null; the total is rescaled over measured components and is null
 * when nothing is measurable.
 */
export function improvementScore(records = [], metrics = {}, now = new Date()) {
  const keys = last12MonthKeys(now)
  const mid = keys[5]
  const recent = records.filter((r) => { const k = monthKey(r.issue_date); return k && k > mid && k <= keys[11] })
  const older = records.filter((r) => { const k = monthKey(r.issue_date); return k && k <= mid && k >= keys[0] })
  const costPts = trendPoints(avgCpkOf(older), avgCpkOf(recent))
  const relPts = trendPoints(failureRateOf(older), failureRateOf(recent))
  const inspPts = metrics.inspectionCompliance == null ? null : (metrics.inspectionCompliance / 100) * 25
  const closePts = metrics.closeRate == null ? null : (metrics.closeRate / 100) * 25
  const measured = [costPts, relPts, inspPts, closePts].filter((p) => p != null)
  const total = measured.length ? Math.round((measured.reduce((a, b) => a + b, 0) / (measured.length * 25)) * 100) : null
  const prevFR = failureRateOf(records.filter((r) => monthKey(r.issue_date) === keys[10]))
  const currFR = failureRateOf(records.filter((r) => monthKey(r.issue_date) === keys[11]))
  const delta = prevFR != null && currFR != null ? (prevFR > currFR ? 2 : currFR > prevFR ? -2 : 0) : null
  const round = (v) => (v == null ? null : Math.round(v))
  return { total, costPts: round(costPts), relPts: round(relPts), inspPts: round(inspPts), closePts: round(closePts), measured: measured.length, delta }
}

/**
 * Auto-generated improvement opportunities, grouped by category.
 * @param {{records:Array, actions:Array, inspections:Array, metrics?:object, currency?:string, now?:Date}} p
 */
export function buildOpportunities({ records = [], actions = [], inspections = [], metrics, currency = 'SAR', now = new Date() } = {}) {
  metrics = metrics || computeMetrics(records, inspections, actions)
  const lifeKm = meanLifeKm(records)
  const replacementsPerYear = replacementsPerYearOf(records)
    const cur = currency
    const result = { cost: [], reliability: [], process: [], inspection: [], maintenance: [], procurement: [] }

    // ── A. Cost Reduction ──────────────────────────────────────────────────────
    const brandMap = {}
    records.forEach(r => {
      if (!r.brand || !r.km_at_fitment || !r.km_at_removal || !r.cost_per_tyre) return
      const km = r.km_at_removal - r.km_at_fitment
      if (km <= 0) return
      const cpk = r.cost_per_tyre / km
      if (!brandMap[r.brand]) brandMap[r.brand] = { cpks: [], costs: [] }
      brandMap[r.brand].cpks.push(cpk)
      brandMap[r.brand].costs.push(r.cost_per_tyre)
    })

    const brandCpks = Object.entries(brandMap)
      .map(([brand, v]) => ({ brand, avgCpk: v.cpks.reduce((a, b) => a + b, 0) / v.cpks.length, count: v.cpks.length }))
      .filter(b => b.count >= 3)
      .sort((a, b) => a.avgCpk - b.avgCpk)

    if (brandCpks.length >= 2) {
      const best  = brandCpks[0]
      const worst = brandCpks[brandCpks.length - 1]
      const annualSaving = replacementsPerYear != null && lifeKm != null
        ? Math.round(replacementsPerYear * (worst.avgCpk - best.avgCpk) * lifeKm)
        : null

      result.cost.push({
        key: 'brand-switch',
        title: `Switch procurement from ${worst.brand} to ${best.brand}`,
        description: `${worst.brand} has CPK ${fmt(worst.avgCpk, 4)} vs ${best.brand} at ${fmt(best.avgCpk, 4)} - a ${fmt((worst.avgCpk - best.avgCpk) / best.avgCpk * 100, 1)}% difference. Migrating procurement could generate significant annual savings.`,
        priority: 'High',
        saving: annualSaving == null ? null : Math.max(0, annualSaving),
        currency: cur,
        details: [
          `${worst.brand}: avg CPK ${fmt(worst.avgCpk, 4)} (${worst.count} tyres)`,
          `${best.brand}: avg CPK ${fmt(best.avgCpk, 4)} (${best.count} tyres)`,
          `Estimated fleet replacements/year: ${replacementsPerYear == null ? 'N/A' : fmt(Math.round(replacementsPerYear))}`,
          `Measured average tyre life: ${lifeKm == null ? 'N/A' : `${fmt(lifeKm)} km`}`,
        ],
      })
    }

    // Site with highest avg cost
    const siteMap = {}
    records.forEach(r => {
      if (!r.site || !r.cost_per_tyre) return
      if (!siteMap[r.site]) siteMap[r.site] = []
      siteMap[r.site].push(r.cost_per_tyre)
    })
    const siteCosts = Object.entries(siteMap)
      .map(([site, costs]) => ({ site, avg: costs.reduce((a, b) => a + b, 0) / costs.length, count: costs.length }))
      .filter(s => s.count >= 5)
      .sort((a, b) => b.avg - a.avg)

    const fleetAvgCost = metrics.avgCostPerTyre
    if (fleetAvgCost != null && fleetAvgCost > 0 && siteCosts.length > 1 && siteCosts[0].avg > fleetAvgCost * 1.2) {
      result.cost.push({
        key: 'site-cost-audit',
        title: `Audit ${siteCosts[0].site} cost controls - ${fmt(((siteCosts[0].avg / fleetAvgCost) - 1) * 100, 0)}% above fleet average`,
        description: `Site ${siteCosts[0].site} averages ${fmtCur(siteCosts[0].avg, cur)} per tyre replacement vs fleet average ${fmtCur(fleetAvgCost, cur)}. A procurement and workshop audit may identify overspend drivers.`,
        priority: 'Medium',
        saving: Math.round((siteCosts[0].avg - fleetAvgCost) * siteCosts[0].count),
        currency: cur,
        site: siteCosts[0].site,
        details: siteCosts.slice(0, 5).map(s => `${s.site}: avg ${fmtCur(s.avg, cur)} (${s.count} tyres)`),
      })
    }

    // High CPK vehicles
    const vehicleMap = {}
    records.forEach(r => {
      if (!r.asset_no || !r.km_at_fitment || !r.km_at_removal || !r.cost_per_tyre) return
      const km = r.km_at_removal - r.km_at_fitment
      if (km <= 0) return
      if (!vehicleMap[r.asset_no]) vehicleMap[r.asset_no] = []
      vehicleMap[r.asset_no].push(r.cost_per_tyre / km)
    })
    const fleetAvgCpk = metrics.avgCpk
    const highCpkVehicles = Object.entries(vehicleMap)
      .map(([asset, cpks]) => ({ asset, avg: cpks.reduce((a, b) => a + b, 0) / cpks.length, count: cpks.length }))
      .filter(v => fleetAvgCpk != null && v.count >= 2 && v.avg > fleetAvgCpk * 2)
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 8)

    if (highCpkVehicles.length > 0) {
      result.cost.push({
        key: 'high-cpk-vehicles',
        title: `${highCpkVehicles.length} vehicles operating at 2x fleet average CPK`,
        description: `These vehicles show abnormally high cost-per-kilometre. Root causes may include alignment issues, driver behaviour, route conditions, or wrong tyre specification.`,
        priority: 'High',
        saving: lifeKm == null ? null : Math.round(highCpkVehicles.reduce((s, v) => s + (v.avg - fleetAvgCpk) * lifeKm * v.count, 0)),
        currency: cur,
        details: highCpkVehicles.map(v => `${v.asset}: CPK ${fmt(v.avg, 4)} - ${fmt(((v.avg / fleetAvgCpk) - 1) * 100, 0)}% above average`),
      })
    }

    // ── B. Reliability ────────────────────────────────────────────────────────

    const posMap = {}
    records.forEach(r => {
      if (!r.position) return
      if (!posMap[r.position]) posMap[r.position] = { total: 0, failures: 0 }
      posMap[r.position].total++
      if (r.risk_level === 'High' || r.category === 'Scrap') posMap[r.position].failures++
    })

    Object.entries(posMap).forEach(([pos, v]) => {
      const rate = v.total > 4 ? (v.failures / v.total) * 100 : 0
      if (rate > 20) {
        result.reliability.push({
          key: `pos-failure-${pos}`,
          title: `High failure rate on ${pos} position (${fmt(rate, 1)}%)`,
          description: `${pos} tyres are failing at ${fmt(rate, 1)}% - above the 20% threshold. Inspect all ${pos} tyres immediately. Likely causes: inflation non-compliance, alignment, or load distribution issues.`,
          priority: rate > 35 ? 'High' : 'Medium',
          impactPct: rate - 20,
          details: [`${v.failures} failures out of ${v.total} tyres on ${pos} position`],
        })
      }
    })

    const fleetFailureRate = metrics.failureRate
    const siteFailMap = {}
    records.forEach(r => {
      if (!r.site) return
      if (!siteFailMap[r.site]) siteFailMap[r.site] = { total: 0, failures: 0 }
      siteFailMap[r.site].total++
      if (r.risk_level === 'High' || r.category === 'Scrap') siteFailMap[r.site].failures++
    })
    Object.entries(siteFailMap).forEach(([site, v]) => {
      const rate = v.total > 4 ? (v.failures / v.total) * 100 : 0
      if (fleetFailureRate != null && rate > fleetFailureRate * 1.3 && rate > 10) {
        result.reliability.push({
          key: `site-failure-${site}`,
          title: `${site} failure rate ${fmt(rate, 1)}% - ${fmt(rate - fleetFailureRate, 1)}pp above fleet average`,
          description: `Site ${site} has a significantly elevated failure rate. A reliability review covering workshop practices, tyre selection, and maintenance compliance is recommended.`,
          priority: 'Medium',
          site,
          details: [`Fleet avg: ${fmt(fleetFailureRate, 1)}%`, `${site}: ${fmt(rate, 1)}% (${v.failures}/${v.total} tyres)`],
        })
      }
    })

    const brandFailMap = {}
    records.forEach(r => {
      if (!r.brand) return
      if (!brandFailMap[r.brand]) brandFailMap[r.brand] = { total: 0, failures: 0 }
      brandFailMap[r.brand].total++
      if (r.risk_level === 'High' || r.category === 'Scrap') brandFailMap[r.brand].failures++
    })
    Object.entries(brandFailMap).forEach(([brand, v]) => {
      const rate = v.total > 5 ? (v.failures / v.total) * 100 : 0
      if (fleetFailureRate != null && rate > fleetFailureRate * 1.4 && rate > 12) {
        result.reliability.push({
          key: `brand-failure-${brand}`,
          title: `${brand} failure rate ${fmt(rate, 1)}% - review procurement`,
          description: `${brand} tyres show above-average failure rate. Consider replacing with higher-reliability brands if CPK analysis supports this decision.`,
          priority: 'Medium',
          details: [`Fleet avg failure rate: ${fmt(fleetFailureRate, 1)}%`, `${brand}: ${fmt(rate, 1)}% (${v.failures}/${v.total} tyres)`],
        })
      }
    })

    // ── C. Process Improvements ───────────────────────────────────────────────

    const overdueActions = actions.filter(a =>
      a.status !== 'Closed' && daysOpen(a.created_at, now) > 14
    )
    if (overdueActions.length > 0) {
      result.process.push({
        key: 'overdue-actions',
        title: `${overdueActions.length} corrective actions overdue (>14 days open)`,
        description: `These open actions represent unresolved operational risks. Escalation and assignment review required to restore action close rate.`,
        priority: overdueActions.length > 10 ? 'High' : 'Medium',
        details: overdueActions.slice(0, 6).map(a => `${a.title} - ${daysOpen(a.created_at, now)}d open${a.site ? ` (${a.site})` : ''}`),
      })
    }

    const siteInspComp = {}
    inspections.forEach(i => {
      if (!i.site) return
      if (!siteInspComp[i.site]) siteInspComp[i.site] = { total: 0, done: 0 }
      if (inspectionCancelled(i)) return
      siteInspComp[i.site].total++
      if (inspectionDone(i)) siteInspComp[i.site].done++
    })
    const lowComplianceSites = Object.entries(siteInspComp)
      .map(([site, v]) => ({ site, pct: v.total > 2 ? (v.done / v.total) * 100 : 100 }))
      .filter(s => s.pct < 85)
      .sort((a, b) => a.pct - b.pct)

    if (lowComplianceSites.length > 0) {
      result.process.push({
        key: 'inspection-compliance-sites',
        title: `${lowComplianceSites.length} sites below 85% inspection compliance`,
        description: `Low inspection compliance leads to undetected tyre degradation, increased failure rates, and higher replacement costs. Immediate compliance intervention required.`,
        priority: 'High',
        details: lowComplianceSites.map(s => `${s.site}: ${fmt(s.pct, 1)}% compliance`),
      })
    }

    const openActionsByPriority = actions.filter(a => a.status === 'Open')
    if (openActionsByPriority.filter(a => a.priority === 'High').length > 5) {
      result.process.push({
        key: 'high-priority-backlog',
        title: `${openActionsByPriority.filter(a => a.priority === 'High').length} high-priority actions still open`,
        description: `High-priority corrective actions are accumulating. Review assignment, escalate unresolved items, and implement daily action tracking.`,
        priority: 'High',
        details: openActionsByPriority.filter(a => a.priority === 'High').slice(0, 5).map(a => `${a.title}${a.site ? ` - ${a.site}` : ''}`),
      })
    }

    // ── D. Inspection Improvements ────────────────────────────────────────────

    const sitesWithNoInspections = [...new Set(records.map(r => r.site).filter(Boolean))]
      .filter(site => !siteInspComp[site])

    if (sitesWithNoInspections.length > 0) {
      result.inspection.push({
        key: 'sites-no-inspections',
        title: `${sitesWithNoInspections.length} active site(s) with no inspection records`,
        description: `Sites with tyre records but no inspection history represent unmonitored operational risk. Establish regular inspection schedules immediately.`,
        priority: 'High',
        details: sitesWithNoInspections.map(s => `${s}: no inspections found`),
      })
    }

    const overdueInspections = inspections.filter(i => {
      if (inspectionDone(i) || inspectionCancelled(i)) return false
      if (!i.scheduled_date) return false
      return new Date(i.scheduled_date) < now
    })
    if (overdueInspections.length > 0) {
      result.inspection.push({
        key: 'overdue-inspections',
        title: `${overdueInspections.length} scheduled inspections are overdue`,
        description: `Overdue inspections create compliance gaps and undetected tyre risk. Implement automated reminder and escalation workflow.`,
        priority: overdueInspections.length > 20 ? 'High' : 'Medium',
        details: [`${overdueInspections.length} inspections past scheduled date`],
      })
    }

    if (metrics.inspectionCompliance != null && metrics.inspectionCompliance < 75) {
      result.inspection.push({
        key: 'fleet-inspection-compliance',
        title: `Fleet inspection compliance at ${fmt(metrics.inspectionCompliance, 1)}% - critical`,
        description: `Overall inspection compliance is critically low. Without systematic inspections, pressure non-compliance and wear issues go undetected. A structured inspection programme rollout is required.`,
        priority: 'High',
        impactPct: 75 - metrics.inspectionCompliance,
      })
    }

    // ── E. Maintenance Improvements ───────────────────────────────────────────

    const vehicleHighRiskCount = {}
    const now12 = new Date(now)
    now12.setMonth(now12.getMonth() - 12)
    records.filter(r => r.issue_date && new Date(r.issue_date) >= now12 && r.risk_level === 'High').forEach(r => {
      if (!r.asset_no) return
      vehicleHighRiskCount[r.asset_no] = (vehicleHighRiskCount[r.asset_no] ?? 0) + 1
    })
    const repeatHighRisk = Object.entries(vehicleHighRiskCount)
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)

    if (repeatHighRisk.length > 0) {
      result.maintenance.push({
        key: 'repeat-high-risk-vehicles',
        title: `${repeatHighRisk.length} vehicles with 3+ high-risk tyres in 12 months`,
        description: `Repeated high-risk tyre events on the same vehicle suggest a systemic mechanical issue: alignment, suspension, brake drag, or driver behaviour. Full vehicle inspection required.`,
        priority: 'High',
        details: repeatHighRisk.map(([asset, count]) => `${asset}: ${count} high-risk tyre events`),
      })
    }

    const siteScrapMap = {}
    records.forEach(r => {
      if (!r.site) return
      if (!siteScrapMap[r.site]) siteScrapMap[r.site] = { total: 0, scrap: 0 }
      siteScrapMap[r.site].total++
      if (r.category === 'Scrap') siteScrapMap[r.site].scrap++
    })
    const fleetScrapRate = records.length ? (records.filter(r => r.category === 'Scrap').length / records.length) * 100 : 0
    const highScrapSites = Object.entries(siteScrapMap)
      .map(([site, v]) => ({ site, rate: v.total > 5 ? (v.scrap / v.total) * 100 : 0 }))
      .filter(s => s.rate > fleetScrapRate * 1.5 && s.rate > 10)
      .sort((a, b) => b.rate - a.rate)

    if (highScrapSites.length > 0) {
      result.maintenance.push({
        key: 'high-scrap-sites',
        title: `${highScrapSites.length} site(s) with elevated scrap rate - workshop audit required`,
        description: `These sites are generating scrap tyres at above-average rates. Root causes likely include poor installation practice, under-inflation, or overloading. Workshop audit recommended.`,
        priority: 'Medium',
        details: highScrapSites.map(s => `${s.site}: ${fmt(s.rate, 1)}% scrap rate`),
      })
    }

    const steerFast = posMap['Steer']
    if (steerFast && posMap['Drive']) {
      const steerFR = steerFast.total > 5 ? (steerFast.failures / steerFast.total) * 100 : 0
      const driveFR = posMap['Drive'].total > 5 ? (posMap['Drive'].failures / posMap['Drive'].total) * 100 : 0
      if (steerFR > driveFR * 1.5) {
        result.maintenance.push({
          key: 'steer-wear',
          title: `Steer tyres failing ${fmt(steerFR / Math.max(driveFR, 1), 1)}x faster than drive - rotation non-compliance signal`,
          description: `Steer tyre failure rate significantly exceeds drive axle, suggesting tyre rotation is not being performed. Implement mandatory rotation schedule.`,
          priority: 'Medium',
          details: [`Steer failure rate: ${fmt(steerFR, 1)}%`, `Drive failure rate: ${fmt(driveFR, 1)}%`],
        })
      }
    }

    // ── F. Procurement Improvements ───────────────────────────────────────────

    if (brandCpks.length >= 2) {
      result.procurement.push({
        key: 'brand-cpk-ranking',
        title: `Brand CPK ranking - procurement consolidation opportunity`,
        description: `Fleet is using ${brandCpks.length} brands with CPK variance of ${fmt(brandCpks[brandCpks.length-1].avgCpk - brandCpks[0].avgCpk, 4)}. Consolidating to top 2-3 performers could reduce CPK significantly.`,
        priority: brandCpks.length > 8 ? 'High' : 'Medium',
        details: brandCpks.slice(0, 6).map(b => `${b.brand}: CPK ${fmt(b.avgCpk, 4)} (${b.count} tyres)`),
      })
    }

    if (brandCpks.length > 8) {
      result.procurement.push({
        key: 'vendor-consolidation',
        title: `${brandCpks.length} active brands - vendor consolidation recommended`,
        description: `Operating with ${brandCpks.length} different tyre brands increases inventory complexity, reduces negotiating power, and complicates quality control. Consolidate to 3-5 preferred brands.`,
        priority: 'Medium',
        saving: metrics.avgCostPerTyre == null ? null : Math.round(metrics.avgCostPerTyre * records.length * VENDOR_CONSOLIDATION_SAVING),
        currency: cur,
        details: [`Current active brands: ${brandCpks.length}`, 'Target: 3-5 preferred approved brands', 'Estimated procurement saving: 5-10% through volume discounts'],
      })
    }

    const retreads = records.filter(r => r.category === 'Retread')
    const newTyres = records.filter(r => r.category !== 'Retread')

    function avgCpkFromSet(set) {
      const wk = set.filter(r => r.km_at_fitment != null && r.km_at_removal != null && r.cost_per_tyre > 0)
      const cpks = wk.map(r => {
        const km = r.km_at_removal - r.km_at_fitment
        return km > 0 ? r.cost_per_tyre / km : null
      }).filter(Boolean)
      return cpks.length ? cpks.reduce((a, b) => a + b, 0) / cpks.length : null
    }

    const retreadCpk = avgCpkFromSet(retreads)
    const newTyreCpk = avgCpkFromSet(newTyres)

    if (retreadCpk != null && newTyreCpk != null && retreadCpk < newTyreCpk * 0.8 && retreads.length > 10) {
      const share = retreads.length / records.length
      const adoptionSaving = lifeKm != null && replacementsPerYear != null
        ? Math.round((newTyreCpk - retreadCpk) * lifeKm * replacementsPerYear * Math.max(0, RETREAD_TARGET_SHARE - share))
        : null
      result.procurement.push({
        key: 'retread-adoption',
        title: `Increase retread adoption - ${fmt(((newTyreCpk - retreadCpk) / newTyreCpk) * 100, 0)}% lower CPK than new tyres`,
        description: `Retreads are outperforming new tyres on CPK. Increasing retread adoption from ${fmt(retreads.length / records.length * 100, 0)}% to 25-30% of replacements could generate significant annual savings.`,
        priority: 'Medium',
        saving: adoptionSaving == null ? null : Math.max(0, adoptionSaving),
        currency: cur,
        details: [
          `Retread avg CPK: ${fmt(retreadCpk, 4)}`,
          `New tyre avg CPK: ${fmt(newTyreCpk, 4)}`,
          `Current retread share: ${fmt(retreads.length / records.length * 100, 1)}%`,
        ],
      })
    } else if (retreads.length < 5 && records.length > 50) {
      result.procurement.push({
        key: 'retread-opportunity',
        title: `Low retread usage (${fmt(retreads.length / Math.max(records.length, 1) * 100, 1)}%) - evaluate retread programme`,
        description: `Fleet retread adoption is very low. A structured retread evaluation programme could reduce tyre costs by 30-50% on eligible axle positions (drive and trailer).`,
        priority: 'Low',
        details: [`Current retreads: ${retreads.length} of ${records.length} total`, 'Typical retread saving: 30-50% cost reduction per tyre'],
      })
    }

    return result
}

/** 12-month average CPK series (null months have no measurable tyre). */
export function cpkTrend(records = [], now = new Date()) {
  const keys = last12MonthKeys(now)
  return { keys, values: keys.map((k) => avgCpkOf(records.filter((r) => monthKey(r.issue_date) === k))) }
}

/** 12-month failure rate series. */
export function failureTrend(records = [], now = new Date()) {
  const keys = last12MonthKeys(now)
  return { keys, values: keys.map((k) => failureRateOf(records.filter((r) => monthKey(r.issue_date) === k))) }
}

/** 12-month action close-rate series by creation month. */
export function closeRateTrend(actions = [], now = new Date()) {
  const keys = last12MonthKeys(now)
  return {
    keys,
    values: keys.map((k) => {
      const m = actions.filter((a) => monthKey(a.created_at) === k)
      return m.length ? (m.filter((a) => a.status === 'Closed').length / m.length) * 100 : null
    }),
  }
}

export function findTarget(targets = [], ...metricNames) {
  const row = (targets || []).find((t) => metricNames.includes(t.metric))
  return row && row.target_value != null ? Number(row.target_value) : null
}

/** KPI vs target rows (only metrics with a configured target). */
export function kpiScorecard(metrics = {}, targets = []) {
  const defs = [
    { metric: 'target_cpk', label: 'Cost Per KM (CPK)', current: metrics.avgCpk, higherBetter: false, kind: 'cpk' },
    { metric: 'max_failure_rate', label: 'Failure Rate %', current: metrics.failureRate, higherBetter: false, kind: 'pct' },
    { metric: 'min_inspection_comp', label: 'Inspection Compliance %', current: metrics.inspectionCompliance, higherBetter: true, kind: 'pct' },
    { metric: 'min_action_close_rate', label: 'Action Close Rate %', current: metrics.closeRate, higherBetter: true, kind: 'pct' },
    { metric: 'max_avg_cost_tyre', label: 'Avg Cost Per Tyre', current: metrics.avgCostPerTyre, higherBetter: false, kind: 'money' },
  ]
  return defs.map((d) => {
    const target = findTarget(targets, d.metric)
    if (target == null) return null
    if (d.current == null) return { ...d, target, gap: null, status: 'No data' }
    const gap = d.current - target
    const status = d.higherBetter
      ? (d.current >= target ? 'Met' : d.current >= target * 0.9 ? 'Close' : 'Off Track')
      : (d.current <= target ? 'Met' : d.current <= target * 1.1 ? 'Close' : 'Off Track')
    return { ...d, target, gap, status }
  }).filter(Boolean)
}

const PRIORITY_ORDER = { High: 0, Medium: 1, Low: 2 }

/** Corrective action stats; openTable is every non-closed action, highest priority then oldest first. */
export function actionStats(actions = [], now = new Date()) {
  const rows = actions.map((a) => {
    const d = daysOpen(a.created_at, now)
    return { ...a, days_open: d, overdue: a.status !== 'Closed' && d != null && d > OVERDUE_ACTION_DAYS }
  })
  return {
    open: rows.filter((a) => a.status === 'Open'),
    inProgress: rows.filter((a) => a.status === 'In Progress'),
    closed: rows.filter((a) => a.status === 'Closed'),
    overdue: rows.filter((a) => a.overdue),
    openTable: rows.filter((a) => a.status !== 'Closed')
      .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1) || (b.days_open ?? -1) - (a.days_open ?? -1)),
    all: rows,
  }
}

/** Filter the action register by status / priority / overdue and free text. */
export function filterActions(rows = [], { status = 'all', priority = 'all', overdueOnly = false, search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return rows.filter((a) => {
    if (status !== 'all' && a.status !== status) return false
    if (priority !== 'all' && a.priority !== priority) return false
    if (overdueOnly && !a.overdue) return false
    if (q && !`${a.title || ''} ${a.site || ''} ${a.description || ''}`.toLowerCase().includes(q)) return false
    return true
  })
}

/**
 * ROI summary. Cost avoidance / backlog risk are indicative multiples of the
 * measured average tyre cost (3x per closed, 2x per open High action) and null
 * when no tyre is priced. Total saving sums only measured savings.
 */
export function roiSummary(actions = [], stats, metrics = {}, opportunities = {}) {
  const avg = metrics.avgCostPerTyre
  const closedHigh = stats.closed.filter((a) => a.priority === 'High').length
  const openHigh = stats.open.filter((a) => a.priority === 'High').length
  const all = Object.values(opportunities).flat()
  const measured = all.filter((o) => o.saving != null)
  return {
    totalRaised: actions.length,
    totalClosed: stats.closed.length,
    costAvoidance: avg == null ? null : closedHigh * avg * 3,
    backlogRisk: avg == null ? null : openHigh * avg * 2,
    totalSaving: measured.length ? measured.reduce((s, o) => s + o.saving, 0) : null,
    unpricedOpportunities: all.filter((o) => o.saving === null).length,
  }
}

export const ACTION_EXPORT_COLS = ['title', 'site', 'priority', 'status', 'days_open', 'overdue', 'created_at', 'resolved_at', 'description']
export const ACTION_EXPORT_HEADERS = ['Title', 'Site', 'Priority', 'Status', 'Days Open', 'Overdue', 'Created', 'Resolved', 'Description']

export function actionExportRows(rows = []) {
  return rows.map((a) => ({
    title: a.title || 'N/A',
    site: a.site || 'N/A',
    priority: a.priority || 'N/A',
    status: a.status || 'N/A',
    days_open: a.days_open == null ? 'N/A' : a.days_open,
    overdue: a.overdue ? 'Yes' : 'No',
    created_at: a.created_at ? String(a.created_at).slice(0, 10) : 'N/A',
    resolved_at: a.resolved_at ? String(a.resolved_at).slice(0, 10) : 'N/A',
    description: a.description || '',
  }))
}
