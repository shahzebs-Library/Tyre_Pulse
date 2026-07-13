/**
 * Tyre Passport — pure builder (no I/O) that assembles a single tyre's complete
 * lifecycle from its `tyre_records` rows (ported + deepened from tyre_saas's
 * TyrePassport + health-score / tread-wear engines). One physical tyre may
 * appear across several records (fitment, rotation to another asset/position,
 * removal, retread). This collapses them into:
 *   • an identity header + lifetime totals (km, hours, cost, CPK),
 *   • a composite Health Score (0–100) with weighted sub-scores,
 *   • Wear Intelligence (tread-remaining %, wear rate, projected scrap),
 *   • per-stint position history with km earned,
 *   • a tread-over-time wear curve and lifecycle statistics.
 *
 * The tyre_saas engines read many collections (per-groove tread readings,
 * pressure targets, alerts, manufacture dates, cost ledgers) that this app's
 * flat `tyre_records` does not carry. Rather than fabricate those, each engine
 * degrades gracefully: a sub-score with no source signal returns a NEUTRAL 70
 * (exactly as the original engine does for missing inputs) and is flagged
 * `hasData:false` so the UI can label it "no data" instead of implying a
 * measurement. Unit-tested; the page consumes it directly.
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

// ── Health sub-scores (buckets ported verbatim from health_score_engine) ─────

/** Tread sub-score from tread-remaining %. null pct → neutral. */
export function treadScore(remainingPct) {
  if (remainingPct == null) return NEUTRAL_SCORE
  if (remainingPct >= 80) return 100
  if (remainingPct >= 60) return 85
  if (remainingPct >= 40) return 65
  if (remainingPct >= 20) return 40
  return 15
}

/** Pressure sub-score from |Δ%| vs target. null → neutral (no target in this data). */
export function pressureScore(deltaPct) {
  if (deltaPct == null) return NEUTRAL_SCORE
  const d = Math.abs(deltaPct)
  if (d <= 5) return 100
  if (d <= 10) return 80
  if (d <= 15) return 55
  if (d <= 25) return 30
  return 10
}

/** Age sub-score from age in years. null → neutral (no manufacture date in this data). */
export function ageScore(years) {
  if (years == null) return NEUTRAL_SCORE
  if (years <= 2) return 100
  if (years <= 4) return 80
  if (years <= 5) return 60
  if (years <= 6) return 35
  return 10
}

/** Open-alert sub-score. null → neutral (no alerts source). */
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

/** Risk band from an overall 0–100 score. */
export function riskLevel(score) {
  if (score == null) return 'unknown'
  if (score < 40) return 'critical'
  if (score < 60) return 'high'
  if (score < 80) return 'medium'
  return 'low'
}

const REPAIR_RE = /repair|puncture|patch|plug|section/i

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

// ── Wear intelligence (from tread_wear_engine) ──────────────────────────────

/**
 * Derive wear metrics from a tyre's tread readings + lifetime km.
 * @param {{date:string|null, tread:number|null}[]} readings  oldest→newest
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

/**
 * @param {object[]} records  tyre_records rows for ONE serial
 * @returns {object|null} passport, or null when there are no records
 */
export function buildPassport(records) {
  const rows = (Array.isArray(records) ? records : []).filter(Boolean)
  if (!rows.length) return null

  // Chronological (oldest → newest) by the record's effective date.
  const sorted = [...rows].sort((a, b) => {
    const da = new Date(eventDate(a) || 0).getTime()
    const db = new Date(eventDate(b) || 0).getTime()
    return da - db
  })

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
  // Lifetime CPK across the tyre (cost / km) — the core tyre-economics metric.
  const cpk = totalKm > 0 ? Math.round((totalCost / totalKm) * 1000) / 1000 : null

  const removed = events.some((e) => e.removal_date) || /scrap|remov/i.test(String(firstNonEmpty(sorted, 'status') || ''))

  // Wear curve + wear intelligence from tread readings.
  const wearCurve = events
    .filter((e) => e.tread_depth != null && e.date)
    .map((e) => ({ date: e.date, tread: e.tread_depth }))
  const wear = computeWear(events.map((e) => ({ date: e.date, tread: e.tread_depth })), totalKm)

  // Repair-history count from removal reasons / findings (a real signal here).
  const repairCount = sorted.reduce((acc, r) => {
    const txt = `${r.reason_for_removal || ''} ${r.removal_reason || ''} ${r.findings || ''} ${r.remarks || ''}`
    return acc + (REPAIR_RE.test(txt) ? 1 : 0)
  }, 0)

  // Health: tread signal is real; pressure/age/alerts have no source in this
  // dataset → neutral (hasData:false). History is derived from real records.
  const health = computeHealth({
    treadRemainingPct: wear.treadRemainingPct,
    pressureDeltaPct: null, // no per-tyre pressure target in tyre_records
    ageYears: null, // no manufacture date in tyre_records
    openAlerts: null, // no alerts linkage in this dataset
    repairCount,
  })

  const positions = events.filter((e) => e.position || e.asset_no)
  const stats = {
    recordCount: rows.length,
    assetsServed: new Set(events.map((e) => e.asset_no).filter(Boolean)).size,
    positionsServed: new Set(events.map((e) => e.position).filter(Boolean)).size,
    kmEarned: totalKm,
    repairCount,
    lastPressure: [...events].reverse().find((e) => e.pressure != null)?.pressure ?? null,
  }

  return {
    serial,
    brand: firstNonEmpty(sorted, 'brand'),
    size: firstNonEmpty(sorted, 'size'),
    supplier: firstNonEmpty(sorted, 'supplier'),
    status: firstNonEmpty([...sorted].reverse(), 'status') || (removed ? 'removed' : 'in_service'),
    recordCount: rows.length,
    firstDate: events[0]?.date || null,
    lastDate: events[events.length - 1]?.date || null,
    assets: [...new Set(events.map((e) => e.asset_no).filter(Boolean))],
    totals: { km: totalKm, hrs: totalHrs, cost: Math.round(totalCost * 100) / 100, cpk },
    health,
    wear,
    wearCurve,
    positions,
    stats,
    events,
  }
}
