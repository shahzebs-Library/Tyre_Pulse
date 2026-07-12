import { describe, it, expect } from 'vitest'
import { claimAgeDays, summarizeClaims } from '../lib/insuranceClaims'

const NOW = new Date('2026-07-12T00:00:00Z')

describe('insuranceClaims - claimAgeDays', () => {
  it('measures whole days from the incident date', () => {
    expect(claimAgeDays({ incident_date: '2026-07-02' }, NOW)).toBe(10)
  })

  it('falls back to claim_date when no incident_date', () => {
    expect(claimAgeDays({ claim_date: '2026-07-05' }, NOW)).toBe(7)
  })

  it('prefers incident_date over claim_date', () => {
    expect(claimAgeDays({ incident_date: '2026-07-01', claim_date: '2026-07-11' }, NOW)).toBe(11)
  })

  it('returns null when there is no usable date', () => {
    expect(claimAgeDays({}, NOW)).toBeNull()
    expect(claimAgeDays({ incident_date: 'not-a-date' }, NOW)).toBeNull()
  })

  it('never returns a negative age for future incidents', () => {
    expect(claimAgeDays({ incident_date: '2026-08-01' }, NOW)).toBe(0)
  })

  it('accepts a millisecond timestamp for now', () => {
    expect(claimAgeDays({ incident_date: '2026-07-02' }, NOW.getTime())).toBe(10)
  })
})

describe('insuranceClaims - summarizeClaims', () => {
  it('handles an empty list deterministically', () => {
    const s = summarizeClaims([])
    expect(s.total).toBe(0)
    expect(s.totalClaimed).toBe(0)
    expect(s.totalSettled).toBe(0)
    expect(s.recoveryRate).toBe(0)
    expect(s.openCount).toBe(0)
    expect(s.byStatus.open).toBe(0)
  })

  it('counts by status and tallies open claims', () => {
    const rows = [
      { status: 'open', amount_claimed: 1000, amount_settled: 0 },
      { status: 'under_review', amount_claimed: 2000, amount_settled: 0 },
      { status: 'settled', amount_claimed: 3000, amount_settled: 2400 },
      { status: 'closed', amount_claimed: 1000, amount_settled: 600 },
    ]
    const s = summarizeClaims(rows)
    expect(s.total).toBe(4)
    expect(s.byStatus.open).toBe(1)
    expect(s.byStatus.under_review).toBe(1)
    expect(s.byStatus.settled).toBe(1)
    expect(s.byStatus.closed).toBe(1)
    expect(s.openCount).toBe(2) // open + under_review
  })

  it('sums claimed / settled and computes recovery rate %', () => {
    const rows = [
      { status: 'settled', amount_claimed: 10000, amount_settled: 7000 },
      { status: 'settled', amount_claimed: 10000, amount_settled: 3000 },
    ]
    const s = summarizeClaims(rows)
    expect(s.totalClaimed).toBe(20000)
    expect(s.totalSettled).toBe(10000)
    expect(s.recoveryRate).toBe(50)
  })

  it('coerces string amounts and ignores non-numeric values', () => {
    const rows = [
      { status: 'settled', amount_claimed: '5000', amount_settled: '2500' },
      { status: 'open', amount_claimed: null, amount_settled: undefined },
    ]
    const s = summarizeClaims(rows)
    expect(s.totalClaimed).toBe(5000)
    expect(s.totalSettled).toBe(2500)
    expect(s.recoveryRate).toBe(50)
  })

  it('recovery rate is 0 when nothing has been claimed', () => {
    const s = summarizeClaims([{ status: 'open', amount_claimed: 0, amount_settled: 0 }])
    expect(s.recoveryRate).toBe(0)
  })
})
