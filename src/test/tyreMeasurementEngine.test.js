import { describe, it, expect } from 'vitest'
import {
  validateReadings, analyzeMeasurements, unevenWearHints, compareToFleet, replaceSoon,
  describeSeries, median, ENGINE_LIMITS, HINT_CODES,
} from '../lib/tyreMeasurementEngine'

const NOW = Date.parse('2026-10-20T00:00:00Z')
let seq = 0
const row = (o = {}) => ({
  id: 'r' + (++seq), inspection_id: 'i1', tyre_position: 'R1Lo', tyre_serial: 'S1',
  original_mm: 16, minimum_mm: 3, inner_mm: null, center_mm: 12, outer_mm: null,
  odometer_km: null, measured_at: '2026-09-01T00:00:00Z', source: 'manual_gauge', ...o,
})
const day = n => new Date(Date.parse('2026-06-01T00:00:00Z') + n * 86400000).toISOString()

describe('validateReadings', () => {
  it('rejects impossible depths, future dates, missing depth and bad limits', () => {
    const rows = [
      row({ center_mm: -1 }), row({ center_mm: 31 }), row({ center_mm: 17.2 }),
      row({ center_mm: null }), row({ measured_at: '2026-12-31T00:00:00Z' }),
      row({ measured_at: 'garbage' }), row({ minimum_mm: 16 }), row({ original_mm: 80 }),
      row({ odometer_km: -5 }), row({ tyre_position: '' }),
    ]
    const v = validateReadings(rows, { now: NOW })
    expect(v.accepted).toHaveLength(0)
    const codes = new Set(v.issues.map(i => i.code))
    for (const c of ['out_of_range', 'no_depth', 'future_date', 'bad_date', 'bad_limits', 'bad_odometer', 'bad_position']) expect(codes.has(c)).toBe(true)
  })
  it('counts an identical reading once and reports the duplicate', () => {
    const a = row({ odometer_km: 1000 })
    const v = validateReadings([a, { ...a, id: 'other' }], { now: NOW })
    expect(v.accepted).toHaveLength(1)
    expect(v.issues.filter(i => i.code === 'duplicate')).toHaveLength(1)
  })
  it('keeps but warns when the same tyre has two depths at the same instant', () => {
    const v = validateReadings([row({ center_mm: 10 }), row({ center_mm: 9 })], { now: NOW })
    expect(v.accepted).toHaveLength(2)
    expect(v.issues.some(i => i.code === 'conflicting_same_time')).toBe(true)
  })
  it('warns (not rejects) when the minimum depth is missing', () => {
    const v = validateReadings([row({ minimum_mm: null })], { now: NOW })
    expect(v.accepted).toHaveLength(1)
    expect(v.issues[0].code).toBe('minimum_missing')
  })
  it('treats blank strings and booleans as not measured, not zero', () => {
    const v = validateReadings([row({ inner_mm: '', center_mm: true, outer_mm: '9.5' })], { now: NOW })
    expect(v.readings[0].innerMm).toBeNull()
    expect(v.readings[0].centreMm).toBeNull()
    expect(v.readings[0].worstMm).toBe(9.5)
  })
})

describe('wear rate and projection', () => {
  const linear = n => Array.from({ length: n }, (_, i) =>
    row({ measured_at: day(i * 30), odometer_km: 10000 + i * 5000, center_mm: 12 - i * 1.0 }))
  it('computes mm per 1000 km and the distance to the limit from repeated readings', () => {
    const { series } = analyzeMeasurements(linear(4), { now: NOW })
    const s = series[0]
    expect(s.status).toBe('ok')
    expect(s.wear.mode).toBe('odometer')
    expect(s.wear.rate).toBeCloseTo(0.2, 3) // 1 mm per 5000 km
    expect(s.remainingMm).toBe(6) // latest 9 - minimum 3
    expect(s.projection.kmToLimit).toBe(30000)
    expect(s.wear.confidence).toBe('high')
    expect(s.projection.kmPerDay).toBeGreaterThan(0)
    expect(s.projection.daysToLimit).toBe(180) // 15,000 km in 90 days
    expect(s.projection.projectedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('puts a wider band around noisy data and keeps point inside the band', () => {
    const noisy = [12, 11.1, 10.4, 9.2, 8.6].map((mm, i) => row({ measured_at: day(i * 30), odometer_km: 10000 + i * 5000, center_mm: mm + (i % 2 ? 0.3 : -0.3) }))
    const p = analyzeMeasurements(noisy, { now: NOW }).series[0].projection
    expect(p.kmLow).toBeLessThanOrEqual(p.kmToLimit)
    expect(p.kmHigh === null || p.kmHigh >= p.kmToLimit).toBe(true)
  })
  it('with two readings gives a point estimate, no band, low confidence', () => {
    const s = analyzeMeasurements(linear(2), { now: NOW }).series[0]
    expect(s.status).toBe('ok')
    expect(s.wear.confidence).toBe('low')
    expect(s.wear.rateLow).toBeNull()
    expect(s.projection.kmLow).toBeNull()
    expect(s.wear.band).toMatch(/Two readings/)
  })
  it('returns null (never a guess) with one reading', () => {
    const s = analyzeMeasurements(linear(1), { now: NOW }).series[0]
    expect(s.status).toBe('insufficient')
    expect(s.wear).toBeNull()
    expect(s.projection).toBeNull()
    expect(s.remainingMm).toBe(9)
    expect(describeSeries(s).kmLeft).toBe('Not measured')
  })
  it('returns null when the span is too short or wear is inside gauge resolution', () => {
    const short = [row({ odometer_km: 10000, center_mm: 12, measured_at: day(0) }), row({ odometer_km: 10400, center_mm: 11.5, measured_at: day(2) })]
    expect(analyzeMeasurements(short, { now: NOW }).series[0].status).toBe('insufficient')
    const flat = [row({ odometer_km: 10000, center_mm: 12, measured_at: day(0) }), row({ odometer_km: 20000, center_mm: 11.9, measured_at: day(60) })]
    const f = analyzeMeasurements(flat, { now: NOW }).series[0]
    expect(f.status).toBe('insufficient')
    expect(f.insufficientReason).toMatch(/gauge resolution/)
  })
  it('falls back to a time based rate when there is no odometer', () => {
    const rows = [0, 30, 60, 90].map((d, i) => row({ measured_at: day(d), center_mm: 12 - i }))
    const s = analyzeMeasurements(rows, { now: NOW }).series[0]
    expect(s.wear.mode).toBe('time')
    expect(s.projection.kmToLimit).toBeNull()
    expect(s.projection.daysToLimit).toBe(180) // 1 mm / 30 days, 6 mm left
    expect(describeSeries(s).kmLeft).toBe('Not measured')
  })
  it('cannot compute remaining life when the minimum depth is unknown', () => {
    const rows = linear(3).map(r => ({ ...r, minimum_mm: null }))
    const s = analyzeMeasurements(rows, { now: NOW }).series[0]
    expect(s.wear.rate).toBeGreaterThan(0)
    expect(s.remainingMm).toBeNull()
    expect(s.projection).toBeNull()
    expect(s.replace.flag).toBeNull()
  })
  it('flags an implausibly fast wear rate and downgrades confidence', () => {
    const rows = [0, 1, 2].map(i => row({ measured_at: day(i * 30), odometer_km: 10000 + i * 1000, center_mm: 14 - i * 5 }))
    const s = analyzeMeasurements(rows, { now: NOW }).series[0]
    expect(s.wear.implausible).toBe(true)
    expect(s.wear.confidence).toBe('low')
  })
})

describe('series handling', () => {
  it('starts a new series when depth rises (replaced or retreaded tyre) and analyses the latest only', () => {
    const rows = [
      row({ measured_at: day(0), odometer_km: 10000, center_mm: 10 }),
      row({ measured_at: day(30), odometer_km: 15000, center_mm: 8 }),
      row({ measured_at: day(60), odometer_km: 20000, center_mm: 15 }), // new tyre
      row({ measured_at: day(90), odometer_km: 25000, center_mm: 14 }),
    ]
    const { series, issues } = analyzeMeasurements(rows, { now: NOW })
    expect(series[0].segments).toBe(2)
    expect(series[0].segmentReadings).toBe(2)
    expect(series[0].wear.rate).toBeCloseTo(0.2, 3)
    expect(issues.some(i => i.code === 'depth_increased')).toBe(true)
  })
  it('ignores an odometer that goes backwards but keeps the reading', () => {
    const rows = [
      row({ measured_at: day(0), odometer_km: 20000, center_mm: 12 }),
      row({ measured_at: day(30), odometer_km: 5000, center_mm: 11 }),
      row({ measured_at: day(60), odometer_km: 30000, center_mm: 10 }),
    ]
    const { series, issues } = analyzeMeasurements(rows, { now: NOW })
    expect(issues.some(i => i.code === 'odometer_regression')).toBe(true)
    expect(series[0].wear.readingsUsed).toBe(2)
  })
  it('keeps different serials at one position apart and excludes unlabeled readings', () => {
    const rows = [
      row({ tyre_serial: 'A', measured_at: day(0), odometer_km: 1000, center_mm: 12 }),
      row({ tyre_serial: 'A', measured_at: day(30), odometer_km: 6000, center_mm: 11 }),
      row({ tyre_serial: 'B', measured_at: day(0), odometer_km: 1000, center_mm: 14 }),
      row({ tyre_serial: null, measured_at: day(10), odometer_km: 2000, center_mm: 13 }),
    ]
    const { series, issues } = analyzeMeasurements(rows, { now: NOW })
    expect(series.map(s => s.serial).sort()).toEqual(['A', 'B'])
    expect(issues.some(i => i.code === 'serial_ambiguous')).toBe(true)
  })
})

describe('uneven wear hints', () => {
  const r = (inner, centre, outer) => ({ innerMm: inner, centreMm: centre, outerMm: outer })
  it('flags alignment when one shoulder is much lower and names the side', () => {
    const h = unevenWearHints(r(6, 9, 9))
    expect(h.map(x => x.code)).toContain(HINT_CODES.ALIGNMENT)
    expect(h.find(x => x.code === HINT_CODES.ALIGNMENT).detail).toMatch(/Inner/)
    expect(h.every(x => x.indicative)).toBe(true)
  })
  it('flags under-inflation when both shoulders are lower than the centre', () => {
    expect(unevenWearHints(r(7, 10, 7.5)).map(x => x.code)).toEqual([HINT_CODES.UNDERINFLATION])
  })
  it('flags over-inflation when the centre is lower than the shoulders', () => {
    expect(unevenWearHints(r(10, 7.5, 10)).map(x => x.code)).toEqual([HINT_CODES.OVERINFLATION])
  })
  it('gives no hint for even wear or when bands are missing', () => {
    expect(unevenWearHints(r(9, 9.5, 9))).toEqual([])
    expect(unevenWearHints(r(null, 9, null))).toEqual([])
    expect(unevenWearHints(null)).toEqual([])
  })
  it('marks a hint persistent when the previous reading showed it too', () => {
    const rows = [0, 30].map((d, i) => row({ measured_at: day(d), odometer_km: 1000 + i * 5000, inner_mm: 8 - i, center_mm: 11 - i, outer_mm: 11 - i }))
    const h = analyzeMeasurements(rows, { now: NOW }).series[0].hints
    expect(h[0].code).toBe(HINT_CODES.ALIGNMENT)
    expect(h[0].persistent).toBe(true)
  })
})

describe('replace soon', () => {
  it('flags at or below the minimum', () => {
    expect(replaceSoon({ remainingMm: 0 }).flag).toBe(true)
    expect(replaceSoon({ remainingMm: -0.5 }).reasons[0]).toMatch(/minimum/)
  })
  it('flags a small margin, a short conservative distance or few days', () => {
    expect(replaceSoon({ remainingMm: 1 }).flag).toBe(true)
    expect(replaceSoon({ remainingMm: 4, projection: { kmLow: 8000, kmToLimit: 12000 } }).flag).toBe(true)
    expect(replaceSoon({ remainingMm: 4, projection: { daysToLimit: 20 } }).flag).toBe(true)
  })
  it('does not flag a healthy tyre and returns null when nothing is measurable', () => {
    expect(replaceSoon({ remainingMm: 8, projection: { kmLow: 60000, kmToLimit: 70000, daysLow: 300 } }).flag).toBe(false)
    expect(replaceSoon({ remainingMm: null }).flag).toBeNull()
    expect(replaceSoon(null).flag).toBeNull()
  })
  it('uses the conservative end of the band, not only the point estimate', () => {
    expect(replaceSoon({ remainingMm: 5, projection: { kmLow: 9000, kmToLimit: 40000 } }).flag).toBe(true)
  })
})

describe('fleet comparison', () => {
  it('needs enough peers and is relative to their median', () => {
    expect(compareToFleet(0.3, [0.2, 0.2])).toBeNull()
    const c = compareToFleet(0.4, [0.2, 0.2, 0.25, 0.3])
    expect(c.medianRate).toBe(0.225)
    expect(c.ratio).toBe(1.78)
    expect(c.fastWear).toBe(true)
    expect(c.percentile).toBe(100)
    expect(compareToFleet(0.2, [0.2, 0.2, 0.25, 0.3]).fastWear).toBe(false)
    expect(median([])).toBeNull()
    expect(median([3, 1, 2])).toBe(2)
  })
  it('compares each tyre with the OTHER vehicles of the data set, never itself', () => {
    const mk = (inspection, rate) => [0, 30, 60].map((d, i) => row({
      inspection_id: inspection, measured_at: day(d), odometer_km: 10000 + i * 5000, center_mm: 12 - i * 5 * rate,
    }))
    const rows = [...mk('a', 0.2), ...mk('b', 0.2), ...mk('c', 0.25), ...mk('d', 0.8)]
    const assetOf = id => 'asset-' + id
    const { series } = analyzeMeasurements(rows, { now: NOW, assetOf })
    const d = series.find(s => s.assetKey === 'asset-d')
    expect(d.fleet.peers).toBe(3)
    expect(d.fleet.fastWear).toBe(true)
    const a = series.find(s => s.assetKey === 'asset-a')
    expect(a.fleet.fastWear).toBe(false)
    const alone = analyzeMeasurements(mk('a', 0.2), { now: NOW, assetOf }).series[0]
    expect(alone.fleet).toBeNull()
    expect(describeSeries(alone).fleet).toBe('Not measured')
  })
})

describe('describeSeries', () => {
  it('formats measured values and shows the band', () => {
    const rows = [0, 1, 2, 3].map(i => row({ measured_at: day(i * 30), odometer_km: 10000 + i * 5000, center_mm: 12 - i }))
    const d = describeSeries(analyzeMeasurements(rows, { now: NOW }).series[0])
    expect(d.depth).toBe('9 mm')
    expect(d.rate).toBe('0.2 mm/1000 km')
    expect(d.kmLeft).toContain('30,000 km')
    expect(d.note).toBe('')
  })
  it('is "Not measured" everywhere without a series', () => {
    const d = describeSeries(null)
    expect([d.depth, d.remaining, d.rate, d.kmLeft, d.daysLeft, d.fleet]).toEqual(Array(6).fill('Not measured'))
  })
  it('exports the tunable limits as frozen constants', () => {
    expect(Object.isFrozen(ENGINE_LIMITS)).toBe(true)
  })
})
