import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber, daysUntilExpiry, expiryStatus, latestPerAsset,
  summariseEmissions, EXPIRING_SOON_DAYS,
} from '../lib/emissionsTests'

// Fixed reference instant so every time-dependent assertion is reproducible:
// 2026-07-12T12:00:00Z (matches the module's deterministic contract).
const NOW = Date.UTC(2026, 6, 12, 12, 0, 0)

describe('emissionsTests - toFiniteNumber', () => {
  it('parses plain numbers and numeric strings', () => {
    expect(toFiniteNumber(12.5)).toBe(12.5)
    expect(toFiniteNumber('0.48')).toBe(0.48)
    expect(toFiniteNumber('1,200')).toBe(1200)
  })

  it('returns null for empty / null / non-numeric input', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('n/a')).toBeNull()
  })
})

describe('emissionsTests - daysUntilExpiry', () => {
  it('returns a positive day count for a future expiry', () => {
    expect(daysUntilExpiry({ expiry_date: '2026-07-22' }, NOW)).toBe(10)
  })

  it('returns zero on the expiry day itself (time-of-day ignored)', () => {
    expect(daysUntilExpiry({ expiry_date: '2026-07-12' }, NOW)).toBe(0)
  })

  it('returns a negative day count for a past expiry', () => {
    expect(daysUntilExpiry({ expiry_date: '2026-07-02' }, NOW)).toBe(-10)
  })

  it('returns null when expiry_date is missing or unparseable', () => {
    expect(daysUntilExpiry({}, NOW)).toBeNull()
    expect(daysUntilExpiry({ expiry_date: 'not-a-date' }, NOW)).toBeNull()
  })
})

describe('emissionsTests - expiryStatus', () => {
  it('classifies a certificate well in the future as valid', () => {
    expect(expiryStatus({ expiry_date: '2026-12-31' }, NOW)).toBe('valid')
  })

  it('classifies a certificate within the window as expiring_soon', () => {
    expect(expiryStatus({ expiry_date: '2026-08-01' }, NOW)).toBe('expiring_soon')
    // Exactly at the window boundary is still "soon".
    const boundary = new Date(NOW + EXPIRING_SOON_DAYS * 86_400_000)
    const iso = boundary.toISOString().slice(0, 10)
    expect(expiryStatus({ expiry_date: iso }, NOW)).toBe('expiring_soon')
  })

  it('treats the expiry day (0 days) as expiring_soon, not expired', () => {
    expect(expiryStatus({ expiry_date: '2026-07-12' }, NOW)).toBe('expiring_soon')
  })

  it('classifies a past certificate as expired', () => {
    expect(expiryStatus({ expiry_date: '2026-07-11' }, NOW)).toBe('expired')
  })

  it('returns unknown when there is no expiry date', () => {
    expect(expiryStatus({ asset_no: 'A' }, NOW)).toBe('unknown')
  })
})

describe('emissionsTests - latestPerAsset', () => {
  it('keeps the most recent test_date per asset and ignores blank assets', () => {
    const rows = [
      { id: 1, asset_no: 'TRK-1', test_date: '2026-01-10' },
      { id: 2, asset_no: 'TRK-1', test_date: '2026-06-10' },
      { id: 3, asset_no: 'TRK-2', test_date: '2026-03-01' },
      { id: 4, asset_no: '   ', test_date: '2026-05-01' },
    ]
    const latest = latestPerAsset(rows)
    expect(latest).toHaveLength(2)
    const byAsset = Object.fromEntries(latest.map((r) => [r.asset_no, r.id]))
    expect(byAsset['TRK-1']).toBe(2)
    expect(byAsset['TRK-2']).toBe(3)
  })

  it('returns an empty array for non-array / empty input', () => {
    expect(latestPerAsset(null)).toEqual([])
    expect(latestPerAsset([])).toEqual([])
  })
})

describe('emissionsTests - summariseEmissions', () => {
  it('returns zeroed totals for empty input', () => {
    expect(summariseEmissions([], NOW)).toEqual({
      totalTests: 0, passCount: 0, failCount: 0, passRate: 0,
      expiredCount: 0, expiringSoonCount: 0,
    })
  })

  it('counts pass/fail and computes pass rate ignoring conditional', () => {
    const rows = [
      { asset_no: 'A', result: 'pass', test_date: '2026-06-01', expiry_date: '2027-06-01' },
      { asset_no: 'B', result: 'pass', test_date: '2026-06-01', expiry_date: '2027-06-01' },
      { asset_no: 'C', result: 'fail', test_date: '2026-06-01', expiry_date: '2027-06-01' },
      { asset_no: 'D', result: 'conditional', test_date: '2026-06-01', expiry_date: '2027-06-01' },
    ]
    const s = summariseEmissions(rows, NOW)
    expect(s.totalTests).toBe(4)
    expect(s.passCount).toBe(2)
    expect(s.failCount).toBe(1)
    // 2 pass of 3 decided (conditional excluded) → 67%.
    expect(s.passRate).toBe(67)
  })

  it('counts expired / expiring assets on the latest test per asset only', () => {
    const rows = [
      // TRK-1: an old expired cert superseded by a valid newer one → not expired.
      { asset_no: 'TRK-1', result: 'pass', test_date: '2025-01-01', expiry_date: '2025-06-01' },
      { asset_no: 'TRK-1', result: 'pass', test_date: '2026-06-01', expiry_date: '2027-06-01' },
      // TRK-2: latest cert already expired.
      { asset_no: 'TRK-2', result: 'pass', test_date: '2026-01-01', expiry_date: '2026-06-01' },
      // TRK-3: latest cert expiring soon.
      { asset_no: 'TRK-3', result: 'pass', test_date: '2026-06-01', expiry_date: '2026-07-20' },
    ]
    const s = summariseEmissions(rows, NOW)
    expect(s.expiredCount).toBe(1)
    expect(s.expiringSoonCount).toBe(1)
  })
})
