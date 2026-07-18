import { describe, it, expect } from 'vitest'
import {
  RETREAD_CLAIM_STATUSES,
  OPEN_STATUSES,
  RESOLVED_STATUSES,
  DECIDED_STATUSES,
  APPROVED_OUTCOME_STATUSES,
  daysBetween,
  isOpen,
  isResolved,
  isDecided,
  isApprovedOutcome,
  resolutionDays,
  computeRetreadKpis,
  statusDistribution,
  rankByField,
  rankVendors,
  monthlyTrend,
  analyzeRetreadClaims,
} from './retreadClaimsAnalytics.js'

// A small, realistic sample using ONLY real columns/status vocab.
const sample = [
  { status: 'open', vendor: 'Bandag', cost: 100, amount_recovered: 0, claim_date: '2026-06-05', updated_at: '2026-06-05T00:00:00Z' },
  { status: 'submitted', vendor: 'Bandag', cost: 200, amount_recovered: 0, claim_date: '2026-06-20', updated_at: '2026-06-22T00:00:00Z' },
  { status: 'approved', vendor: 'Marangoni', cost: 300, amount_recovered: 0, claim_date: '2026-05-10', updated_at: '2026-05-20T00:00:00Z' },
  { status: 'settled', vendor: 'Bandag', cost: 400, amount_recovered: 360, claim_date: '2026-05-01', updated_at: '2026-05-11T00:00:00Z' },
  { status: 'rejected', vendor: 'Marangoni', cost: 500, amount_recovered: 0, claim_date: '2026-04-01', updated_at: '2026-04-21T00:00:00Z' },
]

describe('vocab + predicates', () => {
  it('exposes the canonical status vocab', () => {
    expect(RETREAD_CLAIM_STATUSES).toEqual(['open', 'submitted', 'approved', 'rejected', 'settled'])
  })
  it('classifies statuses correctly', () => {
    expect(OPEN_STATUSES).toContain('approved')
    expect(RESOLVED_STATUSES).toEqual(['settled', 'rejected'])
    expect(DECIDED_STATUSES).toEqual(['approved', 'settled', 'rejected'])
    expect(APPROVED_OUTCOME_STATUSES).toEqual(['approved', 'settled'])
    expect(isOpen('submitted')).toBe(true)
    expect(isOpen('rejected')).toBe(false)
    expect(isResolved('settled')).toBe(true)
    expect(isResolved('open')).toBe(false)
    expect(isDecided('approved')).toBe(true)
    expect(isApprovedOutcome('rejected')).toBe(false)
  })
})

describe('daysBetween', () => {
  it('returns whole days, floored at 0, null on invalid', () => {
    expect(daysBetween('2026-05-01', '2026-05-11')).toBe(10)
    expect(daysBetween('2026-05-11', '2026-05-01')).toBe(0)
    expect(daysBetween(null, '2026-05-01')).toBeNull()
    expect(daysBetween('nope', '2026-05-01')).toBeNull()
  })
})

describe('resolutionDays', () => {
  it('is null for non-resolved claims', () => {
    expect(resolutionDays({ status: 'open', claim_date: '2026-05-01', updated_at: '2026-05-10T00:00:00Z' })).toBeNull()
  })
  it('measures claim_date to updated_at for resolved claims', () => {
    expect(resolutionDays({ status: 'settled', claim_date: '2026-05-01', updated_at: '2026-05-11T00:00:00Z' })).toBe(10)
    expect(resolutionDays({ status: 'rejected', claim_date: '2026-04-01', updated_at: '2026-04-21T00:00:00Z' })).toBe(20)
  })
  it('falls back to created_at when updated_at is absent', () => {
    expect(resolutionDays({ status: 'settled', claim_date: '2026-05-01', created_at: '2026-05-06T00:00:00Z' })).toBe(5)
  })
})

describe('computeRetreadKpis', () => {
  it('returns honest zeros / N-null on empty input', () => {
    const k = computeRetreadKpis([])
    expect(k.total).toBe(0)
    expect(k.totalClaimed).toBe(0)
    expect(k.totalRecovered).toBe(0)
    expect(k.recoveryRate).toBe(0)
    expect(k.approvalRate).toBeNull()
    expect(k.avgResolutionDays).toBeNull()
    expect(k.outstanding).toBe(0)
  })
  it('is defensive against non-array input', () => {
    expect(computeRetreadKpis(null).total).toBe(0)
    expect(computeRetreadKpis(undefined).total).toBe(0)
  })
  it('computes headline figures over the sample', () => {
    const k = computeRetreadKpis(sample)
    expect(k.total).toBe(5)
    // open = open, submitted, approved
    expect(k.openCount).toBe(3)
    expect(k.openExposure).toBe(600) // 100 + 200 + 300
    expect(k.settledCount).toBe(1)
    expect(k.rejectedCount).toBe(1)
    expect(k.decidedCount).toBe(3) // approved, settled, rejected
    expect(k.approvedCount).toBe(2) // approved + settled
    expect(k.totalClaimed).toBe(1500)
    expect(k.totalRecovered).toBe(360)
    expect(k.outstanding).toBe(1140)
    expect(k.recoveryRate).toBe(24) // 360 / 1500
    expect(k.approvalRate).toBe(66.7) // 2 / 3 decided
    // resolved = settled(10) + rejected(20) => avg 15
    expect(k.resolvedCount).toBe(2)
    expect(k.avgResolutionDays).toBe(15)
  })
  it('coerces numeric strings and ignores junk amounts', () => {
    const k = computeRetreadKpis([
      { status: 'settled', cost: '250.50', amount_recovered: '100' },
      { status: 'open', cost: 'n/a', amount_recovered: null },
    ])
    expect(k.totalClaimed).toBe(250.5)
    expect(k.totalRecovered).toBe(100)
  })
})

describe('statusDistribution', () => {
  it('returns one entry per vocab status in order, with counts + pct', () => {
    const dist = statusDistribution(sample)
    expect(dist.map((d) => d.status)).toEqual(RETREAD_CLAIM_STATUSES)
    const bandagOpen = dist.find((d) => d.status === 'open')
    expect(bandagOpen.count).toBe(1)
    expect(bandagOpen.pct).toBe(20) // 1 of 5
    expect(dist.every((d) => typeof d.label === 'string')).toBe(true)
  })
  it('zero-fills on empty input', () => {
    const dist = statusDistribution([])
    expect(dist).toHaveLength(RETREAD_CLAIM_STATUSES.length)
    expect(dist.every((d) => d.count === 0 && d.pct === 0)).toBe(true)
  })
})

describe('rankByField / rankVendors', () => {
  it('groups vendors, sorted by claim count then cost', () => {
    const ranked = rankVendors(sample)
    expect(ranked[0].key).toBe('Bandag') // 3 claims
    expect(ranked[0].claims).toBe(3)
    expect(ranked[0].cost).toBe(700) // 100 + 200 + 400
    expect(ranked[0].recovered).toBe(360)
    expect(ranked[0].recoveryPct).toBe(51.4) // 360 / 700
    expect(ranked[1].key).toBe('Marangoni')
    expect(ranked[1].claims).toBe(2)
  })
  it('computes per-vendor approval rate over decided claims only', () => {
    const ranked = rankVendors(sample)
    const bandag = ranked.find((r) => r.key === 'Bandag')
    // Bandag decided = settled(1); approved outcome = 1 => 100
    expect(bandag.approvalRate).toBe(100)
    const marangoni = ranked.find((r) => r.key === 'Marangoni')
    // Marangoni decided = approved(1) + rejected(1) = 2; approved outcome = 1 => 50
    expect(marangoni.approvalRate).toBe(50)
  })
  it('returns [] when the field is absent (e.g. brand not stored) - never fabricated', () => {
    expect(rankByField(sample, 'brand')).toEqual([])
    expect(rankByField([], 'vendor')).toEqual([])
  })
  it('honors an optional limit', () => {
    expect(rankVendors(sample, { limit: 1 })).toHaveLength(1)
  })
  it('null approvalRate when a vendor has no decided claims', () => {
    const ranked = rankByField([
      { status: 'open', vendor: 'X', cost: 10 },
      { status: 'submitted', vendor: 'X', cost: 20 },
    ], 'vendor')
    expect(ranked[0].approvalRate).toBeNull()
  })
})

describe('monthlyTrend', () => {
  const now = new Date('2026-06-15T00:00:00Z')
  it('returns exactly N contiguous zero-filled buckets ending on now', () => {
    const t = monthlyTrend(sample, { months: 6, now })
    expect(t).toHaveLength(6)
    expect(t[t.length - 1].key).toBe('2026-06')
    expect(t[0].key).toBe('2026-01')
  })
  it('buckets claims/cost/recovered by claim_date', () => {
    const t = monthlyTrend(sample, { months: 6, now })
    const jun = t.find((b) => b.key === '2026-06')
    expect(jun.claims).toBe(2) // open(100) + submitted(200)
    expect(jun.cost).toBe(300)
    const may = t.find((b) => b.key === '2026-05')
    expect(may.claims).toBe(2) // approved(300) + settled(400)
    expect(may.recovered).toBe(360)
  })
  it('excludes rows with missing/invalid claim_date', () => {
    const t = monthlyTrend([
      { status: 'open', cost: 100, claim_date: null },
      { status: 'open', cost: 50, claim_date: 'bad' },
    ], { months: 3, now })
    expect(t.reduce((s, b) => s + b.claims, 0)).toBe(0)
  })
})

describe('analyzeRetreadClaims', () => {
  it('bundles kpis, statuses, vendors and trend from one row set', () => {
    const a = analyzeRetreadClaims(sample, { months: 6, now: new Date('2026-06-15T00:00:00Z') })
    expect(a.kpis.total).toBe(5)
    expect(a.statuses).toHaveLength(RETREAD_CLAIM_STATUSES.length)
    expect(a.vendors[0].key).toBe('Bandag')
    expect(a.trend).toHaveLength(6)
  })
  it('degrades to empty-safe output on empty input', () => {
    const a = analyzeRetreadClaims([])
    expect(a.kpis.total).toBe(0)
    expect(a.vendors).toEqual([])
    expect(a.trend).toHaveLength(12)
  })
})
