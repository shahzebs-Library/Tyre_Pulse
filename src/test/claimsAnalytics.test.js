import { describe, it, expect } from 'vitest'
import {
  analyzeClaims, hasClaim, isClosed, isDelayed, claimNet, grossCost, overdueDays,
} from '../lib/claimsAnalytics'

const NOW = '2026-07-13'

const rows = [
  // Open, delayed, faulty, 100% liability, insurer A
  {
    asset_no: 'TM-01', site: 'Riyadh', incident_date: '2026-04-01',
    claim_amount: 10000, claim_approved_amount: 8000, recovered_amount: 0,
    deductible: 500, insurer: 'Tawuniya', claim_status: 'Under review',
    gcc_liability_ratio: 100, fault_status: 'Faulty', najm_status: 'Najm report',
    taqdeer_status: 'No Taqdeer', repair_cost: 12000, parts_cost: 1000,
    expected_release_date: '2026-05-01',
  },
  // Closed/settled, non-faulty, 0% liability, insurer B, fully recovered
  {
    asset_no: 'TM-02', site: 'Jeddah', incident_date: '2026-05-10',
    claim_amount: 6000, claim_approved_amount: 6000, recovered_amount: 6000,
    insurer: 'Bupa', claim_status: 'Settled', release_date: '2026-06-10',
    gcc_liability_ratio: 0, fault_status: 'Non-faulty', najm_status: 'No report',
    repair_cost: 6000,
  },
  // Open, 50% liability, no insurer but has claim_amount
  {
    asset_no: 'TM-01', site: 'Riyadh', incident_date: '2026-07-05',
    claim_amount: 4000, gcc_liability_ratio: 50, status: 'Open',
    estimated_damage_cost: 4000, recovered_amount: 1000,
  },
  // Not a claim (no money, no insurer, no claim status) → excluded
  { asset_no: 'TM-09', site: 'Dammam', incident_date: '2026-07-01', status: 'Reported' },
]

describe('claimsAnalytics helpers', () => {
  it('hasClaim detects money / status / insurer', () => {
    expect(hasClaim(rows[0])).toBe(true)
    expect(hasClaim(rows[3])).toBe(false)
    expect(hasClaim({ insurer: 'X' })).toBe(true)
    expect(hasClaim({ status: 'Insurance claim filed' })).toBe(true)
  })
  it('isClosed reads release_date and terminal statuses', () => {
    expect(isClosed(rows[1])).toBe(true)
    expect(isClosed(rows[0])).toBe(false)
    expect(isClosed({ claim_status: 'Rejected' })).toBe(true)
  })
  it('isDelayed flags open claims past expected release', () => {
    expect(isDelayed(rows[0], NOW)).toBe(true)
    expect(isDelayed(rows[1], NOW)).toBe(false) // closed
    expect(isDelayed({ expected_release_date: '2027-01-01' }, NOW)).toBe(false)
  })
  it('claimNet nets recoveries against repair+parts', () => {
    expect(claimNet(rows[0])).toBe(13000) // 12000 + 1000 - 0
    expect(claimNet(rows[1])).toBe(0)     // 6000 - 6000
    expect(claimNet(rows[2])).toBe(3000)  // 4000 (est) - 1000
  })
  it('grossCost is repair (or estimate) + parts, and claimNet == gross - recovered', () => {
    expect(grossCost(rows[0])).toBe(13000)                 // 12000 repair + 1000 parts
    expect(grossCost(rows[2])).toBe(4000)                  // estimate used when no repair_cost
    for (const r of rows) {
      const recovered = Number(r.recovered_amount) || 0
      expect(claimNet(r)).toBe(Math.max(0, grossCost(r) - recovered))
    }
  })
})

describe('analyzeClaims', () => {
  const a = analyzeClaims(rows, { now: NOW })

  it('counts only real claims and splits open/closed/delayed', () => {
    expect(a.total).toBe(3)
    expect(a.open).toBe(2)
    expect(a.closed).toBe(1)
    expect(a.delayed).toBe(1)
  })
  it('sums the money rails and derives rates', () => {
    expect(a.claimed).toBe(20000)
    expect(a.approved).toBe(14000)
    expect(a.recovered).toBe(7000)
    expect(a.deductible).toBe(500)
    expect(a.recoveryRate).toBe(35) // 7000/20000
    expect(a.outstanding).toBe(7000) // approved 14000 - recovered 7000
    expect(a.avgClaim).toBe(Math.round(20000 / 3))
  })
  it('buckets GCC liability into 0 / 50 / 100', () => {
    expect(a.liability[100].count).toBe(1)
    expect(a.liability[0].count).toBe(1)
    expect(a.liability[50].count).toBe(1)
  })
  it('breaks down fault status', () => {
    expect(a.fault.faulty.count).toBe(1)
    expect(a.fault.non_faulty.count).toBe(1)
    expect(a.fault.unknown.count).toBe(1)
  })
  it('ranks insurers and assets by value', () => {
    expect(a.byInsurer[0].label).toBe('Tawuniya')
    expect(a.topAssets.find((x) => x.label === 'TM-01').count).toBe(2)
  })
  it('builds a monthly trend and computes avg cycle days', () => {
    expect(a.byMonth.length).toBeGreaterThanOrEqual(3)
    expect(a.avgCycleDays).toBe(31) // 2026-05-10 → 2026-06-10
  })
  it('ages open claims into buckets', () => {
    // TM-01 open since 2026-04-01 (>90d), TM-01 open since 2026-07-05 (<=30d)
    expect(a.aging['90+'].count).toBe(1)
    expect(a.aging['0-30'].count).toBe(1)
  })
  it('is safe on empty input', () => {
    const e = analyzeClaims([], { now: NOW })
    expect(e.total).toBe(0)
    expect(e.recoveryRate).toBeNull()
    expect(e.byInsurer).toEqual([])
  })
})


describe('delayed intelligence (overdueDays + delayedDetail)', () => {
  const T = '2026-07-13'
  it('overdueDays counts whole days past expected release for open claims only', () => {
    expect(overdueDays({ claim_amount: 100, expected_release_date: '2026-07-03' }, T)).toBe(10)
    expect(overdueDays({ claim_amount: 100, expected_release_date: '2026-08-01' }, T)).toBe(0)
    expect(overdueDays({ claim_amount: 100, expected_release_date: '2026-07-03', release_date: '2026-07-05' }, T)).toBe(0)
    expect(overdueDays({ claim_amount: 100 }, T)).toBe(0)
  })
  it('delayedDetail buckets, value at risk, avg/max and worst ordering', () => {
    const rows = [
      { claim_amount: 1000, recovered_amount: 200, insurer: 'A', asset_no: 'T1', incident_date: '2026-06-01', expected_release_date: '2026-07-10' }, // 3d, 800
      { claim_amount: 5000, insurer: 'B', asset_no: 'T2', incident_date: '2026-05-01', expected_release_date: '2026-06-23' },                        // 20d, 5000
      { claim_amount: 2000, insurer: 'A', asset_no: 'T3', incident_date: '2026-03-01', expected_release_date: '2026-05-01' },                        // 73d, 2000
    ]
    const d = analyzeClaims(rows, { now: T }).delayedDetail
    expect(d.count).toBe(3)
    expect(d.valueAtRisk).toBe(7800)
    expect(d.buckets['1-7'].count).toBe(1)
    expect(d.buckets['8-30'].count).toBe(1)
    expect(d.buckets['31+'].count).toBe(1)
    expect(d.maxOverdueDays).toBe(73)
    expect(d.avgOverdueDays).toBe(32)
    expect(d.worst[0].asset_no).toBe('T3')
    expect(d.worst[0].overdue_days).toBe(73)
    expect(d.byInsurer[0].label).toBe('A')
  })
  it('is honest on empty input', () => {
    const d = analyzeClaims([], { now: T }).delayedDetail
    expect(d.count).toBe(0)
    expect(d.valueAtRisk).toBe(0)
    expect(d.avgOverdueDays).toBeNull()
    expect(d.maxOverdueDays).toBeNull()
    expect(d.worst).toEqual([])
  })
})
