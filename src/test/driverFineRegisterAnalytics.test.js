import { describe, it, expect } from 'vitest'
import {
  splitFinePage, summarizeFinePage, formatBalances, activeFineFilterCount, humanFineValue, FINE_PAGE_SIZE,
} from '../lib/driverFineRegisterAnalytics'

describe('driverFineRegisterAnalytics', () => {
  it('splits the look-ahead row off a page', () => {
    const rows = Array.from({ length: FINE_PAGE_SIZE + 1 }, (_, i) => ({ id: i }))
    const p = splitFinePage(rows)
    expect(p.visible).toHaveLength(FINE_PAGE_SIZE)
    expect(p.hasNext).toBe(true)
    expect(splitFinePage([{ id: 1 }]).hasNext).toBe(false)
  })

  it('summarises the page and never blends currencies', () => {
    const s = summarizeFinePage([
      { status: 'open', overdue: true, review_stage: 'supervisor', currency: 'SAR', balance: 500 },
      { status: 'open', review_stage: 'driver', currency: 'SAR', balance: '250.5' },
      { status: 'settled', review_stage: 'complete', currency: 'AED', balance: 0 },
      { status: 'open', review_stage: 'finance', currency: 'EGP', balance: null },
    ])
    expect(s).toMatchObject({ rows: 4, open: 3, overdue: 1, unpricedBalances: 1 })
    expect(s.byStage).toEqual({ driver: 1, supervisor: 1, finance: 1, complete: 1 })
    expect(s.balances).toEqual([{ currency: 'AED', amount: 0 }, { currency: 'SAR', amount: 750.5 }])
    expect(formatBalances(s.balances)).toBe('AED 0 | SAR 750.5')
  })

  it('reports N/A when no balance is recorded', () => {
    expect(formatBalances(summarizeFinePage([]).balances)).toBe('N/A')
  })

  it('counts active filters and humanises tokens', () => {
    expect(activeFineFilterCount({ search: ' x ', status: 'open', review_stage: '', overdue: true })).toBe(3)
    expect(humanFineValue('finance_approval')).toBe('finance approval')
    expect(humanFineValue(null)).toBe('not recorded')
  })
})
