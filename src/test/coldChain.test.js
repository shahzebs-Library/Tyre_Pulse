import { describe, it, expect } from 'vitest'
import { classifyTemp, summarizeColdChain, WARNING_MARGIN_C } from '../lib/coldChain'

describe('coldChain - classifyTemp', () => {
  // Safe range: keep frozen cargo between -20 and -15 °C.
  it('classifies a comfortably in-range reading as ok', () => {
    expect(classifyTemp(-18, -20, -15)).toBe('ok')
  })

  it('flags a reading above the max bound as breach', () => {
    expect(classifyTemp(-10, -20, -15)).toBe('breach')
  })

  it('flags a reading below the min bound as breach', () => {
    expect(classifyTemp(-25, -20, -15)).toBe('breach')
  })

  it('flags a reading within the warning margin of the max bound', () => {
    // -15.5 is inside [-20,-15] but within 1°C of the -15 max.
    expect(classifyTemp(-15.5, -20, -15)).toBe('warning')
  })

  it('flags a reading within the warning margin of the min bound', () => {
    expect(classifyTemp(-19.5, -20, -15)).toBe('warning')
  })

  it('treats a reading sitting exactly on a bound as warning (on-bound, not outside)', () => {
    // Exactly on a bound: not strictly outside, but zero distance <= margin → warning.
    expect(classifyTemp(-15, -20, -15)).toBe('warning')
    expect(classifyTemp(-20, -20, -15)).toBe('warning')
  })

  it('honours the configured warning margin', () => {
    // A point beyond the margin from both bounds is ok.
    expect(classifyTemp(-18, -20, -15)).toBe('ok')
    expect(WARNING_MARGIN_C).toBe(1)
  })

  it('honours a single open-ended bound (max only)', () => {
    expect(classifyTemp(8, null, 5)).toBe('breach')
    expect(classifyTemp(4.5, null, 5)).toBe('warning')
    expect(classifyTemp(0, null, 5)).toBe('ok')
  })

  it('honours a single open-ended bound (min only)', () => {
    expect(classifyTemp(1, 2, null)).toBe('breach')
    expect(classifyTemp(2.5, 2, null)).toBe('warning')
    expect(classifyTemp(10, 2, null)).toBe('ok')
  })

  it('is ok when no usable bounds are provided (cannot breach)', () => {
    expect(classifyTemp(500, null, null)).toBe('ok')
    expect(classifyTemp(2, undefined, undefined)).toBe('ok')
  })

  it('parses numeric-looking strings and returns ok for a non-numeric temp', () => {
    expect(classifyTemp('-10', '-20', '-15')).toBe('breach')
    expect(classifyTemp('n/a', -20, -15)).toBe('ok')
  })

  it('is deterministic across repeated calls', () => {
    const a = classifyTemp(-15.5, -20, -15)
    const b = classifyTemp(-15.5, -20, -15)
    expect(a).toBe(b)
  })
})

describe('coldChain - summarizeColdChain', () => {
  it('returns zeroed totals for an empty / invalid input', () => {
    const s = summarizeColdChain([])
    expect(s).toEqual({
      total: 0, ok: 0, warning: 0, breach: 0,
      breaches: 0, warnings: 0, assetsMonitored: 0,
    })
    expect(summarizeColdChain(null).total).toBe(0)
    expect(summarizeColdChain(undefined).total).toBe(0)
  })

  it('counts by stored status and distinct assets', () => {
    const rows = [
      { asset_no: 'RF-01', status: 'ok', temperature_c: -18, min_threshold_c: -20, max_threshold_c: -15 },
      { asset_no: 'RF-01', status: 'breach', temperature_c: -5, min_threshold_c: -20, max_threshold_c: -15 },
      { asset_no: 'RF-02', status: 'warning', temperature_c: -15.5, min_threshold_c: -20, max_threshold_c: -15 },
      { asset_no: 'RF-03', status: 'ok', temperature_c: -18, min_threshold_c: -20, max_threshold_c: -15 },
    ]
    const s = summarizeColdChain(rows)
    expect(s.total).toBe(4)
    expect(s.ok).toBe(2)
    expect(s.warning).toBe(1)
    expect(s.breach).toBe(1)
    expect(s.breaches).toBe(1)
    expect(s.warnings).toBe(1)
    expect(s.assetsMonitored).toBe(3)
  })

  it('re-classifies rows missing a stored status', () => {
    const rows = [
      { asset_no: 'A', temperature_c: -5, min_threshold_c: -20, max_threshold_c: -15 }, // breach
      { asset_no: 'B', temperature_c: -15.5, min_threshold_c: -20, max_threshold_c: -15 }, // warning
      { asset_no: 'C', temperature_c: -18, min_threshold_c: -20, max_threshold_c: -15 }, // ok
    ]
    const s = summarizeColdChain(rows)
    expect(s.breach).toBe(1)
    expect(s.warning).toBe(1)
    expect(s.ok).toBe(1)
    expect(s.assetsMonitored).toBe(3)
  })

  it('ignores blank asset numbers when counting monitored assets', () => {
    const rows = [
      { asset_no: '', status: 'ok' },
      { asset_no: '   ', status: 'ok' },
      { asset_no: 'RF-09', status: 'ok' },
    ]
    expect(summarizeColdChain(rows).assetsMonitored).toBe(1)
  })
})
