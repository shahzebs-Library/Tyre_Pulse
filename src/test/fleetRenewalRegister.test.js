import { describe, it, expect } from 'vitest'
import { filterRenewalPlans, renewalRegisterRows, renewalExportRows } from '../lib/fleetRenewalAnalytics'

const NOW = new Date('2026-07-18T12:00:00Z')
const ROWS = [
  { id: 1, asset_no: 'TRK-1', site: 'NHC', priority: 'high', status: 'planned', target_replace_date: '2026-06-01', est_cost: 100 },
  { id: 2, asset_no: 'TRK-2', site: 'DHAHBAN', priority: 'low', status: 'approved', target_replace_date: '2026-09-01' },
  { id: 3, asset_no: 'TRK-3', priority: 'medium', status: 'completed', target_replace_date: '2026-05-01' },
  { id: 4, asset_no: 'TRK-4', priority: 'medium', status: 'planned', target_replace_date: null, notes: 'EV swap' },
]

describe('fleetRenewal register helpers', () => {
  it('filters by status, site, search and date window', () => {
    expect(filterRenewalPlans(ROWS, { status: 'planned' }, NOW).map((r) => r.id)).toEqual([1, 4])
    expect(filterRenewalPlans(ROWS, { site: 'NHC' }, NOW).map((r) => r.id)).toEqual([1])
    expect(filterRenewalPlans(ROWS, { search: 'ev' }, NOW).map((r) => r.id)).toEqual([4])
    // An undated plan cannot fall inside a dated window.
    expect(filterRenewalPlans(ROWS, { from: '2026-05-15' }, NOW).map((r) => r.id)).toEqual([1, 2])
  })

  it('overdue-only keeps open plans past target, never completed ones', () => {
    expect(filterRenewalPlans(ROWS, { overdueOnly: true }, NOW).map((r) => r.id)).toEqual([1])
  })

  it('orders soonest first and flags overdue rows', () => {
    const reg = renewalRegisterRows(ROWS, NOW)
    expect(reg[reg.length - 1].id).toBe(4)
    expect(reg.find((r) => r.id === 1).isOverdue).toBe(true)
    expect(reg.find((r) => r.id === 3).isOverdue).toBe(false)
    expect(reg.find((r) => r.id === 2).costValue).toBeNull()
  })

  it('exports blanks for unknown numbers and labels for tokens', () => {
    const x = renewalExportRows(ROWS, NOW)
    const two = x.find((r) => r.asset_no === 'TRK-2')
    expect(two).toMatchObject({ est_cost: '', priority: 'Low', status: 'Approved' })
    expect(x.find((r) => r.asset_no === 'TRK-4').days_to_target).toBe('')
  })
})
