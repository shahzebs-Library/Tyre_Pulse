/**
 * Advanced tyre measurement engine (pure: no network, no clock unless `now` is passed).
 *
 * Input is the rows of `ai_tyre_depth_measurements` (physical gauge readings only).
 * It never reads a photograph and never invents a figure: every derived value is
 * `null` (rendered "Not measured") when the readings cannot support it.
 *
 *  1. validateReadings  - drops impossible / duplicate readings, flags suspicious ones.
 *  2. analyzeMeasurements - per tyre (asset + position + serial) series:
 *       wear rate (mm / 1000 km, or mm / day when no odometer), remaining km / days with a
 *       90% confidence band, uneven-wear / alignment / pressure hints, replace-soon flag,
 *       comparison with the median of the other tyres in the data set.
 *
 * Estimates are trend aids, not serviceability decisions. A tyre is never certified.
 */

export const ENGINE_LIMITS = Object.freeze({
  MAX_DEPTH_MM: 30,             // no commercial tyre is this deep; above is a typo
  MIN_ORIGINAL_MM: 3,
  MAX_ORIGINAL_MM: 40,
  GAUGE_TOLERANCE_MM: 0.5,      // an increase up to this is gauge noise, above it is a new tyre
  MIN_SPAN_KM: 1000,            // same floor as forecastTread in aiTyreInspection.js
  MIN_SPAN_DAYS: 14,
  MIN_WEAR_MM: 0.3,             // wear inside gauge resolution proves nothing
  MAX_PLAUSIBLE_RATE: 4,        // mm per 1000 km; faster is almost always a data error
  UNEVEN_SHOULDER_MM: 2,        // inner vs outer difference -> alignment
  UNEVEN_CENTRE_MM: 1.5,        // centre vs shoulder average -> inflation
  REPLACE_MARGIN_MM: 1.5,       // usable tread left at which replacement is planned
  REPLACE_KM: 10000,
  REPLACE_DAYS: 30,
  MIN_FLEET_SERIES: 3,
  FAST_WEAR_RATIO: 1.5,
  FUTURE_TOLERANCE_MS: 24 * 3600 * 1000,
})

export const HINT_CODES = Object.freeze({
  UNDERINFLATION: 'underinflation_suspected',
  OVERINFLATION: 'overinflation_suspected',
  ALIGNMENT: 'alignment_suspected',
})

const DAY_MS = 24 * 3600 * 1000
const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d)
const num = v => (v === null || v === undefined || v === '' || typeof v === 'boolean' ? null : (Number.isFinite(Number(v)) ? Number(v) : null))
const text = v => (typeof v === 'string' ? v.trim() : '')

/** Two-sided 90% Student t critical values by degrees of freedom (1..10), 1.645 asymptote. */
const T90 = [0, 6.314, 2.92, 2.353, 2.132, 2.015, 1.943, 1.895, 1.86, 1.833, 1.812]
const tCritical = df => (df >= 1 && df <= 10 ? T90[df] : df > 10 ? 1.7 : NaN)

/** One DB row (snake_case) or camelCase object -> normalized reading. */
export function normalizeReading(row) {
  const r = row || {}
  const inner = num(r.inner_mm ?? r.innerMm)
  const centre = num(r.center_mm ?? r.centerMm ?? r.centre_mm ?? r.centreMm)
  const outer = num(r.outer_mm ?? r.outerMm)
  const depths = [inner, centre, outer].filter(v => v !== null)
  const measuredAt = r.measured_at ?? r.measuredAt ?? null
  const ms = measuredAt ? Date.parse(measuredAt) : NaN
  return {
    id: r.id ?? null,
    inspectionId: r.inspection_id ?? r.inspectionId ?? null,
    position: text(r.tyre_position ?? r.position),
    serial: text(r.tyre_serial ?? r.tyreSerial) || null,
    originalMm: num(r.original_mm ?? r.originalMm),
    minimumMm: num(r.minimum_mm ?? r.minimumMm),
    innerMm: inner, centreMm: centre, outerMm: outer,
    worstMm: depths.length ? Math.min(...depths) : null,
    averageMm: depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : null,
    spreadMm: depths.length > 1 ? Math.max(...depths) - Math.min(...depths) : null,
    odometerKm: num(r.odometer_km ?? r.odometerKm),
    source: text(r.source),
    measuredAt, ms,
  }
}

const issue = (reading, code, severity, message) => ({
  code, severity, message, readingId: reading.id, position: reading.position,
  serial: reading.serial, measuredAt: reading.measuredAt,
})

/** Hard checks on one reading. Returns issues; any severity 'error' excludes the reading. */
function checkReading(r, now) {
  const out = []
  if (!r.position) out.push(issue(r, 'bad_position', 'error', 'Tyre position is missing.'))
  if (!Number.isFinite(r.ms)) out.push(issue(r, 'bad_date', 'error', 'Measurement date is missing or unreadable.'))
  else if (r.ms > now + ENGINE_LIMITS.FUTURE_TOLERANCE_MS) out.push(issue(r, 'future_date', 'error', 'Measurement date is in the future.'))
  if (r.worstMm === null) out.push(issue(r, 'no_depth', 'error', 'No tread depth was recorded.'))
  for (const [band, v] of [['inner', r.innerMm], ['centre', r.centreMm], ['outer', r.outerMm]]) {
    if (v === null) continue
    if (v < 0 || v > ENGINE_LIMITS.MAX_DEPTH_MM) {
      out.push(issue(r, 'out_of_range', 'error', `The ${band} depth ${v} mm is outside the physically possible range.`))
    } else if (r.originalMm !== null && v > r.originalMm + ENGINE_LIMITS.GAUGE_TOLERANCE_MM) {
      out.push(issue(r, 'out_of_range', 'error', `The ${band} depth ${v} mm exceeds the original tread depth ${r.originalMm} mm.`))
    }
  }
  if (r.originalMm !== null && (r.originalMm < ENGINE_LIMITS.MIN_ORIGINAL_MM || r.originalMm > ENGINE_LIMITS.MAX_ORIGINAL_MM)) {
    out.push(issue(r, 'bad_limits', 'error', `Original tread depth ${r.originalMm} mm is implausible.`))
  }
  if (r.minimumMm !== null && (r.minimumMm < 0 || (r.originalMm !== null && r.minimumMm >= r.originalMm))) {
    out.push(issue(r, 'bad_limits', 'error', 'Minimum permitted depth must be lower than the original depth.'))
  }
  if (r.odometerKm !== null && r.odometerKm < 0) out.push(issue(r, 'bad_odometer', 'error', 'Odometer reading is negative.'))
  if (r.minimumMm === null) out.push(issue(r, 'minimum_missing', 'warning', 'Minimum permitted depth is missing; remaining usable tread cannot be calculated.'))
  return out
}

/**
 * Validate a set of readings.
 * @returns {{readings: object[], accepted: object[], issues: object[]}}
 *   `accepted` are the readings that may feed a calculation (no error issue, not a duplicate).
 */
export function validateReadings(rows, { now = Date.now(), assetOf = () => '' } = {}) {
  const readings = (rows || []).map(normalizeReading)
  const issues = []
  const rejected = new Set()
  const seen = new Map()
  readings.forEach((r, index) => {
    const found = checkReading(r, now)
    issues.push(...found)
    if (found.some(i => i.severity === 'error')) { rejected.add(index); return }
    const key = [assetOf(r.inspectionId), r.position, r.serial || '', r.ms, r.worstMm, r.odometerKm ?? ''].join('|')
    if (seen.has(key)) {
      rejected.add(index)
      issues.push(issue(r, 'duplicate', 'error', 'Identical reading already recorded; counted once.'))
      return
    }
    seen.set(key, index)
  })
  // Same tyre, same instant, different depths: ambiguous, kept but reported.
  const instants = new Map()
  readings.forEach((r, index) => {
    if (rejected.has(index)) return
    const key = [assetOf(r.inspectionId), r.position, r.serial || '', r.ms].join('|')
    if (instants.has(key) && instants.get(key) !== r.worstMm) {
      issues.push(issue(r, 'conflicting_same_time', 'warning', 'Two different depths recorded for the same tyre at the same time.'))
    }
    instants.set(key, r.worstMm)
  })
  return { readings, accepted: readings.filter((_, i) => !rejected.has(i)), issues }
}

/** Ordinary least squares on [x, y] points. */
function ols(points) {
  const n = points.length
  const mx = points.reduce((s, p) => s + p[0], 0) / n
  const my = points.reduce((s, p) => s + p[1], 0) / n
  const sxx = points.reduce((s, p) => s + (p[0] - mx) ** 2, 0)
  if (sxx <= 0) return null
  const sxy = points.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0)
  const slope = sxy / sxx
  const intercept = my - slope * mx
  const sse = points.reduce((s, p) => s + (p[1] - (intercept + slope * p[0])) ** 2, 0)
  const syy = points.reduce((s, p) => s + (p[1] - my) ** 2, 0)
  const se = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : null
  return { n, slope, intercept, se, r2: syy > 0 ? Math.max(0, 1 - sse / syy) : 1 }
}

/** Inner / centre / outer pattern of one reading. Indicative only. */
export function unevenWearHints(reading) {
  const out = []
  if (!reading) return out
  const { innerMm: i, centreMm: c, outerMm: o } = reading
  if (i !== null && o !== null && Math.abs(i - o) >= ENGINE_LIMITS.UNEVEN_SHOULDER_MM) {
    out.push({
      code: HINT_CODES.ALIGNMENT,
      label: 'One shoulder wears faster',
      detail: `${i < o ? 'Inner' : 'Outer'} shoulder is ${round(Math.abs(i - o), 1)} mm lower. Often camber, toe or suspension alignment; check the axle.`,
      evidence: { inner: i, centre: c, outer: o },
    })
  }
  if (i !== null && o !== null && c !== null) {
    const shoulders = (i + o) / 2
    const gap = c - shoulders
    if (gap >= ENGINE_LIMITS.UNEVEN_CENTRE_MM) {
      out.push({
        code: HINT_CODES.UNDERINFLATION,
        label: 'Both shoulders worn more than the centre',
        detail: `Shoulders average ${round(gap, 1)} mm below the centre. Often under-inflation; review pressure records for this position.`,
        evidence: { inner: i, centre: c, outer: o },
      })
    } else if (gap <= -ENGINE_LIMITS.UNEVEN_CENTRE_MM) {
      out.push({
        code: HINT_CODES.OVERINFLATION,
        label: 'Centre worn more than the shoulders',
        detail: `Centre is ${round(-gap, 1)} mm below the shoulder average. Often over-inflation; review pressure records for this position.`,
        evidence: { inner: i, centre: c, outer: o },
      })
    }
  }
  return out.map(h => ({ ...h, indicative: true }))
}

/** Median of numbers, null when empty. */
export function median(values) {
  const v = (values || []).filter(x => Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/** Split one chronologically sorted series into segments; a depth jump up starts a new tyre/retread. */
function segmentSeries(sorted, issues) {
  const segments = []
  let current = []
  let maxKm = -Infinity
  for (const original of sorted) {
    const r = { ...original }
    const prev = current[current.length - 1]
    if (prev && r.worstMm > prev.worstMm + ENGINE_LIMITS.GAUGE_TOLERANCE_MM) {
      issues.push(issue(r, 'depth_increased', 'warning', `Depth rose ${round(r.worstMm - prev.worstMm, 1)} mm since the previous reading; treated as a replaced or retreaded tyre and a new series was started.`))
      segments.push(current); current = []; maxKm = -Infinity
    }
    if (r.odometerKm !== null) {
      if (r.odometerKm < maxKm) {
        issues.push(issue(r, 'odometer_regression', 'warning', 'Odometer is lower than an earlier reading; the odometer value was ignored for this reading.'))
        r.odometerKm = null
      } else maxKm = r.odometerKm
    }
    current.push(r)
  }
  if (current.length) segments.push(current)
  return segments
}

const insufficient = reason => ({ status: 'insufficient', reason, wear: null, projection: null })

/** Wear + projection of one segment. */
function analyzeSegment(segment) {
  const latest = segment[segment.length - 1]
  const first = segment[0]
  const remainingMm = latest.minimumMm !== null ? round(latest.worstMm - latest.minimumMm, 2) : null
  if (segment.length < 2) return { ...insufficient('Only one reading. At least two readings at different dates are needed.'), remainingMm }
  const km = segment.filter(r => r.odometerKm !== null)
  const spanDays = (latest.ms - first.ms) / DAY_MS
  const used = first.worstMm - latest.worstMm
  if (used < ENGINE_LIMITS.MIN_WEAR_MM) {
    return { ...insufficient(`Measured wear (${round(Math.max(used, 0), 2)} mm) is within gauge resolution; no trend can be calculated yet.`), remainingMm }
  }
  const spanKm = km.length >= 2 ? km[km.length - 1].odometerKm - km[0].odometerKm : 0
  const mode = km.length >= 2 && spanKm >= ENGINE_LIMITS.MIN_SPAN_KM ? 'odometer' : (spanDays >= ENGINE_LIMITS.MIN_SPAN_DAYS ? 'time' : null)
  if (!mode) {
    return { ...insufficient(km.length >= 2
      ? `Readings span only ${Math.round(spanKm)} km and ${Math.round(spanDays)} days; at least ${ENGINE_LIMITS.MIN_SPAN_KM} km or ${ENGINE_LIMITS.MIN_SPAN_DAYS} days are needed.`
      : `Readings span only ${Math.round(spanDays)} days and no odometer is recorded.`), remainingMm }
  }
  const points = mode === 'odometer'
    ? km.map(r => [r.odometerKm / 1000, r.worstMm])
    : segment.map(r => [(r.ms - first.ms) / DAY_MS, r.worstMm])
  const fit = ols(points)
  if (!fit || fit.slope >= 0) return { ...insufficient('Readings show no consistent wear.'), remainingMm }
  const rate = -fit.slope // mm per 1000 km, or mm per day
  const t = fit.se !== null ? tCritical(fit.n - 2) : NaN
  const half = fit.se !== null && Number.isFinite(t) ? t * fit.se : null
  const rateLow = half === null ? null : Math.max(rate - half, 0)
  const rateHigh = half === null ? null : rate + half
  const confidence = fit.n >= 4 && fit.r2 >= 0.9 ? 'high' : fit.n >= 3 && fit.r2 >= 0.7 ? 'medium' : 'low'
  const implausible = mode === 'odometer' && rate > ENGINE_LIMITS.MAX_PLAUSIBLE_RATE
  const wear = {
    mode,
    unit: mode === 'odometer' ? 'mm/1000 km' : 'mm/day',
    rate: round(rate, 4), rateLow: round(rateLow, 4), rateHigh: round(rateHigh, 4),
    readingsUsed: fit.n, r2: round(fit.r2, 3),
    spanKm: mode === 'odometer' ? Math.round(spanKm) : null,
    spanDays: round(spanDays, 1),
    confidence: implausible ? 'low' : confidence,
    implausible,
    band: half === null ? 'Two readings only: a single interval, no statistical band.' : '90% confidence band on the wear rate.',
  }
  let projection = null
  if (remainingMm !== null) {
    const toLimit = x => (remainingMm <= 0 ? 0 : x)
    const kmPerDay = km.length >= 2 && spanDays > 0 ? spanKm / spanDays : null
    const distance = r => (r && r > 0 ? toLimit(remainingMm / r * 1000) : null)
    const daily = r => (r && r > 0 ? toLimit(remainingMm / r) : null)
    if (mode === 'odometer') {
      const kmPoint = distance(rate), kmLow = distance(rateHigh), kmHigh = distance(rateLow)
      const perDay = kmPerDay && kmPerDay > 0 ? kmPerDay : null
      projection = {
        remainingMm,
        kmToLimit: kmPoint === null ? null : Math.floor(kmPoint),
        kmLow: kmLow === null ? null : Math.floor(kmLow),
        kmHigh: kmHigh === null ? null : Math.floor(kmHigh),
        daysToLimit: perDay && kmPoint !== null ? Math.floor(kmPoint / perDay) : null,
        daysLow: perDay && kmLow !== null ? Math.floor(kmLow / perDay) : null,
        daysHigh: perDay && kmHigh !== null ? Math.floor(kmHigh / perDay) : null,
        kmPerDay: perDay ? Math.round(perDay) : null,
      }
    } else {
      const point = daily(rate), low = daily(rateHigh), high = daily(rateLow)
      projection = {
        remainingMm, kmToLimit: null, kmLow: null, kmHigh: null, kmPerDay: null,
        daysToLimit: point === null ? null : Math.floor(point),
        daysLow: low === null ? null : Math.floor(low),
        daysHigh: high === null ? null : Math.floor(high),
      }
    }
    projection.projectedDate = projection.daysToLimit == null ? null
      : new Date(latest.ms + projection.daysToLimit * DAY_MS).toISOString().slice(0, 10)
    projection.disclaimer = 'Trend estimate only. Not a serviceability or safety decision.'
  }
  return { status: 'ok', reason: '', wear, projection, remainingMm }
}

/** Should this tyre be planned for replacement? flag is null when nothing is measured. */
export function replaceSoon(series) {
  const reasons = []
  const remaining = series?.remainingMm
  if (remaining == null) return { flag: null, reasons: ['Remaining usable tread cannot be calculated (minimum depth not recorded).'] }
  if (remaining <= 0) reasons.push('At or below the minimum permitted depth.')
  else if (remaining <= ENGINE_LIMITS.REPLACE_MARGIN_MM) reasons.push(`Only ${remaining} mm usable tread left.`)
  const p = series.projection
  if (p) {
    const km = p.kmLow ?? p.kmToLimit
    if (km != null && remaining > 0 && km <= ENGINE_LIMITS.REPLACE_KM) reasons.push(`Estimated ${km.toLocaleString('en-US')} km to the limit (conservative end of the band).`)
    const days = p.daysLow ?? p.daysToLimit
    if (days != null && remaining > 0 && days <= ENGINE_LIMITS.REPLACE_DAYS) reasons.push(`Estimated ${days} days to the limit.`)
  }
  return { flag: reasons.length > 0, reasons }
}

/** Compare one wear rate with the other tyres. Null when fewer than MIN_FLEET_SERIES peers. */
export function compareToFleet(rate, peerRates) {
  const peers = (peerRates || []).filter(x => Number.isFinite(x) && x > 0)
  if (!Number.isFinite(rate) || peers.length < ENGINE_LIMITS.MIN_FLEET_SERIES) return null
  const med = median(peers)
  const lower = peers.filter(x => x < rate).length
  return {
    peers: peers.length,
    medianRate: round(med, 4),
    ratio: round(rate / med, 2),
    percentile: Math.round(lower / peers.length * 100),
    fastWear: rate / med >= ENGINE_LIMITS.FAST_WEAR_RATIO,
  }
}

/**
 * Analyse every tyre series in a set of readings.
 * @param {object[]} rows ai_tyre_depth_measurements rows
 * @param {{now?:number, assetOf?:(inspectionId:string)=>string}} opts
 *   `assetOf` maps an inspection to its vehicle so peers of the same vehicle type
 *   can be told apart; without it every reading is treated as one vehicle.
 * @returns {{series: object[], issues: object[], accepted: number, rejected: number}}
 */
export function analyzeMeasurements(rows, { now = Date.now(), assetOf = () => '' } = {}) {
  const { accepted, issues, readings } = validateReadings(rows, { now, assetOf })
  const byPosition = new Map()
  for (const r of accepted) {
    const key = assetOf(r.inspectionId) + '\u0000' + r.position
    if (!byPosition.has(key)) byPosition.set(key, { assetKey: assetOf(r.inspectionId) || '', position: r.position, list: [] })
    byPosition.get(key).list.push(r)
  }
  const groups = []
  for (const g of byPosition.values()) {
    const serials = [...new Set(g.list.map(r => r.serial).filter(Boolean))]
    if (serials.length <= 1) { groups.push({ ...g, serial: serials[0] || null }); continue }
    // Several serials on one position: attribute only readings that name their tyre.
    for (const s of serials) groups.push({ ...g, serial: s, list: g.list.filter(r => r.serial === s) })
    g.list.filter(r => !r.serial).forEach(r => issues.push(issue(r, 'serial_ambiguous', 'warning', 'Several tyre serials were measured at this position; a reading without a serial was left out of the trend.')))
  }
  const series = groups.map(g => {
    const sorted = g.list.slice().sort((a, b) => a.ms - b.ms || (a.odometerKm ?? 0) - (b.odometerKm ?? 0))
    const segments = segmentSeries(sorted, issues)
    const segment = segments[segments.length - 1] || []
    const analysis = analyzeSegment(segment)
    const latest = segment[segment.length - 1] || null
    const previous = segment[segment.length - 2] || null
    const prevCodes = new Set(unevenWearHints(previous).map(h => h.code))
    const hints = unevenWearHints(latest).map(h => ({ ...h, persistent: prevCodes.has(h.code) }))
    const out = {
      key: [g.assetKey, g.position, g.serial || ''].join('|'),
      assetKey: g.assetKey, position: g.position, serial: g.serial,
      totalReadings: sorted.length, segmentReadings: segment.length, segments: segments.length,
      latest: latest && {
        measuredAt: latest.measuredAt, worstMm: round(latest.worstMm, 2), averageMm: round(latest.averageMm, 2),
        spreadMm: round(latest.spreadMm, 2), innerMm: latest.innerMm, centreMm: latest.centreMm, outerMm: latest.outerMm,
        odometerKm: latest.odometerKm, minimumMm: latest.minimumMm, originalMm: latest.originalMm,
      },
      status: analysis.status, insufficientReason: analysis.reason,
      remainingMm: analysis.remainingMm, wear: analysis.wear, projection: analysis.projection,
      hints,
    }
    out.replace = replaceSoon(out)
    return out
  })
  // Leave-one-out fleet comparison on the odometer-based rates only (same unit).
  const rateOf = s => (s.wear && s.wear.mode === 'odometer' ? s.wear.rate : null)
  series.forEach((s, i) => {
    const own = rateOf(s)
    s.fleet = own == null ? null : compareToFleet(own, series.filter((_, j) => j !== i).map(rateOf))
  })
  return { series, issues, accepted: accepted.length, rejected: readings.length - accepted.length }
}

/** Per-position summary for display: values are strings, "Not measured" when unknown. */
export function describeSeries(s) {
  const nm = 'Not measured'
  const km = n => `${Math.round(n).toLocaleString('en-US')} km`
  if (!s || !s.latest) return { depth: nm, remaining: nm, rate: nm, kmLeft: nm, daysLeft: nm, fleet: nm, note: 'No valid physical reading.' }
  const p = s.projection
  const range = (a, b, fmt) => (a != null && b != null ? ` (${fmt(a)} to ${fmt(b)})` : a != null ? ` (at least ${fmt(a)})` : '')
  return {
    depth: `${s.latest.worstMm} mm`,
    remaining: s.remainingMm == null ? nm : `${s.remainingMm} mm`,
    rate: s.wear ? `${s.wear.rate} ${s.wear.unit}` : nm,
    kmLeft: p && p.kmToLimit != null ? km(p.kmToLimit) + range(p.kmLow, p.kmHigh, km) : nm,
    daysLeft: p && p.daysToLimit != null ? `${p.daysToLimit} days` + range(p.daysLow, p.daysHigh, d => `${d} days`) : nm,
    fleet: s.fleet ? `${s.fleet.ratio}x fleet median (${s.fleet.peers} peers)` : nm,
    note: s.status === 'ok' ? '' : s.insufficientReason,
  }
}
