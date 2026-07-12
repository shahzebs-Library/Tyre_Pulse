import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber,
  classifyTemp,
  tempOverAmbient,
  latestPerPosition,
  summariseHeat,
  hotspots,
} from '../lib/heatIntelligence'

describe('heatIntelligence — toFiniteNumber', () => {
  it('parses numbers, strings, and dirty strings', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('95')).toBe(95)
    expect(toFiniteNumber('88.5 °C')).toBe(88.5)
    expect(toFiniteNumber('-4')).toBe(-4)
  })

  it('returns null for blank / null / non-numeric', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('n/a')).toBeNull()
    expect(toFiniteNumber(NaN)).toBeNull()
  })
})

describe('heatIntelligence — classifyTemp', () => {
  it('treats a missing/blank temperature as normal', () => {
    expect(classifyTemp({})).toBe('normal')
    expect(classifyTemp({ temperature_c: null })).toBe('normal')
    expect(classifyTemp({ temperature_c: '' })).toBe('normal')
  })

  it('classifies the absolute bands', () => {
    expect(classifyTemp({ temperature_c: 40 })).toBe('normal')
    expect(classifyTemp({ temperature_c: 84.9 })).toBe('normal')
    expect(classifyTemp({ temperature_c: 85 })).toBe('elevated')
    expect(classifyTemp({ temperature_c: 94.9 })).toBe('elevated')
    expect(classifyTemp({ temperature_c: 95 })).toBe('high')
    expect(classifyTemp({ temperature_c: 109.9 })).toBe('high')
    expect(classifyTemp({ temperature_c: 110 })).toBe('critical')
    expect(classifyTemp({ temperature_c: 140 })).toBe('critical')
  })

  it('escalates to critical when temperature breaches threshold_c + 20', () => {
    // 100 >= 75 + 20 → critical even though 100 < 110
    expect(classifyTemp({ temperature_c: 100, threshold_c: 75 })).toBe('critical')
    // exactly at threshold + 20
    expect(classifyTemp({ temperature_c: 90, threshold_c: 70 })).toBe('critical')
  })

  it('does not escalate when temperature is under threshold_c + 20', () => {
    // 96 < 80 + 20 (=100) → falls back to absolute band (high)
    expect(classifyTemp({ temperature_c: 96, threshold_c: 80 })).toBe('high')
    // 88 < 80 + 20 → elevated
    expect(classifyTemp({ temperature_c: 88, threshold_c: 80 })).toBe('elevated')
  })

  it('ignores a non-numeric threshold and uses absolute bands', () => {
    expect(classifyTemp({ temperature_c: 96, threshold_c: 'n/a' })).toBe('high')
    expect(classifyTemp({ temperature_c: 50, threshold_c: null })).toBe('normal')
  })

  it('parses string temperatures', () => {
    expect(classifyTemp({ temperature_c: '112' })).toBe('critical')
    expect(classifyTemp({ temperature_c: '86' })).toBe('elevated')
  })
})

describe('heatIntelligence — tempOverAmbient', () => {
  it('returns the rise over ambient', () => {
    expect(tempOverAmbient({ temperature_c: 90, ambient_c: 50 })).toBe(40)
    expect(tempOverAmbient({ temperature_c: '88.5', ambient_c: '8.5' })).toBe(80)
  })

  it('returns null when either side is missing or non-numeric', () => {
    expect(tempOverAmbient({ temperature_c: 90 })).toBeNull()
    expect(tempOverAmbient({ ambient_c: 30 })).toBeNull()
    expect(tempOverAmbient({ temperature_c: 90, ambient_c: 'x' })).toBeNull()
    expect(tempOverAmbient({})).toBeNull()
  })
})

describe('heatIntelligence — latestPerPosition', () => {
  it('returns [] for empty / non-array input', () => {
    expect(latestPerPosition([])).toEqual([])
    expect(latestPerPosition()).toEqual([])
    expect(latestPerPosition(null)).toEqual([])
  })

  it('keeps the most recent reading per asset+position by recorded_at', () => {
    const rows = [
      { id: 1, asset_no: 'A1', tyre_position: 'FL', temperature_c: 80, recorded_at: '2026-01-01T00:00:00Z' },
      { id: 2, asset_no: 'A1', tyre_position: 'FL', temperature_c: 95, recorded_at: '2026-03-01T00:00:00Z' },
      { id: 3, asset_no: 'A1', tyre_position: 'FL', temperature_c: 88, recorded_at: '2026-02-01T00:00:00Z' },
    ]
    const latest = latestPerPosition(rows)
    expect(latest).toHaveLength(1)
    expect(latest[0].id).toBe(2)
  })

  it('separates distinct positions on the same asset', () => {
    const rows = [
      { id: 1, asset_no: 'A1', tyre_position: 'FL', temperature_c: 80, recorded_at: '2026-01-01T00:00:00Z' },
      { id: 2, asset_no: 'A1', tyre_position: 'FR', temperature_c: 90, recorded_at: '2026-01-01T00:00:00Z' },
      { id: 3, asset_no: 'A1', tyre_position: 'FL', temperature_c: 85, recorded_at: '2026-02-01T00:00:00Z' },
    ]
    const latest = latestPerPosition(rows).sort((a, b) => a.tyre_position.localeCompare(b.tyre_position))
    expect(latest.map((r) => r.tyre_position)).toEqual(['FL', 'FR'])
    expect(latest.find((r) => r.tyre_position === 'FL').id).toBe(3)
  })

  it('falls back to created_at, and breaks time ties with the hotter reading', () => {
    const fallback = [
      { id: 1, asset_no: 'A1', tyre_position: 'RL', temperature_c: 70, created_at: '2026-01-01T00:00:00Z' },
      { id: 2, asset_no: 'A1', tyre_position: 'RL', temperature_c: 99, created_at: '2026-05-01T00:00:00Z' },
    ]
    expect(latestPerPosition(fallback)[0].id).toBe(2)

    const tie = [
      { id: 1, asset_no: 'A1', tyre_position: 'RL', temperature_c: 70, recorded_at: '2026-05-01T00:00:00Z' },
      { id: 2, asset_no: 'A1', tyre_position: 'RL', temperature_c: 99, recorded_at: '2026-05-01T00:00:00Z' },
    ]
    expect(latestPerPosition(tie)[0].id).toBe(2)
  })

  it('ignores rows without an asset number', () => {
    const rows = [
      { id: 1, asset_no: '', tyre_position: 'FL', temperature_c: 80 },
      { id: 2, asset_no: 'A1', tyre_position: 'FL', temperature_c: 90, recorded_at: '2026-01-01T00:00:00Z' },
    ]
    const latest = latestPerPosition(rows)
    expect(latest).toHaveLength(1)
    expect(latest[0].id).toBe(2)
  })
})

describe('heatIntelligence — summariseHeat', () => {
  it('returns zeros / nulls for an empty set', () => {
    expect(summariseHeat([])).toEqual({
      totalReadings: 0,
      criticalCount: 0,
      highCount: 0,
      distinctAssets: 0,
      maxTempC: null,
      avgTempC: null,
    })
    expect(summariseHeat()).toEqual({
      totalReadings: 0,
      criticalCount: 0,
      highCount: 0,
      distinctAssets: 0,
      maxTempC: null,
      avgTempC: null,
    })
  })

  it('counts totals, severities, distinct assets, and temperature stats', () => {
    const rows = [
      { asset_no: 'A1', temperature_c: 120 },               // critical
      { asset_no: 'A1', temperature_c: 96 },                // high
      { asset_no: 'A2', temperature_c: 100, threshold_c: 75 }, // critical via threshold
      { asset_no: 'A3', temperature_c: 40 },                // normal
      { asset_no: 'A3', temperature_c: null },              // no reading (ignored in temp stats)
    ]
    const s = summariseHeat(rows)
    expect(s.totalReadings).toBe(5)
    expect(s.criticalCount).toBe(2)
    expect(s.highCount).toBe(1)
    expect(s.distinctAssets).toBe(3)
    expect(s.maxTempC).toBe(120)
    // avg over the 4 numeric temps: (120+96+100+40)/4 = 89
    expect(s.avgTempC).toBe(89)
  })

  it('leaves avgTempC null when no row carries a temperature', () => {
    const s = summariseHeat([{ asset_no: 'A1' }, { asset_no: 'A2', temperature_c: '' }])
    expect(s.avgTempC).toBeNull()
    expect(s.maxTempC).toBeNull()
    expect(s.distinctAssets).toBe(2)
  })
})

describe('heatIntelligence — hotspots', () => {
  it('returns only high/critical readings sorted hottest-first', () => {
    const rows = [
      { asset_no: 'A1', tyre_position: 'FL', temperature_c: 96 },  // high
      { asset_no: 'A2', tyre_position: 'RR', temperature_c: 130 }, // critical
      { asset_no: 'A3', tyre_position: 'FR', temperature_c: 60 },  // normal (excluded)
      { asset_no: 'A4', tyre_position: 'RL', temperature_c: 88 },  // elevated (excluded)
    ]
    const hs = hotspots(rows)
    expect(hs).toHaveLength(2)
    expect(hs[0]).toEqual({ asset_no: 'A2', tyre_position: 'RR', temperature_c: 130, status: 'critical' })
    expect(hs[1]).toEqual({ asset_no: 'A1', tyre_position: 'FL', temperature_c: 96, status: 'high' })
  })

  it('returns [] for empty / non-array input', () => {
    expect(hotspots([])).toEqual([])
    expect(hotspots()).toEqual([])
    expect(hotspots(null)).toEqual([])
  })

  it('includes threshold-driven criticals', () => {
    const hs = hotspots([{ asset_no: 'A1', tyre_position: 'FL', temperature_c: 100, threshold_c: 75 }])
    expect(hs).toHaveLength(1)
    expect(hs[0].status).toBe('critical')
  })
})
