import { describe, it, expect } from 'vitest'
import {
  mobilityOfUnit, MOBILITY_META, CPK_PERIODS, DEFAULT_PERIOD,
  periodBounds, periodLabel, splitByMobility, fleetSideFor,
} from '../lib/cpkModule'

describe('mobilityOfUnit', () => {
  it('maps engine_hours to non_movable and everything else to movable', () => {
    expect(mobilityOfUnit('engine_hours')).toBe('non_movable')
    expect(mobilityOfUnit('km')).toBe('movable')
    expect(mobilityOfUnit(undefined)).toBe('movable')
    expect(mobilityOfUnit('anything')).toBe('movable')
  })
  it('MOBILITY_META carries the right unit per class', () => {
    expect(MOBILITY_META.movable.unit).toBe('km')
    expect(MOBILITY_META.non_movable.unit).toBe('engine_hours')
  })
})

describe('periodBounds', () => {
  const anchor = new Date(Date.UTC(2026, 6, 15)) // 2026-07-15

  it('defaults to the current month (first day to anchor day)', () => {
    const b = periodBounds(DEFAULT_PERIOD, anchor)
    expect(b.from).toBe('2026-07-01')
    expect(b.to).toBe('2026-07-15')
    expect(b.key).toBe('current_month')
  })

  it('last month spans the whole previous month', () => {
    const b = periodBounds('last_month', anchor)
    expect(b.from).toBe('2026-06-01')
    expect(b.to).toBe('2026-06-30')
  })

  it('last month rolls over the year at January', () => {
    const jan = new Date(Date.UTC(2026, 0, 10))
    const b = periodBounds('last_month', jan)
    expect(b.from).toBe('2025-12-01')
    expect(b.to).toBe('2025-12-31')
  })

  it('quarter starts at the quarter month', () => {
    const b = periodBounds('quarter', anchor) // Jul = Q3 -> starts Jul
    expect(b.from).toBe('2026-07-01')
    expect(b.to).toBe('2026-07-15')
  })

  it('ytd starts on Jan 1', () => {
    const b = periodBounds('ytd', anchor)
    expect(b.from).toBe('2026-01-01')
    expect(b.to).toBe('2026-07-15')
  })

  it('last_12m is a 365-day trailing window', () => {
    const b = periodBounds('last_12m', anchor)
    expect(b.to).toBe('2026-07-15')
    expect(b.from).toBe('2025-07-15')
  })

  it('unknown key falls back to current month', () => {
    const b = periodBounds('nonsense', anchor)
    expect(b.key).toBe('current_month')
    expect(b.from).toBe('2026-07-01')
  })

  it('week is the last completed Sun-Sat week (reported on Sunday)', () => {
    // 2026-07-19 is a Sunday; the week just ended is Sun 12 to Sat 18.
    const sunday = new Date(Date.UTC(2026, 6, 19))
    const wk = periodBounds('week', sunday)
    expect(wk.from).toBe('2026-07-12')
    expect(wk.to).toBe('2026-07-18')
    const prev = periodBounds('prev_week', sunday)
    expect(prev.from).toBe('2026-07-05')
    expect(prev.to).toBe('2026-07-11')
  })

  it('week from a mid-week anchor still ends on the previous Saturday', () => {
    // 2026-07-15 is a Wednesday; last completed week is Sun 5 to Sat 11.
    const wk = periodBounds('week', anchor)
    expect(wk.to).toBe('2026-07-11')
    expect(wk.from).toBe('2026-07-05')
    // Every week window is exactly 7 days (Sun..Sat inclusive).
    expect(new Date(wk.to) - new Date(wk.from)).toBe(6 * 24 * 3600 * 1000)
  })

  it('custom key with a valid range returns exactly that range', () => {
    const b = periodBounds('custom', anchor, { from: '2026-02-03', to: '2026-03-10' })
    expect(b.key).toBe('custom')
    expect(b.from).toBe('2026-02-03')
    expect(b.to).toBe('2026-03-10')
    expect(b.label).toBe('2026-02-03 to 2026-03-10')
  })

  it('custom key with a same-day range is valid', () => {
    const b = periodBounds('custom', anchor, { from: '2026-05-05', to: '2026-05-05' })
    expect(b.from).toBe('2026-05-05')
    expect(b.to).toBe('2026-05-05')
  })

  it('custom key with an incomplete range falls back to current month, key stays custom', () => {
    for (const custom of [null, {}, { from: '2026-02-03' }, { to: '2026-03-10' }, { from: 'garbage', to: '2026-03-10' }]) {
      const b = periodBounds('custom', anchor, custom)
      expect(b.key).toBe('custom')
      expect(b.from).toBe('2026-07-01')
      expect(b.to).toBe('2026-07-15')
      expect(b.label).toBe('Custom range (pick both dates)')
    }
  })

  it('custom key with a reversed range falls back to current month', () => {
    const b = periodBounds('custom', anchor, { from: '2026-03-10', to: '2026-02-03' })
    expect(b.key).toBe('custom')
    expect(b.from).toBe('2026-07-01')
    expect(b.to).toBe('2026-07-15')
    expect(b.label).toBe('Custom range (pick both dates)')
  })

  it('existing preset keys ignore the custom argument', () => {
    const b = periodBounds('last_month', anchor, { from: '2020-01-01', to: '2020-02-01' })
    expect(b.from).toBe('2026-06-01')
    expect(b.to).toBe('2026-06-30')
  })

  it('every preset resolves to valid ISO bounds', () => {
    for (const p of CPK_PERIODS) {
      const b = periodBounds(p.key, anchor)
      expect(b.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(b.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(b.from <= b.to).toBe(true)
    }
  })
})

describe('periodLabel', () => {
  it('formats a resolved bounds object', () => {
    const b = periodBounds('current_month', new Date(Date.UTC(2026, 6, 15)))
    expect(periodLabel(b)).toBe('This month (2026-07-01 to 2026-07-15)')
  })
  it('is safe on null', () => {
    expect(periodLabel(null)).toBe('')
  })
  it('does not print a valid custom range twice', () => {
    const b = periodBounds('custom', new Date(Date.UTC(2026, 6, 15)), { from: '2026-02-03', to: '2026-03-10' })
    expect(periodLabel(b)).toBe('Custom range (2026-02-03 to 2026-03-10)')
  })
})

describe('splitByMobility', () => {
  it('separates rows by unit; unknown -> movable', () => {
    const rows = [
      { asset_no: 'TM1', unit: 'km' },
      { asset_no: 'GEN1', unit: 'engine_hours' },
      { asset_no: 'X', unit: undefined },
    ]
    const out = splitByMobility(rows)
    expect(out.movable.map((r) => r.asset_no)).toEqual(['TM1', 'X'])
    expect(out.non_movable.map((r) => r.asset_no)).toEqual(['GEN1'])
  })
  it('is safe on non-arrays', () => {
    expect(splitByMobility(null)).toEqual({ movable: [], non_movable: [] })
  })
})

describe('fleetSideFor', () => {
  const fleetRow = {
    country: 'KSA', currency: 'SAR',
    km: { total_km: 1000, total_cost_matched: 500, tyre_cost_matched: 200, cpk_tyre: 0.2, cpk_total: 0.5, coverage_pct: 63 },
    hours: { total_hours: 0, total_cost_matched: 0, cpk_tyre: null, cpk_total: null, coverage_pct: 0 },
  }
  it('reads the km side for movable', () => {
    const s = fleetSideFor(fleetRow, 'movable')
    expect(s.unit).toBe('km')
    expect(s.distance).toBe(1000)
    expect(s.cpkTyre).toBe(0.2)
    expect(s.currency).toBe('SAR')
  })
  it('returns null for an empty side (no cost, no distance)', () => {
    expect(fleetSideFor(fleetRow, 'non_movable')).toBeNull()
  })
  it('is safe on null row', () => {
    expect(fleetSideFor(null, 'movable')).toBeNull()
  })
})
