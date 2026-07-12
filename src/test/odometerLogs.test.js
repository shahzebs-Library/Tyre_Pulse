import { describe, it, expect } from 'vitest'
import { latestPerAsset, summarizeOdometer, toFiniteNumber } from '../lib/odometerLogs'

describe('odometerLogs — latestPerAsset', () => {
  it('returns [] for empty / non-array input', () => {
    expect(latestPerAsset([])).toEqual([])
    expect(latestPerAsset()).toEqual([])
    expect(latestPerAsset(null)).toEqual([])
  })

  it('keeps the most recent reading per asset by reading_date', () => {
    const rows = [
      { id: 1, asset_no: 'A1', odometer_km: 1000, reading_date: '2026-01-01' },
      { id: 2, asset_no: 'A1', odometer_km: 3000, reading_date: '2026-03-01' },
      { id: 3, asset_no: 'A1', odometer_km: 2000, reading_date: '2026-02-01' },
    ]
    const latest = latestPerAsset(rows)
    expect(latest).toHaveLength(1)
    expect(latest[0].id).toBe(2)
    expect(latest[0].odometer_km).toBe(3000)
  })

  it('tracks one latest row per distinct asset', () => {
    const rows = [
      { id: 1, asset_no: 'A1', odometer_km: 1000, reading_date: '2026-01-01' },
      { id: 2, asset_no: 'A2', odometer_km: 5000, reading_date: '2026-01-01' },
      { id: 3, asset_no: 'A1', odometer_km: 1200, reading_date: '2026-02-01' },
    ]
    const latest = latestPerAsset(rows).sort((a, b) => a.asset_no.localeCompare(b.asset_no))
    expect(latest.map((r) => r.asset_no)).toEqual(['A1', 'A2'])
    expect(latest[0].id).toBe(3)
  })

  it('falls back to created_at when reading_date is absent', () => {
    const rows = [
      { id: 1, asset_no: 'A1', odometer_km: 1000, created_at: '2026-01-01T00:00:00Z' },
      { id: 2, asset_no: 'A1', odometer_km: 2000, created_at: '2026-05-01T00:00:00Z' },
    ]
    expect(latestPerAsset(rows)[0].id).toBe(2)
  })

  it('breaks a same-date tie with the higher odometer value', () => {
    const rows = [
      { id: 1, asset_no: 'A1', odometer_km: 1000, reading_date: '2026-01-01' },
      { id: 2, asset_no: 'A1', odometer_km: 1500, reading_date: '2026-01-01' },
    ]
    expect(latestPerAsset(rows)[0].id).toBe(2)
  })

  it('ignores rows with a blank/missing asset_no', () => {
    const rows = [
      { id: 1, asset_no: '', odometer_km: 100 },
      { id: 2, odometer_km: 200 },
      { id: 3, asset_no: 'A1', odometer_km: 300, reading_date: '2026-01-01' },
    ]
    const latest = latestPerAsset(rows)
    expect(latest).toHaveLength(1)
    expect(latest[0].asset_no).toBe('A1')
  })
})

describe('odometerLogs — summarizeOdometer', () => {
  it('returns zeroes for empty / non-array input', () => {
    expect(summarizeOdometer([])).toEqual({
      totalReadings: 0, distinctAssets: 0, highestKm: null, fleetKm: 0,
    })
    expect(summarizeOdometer()).toEqual({
      totalReadings: 0, distinctAssets: 0, highestKm: null, fleetKm: 0,
    })
  })

  it('counts readings, distinct assets, highest km and fleet km (sum of latest per asset)', () => {
    const rows = [
      { id: 1, asset_no: 'A1', odometer_km: 1000, reading_date: '2026-01-01' },
      { id: 2, asset_no: 'A1', odometer_km: 3000, reading_date: '2026-03-01' },
      { id: 3, asset_no: 'A2', odometer_km: 5000, reading_date: '2026-02-01' },
    ]
    const s = summarizeOdometer(rows)
    expect(s.totalReadings).toBe(3)
    expect(s.distinctAssets).toBe(2)
    expect(s.highestKm).toBe(5000)
    // Fleet km = latest of A1 (3000) + latest of A2 (5000)
    expect(s.fleetKm).toBe(8000)
  })

  it('coerces string odometer values and tolerates missing readings', () => {
    const rows = [
      { id: 1, asset_no: 'A1', odometer_km: '12,500', reading_date: '2026-01-01' },
      { id: 2, asset_no: 'A2', odometer_km: null, reading_date: '2026-01-01' },
    ]
    const s = summarizeOdometer(rows)
    expect(s.distinctAssets).toBe(2)
    expect(s.highestKm).toBe(12500)
    expect(s.fleetKm).toBe(12500)
  })
})

describe('odometerLogs — toFiniteNumber', () => {
  it('parses numbers, numeric strings, and rejects junk', () => {
    expect(toFiniteNumber(42)).toBe(42)
    expect(toFiniteNumber('1,200')).toBe(1200)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})
