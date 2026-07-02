// ─────────────────────────────────────────────────────────────────────────────
// kpiEngine.js - Pure KPI computation library for TyrePulse
// No Supabase calls. No React. No side effects.
// All functions accept raw data arrays and return computed result objects.
// ─────────────────────────────────────────────────────────────────────────────

// ── Internal Utilities ────────────────────────────────────────────────────────

function _mean(arr) {
  if (!arr.length) return 0
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function _median(arr) {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

function _percentile(arr, p) {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo])
}

function _groupBy(arr, keyFn) {
  return arr.reduce((acc, item) => {
    const k = keyFn(item) ?? 'Unknown'
    if (!acc[k]) acc[k] = []
    acc[k].push(item)
    return acc
  }, {})
}

function _toMonthKey(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function _isValidRecord(r) {
  const fitKm = Number(r.km_at_fitment)
  const remKm = Number(r.km_at_removal)
  const cost  = Number(r.cost_per_tyre)
  return (
    isFinite(fitKm) && fitKm > 0 &&
    isFinite(remKm) && remKm > fitKm &&
    isFinite(cost)  && cost > 0
  )
}

function _cpkOf(r) {
  return Number(r.cost_per_tyre) / (Number(r.km_at_removal) - Number(r.km_at_fitment))
}

function _kmRun(r) {
  return Number(r.km_at_removal) - Number(r.km_at_fitment)
}

function _linearRegression(points) {
  // points: [{x, y}]
  const n = points.length
  if (n < 2) return { slope: 0, intercept: 0 }
  const sumX  = points.reduce((s, p) => s + p.x, 0)
  const sumY  = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x ** 2, 0)
  const denom = n * sumX2 - sumX ** 2
  if (denom === 0) return { slope: 0, intercept: sumY / n }
  const slope     = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

// ── Exported KPI Functions ────────────────────────────────────────────────────

/**
 * Fleet-level CPK summary.
 * @param {Object[]} records - tyre change records
 * @returns {{ fleetAvgCpk, medianCpk, validCount, totalCount, coveragePct, p10Cpk, p90Cpk }}
 */
export function computeCpkFleet(records = []) {
  const total = records.length
  const valid = records.filter(_isValidRecord)
  const cpks  = valid.map(_cpkOf)

  return {
    fleetAvgCpk:  _mean(cpks),
    medianCpk:    _median(cpks),
    validCount:   valid.length,
    totalCount:   total,
    coveragePct:  total > 0 ? (valid.length / total) * 100 : 0,
    p10Cpk:       _percentile(cpks, 10),
    p90Cpk:       _percentile(cpks, 90),
  }
}

/**
 * CPK grouped by tyre brand.
 * @param {Object[]} records
 * @returns {Array<{ brand, avgCpk, medianCpk, count, validCount, minCpk, maxCpk }>} sorted ascending (best CPK first)
 */
export function computeCpkByBrand(records = []) {
  const valid  = records.filter(_isValidRecord)
  const groups = _groupBy(valid, r => r.brand ?? 'Unknown')

  return Object.entries(groups)
    .map(([brand, rows]) => {
      const cpks = rows.map(_cpkOf)
      return {
        brand,
        avgCpk:    _mean(cpks),
        medianCpk: _median(cpks),
        count:     rows.length,
        validCount: rows.length,
        minCpk:    Math.min(...cpks),
        maxCpk:    Math.max(...cpks),
      }
    })
    .sort((a, b) => a.avgCpk - b.avgCpk)
}

/**
 * CPK grouped by asset (vehicle).
 * @param {Object[]} records
 * @returns {Array<{ asset_no, avgCpk, totalCost, count, validCount }>} sorted descending (worst first)
 */
export function computeCpkByAsset(records = []) {
  const valid  = records.filter(_isValidRecord)
  const groups = _groupBy(valid, r => r.asset_no ?? 'Unknown')

  return Object.entries(groups)
    .map(([asset_no, rows]) => {
      const cpks      = rows.map(_cpkOf)
      const totalCost = rows.reduce((s, r) => s + Number(r.cost_per_tyre), 0)
      return {
        asset_no,
        avgCpk:    _mean(cpks),
        totalCost,
        count:     rows.length,
        validCount: rows.length,
      }
    })
    .sort((a, b) => b.avgCpk - a.avgCpk)
}

/**
 * CPK grouped by site.
 * @param {Object[]} records
 * @returns {Array<{ site, avgCpk, medianCpk, count, validCount, minCpk, maxCpk }>} sorted descending (worst site first)
 */
export function computeCpkBySite(records = []) {
  const valid  = records.filter(_isValidRecord)
  const groups = _groupBy(valid, r => r.site ?? 'Unknown')

  return Object.entries(groups)
    .map(([site, rows]) => {
      const cpks = rows.map(_cpkOf)
      return {
        site,
        avgCpk:    _mean(cpks),
        medianCpk: _median(cpks),
        count:     rows.length,
        validCount: rows.length,
        minCpk:    Math.min(...cpks),
        maxCpk:    Math.max(...cpks),
      }
    })
    .sort((a, b) => b.avgCpk - a.avgCpk)
}

/**
 * Average tyre life in km.
 * @param {Object[]} records
 * @returns {{ avgKm, medianKm, maxKm, minKm, validCount, byBrand, bySite }}
 */
export function computeAvgTyreLife(records = []) {
  const valid = records.filter(r => {
    const fit = Number(r.km_at_fitment)
    const rem = Number(r.km_at_removal)
    return isFinite(fit) && isFinite(rem) && rem > fit
  })

  const kms = valid.map(_kmRun)

  const byBrand = Object.entries(_groupBy(valid, r => r.brand ?? 'Unknown'))
    .map(([brand, rows]) => ({ brand, avgKm: _mean(rows.map(_kmRun)), count: rows.length }))
    .sort((a, b) => b.avgKm - a.avgKm)

  const bySite = Object.entries(_groupBy(valid, r => r.site ?? 'Unknown'))
    .map(([site, rows]) => ({ site, avgKm: _mean(rows.map(_kmRun)), count: rows.length }))
    .sort((a, b) => b.avgKm - a.avgKm)

  return {
    avgKm:      _mean(kms),
    medianKm:   _median(kms),
    maxKm:      kms.length ? Math.max(...kms) : 0,
    minKm:      kms.length ? Math.min(...kms) : 0,
    validCount: valid.length,
    byBrand,
    bySite,
  }
}

/**
 * Fleet-level tyre life with monthly trend.
 * @param {Object[]} records
 * @returns {{ avgKm, trend: [{month, avgKm}] }}
 */
export function computeFleetTyreLife(records = []) {
  const valid = records.filter(r => {
    const fit = Number(r.km_at_fitment)
    const rem = Number(r.km_at_removal)
    return isFinite(fit) && isFinite(rem) && rem > fit
  })

  const avgKm = _mean(valid.map(_kmRun))

  const byMonth = _groupBy(valid, r => _toMonthKey(r.issue_date) ?? 'Unknown')
  const trend = Object.entries(byMonth)
    .filter(([month]) => month !== 'Unknown')
    .map(([month, rows]) => ({ month, avgKm: _mean(rows.map(_kmRun)) }))
    .sort((a, b) => a.month.localeCompare(b.month))

  return { avgKm, trend }
}

/**
 * Tyre removal rate per 1 000 fleet km.
 * @param {Object[]} records
 * @param {number} [fleetKmTotal]
 * @returns {{ removalPer1000Km, totalRemovals, estimatedFleetKm }}
 */
export function computeRemovalRate(records = [], fleetKmTotal) {
  const valid = records.filter(r => {
    const fit = Number(r.km_at_fitment)
    const rem = Number(r.km_at_removal)
    return isFinite(fit) && isFinite(rem) && rem > fit
  })

  const totalRemovals    = records.length
  const estimatedFleetKm = fleetKmTotal ?? valid.reduce((s, r) => s + _kmRun(r), 0)
  const removalPer1000Km = estimatedFleetKm > 0
    ? (totalRemovals / estimatedFleetKm) * 1000
    : 0

  return { removalPer1000Km, totalRemovals, estimatedFleetKm }
}

/**
 * Tyre failure rate (High + Critical risk levels).
 * @param {Object[]} records
 * @returns {{ failureRate, failureCount, totalCount, criticalRate, highRate, bySite, byBrand }}
 */
export function computeFailureRate(records = []) {
  const total    = records.length
  const critical = records.filter(r => r.risk_level === 'Critical')
  const high     = records.filter(r => r.risk_level === 'High')
  const failures = records.filter(r => r.risk_level === 'High' || r.risk_level === 'Critical')

  const _ratesByGroup = (groupKey) =>
    Object.entries(_groupBy(records, r => r[groupKey] ?? 'Unknown'))
      .map(([key, rows]) => ({
        [groupKey]: key,
        rate:  rows.filter(r => r.risk_level === 'High' || r.risk_level === 'Critical').length / rows.length,
        count: rows.length,
      }))
      .sort((a, b) => b.rate - a.rate)

  return {
    failureRate:  total > 0 ? failures.length / total : 0,
    failureCount: failures.length,
    totalCount:   total,
    criticalRate: total > 0 ? critical.length / total : 0,
    highRate:     total > 0 ? high.length / total : 0,
    bySite:       _ratesByGroup('site'),
    byBrand:      _ratesByGroup('brand'),
  }
}

/**
 * Average replacement rate per vehicle per month.
 * @param {Object[]} records
 * @returns {{ avgPerVehiclePerMonth, totalReplacements, activeVehicles, byMonth }}
 */
export function computeReplacementRate(records = []) {
  const total = records.length

  // Group by asset_no + month bucket
  const byAssetMonth = _groupBy(
    records.filter(r => r.asset_no && _toMonthKey(r.issue_date)),
    r => `${r.asset_no}||${_toMonthKey(r.issue_date)}`
  )

  const activeVehicles = new Set(records.map(r => r.asset_no).filter(Boolean)).size

  const byMonth = Object.entries(
    _groupBy(records.filter(r => _toMonthKey(r.issue_date)), r => _toMonthKey(r.issue_date))
  )
    .map(([month, rows]) => ({
      month,
      count:          rows.length,
      uniqueVehicles: new Set(rows.map(r => r.asset_no).filter(Boolean)).size,
    }))
    .sort((a, b) => a.month.localeCompare(b.month))

  const countsPerAssetMonth = Object.values(byAssetMonth).map(rows => rows.length)
  const avgPerVehiclePerMonth = _mean(countsPerAssetMonth)

  return {
    avgPerVehiclePerMonth,
    totalReplacements: total,
    activeVehicles,
    byMonth,
  }
}

/**
 * Pressure compliance approximation from inspections.
 * @param {Object[]} inspections
 * @param {number}   [targetPct=90]
 * @returns {{ compliancePct, compliantCount, totalCount, bySite }}
 */
export function computePressureCompliance(inspections = [], targetPct = 90) {
  const nonCancelled = inspections.filter(i => i.status !== 'Cancelled')
  const compliant    = nonCancelled.filter(
    i => i.status === 'Done' && i.findings && String(i.findings).trim() !== ''
  )

  const bySite = Object.entries(_groupBy(nonCancelled, i => i.site ?? 'Unknown'))
    .map(([site, rows]) => {
      const comp = rows.filter(
        i => i.status === 'Done' && i.findings && String(i.findings).trim() !== ''
      )
      return { site, compliancePct: rows.length > 0 ? (comp.length / rows.length) * 100 : 0, count: rows.length }
    })
    .sort((a, b) => a.compliancePct - b.compliancePct)

  return {
    compliancePct:  nonCancelled.length > 0 ? (compliant.length / nonCancelled.length) * 100 : 0,
    compliantCount: compliant.length,
    totalCount:     nonCancelled.length,
    targetPct,
    bySite,
  }
}

/**
 * Inspection compliance - % completed on time.
 * @param {Object[]} inspections
 * @returns {{ compliancePct, onTimeCount, lateCount, overdueCount, totalScheduled, bySite, byMonth }}
 */
export function computeInspectionCompliance(inspections = []) {
  const scheduled = inspections.filter(i => i.status !== 'Cancelled')
  const done      = scheduled.filter(i => i.status === 'Done')

  const onTime = done.filter(i => {
    if (!i.completed_date || !i.scheduled_date) return false
    return new Date(i.completed_date) <= new Date(i.scheduled_date)
  })

  const late    = done.filter(i => {
    if (!i.completed_date || !i.scheduled_date) return false
    return new Date(i.completed_date) > new Date(i.scheduled_date)
  })

  const overdue = scheduled.filter(i => i.status === 'Overdue')

  const bySite = Object.entries(_groupBy(scheduled, i => i.site ?? 'Unknown'))
    .map(([site, rows]) => {
      const doneRows   = rows.filter(i => i.status === 'Done')
      const onTimeRows = doneRows.filter(i => {
        if (!i.completed_date || !i.scheduled_date) return false
        return new Date(i.completed_date) <= new Date(i.scheduled_date)
      })
      return {
        site,
        compliancePct: rows.length > 0 ? (onTimeRows.length / rows.length) * 100 : 0,
        count: rows.length,
      }
    })
    .sort((a, b) => a.compliancePct - b.compliancePct)

  const byMonth = Object.entries(
    _groupBy(scheduled.filter(i => _toMonthKey(i.scheduled_date)), i => _toMonthKey(i.scheduled_date))
  )
    .map(([month, rows]) => {
      const onTimeRows = rows.filter(i => {
        if (i.status !== 'Done' || !i.completed_date) return false
        return new Date(i.completed_date) <= new Date(i.scheduled_date)
      })
      return { month, compliancePct: rows.length > 0 ? (onTimeRows.length / rows.length) * 100 : 0 }
    })
    .sort((a, b) => a.month.localeCompare(b.month))

  return {
    compliancePct:  scheduled.length > 0 ? (onTime.length / scheduled.length) * 100 : 0,
    onTimeCount:    onTime.length,
    lateCount:      late.length,
    overdueCount:   overdue.length,
    totalScheduled: scheduled.length,
    bySite,
    byMonth,
  }
}

/**
 * Retread performance vs new tyres.
 * @param {Object[]} records
 * @returns {{ retreadCpk, newCpk, retreadCount, newCount, savingsPct, retreadAvgLife, newAvgLife } | null}
 */
export function computeRetreadPerformance(records = []) {
  const valid    = records.filter(_isValidRecord)
  const retreads = valid.filter(r => /retread/i.test(String(r.category ?? '')))
  const newTyres = valid.filter(r => !/retread/i.test(String(r.category ?? '')) && !/scrap/i.test(String(r.category ?? '')))

  if (retreads.length < 2 || newTyres.length < 2) return null

  const retreadCpk  = _mean(retreads.map(_cpkOf))
  const newCpk      = _mean(newTyres.map(_cpkOf))
  const savingsPct  = newCpk > 0 ? ((newCpk - retreadCpk) / newCpk) * 100 : 0
  const retreadAvgLife = _mean(retreads.map(_kmRun))
  const newAvgLife     = _mean(newTyres.map(_kmRun))

  return {
    retreadCpk,
    newCpk,
    retreadCount:  retreads.length,
    newCount:      newTyres.length,
    savingsPct,
    retreadAvgLife,
    newAvgLife,
  }
}

/**
 * Scrap rate calculation.
 * @param {Object[]} records
 * @param {number}   [scrapKmPct=20]  - % of fleet avg km below which a removal is premature scrap
 * @param {number}   [defaultCost=1200]
 * @returns {{ scrapRate, scrapCount, totalCount, estimatedScrapCost, bySite }}
 */
export function computeScrapRate(records = [], scrapKmPct = 20, defaultCost = 1200) {
  const total  = records.length
  const valid  = records.filter(r => {
    const fit = Number(r.km_at_fitment)
    const rem = Number(r.km_at_removal)
    return isFinite(fit) && isFinite(rem) && rem > fit
  })
  const avgKm = _mean(valid.map(_kmRun))
  const kmThreshold = avgKm * (scrapKmPct / 100)

  const scrapped = records.filter(r => {
    if (/scrap/i.test(String(r.category ?? ''))) return true
    if (r.risk_level === 'Critical') {
      const fit = Number(r.km_at_fitment)
      const rem = Number(r.km_at_removal)
      if (isFinite(fit) && isFinite(rem) && rem > fit && _kmRun(r) < kmThreshold) return true
    }
    return false
  })

  const estimatedScrapCost = scrapped.reduce(
    (s, r) => s + (Number(r.cost_per_tyre) > 0 ? Number(r.cost_per_tyre) : defaultCost),
    0
  )

  const bySite = Object.entries(_groupBy(records, r => r.site ?? 'Unknown'))
    .map(([site, rows]) => {
      const siteScrap = rows.filter(r => {
        if (/scrap/i.test(String(r.category ?? ''))) return true
        if (r.risk_level === 'Critical') {
          const fit = Number(r.km_at_fitment)
          const rem = Number(r.km_at_removal)
          if (isFinite(fit) && isFinite(rem) && rem > fit && _kmRun(r) < kmThreshold) return true
        }
        return false
      })
      return {
        site,
        scrapRate:  rows.length > 0 ? siteScrap.length / rows.length : 0,
        scrapCount: siteScrap.length,
        count:      rows.length,
      }
    })
    .sort((a, b) => b.scrapRate - a.scrapRate)

  return {
    scrapRate:          total > 0 ? scrapped.length / total : 0,
    scrapCount:         scrapped.length,
    totalCount:         total,
    estimatedScrapCost,
    bySite,
  }
}

/**
 * Vehicle downtime impact from tyre replacements.
 * @param {Object[]} records
 * @param {number}   [hoursPerReplacement=2]
 * @returns {{ totalDowntimeHours, avgDowntimePerVehicle, worstAssets }}
 */
export function computeVehicleDowntimeImpact(records = [], hoursPerReplacement = 2) {
  const byAsset = _groupBy(records.filter(r => r.asset_no), r => r.asset_no)

  const assetDowntime = Object.entries(byAsset).map(([assetNo, rows]) => ({
    assetNo,
    replacements: rows.length,
    downtime:     rows.length * hoursPerReplacement,
  }))

  const totalDowntimeHours    = assetDowntime.reduce((s, a) => s + a.downtime, 0)
  const avgDowntimePerVehicle = assetDowntime.length > 0
    ? totalDowntimeHours / assetDowntime.length
    : 0

  const worstAssets = [...assetDowntime]
    .sort((a, b) => b.downtime - a.downtime)
    .slice(0, 10)

  return { totalDowntimeHours, avgDowntimePerVehicle, worstAssets }
}

/**
 * Fleet availability % based on critical tyre risk in last 30 days.
 * @param {Object[]} records
 * @param {number}   fleetSize
 * @returns {{ availabilityPct, unavailableCount, criticalVehicles, fleetSize }}
 */
export function computeFleetAvailability(records = [], fleetSize = 0) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)

  const recentCritical = records.filter(r => {
    if (r.risk_level !== 'Critical') return false
    const d = r.issue_date ? new Date(r.issue_date) : null
    return d && d >= cutoff
  })

  const criticalVehicles = [...new Set(recentCritical.map(r => r.asset_no).filter(Boolean))]
  const unavailableCount = criticalVehicles.length
  const resolvedFleetSize = fleetSize > 0 ? fleetSize : Math.max(
    new Set(records.map(r => r.asset_no).filter(Boolean)).size,
    unavailableCount
  )
  const availabilityPct = resolvedFleetSize > 0
    ? ((resolvedFleetSize - unavailableCount) / resolvedFleetSize) * 100
    : 100

  return { availabilityPct, unavailableCount, criticalVehicles, fleetSize: resolvedFleetSize }
}

/**
 * Monthly cost trend with linear regression and 1-month forecast.
 * @param {Object[]} records
 * @param {number}   [defaultCost=1200]
 * @returns {{ byMonth, slope, trend, avgMonthlyCost, forecastNextMonth }}
 */
export function computeCostTrend(records = [], defaultCost = 1200) {
  // Last 13 months
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 12, 1)

  const recent = records.filter(r => {
    const d = r.issue_date ? new Date(r.issue_date) : null
    return d && d >= start
  })

  const byMonth = Object.entries(
    _groupBy(recent.filter(r => _toMonthKey(r.issue_date)), r => _toMonthKey(r.issue_date))
  )
    .map(([month, rows]) => ({
      month,
      totalCost: rows.reduce(
        (s, r) => s + (Number(r.cost_per_tyre) > 0 ? Number(r.cost_per_tyre) : defaultCost),
        0
      ),
      count: rows.length,
    }))
    .sort((a, b) => a.month.localeCompare(b.month))

  const avgMonthlyCost = _mean(byMonth.map(m => m.totalCost))

  // Regression using numeric month index
  const points = byMonth.map((m, i) => ({ x: i, y: m.totalCost }))
  const { slope, intercept } = _linearRegression(points)
  const forecastNextMonth    = intercept + slope * byMonth.length

  const trend = Math.abs(slope) < 50
    ? 'stable'
    : slope > 0
      ? 'worsening'
      : 'improving'

  return { byMonth, slope, trend, avgMonthlyCost, forecastNextMonth }
}

/**
 * Vendor (brand) performance with composite score.
 * @param {Object[]} records
 * @returns {Array<{ brand, avgCpk, failureRate, avgLife, scrapRate, totalCost, count, score, rank }>}
 */
export function computeVendorPerformance(records = []) {
  const valid  = records.filter(_isValidRecord)
  const groups = _groupBy(records, r => r.brand ?? 'Unknown')

  const brandStats = Object.entries(groups).map(([brand, rows]) => {
    const validRows   = rows.filter(_isValidRecord)
    const cpks        = validRows.map(_cpkOf)
    const avgCpk      = _mean(cpks)
    const avgLife     = validRows.length > 0 ? _mean(validRows.map(_kmRun)) : 0
    const failureCount = rows.filter(r => r.risk_level === 'High' || r.risk_level === 'Critical').length
    const failureRate  = rows.length > 0 ? failureCount / rows.length : 0
    const scrapCount   = rows.filter(r => /scrap/i.test(String(r.category ?? ''))).length
    const scrapRate    = rows.length > 0 ? scrapCount / rows.length : 0
    const totalCost    = validRows.reduce((s, r) => s + Number(r.cost_per_tyre), 0)

    // Composite score: lower CPK is better, lower failureRate is better, longer life is better
    const cpkScore     = avgCpk > 0 ? 1 / avgCpk : 0
    const qualityScore = 1 - failureRate
    const lifeScore    = avgLife > 0 ? avgLife / 100000 : 0
    const score        = cpkScore * 0.4 + qualityScore * 0.3 + lifeScore * 0.3

    return { brand, avgCpk, failureRate, avgLife, scrapRate, totalCost, count: rows.length, validCount: validRows.length, score }
  })

  return brandStats
    .sort((a, b) => b.score - a.score)
    .map((b, i) => ({ ...b, rank: i + 1 }))
}

/**
 * Workshop performance proxied by site.
 * @param {Object[]} records   - tyre change records
 * @param {Object[]} actions   - corrective actions (must have site, status fields)
 * @returns {{ bySite: Array<{ site, recordCount, highRiskPct, avgCost, avgCpk, actionCloseRate, score }> }}
 */
export function computeWorkshopPerformance(records = [], actions = []) {
  const siteGroups = _groupBy(records, r => r.site ?? 'Unknown')
  const actionBySite = _groupBy(actions, a => a.site ?? 'Unknown')

  const bySite = Object.entries(siteGroups).map(([site, rows]) => {
    const valid       = rows.filter(_isValidRecord)
    const cpks        = valid.map(_cpkOf)
    const highRisk    = rows.filter(r => r.risk_level === 'High' || r.risk_level === 'Critical')
    const totalCost   = valid.reduce((s, r) => s + Number(r.cost_per_tyre), 0)
    const avgCost     = valid.length > 0 ? totalCost / valid.length : 0
    const avgCpk      = _mean(cpks)
    const highRiskPct = rows.length > 0 ? (highRisk.length / rows.length) * 100 : 0

    const siteActions = actionBySite[site] ?? []
    const closed      = siteActions.filter(a => /closed|resolved|done/i.test(String(a.status ?? '')))
    const actionCloseRate = siteActions.length > 0 ? closed.length / siteActions.length : 0

    // Score: lower CPK better, lower high-risk better, higher close rate better
    const cpkScore   = avgCpk > 0 ? (1 / avgCpk) * 0.4 : 0
    const riskScore  = (1 - highRiskPct / 100) * 0.3
    const closeScore = actionCloseRate * 0.3
    const score      = cpkScore + riskScore + closeScore

    return { site, recordCount: rows.length, highRiskPct, avgCost, avgCpk, actionCloseRate, score }
  })

  return { bySite: bySite.sort((a, b) => b.score - a.score) }
}

/**
 * Compute all KPIs in a single pass.
 * @param {Object[]} records     - tyre change / removal records
 * @param {Object[]} inspections - inspection records
 * @param {Object[]} actions     - corrective action records
 * @param {number}   fleetSize   - total vehicles in fleet
 * @returns {Object} - all KPI results keyed by name
 */
export function computeAllKpis(records = [], inspections = [], actions = [], fleetSize = 0) {
  return {
    cpk:                  computeCpkFleet(records),
    cpkByBrand:           computeCpkByBrand(records),
    cpkByAsset:           computeCpkByAsset(records),
    cpkBySite:            computeCpkBySite(records),
    avgTyreLife:          computeAvgTyreLife(records),
    fleetTyreLife:        computeFleetTyreLife(records),
    removalRate:          computeRemovalRate(records),
    failureRate:          computeFailureRate(records),
    replacementRate:      computeReplacementRate(records),
    pressureCompliance:   computePressureCompliance(inspections),
    inspectionCompliance: computeInspectionCompliance(inspections),
    retreadPerformance:   computeRetreadPerformance(records),
    scrapRate:            computeScrapRate(records),
    downtimeImpact:       computeVehicleDowntimeImpact(records),
    fleetAvailability:    computeFleetAvailability(records, fleetSize),
    costTrend:            computeCostTrend(records),
    vendorPerformance:    computeVendorPerformance(records),
    workshopPerformance:  computeWorkshopPerformance(records, actions),
  }
}
