/**
 * Engine Hours — pure helper tests (V161). Exercises the real, I/O-free logic
 * consumed by the Engine Hours Tracker page and service: reducing a reading set
 * to the latest reading per asset, and rolling readings up into fleet KPIs.
 */
import { describe, it, expect } from 'vitest'
import { latestPerAsset, summarizeEngineHours, toNumber } from '../lib/engineHours'

const rows = [
  { id: 'a1', asset_no: 'TRK-01', engine_hours: 100, reading_date: '2026-01-01', created_at: '2026-01-01T08:00:00Z' },
  { id: 'a2', asset_no: 'TRK-01', engine_hours: 150, reading_date: '2026-03-01', created_at: '2026-03-01T08:00:00Z' },
  { id: 'a3', asset_no: 'TRK-02', engine_hours: 80, reading_date: '2026-02-15', created_at: '2026-02-15T08:00:00Z' },
  { id: 'a4', asset_no: 'TRK-02', engine_hours: 60, reading_date: '2026-01-10', created_at: '2026-01-10T08:00:00Z' },
]

describe('toNumber', () => {
  it('coerces numeric strings and passes through numbers', () => {
    expect(toNumber('123.5')).toBe(123.5)
    expect(toNumber(42)).toBe(42)
    expect(toNumber('1,250 h')).toBe(1250)
  })
  it('returns null for empty / non-numeric input', () => {
    expect(toNumber('')).toBeNull()
    expect(toNumber(null)).toBeNull()
    expect(toNumber(undefined)).toBeNull()
    expect(toNumber('abc')).toBeNull()
  })
})

describe('latestPerAsset', () => {
  it('returns one row per asset — the most recent by reading_date', () => {
    const latest = latestPerAsset(rows)
    expect(latest).toHaveLength(2)
    const byAsset = Object.fromEntries(latest.map((r) => [r.asset_no, r]))
    expect(byAsset['TRK-01'].id).toBe('a2') // 2026-03-01 beats 2026-01-01
    expect(byAsset['TRK-01'].engine_hours).toBe(150)
    expect(byAsset['TRK-02'].id).toBe('a3') // 2026-02-15 beats 2026-01-10
    expect(byAsset['TRK-02'].engine_hours).toBe(80)
  })

  it('is ordered by asset_no', () => {
    expect(latestPerAsset(rows).map((r) => r.asset_no)).toEqual(['TRK-01', 'TRK-02'])
  })

  it('falls back to created_at when reading_date is absent', () => {
    const noDates = [
      { id: 'x1', asset_no: 'X', engine_hours: 10, created_at: '2026-01-01T00:00:00Z' },
      { id: 'x2', asset_no: 'X', engine_hours: 20, created_at: '2026-06-01T00:00:00Z' },
    ]
    expect(latestPerAsset(noDates)).toHaveLength(1)
    expect(latestPerAsset(noDates)[0].id).toBe('x2')
  })

  it('ignores rows without an asset number and handles empty input', () => {
    expect(latestPerAsset([{ id: 'z', asset_no: '', engine_hours: 5 }])).toEqual([])
    expect(latestPerAsset([])).toEqual([])
    expect(latestPerAsset(null)).toEqual([])
  })
})

describe('summarizeEngineHours', () => {
  it('computes total readings, distinct assets, max and avg (latest per asset)', () => {
    const s = summarizeEngineHours(rows)
    expect(s.totalReadings).toBe(4)
    expect(s.assetsTracked).toBe(2)
    expect(s.maxHours).toBe(150)      // max of latest {150, 80}
    expect(s.avgHours).toBe(115)      // (150 + 80) / 2
  })

  it('rounds the average to one decimal place', () => {
    const s = summarizeEngineHours([
      { id: 'p', asset_no: 'A', engine_hours: 100, reading_date: '2026-01-01' },
      { id: 'q', asset_no: 'B', engine_hours: 105, reading_date: '2026-01-01' },
      { id: 'r', asset_no: 'C', engine_hours: 111, reading_date: '2026-01-01' },
    ])
    expect(s.avgHours).toBe(105.3) // 316 / 3 = 105.333…
  })

  it('returns null metrics for an empty / null set', () => {
    for (const input of [[], null, undefined]) {
      const s = summarizeEngineHours(input)
      expect(s.totalReadings).toBe(0)
      expect(s.assetsTracked).toBe(0)
      expect(s.maxHours).toBeNull()
      expect(s.avgHours).toBeNull()
    }
  })

  it('skips non-numeric engine_hours when averaging', () => {
    const s = summarizeEngineHours([
      { id: 'm', asset_no: 'A', engine_hours: 200, reading_date: '2026-01-01' },
      { id: 'n', asset_no: 'B', engine_hours: null, reading_date: '2026-01-01' },
    ])
    expect(s.assetsTracked).toBe(2)
    expect(s.maxHours).toBe(200)
    expect(s.avgHours).toBe(200) // only the one numeric latest reading
  })
})
