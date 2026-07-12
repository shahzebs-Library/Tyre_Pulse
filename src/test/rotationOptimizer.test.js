import { describe, it, expect } from 'vitest'
import {
  analyzeAsset, optimizeFleet, wearClass, treadOf, DEFAULT_ROTATION_OPTS,
} from '../lib/rotationOptimizer'

// High-spread asset: 4mm steer vs 11mm trailer → 7mm spread (>=5 => high).
const highSpreadAsset = [
  { asset_no: 'TRK-01', serial_no: 'S-STEER', position: 'Steer', tread_depth: 4 },
  { asset_no: 'TRK-01', serial_no: 'S-DRIVE', position: 'Drive', tread_depth: 6 },
  { asset_no: 'TRK-01', serial_no: 'S-TRAIL', position: 'Trailer', tread_depth: 11 },
]

// Even-wear asset: 8/8.5/9 → 1mm spread (< threshold => no rotation).
const evenAsset = [
  { asset_no: 'TRK-02', serial_no: 'E-1', position: 'Steer', tread_depth: 9 },
  { asset_no: 'TRK-02', serial_no: 'E-2', position: 'Drive', tread_depth: 8.5 },
  { asset_no: 'TRK-02', serial_no: 'E-3', position: 'Trailer', tread_depth: 8 },
]

// Medium-spread asset: 6 vs 9.5 → 3.5mm spread (>=3 <5 => medium).
const mediumAsset = [
  { asset_no: 'TRK-03', serial_number: 'M-1', tyre_position: 'Steer', tread_depth: 6 },
  { asset_no: 'TRK-03', serial_number: 'M-2', tyre_position: 'Trailer', tread_depth: 9.5 },
]

describe('rotationOptimizer pure helpers', () => {
  it('classifies position wear class', () => {
    expect(wearClass('Steer')).toBe('high')
    expect(wearClass('drive axle')).toBe('high')
    expect(wearClass('Trailer 3')).toBe('low')
    expect(wearClass('Spare')).toBe('low')
    expect(wearClass('Rear')).toBe('other')
    expect(wearClass(null)).toBe('other')
  })

  it('parses tread depth robustly', () => {
    expect(treadOf({ tread_depth: 7 })).toBe(7)
    expect(treadOf({ tread_depth: '5.5' })).toBe(5.5)
    expect(treadOf({ tread_depth: null })).toBeNull()
    expect(treadOf({})).toBeNull()
  })

  it('flags a high-spread asset with a HIGH-priority recommendation', () => {
    const a = analyzeAsset(highSpreadAsset)
    expect(a.asset_no).toBe('TRK-01')
    expect(a.eligible).toBe(true)
    expect(a.spread).toBe(7)
    expect(a.priority).toBe('high')
    expect(a.recommendations.length).toBeGreaterThan(0)
    // Recommendation references the most-worn tyre's serial and position.
    expect(a.recommendations[0]).toContain('S-STEER')
    expect(a.recommendations[0]).toContain('Steer')
    expect(a.stats).toMatchObject({ count: 3, min: 4, max: 11, spread: 7 })
    expect(a.stats.avg).toBeCloseTo(7, 5)
  })

  it('yields NO recommendation for an even-wear asset', () => {
    const a = analyzeAsset(evenAsset)
    expect(a.eligible).toBe(false)
    expect(a.priority).toBeNull()
    expect(a.recommendations).toHaveLength(0)
    expect(a.spread).toBe(1)
    expect(a.reason).toMatch(/even/i)
  })

  it('bands a mid-range spread as MEDIUM priority', () => {
    const a = analyzeAsset(mediumAsset)
    expect(a.eligible).toBe(true)
    expect(a.priority).toBe('medium')
    expect(a.spread).toBe(3.5)
    expect(a.recommendations.length).toBeGreaterThan(0)
  })

  it('is ineligible when fewer than two tyres have tread readings', () => {
    const a = analyzeAsset([
      { asset_no: 'TRK-09', serial_no: 'X', position: 'Steer', tread_depth: 5 },
      { asset_no: 'TRK-09', serial_no: 'Y', position: 'Drive', tread_depth: null },
    ])
    expect(a.eligible).toBe(false)
    expect(a.priority).toBeNull()
    expect(a.stats.count).toBe(1)
    expect(a.reason).toMatch(/two/i)
  })

  it('respects custom thresholds', () => {
    // With threshold 8, the 7mm-spread asset is now within tolerance.
    const a = analyzeAsset(highSpreadAsset, { threshold: 8, highPriorityThreshold: 12 })
    expect(a.eligible).toBe(false)
    expect(a.priority).toBeNull()
  })
})

describe('optimizeFleet', () => {
  const fleet = [...highSpreadAsset, ...evenAsset, ...mediumAsset]

  it('groups by asset and summarises the fleet', () => {
    const { assets, summary } = optimizeFleet(fleet, DEFAULT_ROTATION_OPTS)
    expect(assets).toHaveLength(3)
    // Sorted by spread desc: TRK-01 (7) first.
    expect(assets[0].asset_no).toBe('TRK-01')
    expect(summary).toMatchObject({
      assetsAnalyzed: 3,
      assetsNeedingRotation: 2, // high + medium; even asset excluded
      highPriority: 1,
      mediumPriority: 1,
    })
    expect(typeof summary.avgSpread).toBe('number')
  })

  it('drops single-tyre assets and empty input safely', () => {
    const { assets, summary } = optimizeFleet([
      { asset_no: 'SOLO', serial_no: 'Z', position: 'Steer', tread_depth: 6 },
    ])
    expect(assets).toHaveLength(0)
    expect(summary.assetsAnalyzed).toBe(0)
    expect(optimizeFleet([]).summary.assetsAnalyzed).toBe(0)
    expect(optimizeFleet(null).assets).toHaveLength(0)
  })
})
