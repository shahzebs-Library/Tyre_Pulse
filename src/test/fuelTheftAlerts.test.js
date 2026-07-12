import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber, estimatedLoss, summariseAlerts, byAsset,
} from '../lib/fuelTheftAlerts'

describe('toFiniteNumber', () => {
  it('parses numbers and numeric strings, strips symbols', () => {
    expect(toFiniteNumber(12.5)).toBe(12.5)
    expect(toFiniteNumber('120')).toBe(120)
    expect(toFiniteNumber('SAR 1,200')).toBe(1200)
  })

  it('returns null for blank/nullish/non-numeric', () => {
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('estimatedLoss', () => {
  it('derives drop_litres × fuel_price_per_litre when both present', () => {
    expect(estimatedLoss({ drop_litres: 100, fuel_price_per_litre: 2.5 })).toBe(250)
  })

  it('prefers the derived figure over a stored estimated_loss', () => {
    expect(estimatedLoss({ drop_litres: 100, fuel_price_per_litre: 2, estimated_loss: 999 })).toBe(200)
  })

  it('falls back to stored estimated_loss when drivers are incomplete', () => {
    expect(estimatedLoss({ drop_litres: 100, estimated_loss: 300 })).toBe(300)
    expect(estimatedLoss({ fuel_price_per_litre: 2.5, estimated_loss: 300 })).toBe(300)
  })

  it('returns null when nothing is derivable', () => {
    expect(estimatedLoss({})).toBeNull()
    expect(estimatedLoss(null)).toBeNull()
  })

  it('treats a zero drop with a price as a derived zero loss', () => {
    expect(estimatedLoss({ drop_litres: 0, fuel_price_per_litre: 2.5, estimated_loss: 99 })).toBe(0)
  })
})

describe('summariseAlerts', () => {
  const rows = [
    { asset_no: 'A1', status: 'open', severity: 'critical', drop_litres: 100, fuel_price_per_litre: 2 }, // loss 200, open, critical
    { asset_no: 'A1', status: 'confirmed', severity: 'high', estimated_loss: 50 },                        // loss 50, open, confirmed
    { asset_no: 'A2', status: 'resolved', severity: 'critical', estimated_loss: 500 },                    // loss 500, closed
    { asset_no: 'A2', status: 'dismissed', severity: 'low' },                                             // no loss, closed
    { asset_no: 'A3', status: 'investigating', severity: 'critical', drop_litres: 10, fuel_price_per_litre: 3 }, // loss 30, open, critical
  ]

  it('counts totals, open, critical-open, confirmed and sums loss', () => {
    const s = summariseAlerts(rows)
    expect(s.totalAlerts).toBe(5)
    expect(s.openCount).toBe(3) // open, confirmed, investigating
    expect(s.criticalOpenCount).toBe(2) // A1 critical-open + A3 critical-open (A2 resolved excluded)
    expect(s.confirmedCount).toBe(1)
    expect(s.totalEstimatedLoss).toBe(200 + 50 + 500 + 30)
  })

  it('is safe on empty/invalid input', () => {
    expect(summariseAlerts([])).toEqual({
      totalAlerts: 0, openCount: 0, criticalOpenCount: 0, totalEstimatedLoss: 0, confirmedCount: 0,
    })
    expect(summariseAlerts(null).totalAlerts).toBe(0)
  })
})

describe('byAsset', () => {
  const rows = [
    { asset_no: 'A1', drop_litres: 100, fuel_price_per_litre: 2 }, // 200
    { asset_no: 'A1', estimated_loss: 50 },                        // 50
    { asset_no: 'A2', estimated_loss: 500 },                       // 500
    { asset_no: '', estimated_loss: 9 },                           // ignored (no asset)
  ]

  it('rolls up alert count and loss per asset, sorted by loss desc', () => {
    const out = byAsset(rows)
    expect(out).toEqual([
      { asset_no: 'A2', alerts: 1, loss: 500 },
      { asset_no: 'A1', alerts: 2, loss: 250 },
    ])
  })

  it('ignores rows without an asset number and handles empty input', () => {
    expect(byAsset([])).toEqual([])
    expect(byAsset([{ estimated_loss: 5 }])).toEqual([])
  })

  it('breaks equal-loss ties by alert count descending', () => {
    const out = byAsset([
      { asset_no: 'X', estimated_loss: 100 },
      { asset_no: 'Y', estimated_loss: 50 },
      { asset_no: 'Y', estimated_loss: 50 },
    ])
    expect(out.map((e) => e.asset_no)).toEqual(['Y', 'X'])
    expect(out[0]).toEqual({ asset_no: 'Y', alerts: 2, loss: 100 })
  })
})
