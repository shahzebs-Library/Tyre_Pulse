import { toLifetimeTyres, hasLifetimeCpk, lifetimeCpk, weightedCpk, withOnePricePerTyre, isStrongSerial, lifetimeSummary, fitmentKm, spansMultipleCurrencies, cpkByCountry, CPK_KIND, CPK_KIND_LABEL } from './tyreLifetime'

// Measurable records span more than one country (currency). A CPK, a cost/km
// trend or a scrap cost summed across SAR + AED + EGP is rule T10 forbidden, so
// the scalar is reported null and the caller renders the per-country rows.
const _recordsMixCurrency = (records = []) => {
  const s = new Set()
  for (const r of records) {
    if ((Number(r.cost_per_tyre) || 0) <= 0) continue
    s.add(String(r.country ?? '').trim().toUpperCase())
  }
  return s.size > 1
}
// Sort comparator that pushes a null CPK to the end regardless of direction.
const _cpkAsc = (a, b) => (a == null ? Infinity : a) - (b == null ? Infinity : b)
const _cpkDesc = (a, b) => (b == null ? -Infinity : b) - (a == null ? -Infinity : a)

const _tyreKey = (r) => `${String(r.country ?? '').trim().toUpperCase()}|${String(r.serial_no ?? '').trim().toUpperCase()}`
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
  // ISO-shaped dates bucket by string slice: new Date('YYYY-MM-DD') parses UTC
  // while getFullYear/getMonth read local time, shifting first-of-month rows
  // into the previous month for negative-UTC-offset viewers.
  const m = String(dateStr).match(/^(\d{4})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}`
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// CPK is measured per PHYSICAL TYRE (src/lib/tyreLifetime.js): purchase price
// counted once, km summed across every fitment of that tyre. A refitted tyre is
// several fitment rows; costing each row separately charged it again and divided
// by one stint's km. These helpers take the lifetime objects toLifetimeTyres()
// returns, never raw fitment rows.
function _isValidRecord(t) {
  return hasLifetimeCpk(t)
}

function _cpkOf(t) {
  return lifetimeCpk(t)
}

function _lifeKm(t) {
  return Number(t._life_km)
}

/** Fitment rows -> physical tyres with a measurable price and life. */
function _validTyres(records) {
  return toLifetimeTyres(records).filter(_isValidRecord)
}

/** Physical tyres represented (a weak-serial row may stand for several). */
function _qtySum(tyres) {
  return tyres.reduce((s, t) => s + (t._qty || 1), 0)
}

/**
 * Group CPK block for a set of physical tyres. avgCpk is the WEIGHTED group CPK
 * (total purchase cost / total tyre-km, rule T8) so one short, expensive tyre
 * cannot swing a whole brand/site; meanOfRatios keeps the old average of
 * per-tyre ratios for distribution views only.
 */
function _groupCpk(tyres) {
  const cpks = tyres.map(_cpkOf)
  const w = tyres.length ? weightedCpk(tyres) : null
  const sum = lifetimeSummary(tyres)
  return {
    avgCpk:       w,
    weightedCpk:  w,
    meanOfRatios: cpks.length ? _mean(cpks) : null,
    cpkKind:      CPK_KIND.TYRE_LIFETIME,
    cpkKindLabel: CPK_KIND_LABEL[CPK_KIND.TYRE_LIFETIME],
    provisionalCount: sum.provisional,
    kmCoverage:   sum.coverage,
    estimatedShare: sum.estimatedShare,
  }
}

/**
 * km one completed fitment ran, by the SHARED km rule (tyreKm.js, T7), or null.
 * The removal / scrap rates used the raw removal-minus-fitment difference, so a
 * placeholder fitment odometer of "1" put the machine's whole odometer
 * (229,999 km) into the fleet distance, and a life above the class cap counted
 * as real distance. A fitment measured here is the same fitment the lifetime
 * layer measures.
 */
function _stintKm(r) {
  const fit = Number(r.km_at_fitment)
  const rem = Number(r.km_at_removal)
  if (!(isFinite(fit) && isFinite(rem) && rem > fit)) return null
  const km = fitmentKm(r)
  return km != null && km > 0 ? km : null
}

/** A tyre tagged scrap: category Scrap, or the scrap action's status stamp. */
function _isScrapTagged(r) {
  return /scrap/i.test(String(r.category ?? '')) || /^\s*scrap/i.test(String(r.status ?? ''))
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
  const tyres = toLifetimeTyres(records)
  const total = tyres.length
  const valid = tyres.filter(_isValidRecord)
  const cpks  = valid.map(_cpkOf)

  // HONEST NULLS: _mean/_median/_percentile return 0 for an empty array, which
  // is indistinguishable from a real CPK of zero. When no record has usable
  // cost+km the fleet CPK is NOT computable, and reporting 0 makes a data gap
  // look like a perfect result. Consumers already expect this (tyreFailureBoard
  // guards on validCount, boardOverview passes the value through `?? null`,
  // which cannot catch a 0).
  const has = cpks.length > 0
  const summary = lifetimeSummary(tyres)
  // Mixed currency: a fleet CPK, its median and percentiles all collapse several
  // currencies into one number when the scope is "All countries". They are null
  // then (rule T10), with the per-country weighted CPK rows in cpkByCountry; a
  // single-country scope is unchanged.
  const mixedCurrency = spansMultipleCurrencies(valid)
  const measurable = has && !mixedCurrency

  return {
    cpkKind:      CPK_KIND.FLEET_AGGREGATE,
    cpkKindLabel: CPK_KIND_LABEL[CPK_KIND.FLEET_AGGREGATE],
    // Coverage behind the figure: how many tyres are still fitted (provisional),
    // km coverage counts and the share of cost that is an ESTIMATED price.
    provisionalCount: summary.provisional,
    kmCoverage:       summary.coverage,
    estimatedShare:   summary.estimatedShare,
    // Fleet CPK = total purchase cost / total km of the measurable tyres
    // (weighted). Every page reads fleetAvgCpk, so the correction lands
    // everywhere at once. The plain average of per-tyre ratios stays available
    // as meanCpk for distribution views only.
    fleetAvgCpk:  measurable ? weightedCpk(valid) : null,
    weightedCpk:  measurable ? weightedCpk(valid) : null,
    meanCpk:      measurable ? _mean(cpks) : null,
    medianCpk:    measurable ? _median(cpks) : null,
    mixedCurrency,
    cpkByCountry: mixedCurrency ? cpkByCountry(valid) : [],
    validCount:   valid.length,
    totalCount:   total,
    fitmentRows:  records.length,
    coveragePct:  total > 0 ? (valid.length / total) * 100 : 0,
    p10Cpk:       measurable ? _percentile(cpks, 10) : null,
    p90Cpk:       measurable ? _percentile(cpks, 90) : null,
  }
}

/**
 * CPK grouped by tyre brand.
 * @param {Object[]} records
 * avgCpk is the WEIGHTED group CPK (cost / tyre-km); meanOfRatios is the old mean.
 * @returns {Array<{ brand, avgCpk, weightedCpk, meanOfRatios, medianCpk, count, validCount, minCpk, maxCpk }>} sorted ascending (best CPK first)
 */
export function computeCpkByBrand(records = []) {
  // Collapse FIRST, then group: a tyre is grouped by its latest fitment's brand.
  const valid  = _validTyres(records)
  const groups = _groupBy(valid, r => r.brand ?? 'Unknown')

  return Object.entries(groups)
    .map(([brand, rows]) => {
      const cpks = rows.map(_cpkOf)
      return {
        brand,
        ..._groupCpk(rows),
        medianCpk: _median(cpks),
        count:     _qtySum(rows),
        validCount: rows.length,
        minCpk:    Math.min(...cpks),
        maxCpk:    Math.max(...cpks),
      }
    })
    // avgCpk is null for a group that spans currencies (weightedCpk returns null
    // on mixed); such a group sorts last rather than poisoning the order with NaN.
    .sort((a, b) => _cpkAsc(a.avgCpk, b.avgCpk))
}

/**
 * CPK grouped by asset (vehicle). A tyre is attributed to the asset of its
 * LATEST fitment (where it is now / last ran), with its whole lifetime.
 * @param {Object[]} records
 * @returns {Array<{ asset_no, avgCpk, weightedCpk, meanOfRatios, totalCost, count, validCount }>} sorted descending (worst first)
 */
export function computeCpkByAsset(records = []) {
  const valid  = _validTyres(records)
  const groups = _groupBy(valid, r => r.asset_no ?? 'Unknown')

  return Object.entries(groups)
    .map(([asset_no, rows]) => {
      const totalCost = rows.reduce((s, t) => s + t._cost * (t._qty || 1), 0)
      return {
        asset_no,
        ..._groupCpk(rows),
        totalCost,
        count:     _qtySum(rows),
        validCount: rows.length,
      }
    })
    // worst CPK first; a null (mixed-currency) group sorts last.
    .sort((a, b) => _cpkDesc(a.avgCpk, b.avgCpk))
}

/**
 * CPK grouped by site (the site of each tyre's latest fitment).
 * @param {Object[]} records
 * @returns {Array<{ site, avgCpk, weightedCpk, meanOfRatios, medianCpk, count, validCount, minCpk, maxCpk }>} sorted descending (worst site first)
 */
export function computeCpkBySite(records = []) {
  const valid  = _validTyres(records)
  const groups = _groupBy(valid, r => r.site ?? 'Unknown')

  return Object.entries(groups)
    .map(([site, rows]) => {
      const cpks = rows.map(_cpkOf)
      return {
        site,
        ..._groupCpk(rows),
        medianCpk: _median(cpks),
        count:     _qtySum(rows),
        validCount: rows.length,
        minCpk:    Math.min(...cpks),
        maxCpk:    Math.max(...cpks),
      }
    })
    // worst site first; a null (mixed-currency) group sorts last.
    .sort((a, b) => _cpkDesc(a.avgCpk, b.avgCpk))
}

/**
 * Average tyre life in km.
 * @param {Object[]} records
 * @returns {{ avgKm, medianKm, maxKm, minKm, validCount, byBrand, bySite }}
 */
export function computeAvgTyreLife(records = []) {
  // Life of a PHYSICAL tyre: km across all its fitments, not one stint.
  const valid = toLifetimeTyres(records).filter(t => Number(t._life_km) > 0)

  const kms = valid.map(_lifeKm)

  const byBrand = Object.entries(_groupBy(valid, r => r.brand ?? 'Unknown'))
    .map(([brand, rows]) => ({ brand, avgKm: _mean(rows.map(_lifeKm)), count: rows.length }))
    .sort((a, b) => b.avgKm - a.avgKm)

  const bySite = Object.entries(_groupBy(valid, r => r.site ?? 'Unknown'))
    .map(([site, rows]) => ({ site, avgKm: _mean(rows.map(_lifeKm)), count: rows.length }))
    .sort((a, b) => b.avgKm - a.avgKm)

  // Missing is not zero: with no measurable tyre the life is unknown (null),
  // never 0 km (the AI agents and board tiles printed "0 km" for a data gap).
  const has = kms.length > 0
  return {
    avgKm:      has ? _mean(kms) : null,
    medianKm:   has ? _median(kms) : null,
    maxKm:      has ? Math.max(...kms) : null,
    minKm:      has ? Math.min(...kms) : null,
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
  // Per PHYSICAL tyre: km summed across every fitment by the shared km rule.
  const valid = toLifetimeTyres(records).filter(t => Number(t._life_km) > 0)

  const avgKm = valid.length ? _mean(valid.map(_lifeKm)) : null

  const byMonth = _groupBy(valid, r => _toMonthKey(r.issue_date) ?? 'Unknown')
  const trend = Object.entries(byMonth)
    .filter(([month]) => month !== 'Unknown')
    .map(([month, rows]) => ({ month, avgKm: _mean(rows.map(_lifeKm)) }))
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
  const valid = records.filter(r => _stintKm(r) != null)

  // Numerator and denominator MUST cover the same population. When the fleet km
  // is derived here it is summed from `valid` only, so counting every record as
  // a removal divided the full removal count by a partial distance - a large
  // share of records carry no usable km - and inflated the rate. A caller that
  // supplies a real fleetKmTotal is measuring the whole fleet, so there every
  // removal legitimately counts.
  const derived          = fleetKmTotal == null
  const totalRemovals    = derived ? valid.length : records.length
  const estimatedFleetKm = fleetKmTotal ?? valid.reduce((s, r) => s + _stintKm(r), 0)
  // No measured distance means no rate: null, never 0 (0 reads as a perfect fleet).
  const removalPer1000Km = estimatedFleetKm > 0
    ? (totalRemovals / estimatedFleetKm) * 1000
    : null

  return { removalPer1000Km, totalRemovals, estimatedFleetKm }
}

/**
 * Tyre failure rate (High + Critical risk levels).
 * @param {Object[]} records
 * @returns {{ failureRate, failureCount, totalCount, criticalRate, highRate, bySite, byBrand }}
 */
export function computeFailureRate(records = []) {
  // Failure rate is derived from risk_level, which is populated on a MINORITY of
  // rows (0 of 11,132 in the live fleet at the time of writing, because nothing
  // in the intake pipeline sets it). Dividing by every record therefore produced
  // 0/total = 0% and rendered as a perfect fleet.
  //
  // The rate is now computed over the RATED SUBSET only, and is null - not zero -
  // when nothing is rated. A rate of "not measured" is honest; a rate of 0% on
  // unrated data is a safety claim the data cannot support. Callers must treat
  // null as "no data" (boardOverview and the report tiles already do).
  const total = records.length
  const rated = records.filter(r => r.risk_level != null && String(r.risk_level).trim() !== '')
  const ratedCount = rated.length

  const critical = rated.filter(r => r.risk_level === 'Critical')
  const high     = rated.filter(r => r.risk_level === 'High')
  const failures = rated.filter(r => r.risk_level === 'High' || r.risk_level === 'Critical')

  const _ratesByGroup = (groupKey) =>
    Object.entries(_groupBy(rated, r => r[groupKey] ?? 'Unknown'))
      .map(([key, rows]) => ({
        [groupKey]: key,
        rate:  rows.length > 0
          ? rows.filter(r => r.risk_level === 'High' || r.risk_level === 'Critical').length / rows.length
          : null,
        count: rows.length,
      }))
      .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1))

  return {
    failureRate:  ratedCount > 0 ? failures.length / ratedCount : null,
    failureCount: ratedCount > 0 ? failures.length : null,
    totalCount:   total,
    // How much of the fleet the rate actually rests on - surface this wherever
    // the rate is shown, the way the accident analytics surface their basis.
    ratedCount,
    coveragePct:  total > 0 ? (ratedCount / total) * 100 : null,
    measured:     ratedCount > 0,
    criticalRate: ratedCount > 0 ? critical.length / ratedCount : null,
    highRate:     ratedCount > 0 ? high.length / ratedCount : null,
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

/** Minimum recorded pressures on one inspection before its median is trusted. */
export const PRESSURE_MIN_READINGS = 4
/** A reading this far off its vehicle's own median is treated as non-compliant. */
export const PRESSURE_TOLERANCE = 0.15

/**
 * Pull the recorded PSI readings out of one inspection's tyre_conditions.
 * Tolerates every shape the app stores: an object keyed by position, an array of
 * position objects, or a JSON string of either. Mobile writes `pressure_psi`.
 * @returns {number[]} finite, positive readings only
 */
export function pressureReadings(inspection) {
  let tc = inspection ? inspection.tyre_conditions : null
  if (typeof tc === 'string') {
    try { tc = JSON.parse(tc) } catch { return [] }
  }
  if (!tc || typeof tc !== 'object') return []
  const entries = Array.isArray(tc) ? tc : Object.values(tc)
  const out = []
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue
    const n = Number(e.pressure_psi ?? e.pressure ?? e.psi)
    if (Number.isFinite(n) && n > 0) out.push(n)
  }
  return out
}

/**
 * Pressure compliance measured from the ACTUAL recorded PSI readings.
 *
 * THIS USED TO MEASURE NOTHING. The previous implementation counted inspections
 * whose free-text `findings` box was non-empty - so an inspector typing "ok"
 * scored as compliant, and one recording 40 PSI on a 120 PSI tyre while leaving
 * the notes blank did not. It never read a pressure.
 *
 * There is no stored per-size target pressure anywhere in the schema, so the
 * only defensible reference is the one the inspection PDF already uses: each
 * reading is compared to the MEDIAN of the readings taken on that same vehicle,
 * and is non-compliant when it is more than PRESSURE_TOLERANCE off. That makes
 * this a measure of pressure CONSISTENCY across a vehicle's own tyres, not
 * conformance to a manufacturer spec - `basis` says so, and it is the same
 * single judgement the PDF prints so the two can never disagree.
 *
 * An inspection with fewer than PRESSURE_MIN_READINGS readings has no trustworthy
 * median and is counted in NEITHER the numerator nor the denominator. When
 * nothing is measurable the result is null - never a flattering percentage.
 *
 * @param {Object[]} inspections rows INCLUDING tyre_conditions
 * @param {number}   [targetPct=90]
 * @returns {{ compliancePct:(number|null), compliantCount, totalCount, measuredInspections,
 *             notMeasuredInspections, readings, basis, targetPct, bySite }}
 */
export function computePressureCompliance(inspections = [], targetPct = 90) {
  const nonCancelled = inspections.filter(i => i.status !== 'Cancelled')

  // one entry per inspection that carries a usable median
  const measure = (rows) => {
    let compliant = 0
    let readings  = 0
    let measured  = 0
    for (const i of rows) {
      const ps = pressureReadings(i)
      // _median returns 0 for an empty array, which the guard below rejects
      const med = _median(ps)
      if (ps.length < PRESSURE_MIN_READINGS || !med || med <= 0) continue
      measured += 1
      for (const p of ps) {
        readings += 1
        if (Math.abs((p - med) / med) <= PRESSURE_TOLERANCE) compliant += 1
      }
    }
    return {
      compliancePct: readings > 0 ? (compliant / readings) * 100 : null,
      compliant, readings, measured,
    }
  }

  const all = measure(nonCancelled)

  const bySite = Object.entries(_groupBy(nonCancelled, i => i.site ?? 'Unknown'))
    .map(([site, rows]) => {
      const m = measure(rows)
      return { site, compliancePct: m.compliancePct, count: rows.length, readings: m.readings }
    })
    // unmeasured sites sort last rather than pretending to be the worst
    .sort((a, b) => (a.compliancePct ?? Infinity) - (b.compliancePct ?? Infinity))

  return {
    compliancePct:          all.compliancePct,
    compliantCount:         all.readings > 0 ? all.compliant : null,
    totalCount:             all.readings,
    measuredInspections:    all.measured,
    notMeasuredInspections: nonCancelled.length - all.measured,
    readings:               all.readings,
    basis: all.readings > 0
      ? `${all.readings} recorded pressures across ${all.measured} of ${nonCancelled.length} inspections, each compared to its own vehicle median`
      : 'no pressure readings recorded',
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
  const valid    = _validTyres(records)
  const retreads = valid.filter(r => /retread/i.test(String(r.category ?? '')))
  const newTyres = valid.filter(r => !/retread/i.test(String(r.category ?? '')) && !/scrap/i.test(String(r.category ?? '')))

  if (retreads.length < 2 || newTyres.length < 2) return null

  // Weighted per group (total cost / total tyre-km), rule T8.
  const retreadCpk  = weightedCpk(retreads)
  const newCpk      = weightedCpk(newTyres)
  const savingsPct  = newCpk > 0 ? ((newCpk - retreadCpk) / newCpk) * 100 : 0
  const retreadAvgLife = _mean(retreads.map(_lifeKm))
  const newAvgLife     = _mean(newTyres.map(_lifeKm))

  return {
    retreadCpk,
    newCpk,
    retreadMeanOfRatios: _mean(retreads.map(_cpkOf)),
    newMeanOfRatios:     _mean(newTyres.map(_cpkOf)),
    cpkKind:       CPK_KIND.TYRE_LIFETIME,
    retreadCount:  _qtySum(retreads),
    newCount:      _qtySum(newTyres),
    savingsPct,
    retreadAvgLife,
    newAvgLife,
  }
}

/**
 * Scrap rate calculation.
 * @param {Object[]} records
 * @param {number}   [scrapKmPct=20]  - % of fleet avg km below which a removal is premature scrap
 * @param {number}   [defaultCost=0]  - cost for records with no cost_per_tyre; 0 = actual only (no fabricated default)
 * @returns {{ scrapRate, scrapCount, totalCount, estimatedScrapCost, bySite }}
 */
export function computeScrapRate(records = [], scrapKmPct = 20, defaultCost = 0) {
  const stints = records.map(_stintKm).filter(k => k != null)
  const avgKm = _mean(stints)
  const kmThreshold = avgKm * (scrapKmPct / 100)

  // A tyre is scrapped when it is TAGGED Scrap (category), when the scrap action
  // stamped it (status 'Scrapped' - scrap_tyre_by_serial and the bulk scrap both
  // write status, never category), or a Critical premature removal. Reading
  // category alone missed every live scrap: 0 rows carry category Scrap while 835
  // rows carry status Scrapped (2026-11-09), so the rate read 0%.
  const isScrap = (r) => {
    if (_isScrapTagged(r)) return true
    if (r.risk_level === 'Critical') {
      const km = _stintKm(r)
      if (km != null && km < kmThreshold) return true
    }
    return false
  }
  // Counted per PHYSICAL tyre: the scrap action stamps every row of a serial, so a
  // refitted tyre would otherwise be counted once per fitment.
  const physKey = (r, i) => (isStrongSerial(r.serial_no) ? _tyreKey(r) : `row:${r.id ?? i}`)
  const keyed = records.map((r, i) => ({ r, k: physKey(r, i) }))
  const allKeys = new Set(keyed.map(x => x.k))
  const scrapKeys = new Set(keyed.filter(x => isScrap(x.r)).map(x => x.k))
  const scrapped = records.filter(isScrap)
  const total = allKeys.size

  // A scrapped physical tyre costs its purchase price once, wherever that price
  // sits in its fitment history (the scrapped row may be a refit with no price).
  const purchase = new Map()
  for (const r of withOnePricePerTyre(records)) {
    if (isStrongSerial(r.serial_no) && Number(r.cost_per_tyre) > 0) purchase.set(_tyreKey(r), Number(r.cost_per_tyre))
  }
  const countedTyres = new Set()
  const estimatedScrapCost = scrapped.reduce((s, r) => {
    if (isStrongSerial(r.serial_no)) {
      const k = _tyreKey(r)
      if (countedTyres.has(k)) return s
      countedTyres.add(k)
      return s + (purchase.get(k) ?? defaultCost)
    }
    return s + (Number(r.cost_per_tyre) > 0 ? Number(r.cost_per_tyre) : defaultCost) * (Number(r.qty) || 1)
  }, 0)

  const bySite = Object.entries(_groupBy(keyed, x => x.r.site ?? 'Unknown'))
    .map(([site, rows]) => {
      const siteAll = new Set(rows.map(x => x.k))
      const siteScrap = new Set(rows.filter(x => isScrap(x.r)).map(x => x.k))
      return {
        site,
        scrapRate:  siteAll.size > 0 ? siteScrap.size / siteAll.size : 0,
        scrapCount: siteScrap.size,
        count:      siteAll.size,
      }
    })
    .sort((a, b) => b.scrapRate - a.scrapRate)

  return {
    scrapRate:          total > 0 ? scrapKeys.size / total : 0,
    scrapCount:         scrapKeys.size,
    totalCount:         total,
    scrapRows:          scrapped.length,
    fitmentRows:        records.length,
    estimatedScrapCost,
    // estimatedScrapCost sums purchase prices; when the records span countries it
    // blends currencies (rule T10). The scalar is kept for single-country callers;
    // mixedCurrency tells a caller on the All view to withhold the money figure.
    mixedCurrency:      _recordsMixCurrency(records),
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
  // Availability is read off Critical risk ratings. When no tyre carries a rating
  // (0 of 11,410 live rows on 2026-11-09) the old 100% was a claim the data cannot
  // support: it is null (not measured) now, like computeFailureRate.
  const ratedCount = records.filter(r => r.risk_level != null && String(r.risk_level).trim() !== '').length
  const availabilityPct = ratedCount > 0 && resolvedFleetSize > 0
    ? ((resolvedFleetSize - unavailableCount) / resolvedFleetSize) * 100
    : null

  return { availabilityPct, unavailableCount, criticalVehicles, fleetSize: resolvedFleetSize, ratedCount, measured: availabilityPct != null }
}

/**
 * Monthly cost trend with linear regression and 1-month forecast.
 * @param {Object[]} records
 * @param {number}   [defaultCost=0]  - cost for records with no cost_per_tyre; 0 = actual only (no fabricated default)
 * @returns {{ byMonth, slope, trend, avgMonthlyCost, forecastNextMonth }}
 */
export function computeCostTrend(records = [], defaultCost = 0) {
  // Last 13 months
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 12, 1)

  // Purchase spend: a refitted tyre's price is counted once, on its first fitment.
  const recent = withOnePricePerTyre(records).filter(r => {
    const d = r.issue_date ? new Date(r.issue_date) : null
    return d && d >= start
  })

  const byMonth = Object.entries(
    _groupBy(recent.filter(r => _toMonthKey(r.issue_date)), r => _toMonthKey(r.issue_date))
  )
    .map(([month, rows]) => ({
      month,
      totalCost: rows.reduce(
        (s, r) => s + (Number(r.cost_per_tyre) > 0 ? Number(r.cost_per_tyre) : defaultCost) * (Number(r.qty) || 1),
        0
      ),
      count: rows.length,
    }))
    .sort((a, b) => a.month.localeCompare(b.month))

  const avgMonthlyCost = _mean(byMonth.map(m => m.totalCost))

  // Regression using numeric month index
  const points = byMonth.map((m, i) => ({ x: i, y: m.totalCost }))
  const { slope, intercept } = _linearRegression(points)
  // A single month cannot support a regression (slope/intercept fall back to 0,
  // which fabricated a "next month: 0" forecast beside a real positive spend).
  const forecastNextMonth = byMonth.length >= 2
    ? intercept + slope * byMonth.length
    : (byMonth.length === 1 ? byMonth[0].totalCost : null)

  const trend = Math.abs(slope) < 50
    ? 'stable'
    : slope > 0
      ? 'worsening'
      : 'improving'

  // byMonth.totalCost blends currencies when the records span countries (rule
  // T10). The money series is kept for single-country callers; mixedCurrency
  // tells a caller on the All view the trend is not a single-currency figure.
  return { byMonth, slope, trend, avgMonthlyCost, forecastNextMonth, mixedCurrency: _recordsMixCurrency(records) }
}

/**
 * Vendor (brand) performance with composite score.
 * @param {Object[]} records
 * @returns {Array<{ brand, avgCpk, failureRate, avgLife, scrapRate, totalCost, count, score, rank }>}
 */
export function computeVendorPerformance(records = []) {
  // Collapse to physical tyres FIRST, then group by the tyre's latest brand, so a
  // tyre refitted under another brand row is not split across two vendors.
  // Failure and scrap stay per fitment EVENT (each row is one removal/assessment).
  const tyreGroups  = _groupBy(toLifetimeTyres(records), t => t.brand ?? 'Unknown')
  const eventGroups = _groupBy(records, r => r.brand ?? 'Unknown')
  const brands = new Set([...Object.keys(tyreGroups), ...Object.keys(eventGroups)])

  const brandStats = [...brands].map((brand) => {
    const tyres       = tyreGroups[brand] ?? []
    const rows        = eventGroups[brand] ?? []
    const validRows   = tyres.filter(_isValidRecord)
    const cpkBlock    = _groupCpk(validRows)
    // HONEST NULL: a vendor with no measurable, same-currency CPK stays null (N/A),
    // never a flattering 0 that would rank an unpriced brand as the cheapest per km.
    // The score math below reads `avgCpk > 0`, which is false for null exactly as for 0.
    const avgCpk      = cpkBlock.avgCpk
    const lifeTyres   = tyres.filter(t => Number(t._life_km) > 0)
    const avgLife     = lifeTyres.length > 0 ? _mean(lifeTyres.map(_lifeKm)) : 0
    const failureCount = rows.filter(r => r.risk_level === 'High' || r.risk_level === 'Critical').length
    const failureRate  = rows.length > 0 ? failureCount / rows.length : 0
    // Same scrap tag as computeScrapRate: live scraps carry status 'Scrapped'
    // (category is never set by the scrap action), so category alone read 0%.
    const scrapCount   = rows.filter(_isScrapTagged).length
    const scrapRate    = rows.length > 0 ? scrapCount / rows.length : 0
    const totalCost    = validRows.reduce((s, t) => s + t._cost * (t._qty || 1), 0)

    // Composite score: lower CPK is better, lower failureRate is better, longer life is better
    const cpkScore     = avgCpk > 0 ? 1 / avgCpk : 0
    const qualityScore = 1 - failureRate
    const lifeScore    = avgLife > 0 ? avgLife / 100000 : 0
    const score        = cpkScore * 0.4 + qualityScore * 0.3 + lifeScore * 0.3

    return {
      brand, ...cpkBlock, avgCpk, failureRate, avgLife, scrapRate, totalCost,
      count: _qtySum(tyres),          // physical tyres
      fitmentCount: rows.length,      // fitment rows (event basis of failure/scrap rate)
      validCount: validRows.length,
      score,
    }
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
  // Cost/CPK: collapse to physical tyres FIRST, then group by the tyre's latest
  // site. High-risk share and record count stay per fitment row (events).
  const tyreGroups   = _groupBy(toLifetimeTyres(records), t => t.site ?? 'Unknown')
  const siteGroups   = _groupBy(records, r => r.site ?? 'Unknown')
  const actionBySite = _groupBy(actions, a => a.site ?? 'Unknown')
  const sites = new Set([...Object.keys(siteGroups), ...Object.keys(tyreGroups)])

  const bySite = [...sites].map((site) => {
    const rows        = siteGroups[site] ?? []
    const valid       = (tyreGroups[site] ?? []).filter(_isValidRecord)
    const cpkBlock    = _groupCpk(valid)
    const highRisk    = rows.filter(r => r.risk_level === 'High' || r.risk_level === 'Critical')
    const totalCost   = valid.reduce((s, t) => s + t._cost * (t._qty || 1), 0)
    const qtySum      = _qtySum(valid)
    const avgCost     = qtySum > 0 ? totalCost / qtySum : 0
    // HONEST NULL (see computeVendorPerformance): an unmeasurable site CPK stays null.
    const avgCpk      = cpkBlock.avgCpk
    const highRiskPct = rows.length > 0 ? (highRisk.length / rows.length) * 100 : 0

    const siteActions = actionBySite[site] ?? []
    const closed      = siteActions.filter(a => /closed|resolved|done/i.test(String(a.status ?? '')))
    const actionCloseRate = siteActions.length > 0 ? closed.length / siteActions.length : 0

    // Score: lower CPK better, lower high-risk better, higher close rate better
    const cpkScore   = avgCpk > 0 ? (1 / avgCpk) * 0.4 : 0
    const riskScore  = (1 - highRiskPct / 100) * 0.3
    const closeScore = actionCloseRate * 0.3
    const score      = cpkScore + riskScore + closeScore

    return {
      site, recordCount: rows.length, highRiskPct, avgCost, ...cpkBlock, avgCpk,
      tyreCount: qtySum, actionCloseRate, score,
    }
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
