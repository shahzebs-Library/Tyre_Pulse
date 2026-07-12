import { describe, it, expect } from 'vitest'
import {
  warrantyExpiry, batteryNeedsAttention, summarizeBatteries, HEALTH_ATTENTION_PCT,
} from '../lib/batteries'

describe('batteries — warrantyExpiry', () => {
  it('advances install_date by warranty_months', () => {
    const d = warrantyExpiry({ install_date: '2024-01-15', warranty_months: 24 })
    expect(d.toISOString().slice(0, 10)).toBe('2026-01-15')
  })

  it('handles a 12-month warranty', () => {
    const d = warrantyExpiry({ install_date: '2025-07-01', warranty_months: 12 })
    expect(d.toISOString().slice(0, 10)).toBe('2026-07-01')
  })

  it('clamps to end-of-month when the day overflows', () => {
    // Jan 31 + 1 month has no Feb 31 -> clamp to last day of February.
    const d = warrantyExpiry({ install_date: '2025-01-31', warranty_months: 1 })
    expect(d.toISOString().slice(0, 10)).toBe('2025-02-28')
  })

  it('returns null when install_date or warranty_months is missing', () => {
    expect(warrantyExpiry({ install_date: null, warranty_months: 24 })).toBeNull()
    expect(warrantyExpiry({ install_date: '2024-01-15', warranty_months: null })).toBeNull()
    expect(warrantyExpiry({})).toBeNull()
  })

  it('returns null for an unparseable install_date', () => {
    expect(warrantyExpiry({ install_date: 'not-a-date', warranty_months: 12 })).toBeNull()
  })

  it('accepts a numeric string warranty term', () => {
    const d = warrantyExpiry({ install_date: '2024-01-15', warranty_months: '24' })
    expect(d.toISOString().slice(0, 10)).toBe('2026-01-15')
  })
})

describe('batteries — batteryNeedsAttention', () => {
  it('flags a battery whose status is weak or replace', () => {
    expect(batteryNeedsAttention({ status: 'weak', health_pct: 90 })).toBe(true)
    expect(batteryNeedsAttention({ status: 'replace', health_pct: 90 })).toBe(true)
  })

  it('flags a healthy-status battery below the health threshold', () => {
    expect(batteryNeedsAttention({ status: 'healthy', health_pct: 49 })).toBe(true)
    expect(batteryNeedsAttention({ status: 'healthy', health_pct: 0 })).toBe(true)
  })

  it('does not flag a healthy battery at or above the threshold', () => {
    expect(batteryNeedsAttention({ status: 'healthy', health_pct: 50 })).toBe(false)
    expect(batteryNeedsAttention({ status: 'healthy', health_pct: 95 })).toBe(false)
  })

  it('never flags a retired battery, even with low health', () => {
    expect(batteryNeedsAttention({ status: 'retired', health_pct: 10 })).toBe(false)
  })

  it('does not flag when health is absent and status is healthy', () => {
    expect(batteryNeedsAttention({ status: 'healthy', health_pct: null })).toBe(false)
    expect(batteryNeedsAttention({ status: 'healthy' })).toBe(false)
  })

  it('handles null / undefined input safely', () => {
    expect(batteryNeedsAttention(null)).toBe(false)
    expect(batteryNeedsAttention(undefined)).toBe(false)
  })

  it('uses a 50% attention threshold', () => {
    expect(HEALTH_ATTENTION_PCT).toBe(50)
  })
})

describe('batteries — summarizeBatteries', () => {
  const rows = [
    { id: '1', status: 'healthy', health_pct: 95 },
    { id: '2', status: 'healthy', health_pct: 40 }, // needs attention (low health)
    { id: '3', status: 'weak', health_pct: 70 },    // needs attention (status)
    { id: '4', status: 'replace', health_pct: 30 }, // needs attention
    { id: '5', status: 'retired', health_pct: 10 }, // NOT flagged (retired)
    { id: '6', status: 'healthy', health_pct: null }, // no health value
  ]

  it('counts batteries by status', () => {
    const s = summarizeBatteries(rows)
    expect(s.total).toBe(6)
    expect(s.byStatus).toEqual({ healthy: 3, weak: 1, replace: 1, retired: 1 })
  })

  it('counts batteries needing attention', () => {
    const s = summarizeBatteries(rows)
    expect(s.needingAttention).toBe(3)
  })

  it('averages present health values, ignoring nulls', () => {
    const s = summarizeBatteries(rows)
    // (95 + 40 + 70 + 30 + 10) / 5 = 49
    expect(s.avgHealth).toBe(49)
  })

  it('rounds average health to one decimal place', () => {
    const s = summarizeBatteries([
      { status: 'healthy', health_pct: 90 },
      { status: 'healthy', health_pct: 85 },
      { status: 'healthy', health_pct: 81 },
    ])
    // (90 + 85 + 81) / 3 = 85.333... -> 85.3
    expect(s.avgHealth).toBe(85.3)
  })

  it('returns null average health when no rows carry a health value', () => {
    const s = summarizeBatteries([{ status: 'healthy' }, { status: 'weak' }])
    expect(s.avgHealth).toBeNull()
  })

  it('handles empty / non-array input safely', () => {
    expect(summarizeBatteries([]).total).toBe(0)
    expect(summarizeBatteries([]).avgHealth).toBeNull()
    expect(summarizeBatteries(null).total).toBe(0)
    expect(summarizeBatteries(undefined).byStatus).toEqual({ healthy: 0, weak: 0, replace: 0, retired: 0 })
  })
})
