import { describe, it, expect } from 'vitest'
import {
  buildTwin, treadHealth, ageHealth, pressureHealth, healthBand,
} from '../lib/digitalTwin'

// Fixed clock so age-derived signals are deterministic.
const NOW = new Date('2025-01-01T00:00:00Z').getTime()

const healthy = {
  id: 1, asset_no: 'TM517', position: 'Steer L',
  serial_no: 'H1', brand: 'Bridgestone', size: '11R22.5',
  tread_depth: 18, pressure_reading: 8.0, fitment_date: '2024-06-01',
  cost_per_tyre: 1600, total_km: 80000,
}
const worn = {
  id: 2, asset_no: 'TM517', position: 'Drive R',
  serial_no: 'W1', brand: 'Bridgestone',
  tread_depth: 2.5, pressure_reading: 4.5, fitment_date: '2018-01-01',
  cost_per_tyre: 1600, total_km: 20000,
}

describe('signal helpers', () => {
  it('tread health falls as tread wears', () => {
    expect(treadHealth(20)).toBeGreaterThan(treadHealth(10))
    expect(treadHealth(2)).toBeLessThan(treadHealth(18))
    expect(treadHealth(null)).toBeNull()
  })
  it('age health falls as tyres age', () => {
    expect(ageHealth(1)).toBe(100)
    expect(ageHealth(6)).toBe(0)
    expect(ageHealth(4.5)).toBeLessThan(100)
    expect(ageHealth(null)).toBeNull()
  })
  it('pressure health rewards optimal and punishes critical', () => {
    expect(pressureHealth(8.0)).toBeGreaterThan(pressureHealth(4.0))
    expect(pressureHealth('x')).toBeNull()
  })
  it('bands the overall score', () => {
    expect(healthBand(90).tone).toBe('green')
    expect(healthBand(70).tone).toBe('amber')
    expect(healthBand(30).tone).toBe('red')
    expect(healthBand(null).key).toBe('unknown')
  })
})

describe('buildTwin', () => {
  it('handles no tyres', () => {
    const t = buildTwin([], { now: NOW })
    expect(t.tyreCount).toBe(0)
    expect(t.positions).toEqual([])
    expect(t.healthScore).toBeNull()
    expect(t.worstPosition).toBeNull()
  })

  it('assembles per-position health, CPK, age band and identity', () => {
    const t = buildTwin([healthy], { now: NOW })
    expect(t.asset_no).toBe('TM517')
    expect(t.tyreCount).toBe(1)
    const p = t.positions[0]
    expect(p.position).toBe('Steer L')
    expect(p.serial).toBe('H1')
    expect(p.tread).toBe(18)
    expect(p.ageBand).toBe('compliant')
    // CPK = 1600 / 80000 = 0.02
    expect(p.cpk).toBe(0.02)
    expect(p.health).toBeGreaterThan(80)
  })

  it('a worn/aged/under-inflated tyre lowers the overall health score', () => {
    const good = buildTwin([healthy], { now: NOW }).healthScore
    const mixed = buildTwin([healthy, worn], { now: NOW }).healthScore
    expect(mixed).toBeLessThan(good)
    // the worn tyre itself scores far below the healthy one
    const twin = buildTwin([healthy, worn], { now: NOW })
    const wornPos = twin.positions.find((p) => p.serial === 'W1')
    const goodPos = twin.positions.find((p) => p.serial === 'H1')
    expect(wornPos.health).toBeLessThan(goodPos.health)
  })

  it('reports the worst position correctly', () => {
    const twin = buildTwin([healthy, worn], { now: NOW })
    expect(twin.worstPosition).toBe('Drive R')
  })

  it('renormalises when signals are missing without fabricating penalties', () => {
    const treadOnly = buildTwin([
      { id: 9, asset_no: 'A9', position: 'P1', serial_no: 'S9', tread_depth: 18 },
    ], { now: NOW })
    // Only the tread signal is present; a healthy tread yields a high score.
    expect(treadOnly.positions[0].health).toBeGreaterThan(80)
    expect(treadOnly.healthScore).toBeGreaterThan(80)
  })

  it('gives a null health when a position has no usable signals', () => {
    const twin = buildTwin([
      { id: 10, asset_no: 'A10', position: 'P1', serial_no: 'S10' },
    ], { now: NOW })
    expect(twin.positions[0].health).toBeNull()
    expect(twin.healthScore).toBeNull()
    expect(twin.worstPosition).toBeNull()
  })
})
