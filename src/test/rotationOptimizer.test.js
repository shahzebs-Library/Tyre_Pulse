import { describe, it, expect } from 'vitest'
import {
  analyzeAsset, optimizeFleet, wearClass, treadOf, DEFAULT_ROTATION_OPTS,
  wearBalanceScore, generateSwaps, detectViolations, overallStatus,
  spreadUrgency, buildNarrative, normSize, BENEFIT_KM_PER_MM,
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

  it('aggregates deepened fleet signals in the summary', () => {
    const { summary } = optimizeFleet(fleet, DEFAULT_ROTATION_OPTS)
    expect(summary.totalSwaps).toBeGreaterThan(0)
    expect(typeof summary.avgWearBalance).toBe('number')
    expect(summary.criticalAssets).toBe(0) // no <1.6mm tyres in this fleet
    expect(summary.totalViolations).toBe(0)
  })
})

describe('wearBalanceScore', () => {
  it('scores perfectly even wear as 100', () => {
    expect(wearBalanceScore([8, 8, 8])).toBe(100)
  })
  it('uses population std-dev / CV: [9,8.5,8] → 90', () => {
    // mean 8.5, pop std 0.4082, CV 4.803%, 100 - 2*CV = 90.39 → 90
    expect(wearBalanceScore([9, 8.5, 8])).toBe(90)
  })
  it('penalises wide spread and never goes below 0', () => {
    expect(wearBalanceScore([1, 20])).toBe(0) // huge CV clamps to 0
    expect(wearBalanceScore([4, 6, 11])).toBeLessThan(90)
  })
  it('returns null for <2 readings or non-positive mean', () => {
    expect(wearBalanceScore([7])).toBeNull()
    expect(wearBalanceScore([])).toBeNull()
    expect(wearBalanceScore([0, 0])).toBeNull()
  })
})

describe('generateSwaps', () => {
  const tyres = [
    { tread: 4, serial: 'W-STEER', position: 'Steer' },
    { tread: 6, serial: 'W-DRIVE', position: 'Drive' },
    { tread: 11, serial: 'F-TRAIL', position: 'Trailer' },
  ]

  it('pairs most-worn steer with freshest trailer and scores impact', () => {
    const swaps = generateSwaps(tyres)
    expect(swaps).toHaveLength(1)
    const s = swaps[0]
    expect(s.tyre).toBe('W-STEER')
    expect(s.from_position).toBe('Steer')
    expect(s.to_position).toBe('Trailer')
    expect(s.tread_delta_mm).toBe(7)
    // impact = round(7*10)=70 + steer 15 + trailer dest 5 = 90
    expect(s.impact_score).toBe(90)
    // benefit = 7 * 10000
    expect(s.expected_benefit_km).toBe(7 * BENEFIT_KM_PER_MM)
    expect(s.expected_benefit_km).toBe(70000)
  })

  it('respects the 1.5mm delta threshold (no trivial swaps)', () => {
    // 8 vs 9 → 1mm gap, below 1.5mm worth-rotating threshold
    expect(generateSwaps([
      { tread: 8, serial: 'A', position: 'Steer' },
      { tread: 9, serial: 'B', position: 'Trailer' },
    ])).toHaveLength(0)
  })

  it('caps impact at 100', () => {
    const [s] = generateSwaps([
      { tread: 2, serial: 'LOW', position: 'Steer' },
      { tread: 16, serial: 'HI', position: 'Trailer' },
    ])
    // round(14*10)=140 +15 +5 → clamped to 100
    expect(s.impact_score).toBe(100)
  })

  it('size guard: skips a swap when both sizes are known and differ', () => {
    const swaps = generateSwaps([
      { tread: 4, serial: 'W', position: 'Steer', size: '295/80R22.5' },
      { tread: 11, serial: 'F', position: 'Trailer', size: '385/65R22.5' },
    ])
    expect(swaps).toHaveLength(0)
  })

  it('size guard: allows a swap when a size is unknown or matches', () => {
    expect(generateSwaps([
      { tread: 4, serial: 'W', position: 'Steer', size: '11R22.5' },
      { tread: 11, serial: 'F', position: 'Trailer', size: ' 11r22.5 ' },
    ])).toHaveLength(1) // normalised (upper+trim) equal
    expect(generateSwaps([
      { tread: 4, serial: 'W', position: 'Steer', size: '11R22.5' },
      { tread: 11, serial: 'F', position: 'Trailer' },
    ])).toHaveLength(1) // one size unknown → allowed
  })

  it('uses each tyre at most once and sorts by impact desc, cap 8', () => {
    const many = []
    for (let i = 0; i < 20; i++) many.push({ tread: i % 2 === 0 ? 3 : 12, serial: `T${i}`, position: i % 2 === 0 ? 'Steer' : 'Trailer' })
    const swaps = generateSwaps(many)
    expect(swaps.length).toBeLessThanOrEqual(8)
    const serials = swaps.flatMap((s) => [s.tyre])
    expect(new Set(serials).size).toBe(serials.length) // no worn tyre reused
    for (let i = 1; i < swaps.length; i++) expect(swaps[i - 1].impact_score).toBeGreaterThanOrEqual(swaps[i].impact_score)
  })

  it('normSize normalises upper + trim', () => {
    expect(normSize(' 11r22.5 ')).toBe('11R22.5')
    expect(normSize(null)).toBe('')
  })
})

describe('detectViolations', () => {
  it('flags tyres below the 1.6mm legal minimum as critical', () => {
    const v = detectViolations([
      { tread: 1.2, serial: 'BALD', position: 'Drive' },
      { tread: 8, serial: 'OK', position: 'Trailer' },
    ])
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({ type: 'below_legal_minimum', severity: 'critical', tyre: 'BALD' })
    expect(v[0].heuristic).toBe(false)
  })

  it('flags steer imbalance as a HEURISTIC critical when steer tyres differ > 2mm', () => {
    const v = detectViolations([
      { tread: 9, serial: 'S1', position: 'Steer Left' },
      { tread: 5, serial: 'S2', position: 'Steer Right' },
    ])
    const si = v.find((x) => x.type === 'steer_imbalance')
    expect(si).toBeTruthy()
    expect(si.severity).toBe('critical')
    expect(si.heuristic).toBe(true)
    expect(si.gap_mm).toBe(4)
  })

  it('does not flag steer imbalance within the 2mm tolerance', () => {
    const v = detectViolations([
      { tread: 9, serial: 'S1', position: 'Steer Left' },
      { tread: 7.5, serial: 'S2', position: 'Steer Right' },
    ])
    expect(v.find((x) => x.type === 'steer_imbalance')).toBeUndefined()
  })

  it('returns no violations for a clean asset', () => {
    expect(detectViolations([
      { tread: 8, serial: 'A', position: 'Drive' },
      { tread: 9, serial: 'B', position: 'Trailer' },
    ])).toHaveLength(0)
  })
})

describe('overallStatus + spreadUrgency', () => {
  it('critical wins whenever a critical violation exists', () => {
    expect(overallStatus(100, [{ severity: 'critical' }])).toBe('critical')
  })
  it('bands on score when no critical violation', () => {
    expect(overallStatus(40, [])).toBe('warning')
    expect(overallStatus(60, [])).toBe('advisory')
    expect(overallStatus(80, [])).toBe('good')
    expect(overallStatus(null, [])).toBe('good')
  })
  it('spread urgency thresholds: >3 warning, >5 critical', () => {
    expect(spreadUrgency(2)).toBe('advisory')
    expect(spreadUrgency(4)).toBe('warning')
    expect(spreadUrgency(6)).toBe('critical')
    expect(spreadUrgency(null)).toBe('advisory')
  })
})

describe('buildNarrative', () => {
  it('is balanced-clean when there is nothing to do', () => {
    expect(buildNarrative([], [])).toMatch(/well balanced/i)
  })
  it('composes violation count + top swap action', () => {
    const swaps = generateSwaps([
      { tread: 4, serial: 'W-STEER', position: 'Steer' },
      { tread: 11, serial: 'F-TRAIL', position: 'Trailer' },
    ])
    const n = buildNarrative([{ severity: 'critical' }], swaps)
    expect(n).toContain('1 compliance issue(s) detected.')
    expect(n).toContain('move W-STEER from Steer to Trailer')
    expect(n).toContain('7mm gain')
    expect(n).toContain('70,000 km')
  })
})

describe('analyzeAsset — deepened fields wired in', () => {
  it('attaches score, status, swaps, violations and narrative', () => {
    const a = analyzeAsset(highSpreadAsset)
    expect(typeof a.wearBalanceScore).toBe('number')
    expect(a.swaps.length).toBe(1)
    expect(a.swaps[0].tyre).toBe('S-STEER')
    // wide 4/6/11 spread → low balance score (<50) → 'warning' (no critical violation)
    expect(a.overallStatus).toBe('warning')
    expect(a.urgency).toBe('critical') // 7mm spread > 5
    expect(a.violations).toHaveLength(0)
    expect(a.narrative).toContain('Top action')
  })

  it('reports a critical status when a tyre is below the legal minimum', () => {
    const a = analyzeAsset([
      { asset_no: 'X', serial_no: 'BALD', position: 'Drive', tread_depth: 1.2 },
      { asset_no: 'X', serial_no: 'OK', position: 'Trailer', tread_depth: 9 },
    ])
    expect(a.overallStatus).toBe('critical')
    expect(a.violations.some((v) => v.type === 'below_legal_minimum')).toBe(true)
    expect(a.narrative).toContain('compliance issue(s)')
  })

  it('is well-balanced with no swaps for even wear', () => {
    const a = analyzeAsset(evenAsset)
    expect(a.swaps).toHaveLength(0)
    expect(a.narrative).toMatch(/well balanced/i)
    expect(a.overallStatus).toBe('good')
  })

  it('still exposes deepened fields when there are <2 tread readings', () => {
    const a = analyzeAsset([
      { asset_no: 'Y', serial_no: 'ONE', position: 'Steer', tread_depth: 1.0 },
      { asset_no: 'Y', serial_no: 'TWO', position: 'Drive', tread_depth: null },
    ])
    expect(a.wearBalanceScore).toBeNull()
    expect(a.swaps).toHaveLength(0)
    // the single readable tyre is below legal minimum → critical
    expect(a.overallStatus).toBe('critical')
    expect(a.violations).toHaveLength(1)
  })
})
