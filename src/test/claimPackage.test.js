import { describe, it, expect } from 'vitest'
import {
  buildClaimPackage, netClaimable, outstanding, recoveredTotal, lastUpdatedAt,
  liabilityLabel, gccLiabilityPct, isExternalRepairRoute, resolveNotifyPeople, commandCenterOwner,
} from '../lib/claimPackage'
import { CLAIM_PACKAGE_DOCS } from '../lib/accidentCaseVocab'

const ev = (key, n = 1, ws = 'insurance') =>
  Array.from({ length: n }, (_, i) => ({ id: `${key}-${i}`, requirement_key: key, workstream_key: ws, created_at: `2026-09-16T10:0${i}:00Z` }))

// The mock's exact state: 7 of 8 received, 9 photographs, driving licence missing.
const mockRows = [
  ...ev('accident_report_pdf'), ...ev('fleet_validation'), ...ev('workshop_assessment_pdf'),
  ...ev('damage_photographs', 9), ...ev('police_najm_report'), ...ev('vehicle_registration'), ...ev('policy_document'),
]

describe('buildClaimPackage', () => {
  it('lists the exact 8 mock documents in order', () => {
    const pkg = buildClaimPackage([])
    expect(pkg.items.map((i) => i.label)).toEqual([
      'Accident report PDF', 'Fleet validation', 'Workshop assessment PDF', 'Damage photographs',
      'Police / Najm report', 'Vehicle registration', 'Driving licence', 'Policy document',
    ])
    expect(CLAIM_PACKAGE_DOCS).toHaveLength(8)
  })

  it('reads the mock state as "7 of 8 required documents" with the licence missing', () => {
    const pkg = buildClaimPackage(mockRows)
    expect(pkg.counterLabel).toBe('7 of 8 required documents')
    expect(pkg.missingRequired.map((d) => d.key)).toEqual(['driving_licence'])
    expect(pkg.canRegister).toBe(false)
    expect(pkg.complete).toBe(false)
  })

  it('prints "N received" for the countable photographs and Received/Missing otherwise', () => {
    const pkg = buildClaimPackage(mockRows)
    const by = Object.fromEntries(pkg.items.map((i) => [i.key, i]))
    expect(by.damage_photographs.statusLabel).toBe('9 received')
    expect(by.damage_photographs.count).toBe(9)
    expect(by.accident_report_pdf.statusLabel).toBe('Received')
    expect(by.driving_licence.statusLabel).toBe('Missing')
  })

  it('unlocks registration only when every required document is present', () => {
    const pkg = buildClaimPackage([...mockRows, ...ev('driving_licence')])
    expect(pkg.counterLabel).toBe('8 of 8 required documents')
    expect(pkg.missingRequired).toEqual([])
    expect(pkg.canRegister).toBe(true)
  })

  it('matches by requirement key regardless of which tab uploaded it, and never counts unknown keys', () => {
    const pkg = buildClaimPackage([...ev('policy_document', 1, 'liability'), { requirement_key: 'something_else' }])
    expect(pkg.items.find((i) => i.key === 'policy_document').received).toBe(true)
    expect(pkg.requiredReceived).toBe(1)
  })

  it('an empty package is never "complete"', () => {
    expect(buildClaimPackage([]).complete).toBe(false)
    expect(buildClaimPackage(null).counterLabel).toBe('0 of 8 required documents')
  })
})

describe('money derivations', () => {
  it('netClaimable = claim - deductible, floored at 0, null without a claim amount', () => {
    expect(netClaimable(10000, 1500)).toBe(8500)
    expect(netClaimable('10000', '1500')).toBe(8500)
    expect(netClaimable(1000, 5000)).toBe(0)
    expect(netClaimable(10000, null)).toBe(10000)
    expect(netClaimable(null, 1500)).toBeNull()
    expect(netClaimable('', 0)).toBeNull()
  })

  it('outstanding prefers the approved amount, falls back to the claim, null when neither', () => {
    expect(outstanding(10000, 8000, 3000)).toBe(5000)
    expect(outstanding(10000, null, 3000)).toBe(7000)
    expect(outstanding(10000, 8000, null)).toBe(8000)
    expect(outstanding(1000, 500, 900)).toBe(0)
    expect(outstanding(null, null, 500)).toBeNull()
  })

  it('recoveredTotal sums only money that actually came back (recovered/partial), null when none', () => {
    expect(recoveredTotal([
      { amount: 1000, status: 'recovered' }, { amount: 250, status: 'partial' },
      { amount: 9999, status: 'pending' }, { amount: 5, status: 'written_off' }, { amount: null, status: 'recovered' },
    ])).toBe(1250)
    expect(recoveredTotal([{ amount: 100, status: 'pending' }])).toBeNull()
    expect(recoveredTotal([])).toBeNull()
  })

  it('lastUpdatedAt picks the newest stamp across claim and recoveries', () => {
    expect(lastUpdatedAt({ updated_at: '2026-09-01T00:00:00Z' }, [{ created_at: '2026-09-05T00:00:00Z' }])).toBe('2026-09-05T00:00:00Z')
    expect(lastUpdatedAt(null, [])).toBeNull()
  })
})

describe('liability + repair route', () => {
  it('labels the stored liability type and reads the GCC percentage', () => {
    expect(liabilityLabel({ liability_type: 'shared', our_liability_pct: 50 })).toBe('Shared fault')
    expect(liabilityLabel(null)).toBe('')
    expect(gccLiabilityPct({ our_liability_pct: '30' })).toBe(30)
    expect(gccLiabilityPct({})).toBeNull()
  })

  it('external banner follows the repair order first, then the assessment recommendation', () => {
    expect(isExternalRepairRoute({ repair_route: 'external' }, null)).toBe(true)
    expect(isExternalRepairRoute({ repair_route: 'internal', workshop_type: 'internal' }, { recommended_route: 'external' })).toBe(false)
    expect(isExternalRepairRoute(null, { recommended_route: 'external' })).toBe(true)
    expect(isExternalRepairRoute(null, { recommended_route: 'internal' })).toBe(false)
    expect(isExternalRepairRoute(null, null)).toBe(false)
  })
})

describe('notify chips', () => {
  const ws = [
    { workstream_key: 'fleet_validation', team: 'Fleet', owner_id: 'u1' },
    { workstream_key: 'assessment', team: 'Workshop', owner_id: 'u2' },
    { workstream_key: 'timeline', team: 'Command Center', owner_id: 'u3' },
  ]
  const profiles = [{ id: 'u1', full_name: 'Ajay' }, { id: 'u2', username: 'vinay' }, { id: 'u3', full_name: 'Mai' }]

  it('shows the owner name when the workstream owner is known, else the role', () => {
    const chips = resolveNotifyPeople(ws, profiles)
    expect(chips.map((c) => c.display)).toEqual(['Ajay', 'vinay', 'Mai', 'PMV Manager'])
    expect(chips.find((c) => c.key === 'pmv_manager').visibilityOnly).toBe(true)
    expect(chips.some((c) => c.key === 'insurance')).toBe(false)
  })

  it('falls back to the role label with no owners at all', () => {
    expect(resolveNotifyPeople([], []).map((c) => c.display)).toEqual(['Fleet', 'Workshop', 'Command Center', 'PMV Manager'])
    expect(commandCenterOwner([], [])).toBeNull()
    expect(commandCenterOwner(ws, profiles)).toBe('Mai')
  })
})
