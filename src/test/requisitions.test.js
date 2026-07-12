import { describe, it, expect } from 'vitest'
import { summarizeRequisitions, REQUISITION_STATUS_ORDER } from '../lib/requisitions'

describe('summarizeRequisitions', () => {
  it('returns zeroed summary for empty / non-array input', () => {
    for (const input of [[], undefined, null, 'nope', 42]) {
      const s = summarizeRequisitions(input)
      expect(s.total).toBe(0)
      expect(s.pending).toBe(0)
      expect(s.approved).toBe(0)
      expect(s.totalEstCost).toBe(0)
      expect(s.byStatus).toEqual({ draft: 0, submitted: 0, approved: 0, rejected: 0, ordered: 0 })
    }
  })

  it('counts rows by status', () => {
    const rows = [
      { status: 'draft' },
      { status: 'submitted' },
      { status: 'submitted' },
      { status: 'approved' },
      { status: 'rejected' },
      { status: 'ordered' },
    ]
    const s = summarizeRequisitions(rows)
    expect(s.total).toBe(6)
    expect(s.byStatus).toEqual({ draft: 1, submitted: 2, approved: 1, rejected: 1, ordered: 1 })
  })

  it('treats draft + submitted as pending approval', () => {
    const rows = [
      { status: 'draft' },
      { status: 'submitted' },
      { status: 'approved' },
      { status: 'ordered' },
    ]
    const s = summarizeRequisitions(rows)
    expect(s.pending).toBe(2)
    expect(s.approved).toBe(1)
  })

  it('sums estimated cost across all rows, coercing strings and ignoring junk', () => {
    const rows = [
      { status: 'draft', est_cost: 100 },
      { status: 'submitted', est_cost: '250.5' },
      { status: 'approved', est_cost: null },
      { status: 'ordered', est_cost: 'abc' },
      { status: 'rejected' },
    ]
    const s = summarizeRequisitions(rows)
    expect(s.totalEstCost).toBe(350.5)
  })

  it('rounds total estimated cost to 2 decimals', () => {
    const rows = [
      { status: 'draft', est_cost: 0.1 },
      { status: 'draft', est_cost: 0.2 },
    ]
    const s = summarizeRequisitions(rows)
    expect(s.totalEstCost).toBe(0.3)
  })

  it('ignores unknown status values in byStatus but still counts them in total', () => {
    const rows = [
      { status: 'draft' },
      { status: 'weird' },
      {},
    ]
    const s = summarizeRequisitions(rows)
    expect(s.total).toBe(3)
    expect(s.byStatus.draft).toBe(1)
    expect(s.pending).toBe(1)
  })

  it('exposes the canonical lifecycle order', () => {
    expect(REQUISITION_STATUS_ORDER).toEqual(['draft', 'submitted', 'approved', 'rejected', 'ordered'])
  })
})
