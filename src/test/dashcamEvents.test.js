import { describe, it, expect } from 'vitest'
import { toFiniteNumber, summariseDashcam, byEventType, bySeverity } from '../lib/dashcamEvents'

describe('dashcamEvents — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and dirty strings', () => {
    expect(toFiniteNumber(82)).toBe(82)
    expect(toFiniteNumber('82')).toBe(82)
    expect(toFiniteNumber('82 km/h')).toBe(82)
    expect(toFiniteNumber('-5')).toBe(-5)
  })

  it('returns null for empty / non-numeric / nullish input', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('dashcamEvents — summariseDashcam', () => {
  const rows = [
    { asset_no: 'A1', severity: 'critical', reviewed: true },
    { asset_no: 'A1', severity: 'high', reviewed: false },
    { asset_no: 'A2', severity: 'critical', reviewed: true },
    { asset_no: 'A2', severity: 'low', reviewed: false },
    { asset_no: 'A3', severity: 'medium', reviewed: true },
  ]

  it('returns a zeroed summary for empty / non-array input', () => {
    const s = summariseDashcam([])
    expect(s).toEqual({
      totalEvents: 0, criticalCount: 0, highCount: 0, reviewedCount: 0,
      unreviewedCount: 0, distinctAssets: 0, reviewedPct: 0,
    })
    expect(summariseDashcam(null).totalEvents).toBe(0)
    expect(summariseDashcam().totalEvents).toBe(0)
  })

  it('counts totals, severities, and distinct assets', () => {
    const s = summariseDashcam(rows)
    expect(s.totalEvents).toBe(5)
    expect(s.criticalCount).toBe(2)
    expect(s.highCount).toBe(1)
    expect(s.distinctAssets).toBe(3)
  })

  it('computes reviewed / unreviewed counts and rounded reviewed percentage', () => {
    const s = summariseDashcam(rows)
    expect(s.reviewedCount).toBe(3)
    expect(s.unreviewedCount).toBe(2)
    expect(s.reviewedPct).toBe(60)
  })

  it('coerces boolean-ish reviewed values (true/"true"/1)', () => {
    const s = summariseDashcam([
      { asset_no: 'A1', reviewed: 'true' },
      { asset_no: 'A2', reviewed: 1 },
      { asset_no: 'A3', reviewed: 'no' },
    ])
    expect(s.reviewedCount).toBe(2)
    expect(s.unreviewedCount).toBe(1)
  })
})

describe('dashcamEvents — byEventType', () => {
  it('counts events per type sorted by count descending', () => {
    const rows = [
      { event_type: 'harsh_brake' },
      { event_type: 'collision' },
      { event_type: 'harsh_brake' },
      { event_type: 'harsh_brake' },
      { event_type: 'collision' },
      { event_type: 'tailgating' },
    ]
    expect(byEventType(rows)).toEqual([
      { type: 'harsh_brake', count: 3 },
      { type: 'collision', count: 2 },
      { type: 'tailgating', count: 1 },
    ])
  })

  it('ignores rows without an event_type and returns [] for empty input', () => {
    expect(byEventType([{ event_type: '' }, { asset_no: 'A1' }])).toEqual([])
    expect(byEventType([])).toEqual([])
    expect(byEventType(null)).toEqual([])
  })
})

describe('dashcamEvents — bySeverity', () => {
  it('always returns all four buckets with correct counts', () => {
    const rows = [
      { severity: 'low' }, { severity: 'low' }, { severity: 'high' },
      { severity: 'critical' }, { severity: 'medium' },
    ]
    expect(bySeverity(rows)).toEqual({ low: 2, medium: 1, high: 1, critical: 1 })
  })

  it('ignores unknown / missing severities and zeroes empty input', () => {
    expect(bySeverity([{ severity: 'unknown' }, {}, { severity: 'HIGH' }]))
      .toEqual({ low: 0, medium: 0, high: 1, critical: 0 })
    expect(bySeverity([])).toEqual({ low: 0, medium: 0, high: 0, critical: 0 })
    expect(bySeverity(null)).toEqual({ low: 0, medium: 0, high: 0, critical: 0 })
  })
})
