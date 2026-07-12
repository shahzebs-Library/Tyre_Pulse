import { describe, it, expect } from 'vitest'
import {
  classifyPressure,
  deviationPct,
  summarizePressure,
  DEFAULT_TARGET_PRESSURE,
  DEFAULT_TOLERANCE_PCT,
} from '../lib/tpms'

describe('tpms.classifyPressure', () => {
  it('bands at the default 8.0 bar ±15% target', () => {
    // lower = 6.8, upper = 9.2, critical threshold = 5.6
    expect(classifyPressure(8.0)).toBe('optimal')
    expect(classifyPressure(7.0)).toBe('optimal')
    expect(classifyPressure(9.0)).toBe('optimal')
    expect(classifyPressure(6.5)).toBe('under')   // below 6.8, above 5.6
    expect(classifyPressure(9.5)).toBe('over')    // above 9.2
    expect(classifyPressure(5.0)).toBe('critical') // below 5.6
  })

  it('honours boundary conditions inclusively for the optimal band', () => {
    // lower boundary 6.8 is optimal (uses < lower for under)
    expect(classifyPressure(6.8)).toBe('optimal')
    expect(classifyPressure(6.79)).toBe('under')
    // upper boundary 9.2 is optimal (uses > upper for over)
    expect(classifyPressure(9.2)).toBe('optimal')
    expect(classifyPressure(9.21)).toBe('over')
    // critical boundary 5.6 is under (uses < critical for critical)
    expect(classifyPressure(5.6)).toBe('under')
    expect(classifyPressure(5.59)).toBe('critical')
  })

  it('accepts a custom target and tolerance', () => {
    // target 10, tol 10% -> lower 9, upper 11, critical 8
    expect(classifyPressure(10, 10, 10)).toBe('optimal')
    expect(classifyPressure(8.5, 10, 10)).toBe('under')
    expect(classifyPressure(11.5, 10, 10)).toBe('over')
    expect(classifyPressure(7, 10, 10)).toBe('critical')
  })

  it('returns unknown for invalid pressure or target', () => {
    expect(classifyPressure(null)).toBe('unknown')
    expect(classifyPressure(undefined)).toBe('unknown')
    expect(classifyPressure('abc')).toBe('unknown')
    expect(classifyPressure(0)).toBe('unknown')
    expect(classifyPressure(-5)).toBe('unknown')
    expect(classifyPressure(8.0, 0)).toBe('unknown')
    expect(classifyPressure(8.0, -1)).toBe('unknown')
  })

  it('coerces numeric strings', () => {
    expect(classifyPressure('8.0')).toBe('optimal')
    expect(classifyPressure('5.0')).toBe('critical')
  })

  it('exposes sane defaults', () => {
    expect(DEFAULT_TARGET_PRESSURE).toBe(8.0)
    expect(DEFAULT_TOLERANCE_PCT).toBe(15)
  })
})

describe('tpms.deviationPct', () => {
  it('computes absolute deviation from target', () => {
    expect(deviationPct(8.0)).toBe(0)
    expect(deviationPct(9.2)).toBeCloseTo(15, 5)
    expect(deviationPct(6.8)).toBeCloseTo(15, 5)
  })
  it('is zero for invalid input', () => {
    expect(deviationPct(null)).toBe(0)
    expect(deviationPct(8, 0)).toBe(0)
  })
})

describe('tpms.summarizePressure', () => {
  const rows = [
    // sensor-shaped rows (pressure / tyre_position / target_pressure)
    { pressure: 8.0, site: 'Dubai', tyre_position: 'Steer' },     // optimal
    { pressure: 6.5, site: 'Dubai', tyre_position: 'Drive' },     // under
    { pressure: 5.0, site: 'Dubai', tyre_position: 'Drive' },     // critical
    { pressure: 9.5, site: 'Riyadh', tyre_position: 'Trailer' },  // over
    // baseline-shaped row (pressure_reading / position)
    { pressure_reading: 7.5, site: 'Riyadh', position: 'Steer' }, // optimal
    // per-row target override: 10 ±15% -> lower 8.5, so 8 is under
    { pressure: 8.0, target_pressure: 10, site: 'Riyadh', position: 'Drive' }, // under
    // unknown / junk
    { pressure: null, site: 'Dubai', tyre_position: 'Spare' },    // unknown
  ]

  const s = summarizePressure(rows)

  it('counts every band', () => {
    expect(s.total).toBe(7)
    expect(s.bands.optimal).toBe(2)
    expect(s.bands.under).toBe(2)
    expect(s.bands.over).toBe(1)
    expect(s.bands.critical).toBe(1)
    expect(s.bands.unknown).toBe(1)
  })

  it('totals the alerting bands (under+over+critical)', () => {
    expect(s.alerts).toBe(4)
  })

  it('averages only valid pressures', () => {
    // (8.0 + 6.5 + 5.0 + 9.5 + 7.5 + 8.0) / 6
    expect(s.avgPressure).toBeCloseTo(44.5 / 6, 5)
  })

  it('breaks down by site with per-site alert counts', () => {
    const dubai = s.bySite.find(r => r.site === 'Dubai')
    expect(dubai.total).toBe(4)
    expect(dubai.optimal).toBe(1)
    expect(dubai.under).toBe(1)
    expect(dubai.critical).toBe(1)
    expect(dubai.unknown).toBe(1)
    expect(dubai.alerts).toBe(2)
  })

  it('breaks down by position, merging sensor and baseline field names', () => {
    const drive = s.byPosition.find(r => r.position === 'Drive')
    expect(drive.total).toBe(3) // 6.5 under, 5.0 critical, 8@target10 under
    expect(drive.alerts).toBe(3)
    const steer = s.byPosition.find(r => r.position === 'Steer')
    expect(steer.total).toBe(2) // both optimal
    expect(steer.alerts).toBe(0)
  })

  it('sorts breakdowns by alert count descending', () => {
    expect(s.bySite[0].alerts).toBeGreaterThanOrEqual(s.bySite[s.bySite.length - 1].alerts)
  })

  it('is null-safe', () => {
    const empty = summarizePressure(null)
    expect(empty.total).toBe(0)
    expect(empty.alerts).toBe(0)
    expect(empty.avgPressure).toBeNull()
    expect(empty.bySite).toEqual([])
    expect(empty.byPosition).toEqual([])
  })

  it('respects a fleet-wide target override', () => {
    // At target 10 ±15%: lower 8.5. 8.0 becomes under, 9.5 becomes optimal.
    const t = summarizePressure(
      [{ pressure: 8.0 }, { pressure: 9.5 }],
      { target: 10 },
    )
    expect(t.bands.under).toBe(1)
    expect(t.bands.optimal).toBe(1)
  })
})
