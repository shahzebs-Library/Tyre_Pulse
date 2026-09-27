import { describe, it, expect } from 'vitest'
import {
  inDateRange, moneyComparable, filterBoardRecords, assetRanking, removedRegister,
  filterOptions, assetExportRows, removedExportRows, ASSET_EXPORT_COLS, REMOVED_EXPORT_COLS,
} from '../lib/tyreFailureCpkBoardAnalytics'

const rows = [
  { id: 1, serial_no: 'S1', asset_no: 'a1', brand: 'Michelin', site: 'NHC', status: 'Removed', issue_date: '2026-01-10', km_at_fitment: 1000, km_at_removal: 51000, cost_per_tyre: 1000, removal_reason: 'Puncture', removal_date: '2026-06-01' },
  { id: 2, serial_no: 'S2', asset_no: 'A1', brand: 'Michelin', site: 'NHC', status: 'Active', issue_date: '2026-03-10', km_at_fitment: 0, cost_per_tyre: 900 },
  { id: 3, serial_no: 'S3', asset_no: 'A2', brand: 'Pirelli', site: 'JED', status: 'Removed', issue_date: '2025-05-01', km_at_fitment: 2000, km_at_removal: 22000, cost_per_tyre: 1200, removal_reason: 'MICHELIN' },
  { id: 4, serial_no: 'S4', asset_no: 'A3', brand: 'Pirelli', site: 'JED', status: 'removed', issue_date: null },
]

describe('tyreFailureCpkBoardAnalytics', () => {
  it('applies a string-safe date window', () => {
    expect(inDateRange('2026-01-10T00:00:00Z', '2026-01-01', '2026-01-31')).toBe(true)
    expect(inDateRange(null, '', '')).toBe(true)
    expect(inDateRange(null, '2026-01-01', '')).toBe(false)
  })

  it('only allows money on a single-country scope', () => {
    expect(moneyComparable('KSA')).toBe(true)
    expect(moneyComparable('All')).toBe(false)
    expect(moneyComparable('')).toBe(false)
  })

  it('filters by site, brand, status, date and search', () => {
    expect(filterBoardRecords(rows, { site: 'JED' }).map((r) => r.id)).toEqual([3, 4])
    expect(filterBoardRecords(rows, { status: 'removed' }).map((r) => r.id)).toEqual([1, 3, 4])
    expect(filterBoardRecords(rows, { from: '2026-01-01' }).map((r) => r.id)).toEqual([1, 2])
    expect(filterBoardRecords(rows, { search: 'puncture' }).map((r) => r.id)).toEqual([1])
    expect(filterOptions(rows)).toEqual({ sites: ['JED', 'NHC'], brands: ['Michelin', 'Pirelli'] })
  })

  it('ranks every measurable asset worst first and reconciles cost to the grid', () => {
    const grid = new Map([['A2', 5000]])
    const r = assetRanking(rows, grid)
    expect(r.map((a) => a.asset_no)).toEqual(['A2', 'a1'])
    expect(r[0]).toMatchObject({ totalCost: 5000, costSource: 'Expense grid' })
    expect(r[1]).toMatchObject({ costSource: 'Tyre records', count: 1 })
    expect(r[0].avgCpk).toBeCloseTo(0.06, 5)
  })

  it('lists removed tyres with life and CPK, N/A when unmeasurable', () => {
    const reg = removedRegister(rows)
    expect(reg.map((r) => r.id)).toEqual([1, 3, 4])
    expect(reg[0]).toMatchObject({ lifeKm: 50000, reason: 'Puncture' })
    expect(reg[0].cpk).toBeCloseTo(0.02, 5)
    // a brand in the reason field is not a reason
    expect(reg[1].reason).toBeNull()
    expect(reg[2]).toMatchObject({ lifeKm: null, cpk: null })
  })

  it('blanks money in exports when currencies are mixed', () => {
    const a = assetExportRows(assetRanking(rows), { money: false })
    expect(Object.keys(a[0])).toEqual(ASSET_EXPORT_COLS)
    expect(a[0].avgCpk).toBe('N/A')
    expect(a[0].totalCost).toBe('N/A')
    const r = removedExportRows(removedRegister(rows))
    expect(Object.keys(r[0])).toEqual(REMOVED_EXPORT_COLS)
    expect(r[2].lifeKm).toBe('N/A')
    expect(r[0].cpk).toBe(0.02)
  })
})
