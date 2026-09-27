import { describe, it, expect } from 'vitest'
import {
  lineValue, dueBand, summarizeRequisitionRegister, filterRequisitions, DUE_SOON_DAYS,
} from '../lib/requisitionsAnalytics'

const NOW = new Date(2026, 8, 27, 10, 0, 0).getTime() // 27 Sep 2026 local

describe('lineValue', () => {
  it('multiplies quantity by unit cost', () => {
    expect(lineValue({ quantity: 4, est_cost: 250.5 })).toBe(1002)
    expect(lineValue({ quantity: '2', est_cost: '10' })).toBe(20)
  })
  it('is null, never 0, when either side is missing', () => {
    expect(lineValue({ quantity: 4 })).toBeNull()
    expect(lineValue({ est_cost: 10 })).toBeNull()
    expect(lineValue({ quantity: '', est_cost: 10 })).toBeNull()
    expect(lineValue({ quantity: 'x', est_cost: 10 })).toBeNull()
  })
  it('keeps a real zero', () => {
    expect(lineValue({ quantity: 0, est_cost: 10 })).toBe(0)
  })
})

describe('dueBand', () => {
  it('bands open requests by needed-by', () => {
    expect(dueBand({ status: 'submitted', needed_by: '2026-09-26' }, NOW)).toBe('overdue')
    expect(dueBand({ status: 'draft', needed_by: '2026-09-27' }, NOW)).toBe('due_soon')
    expect(dueBand({ status: 'draft', needed_by: '2026-10-11' }, NOW)).toBe('due_soon')
    expect(dueBand({ status: 'draft', needed_by: '2026-10-12' }, NOW)).toBe('later')
    expect(DUE_SOON_DAYS).toBe(14)
  })
  it('ignores dates on closed requests and admits missing dates', () => {
    expect(dueBand({ status: 'ordered', needed_by: '2020-01-01' }, NOW)).toBe('closed')
    expect(dueBand({ status: 'rejected', needed_by: '2020-01-01' }, NOW)).toBe('closed')
    expect(dueBand({ status: 'draft' }, NOW)).toBe('none')
    expect(dueBand({ status: 'draft', needed_by: 'not a date' }, NOW)).toBe('none')
  })
})

describe('summarizeRequisitionRegister', () => {
  const rows = [
    { status: 'draft', category: 'tyres', quantity: 4, est_cost: 100, requester: 'Ali', needed_by: '2026-09-01' },
    { status: 'submitted', category: 'tyres', quantity: 2, est_cost: 50, requester: 'ali ', needed_by: '2026-09-30' },
    { status: 'approved', category: 'tools', quantity: 1, requester: 'Omar' },
    { status: 'ordered', category: 'tools', quantity: 1, est_cost: 30 },
    { status: 'rejected', category: 'tyres' },
  ]
  it('reuses the status counts and adds due and value figures', () => {
    const s = summarizeRequisitionRegister(rows, NOW)
    expect(s.total).toBe(5)
    expect(s.pending).toBe(2)
    expect(s.overdue).toBe(1)
    expect(s.dueSoon).toBe(1)
    expect(s.requesters).toBe(2)
    expect(s.valued).toBe(3)
    expect(s.unvalued).toBe(2)
    expect(s.totalValue).toBe(530)
    expect(s.openValue).toBe(500)
    // approved + ordered of approved + ordered + rejected
    expect(s.approvalRate).toBeCloseTo(66.7, 1)
    expect(s.byCategory[0]).toMatchObject({ key: 'tyres', count: 3, value: 500 })
  })
  it('reports N/A (null) values for an empty or unpriced register', () => {
    const empty = summarizeRequisitionRegister([], NOW)
    expect(empty.totalValue).toBeNull()
    expect(empty.approvalRate).toBeNull()
    const unpriced = summarizeRequisitionRegister([{ status: 'draft', category: 'x' }], NOW)
    expect(unpriced.totalValue).toBeNull()
    expect(unpriced.byCategory[0].value).toBeNull()
  })
})

describe('filterRequisitions', () => {
  const rows = [
    { id: 1, status: 'draft', category: 'tyres', site: 'NHC', item: 'Drive tyres', needed_by: '2026-09-01' },
    { id: 2, status: 'approved', category: 'tools', site: 'JED', item: 'Torque wrench' },
  ]
  it('applies every filter and search', () => {
    expect(filterRequisitions(rows, { status: 'draft' }, NOW).map(r => r.id)).toEqual([1])
    expect(filterRequisitions(rows, { category: 'tools' }, NOW).map(r => r.id)).toEqual([2])
    expect(filterRequisitions(rows, { site: 'JED' }, NOW).map(r => r.id)).toEqual([2])
    expect(filterRequisitions(rows, { due: 'overdue' }, NOW).map(r => r.id)).toEqual([1])
    expect(filterRequisitions(rows, { search: 'WRENCH' }, NOW).map(r => r.id)).toEqual([2])
    expect(filterRequisitions(rows, { status: 'all', due: 'all' }, NOW)).toHaveLength(2)
  })
})
