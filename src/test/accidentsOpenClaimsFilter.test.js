import { describe, it, expect } from 'vitest'
import { hasClaim, isClosed as isClaimClosed } from '../lib/claimsAnalytics'

// Mirrors the register's "Open claims only" predicate in src/pages/Accidents.jsx.
// Kept in lockstep with the single claims engine (hasClaim + isClosed) so the
// quick-filter, the ?claims=open link and the Claims Summary dashboard agree.
const isOpenClaim = (r) => hasClaim(r) && !isClaimClosed(r)

describe('Accidents register — "Open claims only" filter predicate', () => {
  it('keeps an incident with a live claim that is not yet closed', () => {
    expect(isOpenClaim({ claim_amount: 15000, claim_status: 'filed' })).toBe(true)
    expect(isOpenClaim({ insurer: 'Gulf Insurance', claim_status: 'under_review' })).toBe(true)
    expect(isOpenClaim({ status: 'Insurance Claim' })).toBe(true)
  })

  it('drops incidents that carry no claim at all', () => {
    expect(isOpenClaim({ severity: 'Minor', status: 'Reported' })).toBe(false)
    expect(isOpenClaim({ repair_cost: 500 })).toBe(false)
  })

  it('drops claims that have reached a terminal state', () => {
    expect(isOpenClaim({ claim_amount: 1000, claim_status: 'settled' })).toBe(false)
    expect(isOpenClaim({ claim_amount: 1000, claim_status: 'rejected' })).toBe(false)
    expect(isOpenClaim({ claim_amount: 1000, insurer: 'X', release_date: '2026-06-01' })).toBe(false)
    expect(isOpenClaim({ claim_amount: 1000, insurer: 'X', closure_status: 'closed' })).toBe(false)
  })

  it('filters a mixed register down to only the open claims', () => {
    const rows = [
      { id: 1, claim_amount: 1000, claim_status: 'filed' },          // open claim
      { id: 2, claim_amount: 2000, claim_status: 'settled' },        // closed claim
      { id: 3, status: 'Reported' },                                 // no claim
      { id: 4, insurer: 'Acme', release_date: '2026-01-01' },        // closed claim
      { id: 5, claim_approved_amount: 500, claim_status: 'open' },   // open claim
    ]
    expect(rows.filter(isOpenClaim).map(r => r.id)).toEqual([1, 5])
  })
})
