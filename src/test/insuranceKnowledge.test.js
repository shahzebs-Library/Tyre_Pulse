import { describe, it, expect } from 'vitest'
import { assessClaim, totalLossAssessment } from '../lib/insuranceKnowledge'

// Conditions modelled on the seeded rows: one per category the engine matches on,
// each carrying the policy_no the caller enriches them with so findings can cite it.
const CONDITIONS = [
  { seq: 1, category: 'claim_process', clause_text: 'Any repair must be approved by the insurer before work begins.', causes_rejection: true, policy_no: 'P-CLAIM' },
  { seq: 2, category: 'driver', clause_text: 'Driver must hold a valid licence and be at least 25 for a commercial vehicle.', causes_rejection: true, policy_no: 'P-CLAIM' },
  { seq: 3, category: 'deductible', clause_text: 'A deductible applies on the convicted fault share pending the NAJM report.', causes_delay: true, policy_no: 'P-CLAIM' },
  { seq: 4, category: 'coverage', clause_text: 'Outside KSA the applicable deductible and depreciation apply.', policy_no: 'P-CLAIM' },
]

describe('assessClaim', () => {
  it('rejects when repaired before approval and cites the claim-process policy', () => {
    const f = assessClaim(CONDITIONS, { repairedBeforeApproval: true })
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('reject')
    expect(f[0].category).toBe('claim_process')
    expect(f[0].policyNo).toBe('P-CLAIM')
    expect(f[0].conditionSeq).toBe(1)
  })

  it('rejects when the driver licence is invalid', () => {
    const f = assessClaim(CONDITIONS, { driverLicenceValid: false })
    expect(f.some((x) => x.severity === 'reject' && x.category === 'driver')).toBe(true)
  })

  it('rejects a 22-year-old commercial driver (below the 25 minimum)', () => {
    const f = assessClaim(CONDITIONS, { vehicleCommercial: true, driverAge: 22 })
    const rej = f.find((x) => x.severity === 'reject' && x.category === 'driver')
    expect(rej).toBeTruthy()
    expect(rej.reason).toContain('25')
  })

  it('delays when third-party fault is below 100 percent', () => {
    const f = assessClaim(CONDITIONS, { thirdPartyFaultPct: 50 })
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('delay')
    expect(f[0].category).toBe('deductible')
  })

  it('returns no findings for an empty context', () => {
    expect(assessClaim(CONDITIONS, {})).toEqual([])
  })

  it('sorts findings reject > delay > info', () => {
    const f = assessClaim(CONDITIONS, { driverLicenceValid: false, thirdPartyFaultPct: 50, outsideKsa: true })
    const order = f.map((x) => x.severity)
    expect(order).toEqual(['reject', 'delay', 'info'])
  })
})

describe('totalLossAssessment', () => {
  it('flags a constructive total loss when repair cost exceeds the threshold', () => {
    const r = totalLossAssessment({ repairCost: 70000, insuredValue: 100000, thresholdPct: 60 })
    expect(r.isTotalLoss).toBe(true)
    expect(r.thresholdValue).toBe(60000)
    expect(r.ratioPct).toBe(70)
  })

  it('is not a total loss when repair cost is within the threshold', () => {
    const r = totalLossAssessment({ repairCost: 50000, insuredValue: 100000, thresholdPct: 60 })
    expect(r.isTotalLoss).toBe(false)
  })

  it('returns null when inputs are missing', () => {
    expect(totalLossAssessment({}).isTotalLoss).toBeNull()
    expect(totalLossAssessment({ repairCost: 5000 }).isTotalLoss).toBeNull()
  })
})
