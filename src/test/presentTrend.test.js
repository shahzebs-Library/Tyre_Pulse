import { describe, it, expect } from 'vitest'
import {
  canTrend, trendLine, trendChange, trendSummary, trendDataset,
  MIN_TREND_POINTS, WEAK_FIT_R2,
} from '../lib/presentTrend'

describe('canTrend - the guard that keeps the line honest', () => {
  // The studio's category sources are sorted by value. A line through them
  // would trace the SORT and read as a finding, which is the whole reason
  // this gate exists.
  it('refuses a sorted category source', () => {
    expect(canTrend({ kind: 'flat', key: 'by_asset' })).toBe(false)
    expect(canTrend({ kind: 'flat', key: 'tyre_qty_brand' })).toBe(false)
  })

  it('allows an ordered series', () => {
    expect(canTrend({ kind: 'series', key: 'monthly' })).toBe(true)
    expect(canTrend({ kind: 'series', key: 'tyre_rem_month' })).toBe(true)
  })

  it('an explicit ordered flag wins either way', () => {
    expect(canTrend({ kind: 'flat', ordered: true })).toBe(true)
    expect(canTrend({ kind: 'series', ordered: false })).toBe(false)
  })

  it('is safe on nothing', () => {
    expect(canTrend(null)).toBe(false)
    expect(canTrend(undefined)).toBe(false)
  })
})

describe('trendLine', () => {
  it('recovers a known straight line exactly', () => {
    const t = trendLine([10, 20, 30, 40])
    expect(t.slope).toBeCloseTo(10, 6)
    expect(t.intercept).toBeCloseTo(10, 6)
    expect(t.r2).toBeCloseTo(1, 6)
    expect(t.direction).toBe('up')
    expect(t.weak).toBe(false)
    expect(t.fitted).toHaveLength(4)
  })

  it('reads a decline as falling', () => {
    expect(trendLine([100, 80, 60, 40]).direction).toBe('down')
  })

  it('refuses to draw through too few points', () => {
    // Two points always fit a line perfectly - that is arithmetic, not evidence.
    expect(trendLine([5, 9])).toBeNull()
    expect(trendLine([5])).toBeNull()
    expect(trendLine([])).toBeNull()
    expect(MIN_TREND_POINTS).toBe(3)
  })

  it('has no R squared when every point is identical', () => {
    // No variation to explain, so a perfect 1 would be a lie.
    const t = trendLine([50, 50, 50, 50])
    expect(t.r2).toBeNull()
    expect(t.direction).toBe('flat')
  })

  it('calls a scattered fit weak', () => {
    const t = trendLine([10, 90, 20, 85, 15, 95])
    expect(t.r2).toBeLessThan(WEAK_FIT_R2)
    expect(t.weak).toBe(true)
  })

  it('judges direction against the spread, not against zero', () => {
    // A slope of ~1 on values in the millions is noise, not a climb.
    const t = trendLine([5_000_000, 5_000_002, 5_000_001, 5_000_003])
    expect(t.direction).toBe('flat')
  })

  it('fits across a gap and still predicts every x', () => {
    const t = trendLine([10, null, 30, 40])
    expect(t).not.toBeNull()
    expect(t.fitted).toHaveLength(4)
    expect(t.points).toBe(3)          // only the real readings are counted
    expect(t.fitted.every(Number.isFinite)).toBe(true)
  })

  it('survives rubbish input', () => {
    expect(trendLine(null)).toBeNull()
    expect(trendLine(['a', 'b', 'c'])).toBeNull()
  })
})

describe('trendChange + trendSummary', () => {
  const up = trendLine([10, 20, 30, 40])

  it('reports the whole-window change, not the per-step slope', () => {
    expect(trendChange(up, 4)).toBeCloseTo(30, 6)
  })

  it('describes the direction in words', () => {
    const s = trendSummary(up, 4, (v) => `SAR ${Math.round(v)}`)
    expect(s).toContain('rising')
    expect(s).toContain('SAR 30')
  })

  it('says outright when the fit is poor', () => {
    const weak = trendLine([10, 90, 20, 85, 15, 95])
    expect(trendSummary(weak, 6, String)).toMatch(/hint rather than a measurement/i)
  })

  it('does not claim a direction on flat data', () => {
    expect(trendSummary(trendLine([50, 50, 50, 50]), 4, String)).toMatch(/flat/i)
  })

  it('returns nothing when there is no trend', () => {
    expect(trendSummary(null, 4, String)).toBeNull()
    expect(trendChange(null, 4)).toBeNull()
  })
})

describe('trendDataset', () => {
  it('draws as a model, not as another measured series', () => {
    const ds = trendDataset(trendLine([1, 2, 3, 4]))
    expect(ds.type).toBe('line')
    expect(ds.borderDash).toEqual([6, 4])   // dashed = not real readings
    expect(ds.pointRadius).toBe(0)          // no points to mistake for data
    expect(ds.fill).toBe(false)
    expect(ds._isTrend).toBe(true)
  })

  it('sits in its own stack group so stacked bars do not lift it', () => {
    // The studio stacks split series by default. Sharing their stack group
    // would draw the trend at (bar total + fitted value), floating above the
    // chart rather than tracking the data.
    const ds = trendDataset(trendLine([1, 2, 3, 4]))
    expect(ds.stack).toBe('_trend')
  })

  it('is null when there is no trend to draw', () => {
    expect(trendDataset(null)).toBeNull()
  })
})
