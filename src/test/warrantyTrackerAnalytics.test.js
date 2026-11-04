import { describe, it, expect } from 'vitest'
import {
  scopeClaimsByCountry, filterClaimsBase, filterClaimsByDimension, claimKpis, brandPerformance,
  failureBreakdown, statusCounts, monthlyCredits, creditAnalysis, roiModel, generateClaimNo,
  optionsOf, lifePct,
  buildWarrantyCandidates, tyreKmRun, tyreKmAssessment, tyreLifeCapKm, nextClaimStatuses, claimSaveProblem, supplierWaitDays, overdueClaims, claimStepIndex,
} from '../lib/warrantyTrackerAnalytics'

const claims = [
  { id: 1, claim_no: 'WAR-2026-00001', brand: 'Pirelli', site: 'NHC', country: 'KSA', claim_status: 'Credit Issued', credit_amount: 1000, credit_date: '2026-09-02', failure_type: 'Premature Wear', km_run: 40000, expected_life_km: 100000, created_at: '2026-08-01T10:00:00Z' },
  { id: 2, claim_no: 'WAR-2026-00004', brand: 'Pirelli', site: 'JED', country: null, claim_status: 'Approved', failure_type: 'Sidewall Failure', km_run: null, created_at: '2026-09-10T10:00:00Z' },
  { id: 3, claim_no: 'WAR-2025-00001', brand: 'Triangle', site: 'NHC', country: 'UAE', claim_status: 'Rejected', failure_type: 'Premature Wear', km_run: 90000, expected_life_km: 0, created_at: '2025-12-01T10:00:00Z' },
]

describe('warrantyTrackerAnalytics', () => {
  it('scopes by country keeping null-country rows', () => {
    expect(scopeClaimsByCountry(claims, 'All')).toHaveLength(3)
    expect(scopeClaimsByCountry(claims, 'KSA').map(c => c.id)).toEqual([1, 2])
  })

  it('applies population then dimension filters', () => {
    expect(filterClaimsBase(claims, { site: 'NHC' }).map(c => c.id)).toEqual([1, 3])
    expect(filterClaimsBase(claims, { from: '2026-09-01' }).map(c => c.id)).toEqual([2])
    expect(filterClaimsBase(claims, { to: '2026-08-01' }).map(c => c.id)).toEqual([1, 3])
    expect(filterClaimsBase(claims, { search: 'triangle' }).map(c => c.id)).toEqual([3])
    expect(filterClaimsByDimension(claims, { brand: 'Pirelli' }).map(c => c.id)).toEqual([2, 1])
    expect(filterClaimsByDimension(claims, { failure: 'Premature Wear', status: 'Rejected' }).map(c => c.id)).toEqual([3])
  })

  it('computes KPIs with honest nulls', () => {
    expect(claimKpis(claims)).toMatchObject({ total: 3, open: 1, totalCredits: 1000, avgCredit: 1000 })
    expect(claimKpis(claims).approvalRate).toBeCloseTo(66.67, 1)
    expect(claimKpis([])).toMatchObject({ total: 0, approvalRate: null, avgCredit: null })
  })

  it('computes life percent only when measurable', () => {
    expect(lifePct(claims[0])).toBe(40)
    expect(lifePct(claims[1])).toBeNull()
    expect(lifePct(claims[2])).toBeNull()
  })

  it('breaks down by brand and failure type', () => {
    const b = brandPerformance(claims)
    expect(b[0]).toMatchObject({ brand: 'Pirelli', total: 2, approved: 2, avgCredit: 1000, avgKm: 40000 })
    expect(b[1]).toMatchObject({ brand: 'Triangle', approvalRate: 0, avgCredit: null })
    const f = failureBreakdown(claims)
    expect(f[0]).toMatchObject({ type: 'Premature Wear', count: 2, avgKm: 65000 })
    expect(f.find(x => x.type === 'Bead Failure').avgKm).toBeNull()
    expect(statusCounts(claims)).toMatchObject({ Approved: 1, Rejected: 1, 'Credit Issued': 1, Submitted: 0 })
  })

  it('bins credits into the last 12 months relative to now', () => {
    const m = monthlyCredits(claims, { now: new Date(2026, 8, 20) })
    expect(m.labels[11]).toBe('Sep')
    expect(m.data[11]).toBe(1000)
    expect(m.data.reduce((s, v) => s + v, 0)).toBe(1000)
  })

  it('estimates unclaimed credit from issued credits, null when none issued', () => {
    expect(creditAnalysis(claims)).toMatchObject({ totalCredits: 1000, openApprovedCount: 1, estimatedUnclaimed: 1000 })
    expect(creditAnalysis([claims[1]]).estimatedUnclaimed).toBeNull()
  })

  it('models ROI for the current year', () => {
    const r = roiModel(claims, { annualCount: 100, avgCost: 100, now: new Date(2026, 5, 1) })
    expect(r).toMatchObject({ thisYearClaims: 2, thisYearCredits: 1000, recoveryRate: 10, eligibleUnclaimed: 1200 })
    expect(roiModel(claims, { now: new Date(2026, 5, 1) }).recoveryRate).toBeNull()
  })

  it('numbers the next claim after the highest sequence', () => {
    expect(generateClaimNo(claims, new Date(2026, 0, 1))).toBe('WAR-2026-00005')
    expect(generateClaimNo([], new Date(2027, 0, 1))).toBe('WAR-2027-00001')
  })

  it('builds sorted option lists', () => {
    expect(optionsOf(claims, 'site')).toEqual(['All', 'JED', 'NHC'])
  })
})

describe('warranty candidates', async () => {
  const { classifyRemovalReason, buildWarrantyCandidates, candidateSummary, tyreKmRun } =
    await import('../lib/warrantyTrackerAnalytics')

  it('classifies defect, burst and premature wear; ignores road hazards and brands', () => {
    expect(classifyRemovalReason('THREAD SEPRATION')).toEqual({ kind: 'defect', failure: 'Tread Separation' })
    expect(classifyRemovalReason('Sidewall separation / bulge')).toEqual({ kind: 'defect', failure: 'Sidewall Failure' })
    expect(classifyRemovalReason('BLAST/BURST').kind).toBe('burst')
    expect(classifyRemovalReason('WORN OUT').kind).toBe('premature_wear')
    expect(classifyRemovalReason('Normal tread wear')).toBeNull()
    for (const r of ['PUNCTURE', 'DAMAGED', 'MISUSE', 'ALIGNMENT', 'ROADX', '', null]) {
      expect(classifyRemovalReason(r)).toBeNull()
    }
  })

  it('km run: total_km first, else odometer delta, else null (never 0)', () => {
    expect(tyreKmRun({ total_km: 30000 })).toBe(30000)
    expect(tyreKmRun({ total_km: 0, km_at_fitment: 1000, km_at_removal: 21000 })).toBe(20000)
    expect(tyreKmRun({ total_km: null, km_at_fitment: null, km_at_removal: 5000 })).toBeNull()
  })

  it('keeps early defects and early wear, drops late ones and already-claimed serials', () => {
    const tyres = [
      { id: 1, serial_no: 'A1', removal_reason: 'THREAD SEPRATION', total_km: 30000, removal_date: '2026-01-01' },
      { id: 2, serial_no: 'A2', removal_reason: 'THREAD SEPRATION', total_km: 150000 },
      { id: 3, serial_no: 'A3', removal_reason: 'WORN OUT', total_km: 20000 },
      { id: 4, serial_no: 'A4', removal_reason: 'WORN OUT', total_km: 80000 },
      { id: 5, serial_no: 'A5', removal_reason: 'WORN OUT' },
      { id: 6, serial_no: 'A6', removal_reason: 'BLAST/BURST' },
      { id: 7, serial_no: 'a 7', removal_reason: 'BLAST/BURST', total_km: 10000 },
      { id: 8, serial_no: 'A8', removal_reason: 'PUNCTURE', total_km: 100 },
    ]
    const out = buildWarrantyCandidates(tyres, [{ serial_number: 'A7' }])
    // A2's 150,000 km is above the 100,000 km class limit: a reading error, so
    // it stays a defect candidate with its km withheld rather than being dropped.
    expect(out.map(c => c.id).sort()).toEqual([1, 2, 3, 6])
    const s = candidateSummary(out)
    expect(s).toMatchObject({ total: 4, defect: 2, burst: 1, premature_wear: 1, kmUnknown: 2, kmSuspect: 1 })
    expect(out.find(c => c.id === 6).km_run).toBeNull()
    expect(out.find(c => c.id === 2)).toMatchObject({ km_run: null, km_status: 'over_cap', km_reported: 150000 })
  })
})

describe('tyre km is the tyre life, not the machine odometer', () => {
  it('uses removal minus fitment when the fitment odometer is real', () => {
    expect(tyreKmAssessment({ km_at_fitment: 120000, km_at_removal: 160000, total_km: 40000 }))
      .toMatchObject({ km: 40000, status: 'measured' })
  })
  it('a fitment odometer of 1 is a placeholder: the total is the odometer, not a life', () => {
    const a = tyreKmAssessment({ km_at_fitment: 1, km_at_removal: 230001, total_km: 230000, vehicle_type: 'TR-MIXER' })
    expect(a.km).toBeNull()
    expect(a.status).toBe('placeholder')
    expect(tyreKmRun({ km_at_fitment: '1.00', total_km: 31646 })).toBeNull()
  })
  it('a factory fitment at 0 km is a real life', () => {
    expect(tyreKmAssessment({ km_at_fitment: 0, km_at_removal: 61658, total_km: 61658, vehicle_type: 'TR-MIXER' }))
      .toMatchObject({ km: 61658, status: 'factory' })
  })
  it('a life above the vehicle class limit is withheld', () => {
    expect(tyreKmAssessment({ km_at_fitment: 0, total_km: 90000, vehicle_type: 'TR-MIXER' }).status).toBe('over_cap')
    expect(tyreKmAssessment({ km_at_fitment: 0, total_km: 90000, vehicle_type: 'GENERATOR' }).status).toBe('factory')
  })
  it('class limits mirror SQL tyre_life_km_cap', () => {
    expect(tyreLifeCapKm('TR-MIXER')).toBe(80000)
    expect(tyreLifeCapKm('PUMPS')).toBe(56000)
    expect(tyreLifeCapKm('WHEEL LOADER')).toBe(15000)
    expect(tyreLifeCapKm(null)).toBe(100000)
  })
  it('expected life follows the vehicle class', () => {
    const out = buildWarrantyCandidates([
      { id: 1, serial_no: 'P1', removal_reason: 'WORN OUT', km_at_fitment: 1000, km_at_removal: 31000, vehicle_type: 'PUMPS' },
    ])
    // 30,000 km is past half a pump's 56,000 km life, so it is normal wear.
    expect(out).toHaveLength(0)
  })
})

describe('claim procedure', () => {
  it('offers only the next steps', () => {
    expect(nextClaimStatuses('Submitted')).toEqual(['Submitted', 'Under Review', 'Rejected'])
    expect(nextClaimStatuses('Approved')).toEqual(['Approved', 'Credit Issued', 'Closed'])
    expect(nextClaimStatuses('Closed')).toEqual(['Closed'])
  })
  it('a rejection needs a reason and a credit needs amount and date', () => {
    expect(claimSaveProblem({ claim_status: 'Rejected', rejection_reason: ' ' })).toMatch(/rejection reason/)
    expect(claimSaveProblem({ claim_status: 'Rejected', rejection_reason: 'Misuse' })).toBe('')
    expect(claimSaveProblem({ claim_status: 'Credit Issued', credit_amount: 500 })).toMatch(/credit date/)
    expect(claimSaveProblem({ claim_status: 'Credit Issued', credit_amount: 500, credit_date: '2026-11-01' })).toBe('')
  })
  it('counts days waiting on the supplier only while undecided', () => {
    const now = new Date('2026-11-04T00:00:00Z')
    expect(supplierWaitDays({ claim_status: 'Under Review', created_at: '2026-09-25T00:00:00Z' }, { now })).toBe(40)
    expect(supplierWaitDays({ claim_status: 'Approved', created_at: '2026-01-01T00:00:00Z' }, { now })).toBeNull()
    expect(overdueClaims([
      { claim_status: 'Submitted', created_at: '2026-09-25T00:00:00Z' },
      { claim_status: 'Submitted', created_at: '2026-10-30T00:00:00Z' },
    ], { now })).toHaveLength(1)
    expect(claimStepIndex('Rejected')).toBe(2)
  })
})
