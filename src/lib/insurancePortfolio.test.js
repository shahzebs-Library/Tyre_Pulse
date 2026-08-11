import { describe, it, expect } from 'vitest'
import {
  ratio,
  sumMoney,
  reconcileCoverage,
  insuredValue,
  lossRatios,
  claimStats,
  repeatOffenders,
  renewalExposure,
  premiumEfficiency,
  claimAccidentGap,
  buildInsurancePortfolio,
  RENEWAL_WINDOW_DAYS,
} from './insurancePortfolio'

const NOW = Date.parse('2026-08-11T00:00:00Z')

const FLEET = [
  { id: 'f1', asset_no: 'TM655', country: 'KSA', site: 'DIRIYAH-G1', chassis_no: 'LZGJLDR41MX010101', registration_no: '8448 G X A', vehicle_type: 'TR-MIXER' },
  { id: 'f2', asset_no: 'TM736', country: 'KSA', site: 'NHC', chassis_no: 'LZGJLDR41MX020202', registration_no: '1981  JTA', vehicle_type: 'TR-MIXER' },
  { id: 'f3', asset_no: 'MP083', country: 'KSA', site: 'QIDDIYA', chassis_no: null, registration_no: null, vehicle_type: 'PUMPS' },
  { id: 'f4', asset_no: 'TM900', country: 'UAE', site: 'DXB', chassis_no: null, registration_no: null, vehicle_type: 'TR-MIXER' },
]

const SCHEDULE = [
  { id: 's1', country: 'KSA', policy_no: 'CMI-1', cover_type: 'CMI', chassis_no: 'LZGJLDR41MX010101', plate_no: '8448GXA', sum_insured: 300000, premium: 9000, currency: 'SAR', site: 'DIRIYAH-G1', cover_to: '2026-09-15' },
  { id: 's2', country: 'KSA', policy_no: 'CMI-1', cover_type: 'CMI', chassis_no: 'LZGJLDR41MX020202', plate_no: '1981 JTA', sum_insured: 200000, premium: 6000, currency: 'SAR', site: 'NHC', cover_to: '2026-09-15' },
  // Insuring an asset code the register does not hold: wasted premium.
  { id: 's3', country: 'KSA', policy_no: 'CPM-2', cover_type: 'CPM', asset_no: 'TM999', sum_insured: 100000, premium: 4000, currency: 'SAR', site: 'JED', cover_to: '2026-12-31' },
  // No usable key at all: unresolved, NOT an orphan.
  { id: 's4', country: 'KSA', policy_no: 'CPM-2', cover_type: 'CPM', description: 'Loader', sum_insured: 50000, premium: 2000, currency: 'SAR', cover_to: '2026-12-31' },
]

const CLAIMS = [
  { id: 'c1', country: 'KSA', claim_no: 'CLM-1', policy_no: 'CMI-1', uw_year: 2026, accident_date: '2026-03-10', chassis_no: 'LZGJLDR41MX010101', cause_of_loss: 'Collision', driver_name: 'A. Khan', paid_amount: 12000, outstanding_amount: 0, currency: 'SAR' },
  { id: 'c2', country: 'KSA', claim_no: 'CLM-2', policy_no: 'CMI-1', uw_year: 2026, accident_date: '2026-05-02', chassis_no: 'LZGJLDR41MX010101', cause_of_loss: 'Collision', driver_name: 'A. Khan', paid_amount: 0, outstanding_amount: 8000, currency: 'SAR' },
  { id: 'c3', country: 'KSA', claim_no: 'CLM-3', policy_no: 'CMI-1', uw_year: 2026, accident_date: '2026-06-01', plate_no: '1981  JTA', cause_of_loss: 'Overturn', driver_name: 'B. Ali', paid_amount: null, outstanding_amount: null, estimate_payment: null, currency: 'SAR' },
]

describe('primitives', () => {
  it('ratio returns null - never 0 - when the denominator is absent or zero', () => {
    expect(ratio(10, 5)).toBe(2)
    expect(ratio(10, 0)).toBeNull()
    expect(ratio(10, null)).toBeNull()
    expect(ratio(null, 5)).toBeNull()
  })

  it('sumMoney never blends currencies and reports its basis', () => {
    const same = sumMoney([{ premium: 10, currency: 'SAR' }, { premium: 5, currency: 'SAR' }], 'premium')
    expect(same).toMatchObject({ total: 15, currency: 'SAR', mixedCurrency: false, counted: 2 })

    const mixed = sumMoney([{ premium: 10, currency: 'SAR' }, { premium: 5, currency: 'AED' }], 'premium')
    expect(mixed.mixedCurrency).toBe(true)
    expect(mixed.total).toBeNull() // a blended figure is not a number anyone can use
    expect(mixed.byCurrency).toEqual({ SAR: 10, AED: 5 })

    const partial = sumMoney([{ premium: 10, currency: 'SAR' }, { premium: null, currency: 'SAR' }], 'premium')
    expect(partial).toMatchObject({ counted: 1, missing: 1, coverage: 0.5 })
  })
})

describe('reconcileCoverage', () => {
  const r = reconcileCoverage({ fleet: FLEET, schedule: SCHEDULE, country: 'KSA' })

  it('separates insured, uninsured, orphan schedule and unresolved', () => {
    expect(r.fleetCount).toBe(3) // UAE asset is out of scope
    expect(r.insuredCount).toBe(2)
    expect(r.uninsured.map((a) => a.asset_no)).toEqual(['MP083'])
    // TM999 is confidently not in the register: premium buying nothing.
    expect(r.orphanSchedule.map((x) => x.id)).toEqual(['s3'])
    // s4 has no key at all - that is OUR gap, not a dead asset.
    expect(r.unresolved.map((x) => x.id)).toEqual(['s4'])
  })

  it('publishes the fleet key coverage that bounds the whole reconciliation', () => {
    expect(r.basis.fleetWithChassis).toBe(2)
    expect(r.basis.fleetWithPlate).toBe(2)
    expect(r.coveragePct).toBeCloseTo(2 / 3)
  })

  it('reports NULL coverage - not 0% - when nothing has been loaded yet', () => {
    // The whole point: an empty insurance table is "unmeasured", not "uninsured".
    expect(reconcileCoverage({ fleet: FLEET, schedule: [], country: 'KSA' }).coveragePct).toBeNull()
    expect(reconcileCoverage({ fleet: [], schedule: [], country: 'KSA' }).coveragePct).toBeNull()
    expect(reconcileCoverage({}).uninsuredCount).toBe(0)
  })
})

describe('insuredValue', () => {
  it('totals sum insured by cover type and by the asset class of the RESOLVED fleet row', () => {
    const v = insuredValue({ schedule: SCHEDULE, fleet: FLEET, country: 'KSA' })
    expect(v.total.total).toBe(650000)
    expect(v.byCoverType.find((x) => x.key === 'CMI').total).toBe(500000)
    expect(v.byAssetClass.find((x) => x.key === 'TR-MIXER').total).toBe(500000)
    // Unresolved rows are honestly "(not classified)", never lumped into a class.
    expect(v.byAssetClass.find((x) => x.key === '(not classified)').total).toBe(150000)
  })
})

describe('lossRatios', () => {
  it('computes incurred / premium from the insurer loss runs, excluding total rows', () => {
    const lossRuns = [
      { policy_no: 'CMI-1', policy_year: '2026', month_no: 1, paid_amount: 10000, outstanding_amount: 5000, paid_count: 2, outstanding_count: 1, premium: 100000, is_total: false },
      { policy_no: 'CMI-1', policy_year: '2026', month_no: 2, paid_amount: 5000, outstanding_amount: 0, paid_count: 1, outstanding_count: 0, premium: 100000, is_total: false },
      // The insurer's own summary line: including it would double count.
      { policy_no: 'CMI-1', policy_year: '2026', month_no: null, paid_amount: 15000, outstanding_amount: 5000, premium: 100000, is_total: true },
    ]
    const l = lossRatios({ lossRuns, schedule: SCHEDULE })
    const p = l.byPolicy.find((x) => x.key === 'CMI-1')
    expect(l.fromInsurerLossRuns).toBe(true)
    expect(p.incurred).toBe(20000)
    expect(p.premium).toBe(100000) // repeated monthly, not additive
    expect(p.lossRatio).toBeCloseTo(0.2)
    expect(p.claimCount).toBe(4)
  })

  it('returns a NULL loss ratio when the premium is unknown, never a flattering 0', () => {
    const l = lossRatios({
      lossRuns: [{ policy_no: 'X-1', policy_year: '2026', paid_amount: 50000, outstanding_amount: 0, premium: null, is_total: false }],
      schedule: [],
    })
    const p = l.byPolicy[0]
    expect(p.incurred).toBe(50000)
    expect(p.lossRatio).toBeNull()
    expect(p.basis).toBe('premium_unknown')
  })

  it('falls back to the claim register when no loss runs exist, and says so', () => {
    const l = lossRatios({ lossRuns: [], claims: CLAIMS, schedule: SCHEDULE })
    expect(l.fromInsurerLossRuns).toBe(false)
    expect(l.source).toBe('claim_register')
    const p = l.byPolicy.find((x) => x.key === 'CMI-1')
    expect(p.incurred).toBe(20000)
    expect(p.premium).toBe(15000) // summed from the CMI-1 schedule lines
  })
})

describe('claimStats', () => {
  const s = claimStats({ claims: CLAIMS, fleet: FLEET, country: 'KSA' })

  it('groups frequency and severity by asset, site, cause and driver', () => {
    expect(s.claimCount).toBe(3)
    expect(s.byAsset.find((x) => x.key === 'TM655').claimCount).toBe(2)
    expect(s.bySite.find((x) => x.key === 'DIRIYAH-G1').claimCount).toBe(2)
    expect(s.byCause.find((x) => x.key === 'Collision').totalIncurred).toBe(20000)
    expect(s.byDriver.find((x) => x.key === 'A. Khan').claimCount).toBe(2)
  })

  it('averages severity over the claims that carry a value, and publishes that count', () => {
    // CLM-3 has no amount at all: including it as 0 would halve the average and
    // invent a cheap claim.
    expect(s.valuedCount).toBe(2)
    expect(s.avgSeverity).toBe(10000)
    const overturn = s.byCause.find((x) => x.key === 'Overturn')
    expect(overturn.totalIncurred).toBeNull()
    expect(overturn.avgSeverity).toBeNull()
  })

  it('returns null frequency when there is nothing to divide by', () => {
    expect(claimStats({ claims: [], fleet: FLEET, country: 'KSA' }).frequencyPerAsset).toBeNull()
    expect(claimStats({ claims: CLAIMS, fleet: [], country: 'KSA' }).frequencyPerAsset).toBeNull()
  })
})

describe('repeatOffenders', () => {
  it('lists assets and drivers on two or more claims, excluding unattributed rows', () => {
    const r = repeatOffenders({ claims: CLAIMS, fleet: FLEET, country: 'KSA' })
    expect(r.assets.map((a) => a.key)).toEqual(['TM655'])
    expect(r.drivers.map((d) => d.key)).toEqual(['A. Khan'])
    expect(r.assets.every((a) => a.key !== '(not stated)')).toBe(true)
  })
})

describe('renewalExposure', () => {
  it('separates expiring from already expired and counts the machines on each', () => {
    const r = renewalExposure({ schedule: SCHEDULE, now: NOW, days: RENEWAL_WINDOW_DAYS })
    const cmi = r.expiring.find((x) => x.policy_no === 'CMI-1')
    expect(cmi.assetCount).toBe(2)
    expect(cmi.sumInsured.total).toBe(500000)
    expect(cmi.daysToExpiry).toBeGreaterThan(0)
    // CPM-2 ends 2026-12-31, outside a 60 day window.
    expect(r.expiring.some((x) => x.policy_no === 'CPM-2')).toBe(false)

    const past = renewalExposure({ schedule: SCHEDULE, now: Date.parse('2026-10-01T00:00:00Z') })
    expect(past.expired.some((x) => x.policy_no === 'CMI-1')).toBe(true)
  })

  it('counts rows with no expiry date rather than treating them as safe', () => {
    expect(renewalExposure({ schedule: [{ policy_no: 'P', cover_to: null }], now: NOW }).undated).toBe(1)
  })
})

describe('premiumEfficiency', () => {
  it('gives premium per asset and the rate per 1,000 of sum insured', () => {
    const e = premiumEfficiency({ schedule: SCHEDULE })
    expect(e.overall.premiumPerAsset).toBeCloseTo(21000 / 4)
    expect(e.overall.ratePer1000).toBeCloseTo((21000 / 650000) * 1000)
    expect(e.byCoverType.find((x) => x.key === 'CMI').premiumPerAsset).toBe(7500)
  })

  it('withholds the rate entirely when currencies are mixed', () => {
    const e = premiumEfficiency({
      schedule: [
        { cover_type: 'CMI', premium: 100, sum_insured: 1000, currency: 'SAR' },
        { cover_type: 'CMI', premium: 100, sum_insured: 1000, currency: 'AED' },
      ],
    })
    expect(e.overall.premiumPerAsset).toBeNull()
    expect(e.overall.ratePer1000).toBeNull()
    expect(e.overall.basis).toBe('mixed_currency')
  })

  it('says so when no premium was recorded, instead of reporting a rate of 0', () => {
    const e = premiumEfficiency({ schedule: [{ cover_type: 'CPM', premium: null, sum_insured: 500 }] })
    expect(e.overall.premiumPerAsset).toBeNull()
    expect(e.overall.basis).toBe('no_premium_recorded')
  })
})

describe('claimAccidentGap', () => {
  const ACCIDENTS = [
    { id: 'a1', asset_no: 'TM655', incident_date: '2026-03-10', insurance_claim_no: 'CLM-1', claim_amount: 12000 },
    { id: 'a2', asset_no: 'TM736', incident_date: '2026-07-20', insurance_claim_no: null, claim_amount: 4000 },
    { id: 'a3', asset_no: 'MP083', incident_date: '2026-07-25', insurance_claim_no: null, claim_amount: 0 },
  ]

  it('finds claims the fleet never logged and accidents the insurer never saw', () => {
    // Claims are chassis-keyed, so the fleet must be supplied to resolve them.
    const g = claimAccidentGap({ claims: CLAIMS, accidents: ACCIDENTS, fleet: FLEET, country: 'KSA' })
    expect(g.linkedCount).toBe(1) // CLM-1 -> a1
    // CLM-2 names an asset with no accident anywhere near its date.
    expect(g.claimsWithoutAccident.map((c) => c.claim_no)).toContain('CLM-2')
    // a2 carries a claim amount but no register entry; a3 has no claim amount.
    expect(g.accidentsWithoutClaim.map((a) => a.id)).toEqual(['a2'])
  })

  it('holds rows it could not resolve OUT of both gap lists', () => {
    // No asset and no date: unresolvable, and therefore not evidence of anything.
    const g = claimAccidentGap({ claims: [{ id: 'x', claim_no: 'Z', asset_no: null, accident_date: null }], accidents: ACCIDENTS })
    expect(g.claimsWithoutAccident).toHaveLength(0)
    expect(g.unresolved).toHaveLength(1)
  })

  it('reports a null link rate when there is nothing to reconcile', () => {
    expect(claimAccidentGap({ claims: [], accidents: [] }).linkRate).toBeNull()
  })
})

describe('buildInsurancePortfolio', () => {
  it('composes every section and flags that there is data', () => {
    const p = buildInsurancePortfolio({ fleet: FLEET, schedule: SCHEDULE, claims: CLAIMS, accidents: [], country: 'KSA', now: NOW })
    expect(p.hasData).toBe(true)
    expect(p.coverage.insuredCount).toBe(2)
    expect(p.claims.claimCount).toBe(3)
    expect(p.value.total.total).toBe(650000)
  })

  it('degrades to an honest empty shape with NO fabricated zeros when nothing is loaded', () => {
    const p = buildInsurancePortfolio({ now: NOW })
    expect(p.hasData).toBe(false)
    expect(p.coverage.coveragePct).toBeNull()
    expect(p.claims.frequencyPerAsset).toBeNull()
    expect(p.claims.totalIncurred).toBeNull()
    expect(p.gap.linkRate).toBeNull()
    expect(p.efficiency.overall.premiumPerAsset).toBeNull()
    expect(p.loss.byPolicy).toEqual([])
  })
})
