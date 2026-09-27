import { describe, it, expect } from 'vitest'
import {
  downDaysLabel, returnLabel, activeBreakdownFilterCount, breakdownRegisterRows,
  breakdownSiteOptions, siteBars, overdueShare, NOT_RECORDED,
} from '../lib/assetBreakdownsAnalytics'
import { EMPTY_BREAKDOWN_FILTERS } from '../lib/assetBreakdowns'

const NOW = Date.parse('2026-09-27T10:00:00Z')

const ROWS = [
  { id: 'a', asset_no: 'TM1', site: 'NHC', reported_on: '2026-09-20', expected_return: '2026-09-25', repair_location: 'Out' },
  { id: 'b', asset_no: 'TM2', site: 'JED', reported_on: '2026-06-01', expected_return: '2026-10-10' },
  { id: 'c', asset_no: 'TM3', site: 'NHC' }, // no dates and no sheet figure: unmeasurable
  { id: 'd', asset_no: 'TM4', reported_on: '2026-09-01', returned_to_service: true, returned_on: '2026-09-05', expected_return: '2026-09-02' },
]

describe('assetBreakdownsAnalytics', () => {
  it('labels unmeasurable downtime as Not recorded, never 0 days', () => {
    expect(downDaysLabel(null)).toBe(NOT_RECORDED)
    expect(downDaysLabel(undefined)).toBe(NOT_RECORDED)
    expect(downDaysLabel(0)).toBe('0 days')
    expect(downDaysLabel(1)).toBe('1 day')
  })

  it('describes the promised return date in words', () => {
    expect(returnLabel(null)).toBeNull()
    expect(returnLabel(-2)).toBe('2 days late')
    expect(returnLabel(0)).toBe('due today')
    expect(returnLabel(1)).toBe('in 1 day')
  })

  it('sorts longest down first with unmeasurable rows last, and flags overdue', () => {
    const out = breakdownRegisterRows(ROWS, NOW)
    expect(out.map((r) => r.id)).toEqual(['b', 'a', 'd', 'c'])
    const a = out.find((r) => r.id === 'a')
    expect(a).toMatchObject({ _overdue: true, _state: 'Past promised date', _repairLabel: expect.any(String) })
    expect(a._returnLabel).toMatch(/late/)
    const c = out.find((r) => r.id === 'c')
    expect(c._down).toBeNull()
    expect(c._downLabel).toBe(NOT_RECORDED)
  })

  it('only closes a breakdown on a recorded return, never on the promised date passing', () => {
    const d = breakdownRegisterRows(ROWS, NOW).find((r) => r.id === 'd')
    expect(d._state).toBe('Back in service')
    expect(d._overdue).toBe(false)
    expect(d._returnLabel).toBeNull()
    expect(d._down).toBe(4)
  })

  it('counts filters relative to the open-by-default view', () => {
    expect(activeBreakdownFilterCount(EMPTY_BREAKDOWN_FILTERS)).toBe(0)
    expect(activeBreakdownFilterCount({ state: 'all' })).toBe(1)
    expect(activeBreakdownFilterCount({ state: 'open', site: 'NHC', search: 'x' })).toBe(2)
  })

  it('builds site options and scaled site bars', () => {
    expect(breakdownSiteOptions(ROWS)).toEqual(['JED', 'NHC'])
    const bars = siteBars([{ key: 'NHC', count: 2, days: 100 }, { key: 'JED', count: 1, days: 25 }, { key: 'X', count: 1, days: 0 }])
    expect(bars.map((b) => b.widthPct)).toEqual([100, 25, 3])
  })

  it('reports the overdue share as null when nothing is down', () => {
    expect(overdueShare(null)).toBeNull()
    expect(overdueShare({ open: 0, overdue: 0 })).toBeNull()
    expect(overdueShare({ open: 4, overdue: 1 })).toBe(25)
  })
})
