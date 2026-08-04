import { describe, it, expect } from 'vitest'
import {
  forecastTyreDemand, forecastTableRows, nextMonthKey, prevMonthKey,
  monthRange, monthShort, MIN_TREND_MONTHS, DEFAULT_AHEAD,
} from '../lib/tyreDemandForecast'

const rec = (size, issue_date, qty = 1) => ({ size, issue_date, qty })

describe('month helpers', () => {
  it('nextMonthKey rolls the year at December', () => {
    expect(nextMonthKey('2026-07')).toBe('2026-08')
    expect(nextMonthKey('2026-12')).toBe('2027-01')
    expect(nextMonthKey('bad')).toBeNull()
  })
  it('prevMonthKey rolls the year at January', () => {
    expect(prevMonthKey('2026-01')).toBe('2025-12')
    expect(prevMonthKey('2026-08')).toBe('2026-07')
  })
  it('monthRange is inclusive and contiguous', () => {
    expect(monthRange('2026-05', '2026-08')).toEqual(['2026-05', '2026-06', '2026-07', '2026-08'])
    expect(monthRange('2026-08', '2026-05')).toEqual([])
  })
  it('monthShort formats YYYY-MM', () => {
    expect(monthShort('2026-07')).toBe('Jul 26')
  })
})

describe('forecastTyreDemand', () => {
  it('returns an empty, safe shape for no rows', () => {
    const fc = forecastTyreDemand([])
    expect(fc.sizes).toEqual([])
    expect(fc.totals.forecastTotal).toBe(0)
    expect(fc.months).toEqual([])
  })

  it('anchors the window to the latest data month and appends the horizon', () => {
    const rows = [rec('315/80R22.5', '2026-05-10'), rec('315/80R22.5', '2026-07-02')]
    const fc = forecastTyreDemand(rows, { window: 6, ahead: 3 })
    // Latest month is 2026-07; forecast months follow it contiguously.
    expect(fc.months[fc.months.length - 1]).toBe('2026-07')
    expect(fc.forecastMonths).toEqual(['2026-08', '2026-09', '2026-10'])
  })

  it('fills quiet months with real zeros (contiguous history)', () => {
    const rows = [rec('11R22.5', '2026-05-01', 2), rec('11R22.5', '2026-07-01', 4)]
    const fc = forecastTyreDemand(rows, { window: 3, ahead: 1 })
    const s = fc.sizes.find((x) => x.size === '11R22.5')
    // May=2, Jun=0, Jul=4 over the 3-month window ending Jul.
    expect(s.history).toEqual([2, 0, 4])
    expect(s.total).toBe(6)
  })

  it('uses a flat recent average (not a trend) when signal is thin', () => {
    // Only 2 non-zero months < MIN_TREND_MONTHS -> method 'average', flat >= 0.
    const rows = [rec('385/65R22.5', '2026-06-01', 3), rec('385/65R22.5', '2026-07-01', 3)]
    const fc = forecastTyreDemand(rows, { window: 6, ahead: 2 })
    const s = fc.sizes[0]
    expect(s.method).toBe('average')
    expect(s.confidence).toBe('low')
    expect(s.forecast.every((v) => v >= 0 && Number.isInteger(v))).toBe(true)
  })

  it('projects a rising trend upward and never below zero', () => {
    // 5 months of steady growth 1..5 -> a positive slope, trend method.
    const rows = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07']
      .flatMap((mk, i) => Array.from({ length: i + 1 }, () => rec('12.00R24', `${mk}-05`)))
    const fc = forecastTyreDemand(rows, { window: 6, ahead: 2 })
    const s = fc.sizes[0]
    expect(s.method).toBe('trend')
    expect(s.slopePerMonth).toBeGreaterThan(0)
    expect(s.forecast[0]).toBeGreaterThanOrEqual(5) // next month >= last observed
    expect(s.forecast.every((v) => v >= 0)).toBe(true)
    expect(s.confidence === 'medium' || s.confidence === 'high').toBe(true)
  })

  it('rounds forecasts to whole tyres', () => {
    const rows = ['2026-04', '2026-05', '2026-06', '2026-07']
      .flatMap((mk) => [rec('R1', `${mk}-01`), rec('R1', `${mk}-02`), rec('R1', `${mk}-03`)])
    const fc = forecastTyreDemand(rows, { window: 4, ahead: 3 })
    const s = fc.sizes[0]
    expect(s.forecast.every((v) => Number.isInteger(v))).toBe(true)
  })

  it('sorts sizes by forecast demand and totals reconcile', () => {
    const rows = [
      ...Array.from({ length: 10 }, () => rec('BIG', '2026-07-01')),
      rec('SMALL', '2026-07-01'),
    ]
    const fc = forecastTyreDemand(rows, { window: 3, ahead: 1 })
    expect(fc.sizes[0].size).toBe('BIG')
    const sumSizes = fc.sizes.reduce((a, s) => a + s.forecast[0], 0)
    expect(fc.totals.forecast[0]).toBe(sumSizes)
  })

  it('treats a missing/blank size as "UNKNOWN" and qty<=0 as 1', () => {
    const fc = forecastTyreDemand([{ issue_date: '2026-07-01', qty: 0 }], { window: 2, ahead: 1 })
    const s = fc.sizes[0]
    expect(s.size).toBe('UNKNOWN')
    expect(s.total).toBe(1)
  })

  it('merges the same size typed spaced and unspaced', () => {
    const rows = [
      ...Array.from({ length: 4 }, () => rec('315/80 R 22.5', '2026-07-01')),
      ...Array.from({ length: 6 }, () => rec('315/80R22.5', '2026-07-02')),
    ]
    const fc = forecastTyreDemand(rows, { window: 2, ahead: 1 })
    expect(fc.sizes).toHaveLength(1)
    expect(fc.sizes[0].size).toBe('315/80R22.5')
    expect(fc.sizes[0].total).toBe(10)
  })

  it('MIN_TREND_MONTHS and DEFAULT_AHEAD are exported sane', () => {
    expect(MIN_TREND_MONTHS).toBeGreaterThanOrEqual(3)
    expect(DEFAULT_AHEAD).toBeGreaterThanOrEqual(1)
  })
})

describe('forecastTableRows', () => {
  it('emits one honest row per size', () => {
    const rows = ['2026-04', '2026-05', '2026-06', '2026-07']
      .flatMap((mk) => [rec('11R22.5', `${mk}-01`), rec('11R22.5', `${mk}-15`)])
    const fc = forecastTyreDemand(rows, { window: 4, ahead: 3 })
    const t = forecastTableRows(fc)
    expect(t).toHaveLength(1)
    expect(t[0].size).toBe('11R22.5')
    expect(Array.isArray(t[0].forecast)).toBe(true)
    expect(['Rising', 'Falling', 'Flat', 'Flat (avg)']).toContain(t[0].trend)
  })
  it('is safe on null', () => {
    expect(forecastTableRows(null)).toEqual([])
  })
})
