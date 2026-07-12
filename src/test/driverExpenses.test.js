import { describe, it, expect } from 'vitest'
import { summarizeExpenses } from '../lib/driverExpenses'

describe('summarizeExpenses', () => {
  it('returns a zeroed structure for empty/undefined input', () => {
    expect(summarizeExpenses()).toEqual({
      total: 0,
      byStatus: { pending: 0, approved: 0, rejected: 0, reimbursed: 0 },
      totalAmount: 0,
      pendingAmount: 0,
      drivers: 0,
    })
    expect(summarizeExpenses([])).toEqual({
      total: 0,
      byStatus: { pending: 0, approved: 0, rejected: 0, reimbursed: 0 },
      totalAmount: 0,
      pendingAmount: 0,
      drivers: 0,
    })
  })

  it('counts claims by status and totals the amount', () => {
    const rows = [
      { status: 'pending', amount: 100, driver_name: 'Ali' },
      { status: 'approved', amount: 250, driver_name: 'Sara' },
      { status: 'rejected', amount: 40, driver_name: 'Ali' },
      { status: 'reimbursed', amount: 60, driver_name: 'Omar' },
    ]
    const s = summarizeExpenses(rows)
    expect(s.total).toBe(4)
    expect(s.byStatus).toEqual({ pending: 1, approved: 1, rejected: 1, reimbursed: 1 })
    expect(s.totalAmount).toBe(450)
  })

  it('tracks the pending-only amount separately', () => {
    const rows = [
      { status: 'pending', amount: 100 },
      { status: 'pending', amount: 50 },
      { status: 'approved', amount: 300 },
    ]
    const s = summarizeExpenses(rows)
    expect(s.pendingAmount).toBe(150)
    expect(s.totalAmount).toBe(450)
    expect(s.byStatus.pending).toBe(2)
  })

  it('counts distinct drivers case-insensitively, ignoring blanks', () => {
    const rows = [
      { status: 'pending', amount: 10, driver_name: 'Ali' },
      { status: 'approved', amount: 10, driver_name: 'ali' },
      { status: 'approved', amount: 10, driver_name: 'Sara' },
      { status: 'approved', amount: 10, driver_name: '   ' },
      { status: 'approved', amount: 10 },
    ]
    expect(summarizeExpenses(rows).drivers).toBe(2)
  })

  it('coerces string/invalid amounts and ignores unknown statuses safely', () => {
    const rows = [
      { status: 'pending', amount: '100.5', driver_name: 'A' },
      { status: 'approved', amount: 'not-a-number', driver_name: 'B' },
      { status: 'weird', amount: 20, driver_name: 'C' },
      { status: 'pending', amount: null, driver_name: 'D' },
    ]
    const s = summarizeExpenses(rows)
    expect(s.totalAmount).toBe(120.5)
    expect(s.pendingAmount).toBe(100.5)
    expect(s.byStatus).toEqual({ pending: 2, approved: 1, rejected: 0, reimbursed: 0 })
    expect(s.total).toBe(4)
    expect(s.drivers).toBe(4)
  })
})
