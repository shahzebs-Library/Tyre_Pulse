import { describe, it, expect } from 'vitest'
import {
  singleCurrencyOf, headlineValue, categoryShare, docTypeShare, returnFlag,
  recentSlipRows, recentSlipCount, topItemRows, slipLineRows,
} from '../lib/storeMaterialIssueAnalytics'

describe('storeMaterialIssueAnalytics', () => {
  it('picks one currency or none', () => {
    expect(singleCurrencyOf({ byCurrency: { SAR: {} } }, 'KSA')).toBe('SAR')
    expect(singleCurrencyOf({ mixedCurrency: true, byCurrency: { SAR: {}, AED: {} } }, 'All')).toBeNull()
    expect(singleCurrencyOf({ byCurrency: {} }, 'UAE')).toBe('AED')
    expect(singleCurrencyOf({ byCurrency: {} }, 'All')).toBeNull()
    expect(singleCurrencyOf(null, 'KSA')).toBeNull()
  })

  it('headline money is null when unknown, never zero', () => {
    const s = { byCurrency: { SAR: { bookedValue: 1200, creditedValue: -300 } } }
    expect(headlineValue(s, 'SAR')).toBe(1200)
    expect(headlineValue(s, 'SAR', 'creditedValue')).toBe(-300)
    expect(headlineValue(s, 'AED')).toBeNull()
    expect(headlineValue(s, null)).toBeNull()
  })

  it('category split never adds one currency to another', () => {
    const slips = [
      { currency: 'SAR', lines: [{ tyre_cost: 100, spare_cost: 0, oil_cost: 0 }] },
      { currency: 'AED', lines: [{ tyre_cost: 900, spare_cost: 50, oil_cost: 0 }] },
    ]
    const sar = categoryShare(slips, { currency: 'SAR' })
    expect(sar.data).toEqual([{ name: 'Tyres', value: 100 }])
    expect(sar.slips).toBe(1)
    expect(categoryShare([], {}).unavailable).toBe(true)
  })

  it('doc type share drops empty slices', () => {
    expect(docTypeShare({ MIS: 3, MRT: 0, unknown: 1 })).toEqual([
      { name: 'Issues (MIS)', value: 3 }, { name: 'Unreadable number', value: 1 },
    ])
    expect(docTypeShare(null)).toEqual([])
  })

  it('return flag', () => {
    expect(returnFlag({ returnSignAnomaly: true })).toEqual({ label: 'Booked as a charge', anomaly: true })
    expect(returnFlag({}).anomaly).toBe(false)
  })

  it('recent slips shape and count with an injected clock', () => {
    const now = new Date('2026-09-26T00:00:00Z')
    const recent = [
      { id: 1, issue_number: 'GC/MIS/1', doc_type: 'MIS', issued_at: '2026-09-20T10:00:00Z', status: 'issued' },
      { id: 2, issue_number: null, doc_type: 'MRT', issued_at: null, status: 'issued' },
    ]
    const rows = recentSlipRows(recent)
    expect(rows[0]).toMatchObject({ id: 1, issueNumber: 'GC/MIS/1', issuedDay: '2026-09-20' })
    expect(rows[1].issuedDay).toBeNull()
    expect(recentSlipCount(recent, { now, days: 30 })).toBe(1)
  })

  it('row keys are stable and line currency falls back to the slip', () => {
    expect(topItemRows([{ key: 'X' }, { key: 'X' }]).map((r) => r.rowKey)).toEqual(['X-0', 'X-1'])
    const l = slipLineRows([{ id: 9 }, { currency: 'AED' }], 'SAR')
    expect(l[0]).toMatchObject({ rowKey: '9', currency: 'SAR' })
    expect(l[1]).toMatchObject({ rowKey: 'line-1', currency: 'AED' })
  })
})
