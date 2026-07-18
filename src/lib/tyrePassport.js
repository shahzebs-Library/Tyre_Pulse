/**
 * Tyre Passport pure builder (no I/O) that assembles a single tyre's complete
 * whole-life record from its `tyre_records` rows plus optional auxiliary
 * sources (service events, warranty claims, status marks, retread claims).
 * One physical tyre may appear across several records (fitment, rotation to
 * another asset/position, removal, retread). This collapses them into:
 *   - an identity header + lifetime totals (km, hours, cost, CPK),
 *   - a composite Health Score (0 to 100) with weighted sub-scores,
 *   - Wear Intelligence (tread-remaining %, wear rate, projected scrap),
 *   - a cross-vehicle Journey of fitment stints with per-stint km / cost / CPK,
 *   - a tread-over-time series, cost breakdown, honest predictions and a
 *     data-quality audit.
 *
 * Signals with no source in this dataset degrade honestly. A health sub-score
 * with no signal returns a NEUTRAL 70 (flagged hasData:false) rather than
 * fabricating a measurement; predictions return null when not computable.
 *
 * buildPassport(records) keeps its original single-argument shape; an optional
 * second argument carries the auxiliary sources and only adds fields.
 */

/** Engineering constants (tyre_saas defaults). */
export const INITIAL_TREAD_MM = 16.0
export const SCRAP_TREAD_MM = 3.0
export const MIN_KM_FOR_RATE = 50 // don't derive wear/CPK from a trivial distance
const NEUTRAL_SCORE = 70 // engine's "no signal" fallback

/** Health-score component weights (must sum to 1.0). */
export const HEALTH_WEIGHTS = { tread: 0.35, pressure: 0.20, age: 0.15, alerts: 0.20, history: 0.10 }

export const serialOfRecord = (r) =>
  (r?.serial_no || r?.serial_number || r?.tyre_serial || '').toString().trim()

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}
const firstNonEmpty = (rows, key) => {
  for (const r of rows) { const v = r?.[key]; if (v != null && String(v).trim() !== '') return v }
  return null
}
const eventDate = (r) => r?.fitment_date || r?.issue_date || r?.removal_date || r?.created_at || null
const round = (v, dp = 2) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp)
const ts = (d) => { const t = new Date(d || 0).getTime(); return Number.isFinite(t) ? t : 0 }
const DAY_MS = 86400000

// Health sub-scores (buckets ported verbatim from health_score_engine)

/** Tread sub-score from tread-remaining %. null pct returns neutral. */
export function treadScore(remainingPct) {
  if (remainingPct == null) return NEUTRAL_SCORE
  if (remainingPct >= 80) return 100
  if (remainingPct >= 60) return 85
  if (remainingPct >= 40) return 65
  if (remainingPct >= 20) return 40
  return 15
}

/** Pressure sub-score from |delta%| vs target. null returns neutral (no target in this data). */
export function pressureScore(deltaPct) {
  if (deltaPct == null) return NEUTRAL_SCORE
  const d = Math.abs(deltaPct)
  if (d <= 5) return 100
  if (d <= 10) return 80
  if (d <= 15) return 55
  if (d <= 25) return 30
  return 10
}

/** Age sub-score from age in years. null returns neutral (no manufacture date in this data). */
export function ageScore(years) {
  if (years == null) return NEUTRAL_SCORE
  if (years <= 2) return 100
  if (years <= 4) return 80
  if (years <= 5) return 60
  if (years <= 6) return 35
  return 10
}

/** Open-alert sub-score. null returns neutral (no alerts source). */
export function alertScore(openAlerts) {
  if (openAlerts == null) return NEUTRAL_SCORE
  if (openAlerts === 0) return 100
  if (openAlerts === 1) return 65
  if (openAlerts <= 3) return 35
  return 10
}

/** Repair-history sub-score from repair-event count. */
export function historyScore(repairCount) {
  if (repairCount == null) return NEUTRAL_SCORE
  if (repairCount === 0) return 100
  if (repairCount === 1) return 75
  if (repairCount <= 3) return 45
  return 20
}

/** Risk band from an overall 0 to 100 score. */
export function riskLevel(score) {
  if (score == null) return 'unknown'
  if (score < 40) return 'critical'
  if (score < 60) return 'high'
  if (score < 80) return 'medium'
  return 'low'
}

const REPAIR_RE = /repair|puncture|patch|plug|section/i
const RETREAD_RE = /retread|remould|remold|recap|recage|re-?tread/i

/**
 * Compute the composite health score for a passport's derived signals.
 * Each component reports { score, weight, hasData }. Missing signals use the
 * neutral fallback and hasData:false, matching the original engine's behaviour.
 */
export function computeHealth({ treadRemainingPct, pressureDeltaPct, ageYears, openAlerts, repairCount }) {
  const components = {
    tread: { score: treadScore(treadRemainingPct), weight: HEALTH_WEIGHTS.tread, hasData: treadRemainingPct != null },
    pressure: { score: pressureScore(pressureDeltaPct), weight: HEALTH_WEIGHTS.pressure, hasData: pressureDeltaPct != null },
    age: { score: ageScore(ageYears), weight: HEALTH_WEIGHTS.age, hasData: ageYears != null },
    alerts: { score: alertScore(openAlerts), weight: HEALTH_WEIGHTS.alerts, hasData: openAlerts != null },
    history: { score: historyScore(repairCount), weight: HEALTH_WEIGHTS.history, hasData: repairCount != null },
  }
  let overall = 0
  for (const c of Object.values(components)) overall += c.score * c.weight
  overall = Math.max(0, Math.min(100, Math.round(overall)))
  return { overall, risk: riskLevel(overall), components }
}

// Wear intelligence (from tread_wear_engine)

/**
 * Derive wear metrics from a tyre's tread readings + lifetime km.
 * @param {{date:string|null, tread:number|null}[]} readings  oldest to newest
 * @param {number} totalKm
 */
export function computeWear(readings = [], totalKm = 0) {
  const pts = (Array.isArray(readings) ? readings : []).filter((r) => r && r.tread != null)
  const current = pts.length ? pts[pts.length - 1].tread : null
  // Initial tread = the first recorded reading if it is the largest (tyre worn
  // down over time); otherwise the manufacturer default. Never invent a value
  // that would make wear look better than the data shows.
  const firstReading = pts.length ? pts[0].tread : null
  const initial = firstReading != null && firstReading >= (current ?? 0)
    ? Math.max(firstReading, current ?? 0)
    : INITIAL_TREAD_MM
  const usable = initial > SCRAP_TREAD_MM

  const treadRemainingPct = current != null && usable
    ? Math.max(0, Math.min(100, round(((current - SCRAP_TREAD_MM) / (initial - SCRAP_TREAD_MM)) * 100, 1)))
    : null

  const consumed = current != null ? round(initial - current, 2) : null
  const wearRatePer1000 = consumed != null && consumed > 0 && totalKm > MIN_KM_FOR_RATE
    ? round((consumed / totalKm) * 1000, 3)
    : null
  const projectedRemainingKm = wearRatePer1000 && current != null && current > SCRAP_TREAD_MM
    ? Math.round(((current - SCRAP_TREAD_MM) / wearRatePer1000) * 1000)
    : null

  return {
    initialTread: initial,
    currentTread: current,
    scrapTread: SCRAP_TREAD_MM,
    treadRemainingPct,
    treadConsumedMm: consumed,
    wearRatePer1000Km: wearRatePer1000,
    projectedRemainingKm,
    readingCount: pts.length,
  }
}

/** Normalise a raw tyre_service_events row for display. */
export function normalizeServiceEvent(r = {}) {
  return {
    id: r.id,
    date: r.event_date || r.created_at || null,
    type: r.event_type || 'other',
    asset_no: r.asset_no || null,
    position: r.position || null,
    site: r.site || null,
    tread: num(r.tread_depth),
    pressure: num(r.pressure),
    cost: num(r.cost),
    technician: r.technician || null,
    notes: r.notes || null,
  }
}

/** Normalise a raw warranty_claims row for display. */
export function normalizeWarrantyClaim(r = {}) {
  return {
    id: r.id,
    claim_no: r.claim_no || null,
    status: r.claim_status || null,
    failure_type: r.failure_type || null,
    supplier: r.supplier || null,
    brand: r.brand || null,
    asset_no: r.asset_no || null,
    km_run: num(r.km_run),
    expected_life_km: num(r.expected_life_km),
    credit_amount: num(r.credit_amount),
    credit_date: r.credit_date || null,
    fitment_date: r.fitment_date || null,
    removal_date: r.removal_date || null,
    notes: r.notes || null,
  }
}

/** Normalise a raw retread_claims row for display. */
export function normalizeRetreadClaim(r = {}) {
  return {
    id: r.id,
    claim_no: r.claim_no || null,
    vendor: r.vendor || null,
    reason: r.reason || null,
    status: r.status || null,
    cost: num(r.cost),
    amount_recovered: num(r.amount_recovered),
    claim_date: r.claim_date || null,
    asset_no: r.asset_no || null,
    notes: r.notes || null,
  }
}

/**
 * Build the ordered cross-vehicle journey from the chronological events.
 * Each stint carries per-stint km / cost / CPK and its removal reason.
 */
export function buildJourney(events = []) {
  return (Array.isArray(events) ? events : []).map((e) => {
    const km = e.kmEarned != null ? e.kmEarned : (e.km != null ? e.km : null)
    const cost = e.cost != null ? e.cost : null
    const cpk = km != null && km > 0 && cost != null ? round(cost / km, 3) : null
    return {
      id: e.id,
      asset_no: e.asset_no || null,
      position: e.position || null,
      site: e.site || null,
      fitted: e.fitment_date || e.date || null,
      removed: e.removal_date || null,
      km_run: km,
      cost,
      cpk,
      reason: e.reason || null,
      status: e.status || null,
    }
  })
}

/**
 * Honest data-quality audit over the journey + tread series.
 * Returns [] when every check passes.
 */
export function auditDataQuality(journey = [], treadSeries = []) {
  const warnings = []

  // 1. Impossible overlap: the same tyre fitted to two different assets over
  // overlapping date ranges cannot physically happen.
  const stints = (journey || []).filter((s) => s.fitted)
  for (let i = 0; i < stints.length; i += 1) {
    for (let j = i + 1; j < stints.length; j += 1) {
      const a = stints[i]
      const b = stints[j]
      if (!a.asset_no || !b.asset_no || a.asset_no === b.asset_no) continue
      const aStart = ts(a.fitted)
      const aEnd = a.removed ? ts(a.removed) : Number.MAX_SAFE_INTEGER
      const bStart = ts(b.fitted)
      const bEnd = b.removed ? ts(b.removed) : Number.MAX_SAFE_INTEGER
      if (aStart < bEnd && bStart < aEnd) {
        warnings.push({
          code: 'overlap',
          severity: 'high',
          message: `Fitted to ${a.asset_no} and ${b.asset_no} over overlapping dates (a tyre cannot be on two vehicles at once).`,
        })
      }
    }
  }

  // 2. Tread reading increasing over time (a tyre cannot regrow tread).
  const pts = (treadSeries || []).filter((p) => p && p.tread != null && p.date)
    .slice().sort((x, y) => ts(x.date) - ts(y.date))
  for (let i = 1; i < pts.length; i += 1) {
    if (pts[i].tread - pts[i - 1].tread > 0.5) {
      warnings.push({
        code: 'tread_increase',
        severity: 'medium',
        message: `Tread rose from ${pts[i - 1].tread} mm to ${pts[i].tread} mm between readings (likely a sensor or data-entry error).`,
      })
      break
    }
  }

  // 3. Missing fitment / removal odometer on a completed stint.
  const missingKm = (journey || []).filter((s) => s.removed && s.km_run == null).length
  if (missingKm > 0) {
    warnings.push({
      code: 'missing_km',
      severity: 'low',
      message: `${missingKm} removed stint(s) have no fitment or removal odometer, so km run cannot be computed.`,
    })
  }

  return warnings
}

/**
 * @param {object[]} records  tyre_records rows for ONE serial
 * @param {{serviceEvents?:object[], warrantyClaims?:object[], statusMarks?:object[], retreadClaims?:object[]}} [aux]
 * @returns {object|null} passport, or null when there are no records
 */
export function buildPassport(records, aux = {}) {
  const rows = (Array.isArray(records) ? records : []).filter(Boolean)
  if (!rows.length) return null

  const serviceEventsRaw = Array.isArray(aux?.serviceEvents) ? aux.serviceEvents : []
  const warrantyRaw = Array.isArray(aux?.warrantyClaims) ? aux.warrantyClaims : []
  const statusMarksRaw = Array.isArray(aux?.statusMarks) ? aux.statusMarks : []
  const retreadRaw = Array.isArray(aux?.retreadClaims) ? aux.retreadClaims : []

  // Chronological (oldest to newest) by the record's effective date.
  const sorted = [...rows].sort((a, b) => ts(eventDate(a)) - ts(eventDate(b)))

  const serial = serialOfRecord(sorted.find((r) => serialOfRecord(r)) || sorted[0])

  const events = sorted.map((r) => {
    const kmFit = num(r.km_at_fitment)
    const kmRem = num(r.km_at_removal)
    const kmStint = kmRem != null && kmFit != null ? Math.max(0, kmRem - kmFit) : null
    return {
      id: r.id,
      date: eventDate(r),
      fitment_date: r.fitment_date || null,
      removal_date: r.removal_date || null,
      asset_no: r.asset_no || r.asset_number || null,
      site: r.site || null,
      position: r.position || r.tyre_position || null,
      km: num(r.total_km) ?? kmStint,
      kmEarned: kmStint ?? num(r.total_km),
      km_at_fitment: kmFit,
      km_at_removal: kmRem,
      hrs: num(r.total_hrs),
      cost: num(r.cost_per_tyre),
      pressure: num(r.pressure_reading),
      reason: r.reason_for_removal || r.removal_reason || null,
      status: r.status || null,
      tread_depth: num(r.tread_depth),
    }
  })

  const sum = (key) => events.reduce((acc, e) => acc + (num(e[key]) || 0), 0)
  const totalKm = sum('km')
  const totalHrs = sum('hrs')
  const totalCost = sum('cost')
  // Lifetime CPK across the tyre (cost / km), the core tyre-economics metric.
  const cpk = totalKm > 0 ? Math.round((totalCost / totalKm) * 1000) / 1000 : null

  // Removed/scrapped reflects the LATEST stint: a mid-life removal that was
  // followed by a re-fitment to another vehicle is a move, not an end of life.
  const lastRow = events[events.length - 1] || {}
  const latestStatus = String(firstNonEmpty([...sorted].reverse(), 'status') || '')
  const removed = Boolean(lastRow.removal_date) || /scrap|remov|write.?off/i.test(latestStatus)

  // Normalised auxiliary sources.
  const serviceEvents = serviceEventsRaw.map(normalizeServiceEvent)
    .sort((a, b) => ts(b.date) - ts(a.date))
  const warranty = warrantyRaw.map(normalizeWarrantyClaim)
  const retreadClaims = retreadRaw.map(normalizeRetreadClaim)
  const statusMarks = statusMarksRaw
    .map((m) => (m && m.mark_type ? String(m.mark_type) : null))
    .filter(Boolean)

  // Service-event counts by type (real signal for rotation / repair / retread).
  const serviceCounts = serviceEvents.reduce((acc, e) => {
    const t = String(e.type || 'other').toLowerCase()
    acc[t] = (acc[t] || 0) + 1
    return acc
  }, {})

  // Tread series merges record readings + service-event readings (deduped by date).
  const treadSeriesRaw = [
    ...events.filter((e) => e.tread_depth != null && e.date).map((e) => ({ date: e.date, tread: e.tread_depth, source: 'record' })),
    ...serviceEvents.filter((e) => e.tread != null && e.date).map((e) => ({ date: e.date, tread: e.tread, source: 'service' })),
  ].sort((a, b) => ts(a.date) - ts(b.date))
  const treadSeries = treadSeriesRaw.filter((p, i, arr) => i === 0 || !(p.date === arr[i - 1].date && p.tread === arr[i - 1].tread))

  // Wear curve (records only, kept for back-compat) + wear intelligence off the
  // combined tread series so service readings improve the wear estimate.
  const wearCurve = events
    .filter((e) => e.tread_depth != null && e.date)
    .map((e) => ({ date: e.date, tread: e.tread_depth }))
  const wear = computeWear(treadSeries.map((p) => ({ date: p.date, tread: p.tread })), totalKm)

  // Repair-history count from record findings + service repair events.
  const recordRepairs = sorted.reduce((acc, r) => {
    const txt = `${r.reason_for_removal || ''} ${r.removal_reason || ''} ${r.findings || ''} ${r.remarks || ''}`
    return acc + (REPAIR_RE.test(txt) ? 1 : 0)
  }, 0)
  const repairCount = recordRepairs + (serviceCounts.repair || 0)

  // Retread count: service retread events, else record text matches, plus claims.
  const recordRetreads = sorted.reduce((acc, r) => {
    const txt = `${r.reason_for_removal || ''} ${r.removal_reason || ''} ${r.findings || ''} ${r.remarks || ''} ${r.status || ''}`
    return acc + (RETREAD_RE.test(txt) ? 1 : 0)
  }, 0)
  const retreadCount = (serviceCounts.retread || 0) > 0 ? serviceCounts.retread : recordRetreads

  // Journey (cross-vehicle stints) + rotations.
  const journey = buildJourney(events)
  const rotationCount = (serviceCounts.rotation || 0) > 0
    ? serviceCounts.rotation
    : Math.max(0, journey.filter((s) => s.asset_no || s.position).length - 1)

  // Health: tread signal is real; pressure/age/alerts have no source in this
  // dataset (neutral, hasData:false). History is derived from real records.
  const health = computeHealth({
    treadRemainingPct: wear.treadRemainingPct,
    pressureDeltaPct: null, // no per-tyre pressure target in tyre_records
    ageYears: null, // no manufacture date in tyre_records
    openAlerts: null, // no alerts linkage in this dataset
    repairCount,
  })

  // Identity / lifecycle.
  const firstFittedDate = firstNonEmpty(sorted, 'fitment_date') || events[0]?.date || null
  const lastEvent = events[events.length - 1] || {}
  const removalEvent = [...events].reverse().find((e) => e.removal_date || e.reason) || {}
  const endDate = removed ? (removalEvent.removal_date || lastEvent.date) : null
  const ageAnchorEnd = endDate ? ts(endDate) : Date.now()
  const ageDays = firstFittedDate ? Math.max(0, Math.round((ageAnchorEnd - ts(firstFittedDate)) / DAY_MS)) : null
  const status = firstNonEmpty([...sorted].reverse(), 'status') || (removed ? 'removed' : 'in_service')

  // Cost breakdown (purchase from records; service/repair/retread from events;
  // recovered from warranty credits + retread recoveries).
  const purchaseCost = Math.round(totalCost * 100) / 100
  const serviceCost = round(serviceEvents.reduce((a, e) => a + (e.cost || 0), 0), 2) || 0
  const repairCost = round(serviceEvents.filter((e) => String(e.type).toLowerCase() === 'repair').reduce((a, e) => a + (e.cost || 0), 0), 2) || 0
  const retreadCost = round(serviceEvents.filter((e) => String(e.type).toLowerCase() === 'retread').reduce((a, e) => a + (e.cost || 0), 0), 2) || 0
  const recovered = round(
    warranty.reduce((a, c) => a + (c.credit_amount || 0), 0)
    + retreadClaims.reduce((a, c) => a + (c.amount_recovered || 0), 0), 2) || 0
  const lifetimeCost = round(purchaseCost + serviceCost, 2)
  const netLifetimeCost = round(lifetimeCost - recovered, 2)
  const lifetimeCpk = totalKm > 0 ? round(lifetimeCost / totalKm, 3) : null
  const netCpk = totalKm > 0 ? round(netLifetimeCost / totalKm, 3) : null

  const costBreakdown = {
    purchase: purchaseCost,
    service: serviceCost,
    repair: repairCost,
    retread: retreadCost,
    recovered,
    lifetime: lifetimeCost,
    netLifetime: netLifetimeCost,
    cpk: lifetimeCpk,
    netCpk,
  }

  // Predictions (honest, null when not computable).
  let projectedReplacementDate = null
  if (!removed && wear.projectedRemainingKm != null && ageDays && ageDays > 0 && totalKm > 0) {
    const kmPerDay = totalKm / ageDays
    if (kmPerDay > 0) {
      const daysLeft = wear.projectedRemainingKm / kmPerDay
      if (Number.isFinite(daysLeft) && daysLeft >= 0) {
        projectedReplacementDate = new Date(Date.now() + daysLeft * DAY_MS).toISOString().slice(0, 10)
      }
    }
  }
  const predictions = {
    projectedRemainingKm: removed ? null : wear.projectedRemainingKm,
    projectedReplacementDate,
    wearRatePer1000Km: wear.wearRatePer1000Km,
  }

  const positions = events.filter((e) => e.position || e.asset_no)
  const stats = {
    recordCount: rows.length,
    assetsServed: new Set(events.map((e) => e.asset_no).filter(Boolean)).size,
    positionsServed: new Set(events.map((e) => e.position).filter(Boolean)).size,
    kmEarned: totalKm,
    repairCount,
    lastPressure: [...events].reverse().find((e) => e.pressure != null)?.pressure ?? null,
  }

  const dataQuality = auditDataQuality(journey, treadSeries)

  return {
    serial,
    brand: firstNonEmpty(sorted, 'brand'),
    size: firstNonEmpty(sorted, 'size'),
    supplier: firstNonEmpty(sorted, 'supplier'),
    status,
    recordCount: rows.length,
    firstDate: events[0]?.date || null,
    lastDate: events[events.length - 1]?.date || null,
    assets: [...new Set(events.map((e) => e.asset_no).filter(Boolean))],
    totals: { km: totalKm, hrs: totalHrs, cost: purchaseCost, cpk },
    health,
    wear,
    wearCurve,
    positions,
    stats,
    events,
    // Additive fields.
    firstFittedDate,
    ageDays,
    scrapped: removed,
    scrapReason: removalEvent.reason || null,
    currentAssetNo: removed ? null : (lastEvent.asset_no || null),
    currentPosition: removed ? null : (lastEvent.position || null),
    retreadCount,
    rotationCount,
    distinctVehicles: new Set(events.map((e) => e.asset_no).filter(Boolean)).size,
    journey,
    costBreakdown,
    treadSeries,
    predictions,
    dataQuality,
    serviceEvents,
    warranty,
    retreadClaims,
    statusMarks,
  }
}
