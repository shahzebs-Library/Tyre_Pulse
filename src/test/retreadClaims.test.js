import { describe, it, expect } from 'vitest'
import {
  summarizeRetreadClaims, RETREAD_CLAIM_STATUSES, OPEN_RETREAD_CLAIM_STATUSES,
} from '../lib/retreadClaims'

describe('retreadClaims - summarizeRetreadClaims', () => {
  it('returns a zeroed summary for an empty list', () => {
    const s = summarizeRetreadClaims([])
    expect(s.total).toBe(0)
    expect(s.openCount).toBe(0)
    expect(s.totalCost).toBe(0)
    expect(s.totalRecovered).toBe(0)
    expect(s.recoveryRate).toBe(0)
    for (const st of RETREAD_CLAIM_STATUSES) expect(s.byStatus[st]).toBe(0)
  })

  it('tolerates non-array input', () => {
    const s = summarizeRetreadClaims(null)
    expect(s.total).toBe(0)
    expect(s.recoveryRate).toBe(0)
  })

  it('counts claims by status', () => {
    const rows = [
      { status: 'open' }, { status: 'open' }, { status: 'submitted' },
      { status: 'approved' }, { status: 'rejected' }, { status: 'settled' },
      { status: 'unknown' }, {},
    ]
    const s = summarizeRetreadClaims(rows)
    expect(s.total).toBe(8)
    expect(s.byStatus.open).toBe(2)
    expect(s.byStatus.submitted).toBe(1)
    expect(s.byStatus.approved).toBe(1)
    expect(s.byStatus.rejected).toBe(1)
    expect(s.byStatus.settled).toBe(1)
    // unknown / missing statuses are ignored in byStatus
    expect(Object.values(s.byStatus).reduce((a, b) => a + b, 0)).toBe(6)
  })

  it('counts only live (open) statuses in openCount', () => {
    const rows = [
      { status: 'open' }, { status: 'submitted' }, { status: 'approved' },
      { status: 'rejected' }, { status: 'settled' },
    ]
    const s = summarizeRetreadClaims(rows)
    expect(s.openCount).toBe(OPEN_RETREAD_CLAIM_STATUSES.length)
    expect(s.openCount).toBe(3)
  })

  it('sums cost and recovered, coercing numeric strings and ignoring junk', () => {
    const rows = [
      { cost: 1000, amount_recovered: 400 },
      { cost: '500.5', amount_recovered: '99.5' },
      { cost: null, amount_recovered: undefined },
      { cost: 'abc', amount_recovered: 'xyz' },
    ]
    const s = summarizeRetreadClaims(rows)
    expect(s.totalCost).toBe(1500.5)
    expect(s.totalRecovered).toBe(499.5)
  })

  it('computes recovery rate as recovered / cost rounded to a whole percent', () => {
    const s = summarizeRetreadClaims([
      { cost: 1000, amount_recovered: 250 },
      { cost: 1000, amount_recovered: 250 },
    ])
    expect(s.recoveryRate).toBe(25)
  })

  it('returns 0% recovery rate when total cost is 0 (no divide-by-zero)', () => {
    const s = summarizeRetreadClaims([{ cost: 0, amount_recovered: 100 }])
    expect(s.recoveryRate).toBe(0)
  })
})
