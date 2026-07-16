import { describe, it, expect } from 'vitest'
import {
  COST_MODES,
  pickCost,
  costModeLabel,
  pickMonthly,
  splitTotals,
} from './costSources'

const BANNED = /[—–→←‘’“”·]/

describe('COST_MODES', () => {
  it('exposes the exact three modes with clean labels', () => {
    expect(COST_MODES).toEqual([
      { key: 'combined', label: 'Combined' },
      { key: 'tyres', label: 'Tyres' },
      { key: 'maintenance', label: 'Maintenance' },
    ])
    for (const m of COST_MODES) expect(BANNED.test(m.label)).toBe(false)
  })
})

describe('pickCost', () => {
  const split = { tyre: 300, maintenance: 200 }
  it('picks per mode', () => {
    expect(pickCost('tyres', split)).toBe(300)
    expect(pickCost('maintenance', split)).toBe(200)
    expect(pickCost('combined', split)).toBe(500)
  })
  it('defaults unknown mode to combined', () => {
    expect(pickCost('other', split)).toBe(500)
    expect(pickCost(undefined, split)).toBe(500)
  })
  it('coerces non-finite values to 0', () => {
    expect(pickCost('combined', { tyre: NaN, maintenance: 200 })).toBe(200)
    expect(pickCost('tyres', { tyre: undefined })).toBe(0)
    expect(pickCost('combined', {})).toBe(0)
    expect(pickCost('maintenance', { maintenance: Infinity })).toBe(0)
  })
})

describe('costModeLabel', () => {
  it('returns the mode label, defaulting to Combined', () => {
    expect(costModeLabel('tyres')).toBe('Tyres')
    expect(costModeLabel('maintenance')).toBe('Maintenance')
    expect(costModeLabel('combined')).toBe('Combined')
    expect(costModeLabel('unknown')).toBe('Combined')
    expect(costModeLabel()).toBe('Combined')
  })
})

describe('pickMonthly', () => {
  const byMonth = [
    { month: '2026-05', tyre: 100, maintenance: 50 },
    { month: '2026-06', tyre: 200, maintenance: 80 },
  ]
  it('projects the series per mode', () => {
    expect(pickMonthly('tyres', byMonth)).toEqual([
      { month: '2026-05', value: 100 },
      { month: '2026-06', value: 200 },
    ])
    expect(pickMonthly('maintenance', byMonth)).toEqual([
      { month: '2026-05', value: 50 },
      { month: '2026-06', value: 80 },
    ])
    expect(pickMonthly('combined', byMonth)).toEqual([
      { month: '2026-05', value: 150 },
      { month: '2026-06', value: 280 },
    ])
  })
  it('handles a non-array input', () => {
    expect(pickMonthly('combined', null)).toEqual([])
  })
})

describe('splitTotals', () => {
  it('sums each axis and the combined total', () => {
    const byMonth = [
      { month: '2026-05', tyre: 100, maintenance: 50 },
      { month: '2026-06', tyre: 200, maintenance: 80 },
    ]
    expect(splitTotals(byMonth)).toEqual({ tyre: 300, maintenance: 130, combined: 430 })
  })
  it('coerces non-finite and handles empty', () => {
    expect(splitTotals([{ tyre: NaN, maintenance: 10 }])).toEqual({ tyre: 0, maintenance: 10, combined: 10 })
    expect(splitTotals([])).toEqual({ tyre: 0, maintenance: 0, combined: 0 })
    expect(splitTotals(null)).toEqual({ tyre: 0, maintenance: 0, combined: 0 })
  })
})
