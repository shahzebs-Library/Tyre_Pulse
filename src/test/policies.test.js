import { describe, it, expect } from 'vitest'
import {
  policyReviewStatus,
  summarizePolicies,
  DEFAULT_REVIEW_HORIZON_DAYS,
} from '../lib/policies'

// Fixed reference clock so every assertion is deterministic.
const NOW = new Date('2026-07-12T00:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const daysFromNow = (n) => new Date(NOW.getTime() + n * DAY).toISOString().slice(0, 10)

describe('policyReviewStatus', () => {
  it('flags a policy with no review date as not due', () => {
    const r = policyReviewStatus({ status: 'active' }, NOW)
    expect(r.hasReviewDate).toBe(false)
    expect(r.dueForReview).toBe(false)
    expect(r.overdue).toBe(false)
    expect(r.daysUntilReview).toBeNull()
  })

  it('flags due-for-review when review_date is within the 30-day horizon', () => {
    const r = policyReviewStatus({ status: 'active', review_date: daysFromNow(10) }, NOW)
    expect(r.hasReviewDate).toBe(true)
    expect(r.dueForReview).toBe(true)
    expect(r.overdue).toBe(false)
    expect(r.daysUntilReview).toBe(10)
  })

  it('does not flag a policy reviewed comfortably in the future', () => {
    const r = policyReviewStatus({ status: 'active', review_date: daysFromNow(90) }, NOW)
    expect(r.dueForReview).toBe(false)
    expect(r.overdue).toBe(false)
    expect(r.daysUntilReview).toBe(90)
  })

  it('treats the horizon boundary (exactly +30d) as due', () => {
    const r = policyReviewStatus(
      { status: 'active', review_date: daysFromNow(DEFAULT_REVIEW_HORIZON_DAYS) },
      NOW,
    )
    expect(r.dueForReview).toBe(true)
  })

  it('marks a past review date as overdue and due', () => {
    const r = policyReviewStatus({ status: 'active', review_date: daysFromNow(-5) }, NOW)
    expect(r.dueForReview).toBe(true)
    expect(r.overdue).toBe(true)
    expect(r.daysUntilReview).toBe(-5)
  })

  it('never flags archived policies even when overdue', () => {
    const r = policyReviewStatus({ status: 'archived', review_date: daysFromNow(-40) }, NOW)
    expect(r.dueForReview).toBe(false)
    expect(r.overdue).toBe(false)
  })

  it('respects a custom horizon', () => {
    const p = { status: 'active', review_date: daysFromNow(20) }
    expect(policyReviewStatus(p, NOW, 10).dueForReview).toBe(false)
    expect(policyReviewStatus(p, NOW, 25).dueForReview).toBe(true)
  })
})

describe('summarizePolicies', () => {
  const rows = [
    { status: 'draft' },
    { status: 'active', review_date: daysFromNow(5) }, // due
    { status: 'active', review_date: daysFromNow(120) }, // not due
    { status: 'under_review', review_date: daysFromNow(-3) }, // due + overdue
    { status: 'archived', review_date: daysFromNow(-100) }, // ignored
    { status: 'archived' },
  ]

  it('counts by status', () => {
    const s = summarizePolicies(rows, NOW)
    expect(s.total).toBe(6)
    expect(s.byStatus).toEqual({ draft: 1, active: 2, under_review: 1, archived: 2 })
    expect(s.active).toBe(2)
    expect(s.archived).toBe(2)
  })

  it('counts due-for-review and overdue, excluding archived', () => {
    const s = summarizePolicies(rows, NOW)
    expect(s.dueForReview).toBe(2)
    expect(s.overdue).toBe(1)
  })

  it('is null-safe for non-array input', () => {
    const s = summarizePolicies(null, NOW)
    expect(s.total).toBe(0)
    expect(s.dueForReview).toBe(0)
    expect(s.byStatus).toEqual({ draft: 0, active: 0, under_review: 0, archived: 0 })
  })
})
