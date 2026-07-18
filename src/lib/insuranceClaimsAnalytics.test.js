import { describe, it, expect } from 'vitest'
import {
  analyzeInsuranceClaims,
  countByStatus,
  buildStatusFunnel,
  monthlyTrend,
  monthLabel,
  claimMonthKey,
  byInsurer,
  isOpenClaim,
  isResolvedClaim,
  isSettledClaim,
  isDelayedClaim,
  outstandingValue,
  settleDays,
  num,
  STATUS_FUNNEL_ORDER,
  DELAYED_THRESHOLD_DAYS,
} from './insuranceClaimsAnalytics'

const NOW = new Date('2026-07-18T00:00:00Z').getTime()

// A representative real-shaped fixture using ONLY real columns.
const rows = [
  { id: '1', status: 'open', insurer: 'Tawuniya', asset_no: 'A1', amount_claimed: 10000, amount_settled: null, incident_date: '2026-07-10', claim_date: '2026-07-11', updated_at: '2026-07-11T00:00:00Z' },
  { id: '2', status: 'settled', insurer: 'Tawuniya', asset_no: 'A2', amount_claimed: 20000, amount_settled: 18000, incident_date: '2026-05-01', claim_date: '2026-05-02', updated_at: '2026-05-20T00:00:00Z' },
  { id: '3', status: 'rejected', insurer: 'Bupa', asset_no: 'A3', amount_claimed: 5000, amount_settled: 0, incident_date: '2026-06-01', claim_date: '2026-06-02', updated_at: '2026-06-15T00:00:00Z' },
  { id: '4', status: 'under_review', insurer: 'Bupa', asset_no: 'A4', amount_claimed: 8000, amount_settled: null, incident_date: '2026-05-15', claim_date: '2026-05-16', updated_at: '2026-06-01T00:00:00Z' },
  { id: '5', status: 'closed', insurer: null, asset_no: 'A5', amount_claimed: 12000, amount_settled: 12000, incident_date: '2026-04-01', claim_date: '2026-04-02', updated_at: '2026-04-25T00:00:00Z' },
]

describe('num', () => {
  it('coerces to finite numbers, else 0', () => {
    expect(num('12.5')).toBe(12.5)
    expect(num(7)).toBe(7)
    expect(num(null)).toBe(0)
    expect(num('abc')).toBe(0)
    expect(num(undefined)).toBe(0)
  })
})

describe('predicates', () => {
  it('classifies open vs resolved vs settled', () => {
    expect(isOpenClaim({ status: 'open' })).toBe(true)
    expect(isOpenClaim({ status: 'approved' })).toBe(true)
    expect(isOpenClaim({ status: 'settled' })).toBe(false)
    expect(isResolvedClaim({ status: 'rejected' })).toBe(true)
    expect(isResolvedClaim({ status: 'open' })).toBe(false)
    expect(isSettledClaim({ status: 'closed' })).toBe(true)
    expect(isSettledClaim({ status: 'rejected' })).toBe(false)
  })

  it('isDelayedClaim only flags aged OPEN claims', () => {
    const oldOpen = { status: 'open', incident_date: '2026-01-01' }
    const freshOpen = { status: 'open', incident_date: '2026-07-17' }
    const oldSettled = { status: 'settled', incident_date: '2026-01-01' }
    expect(isDelayedClaim(oldOpen, NOW)).toBe(true)
    expect(isDelayedClaim(freshOpen, NOW)).toBe(false)
    expect(isDelayedClaim(oldSettled, NOW)).toBe(false)
    expect(isDelayedClaim({ status: 'open' }, NOW)).toBe(false) // no date
  })
})

describe('outstandingValue', () => {
  it('is claimed minus settled, floored at 0', () => {
    expect(outstandingValue({ amount_claimed: 10000, amount_settled: 4000 })).toBe(6000)
    expect(outstandingValue({ amount_claimed: 10000, amount_settled: 12000 })).toBe(0)
    expect(outstandingValue({ amount_claimed: 5000, amount_settled: null })).toBe(5000)
    expect(outstandingValue({})).toBe(0)
  })
})

describe('settleDays', () => {
  it('measures anchor -> updated_at for resolved claims', () => {
    expect(settleDays({ claim_date: '2026-05-02', updated_at: '2026-05-20T00:00:00Z' })).toBe(18)
  })
  it('returns null on missing dates and floors negatives at 0', () => {
    expect(settleDays({ claim_date: '2026-05-02' })).toBeNull()
    expect(settleDays({ updated_at: '2026-05-20T00:00:00Z' })).toBeNull()
    expect(settleDays({ claim_date: '2026-05-20', updated_at: '2026-05-02T00:00:00Z' })).toBe(0)
  })
})

describe('countByStatus', () => {
  it('counts across full vocabulary with zeros for absent statuses', () => {
    const c = countByStatus(rows)
    expect(c.open).toBe(1)
    expect(c.settled).toBe(1)
    expect(c.rejected).toBe(1)
    expect(c.under_review).toBe(1)
    expect(c.closed).toBe(1)
    expect(c.submitted).toBe(0)
    expect(c.approved).toBe(0)
  })
})

describe('buildStatusFunnel', () => {
  it('emits ordered funnel with labels and counts', () => {
    const f = buildStatusFunnel(countByStatus(rows))
    expect(f.map((x) => x.status)).toEqual(STATUS_FUNNEL_ORDER)
    expect(f.find((x) => x.status === 'open').count).toBe(1)
    expect(f.find((x) => x.status === 'open').label).toBe('Open')
  })
})

describe('claimMonthKey / monthLabel', () => {
  it('keys by claim_date then incident_date then created_at', () => {
    expect(claimMonthKey({ claim_date: '2026-07-11' })).toBe('2026-07')
    expect(claimMonthKey({ incident_date: '2026-05-15' })).toBe('2026-05')
    expect(claimMonthKey({ created_at: '2026-01-09T00:00:00Z' })).toBe('2026-01')
    expect(claimMonthKey({})).toBeNull()
  })
  it('formats month labels', () => {
    expect(monthLabel('2026-07')).toBe('Jul 26')
    expect(monthLabel('2026-01')).toBe('Jan 26')
  })
})

describe('monthlyTrend', () => {
  it('returns a continuous trailing window ending at now', () => {
    const t = monthlyTrend(rows, NOW, 12)
    expect(t).toHaveLength(12)
    expect(t[t.length - 1].ym).toBe('2026-07')
    expect(t[0].ym).toBe('2025-08')
  })
  it('buckets claimed/settled/count into the right month', () => {
    const t = monthlyTrend(rows, NOW, 12)
    const jul = t.find((b) => b.ym === '2026-07')
    expect(jul.count).toBe(1)
    expect(jul.claimed).toBe(10000)
    const may = t.find((b) => b.ym === '2026-05')
    expect(may.count).toBe(2) // rows 2 and 4
    expect(may.settled).toBe(18000)
  })
})

describe('byInsurer', () => {
  it('groups, totals and sorts by claimed desc; null insurer -> Unassigned', () => {
    const g = byInsurer(rows, NOW)
    const taw = g.find((x) => x.insurer === 'Tawuniya')
    expect(taw.count).toBe(2)
    expect(taw.claimed).toBe(30000)
    expect(taw.settled).toBe(18000)
    expect(taw.recoveryRate).toBe(60)
    expect(taw.openCount).toBe(1)
    expect(g.some((x) => x.insurer === 'Unassigned')).toBe(true)
    // sorted by claimed desc
    for (let i = 1; i < g.length; i += 1) {
      expect(g[i - 1].claimed).toBeGreaterThanOrEqual(g[i].claimed)
    }
  })
})

describe('analyzeInsuranceClaims', () => {
  it('handles empty input honestly', () => {
    const a = analyzeInsuranceClaims([], { now: NOW })
    expect(a.total).toBe(0)
    expect(a.totalClaimed).toBe(0)
    expect(a.recoveryRate).toBe(0)
    expect(a.approvalRate).toBe(0)
    expect(a.avgOpenAgeDays).toBeNull()
    expect(a.avgSettleDays).toBeNull()
    expect(a.delayed).toEqual([])
    expect(a.insurers).toEqual([])
    expect(a.monthly).toHaveLength(12)
  })

  it('tolerates non-array input', () => {
    expect(analyzeInsuranceClaims(null, { now: NOW }).total).toBe(0)
    expect(analyzeInsuranceClaims(undefined).total).toBe(0)
  })

  it('computes totals, recovery and outstanding', () => {
    const a = analyzeInsuranceClaims(rows, { now: NOW })
    expect(a.total).toBe(5)
    expect(a.totalClaimed).toBe(55000)
    expect(a.totalSettled).toBe(30000) // 18000 + 12000
    expect(a.outstanding).toBe(25000) // 10000 + 0 + 5000 + 8000 + 0
    expect(a.recoveryRate).toBe(55) // 30000/55000
    expect(a.avgClaim).toBe(11000)
  })

  it('computes open/resolved/settled/rejected counts', () => {
    const a = analyzeInsuranceClaims(rows, { now: NOW })
    expect(a.openCount).toBe(2) // open + under_review
    expect(a.resolvedCount).toBe(3) // settled + rejected + closed
    expect(a.settledCount).toBe(2) // settled + closed
    expect(a.rejectedCount).toBe(1)
  })

  it('computes approvalRate over decided claims', () => {
    // approved outcome = settled(1)+closed(1) = 2; rejected = 1; decided = 3
    const a = analyzeInsuranceClaims(rows, { now: NOW })
    expect(a.decidedCount).toBe(3)
    expect(a.approvalRate).toBe(67) // round(2/3*100)
  })

  it('flags delayed open claims and oldest open', () => {
    const a = analyzeInsuranceClaims(rows, { now: NOW })
    // open row 1 aged ~8 days (< 30, not delayed); under_review row 4 aged ~64 days (delayed)
    expect(a.delayedCount).toBe(1)
    expect(a.delayed[0].id).toBe('4')
    expect(a.oldestOpen.id).toBe('4')
    expect(a.delayedThresholdDays).toBe(DELAYED_THRESHOLD_DAYS)
  })

  it('computes avg settle days over paid resolved claims only', () => {
    const a = analyzeInsuranceClaims(rows, { now: NOW })
    // anchor = incident_date. row 2: 2026-05-01 -> 2026-05-20 = 19d; row 5: 2026-04-01 -> 2026-04-25 = 24d
    expect(a.settleSampleCount).toBe(2)
    expect(a.avgSettleDays).toBe(22) // round((19+24)/2)
  })

  it('respects a custom delayed threshold', () => {
    const a = analyzeInsuranceClaims(rows, { now: NOW, delayedThresholdDays: 5 })
    // now both open claims (age ~8 and ~64) exceed 5 days
    expect(a.delayedCount).toBe(2)
  })

  it('exposes funnel, monthly and insurer breakdowns', () => {
    const a = analyzeInsuranceClaims(rows, { now: NOW })
    expect(a.funnel.map((f) => f.status)).toEqual(STATUS_FUNNEL_ORDER)
    expect(a.monthly).toHaveLength(12)
    expect(a.insurers.length).toBeGreaterThan(0)
  })
})
