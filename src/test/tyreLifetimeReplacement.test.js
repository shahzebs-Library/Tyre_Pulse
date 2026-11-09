import { describe, it, expect } from 'vitest'
import { isStrongSerial, toLifetimeTyres, weightedCpk, lifetimeCpk } from '../lib/tyreLifetime'
import { chainFitmentsPerWheel, wheelKey, summariseReconcile } from '../lib/tyreReplacement'
import { computeCpkFleet, computeAvgTyreLife } from '../lib/kpiEngine'

describe('isStrongSerial', () => {
  it('accepts real serials and rejects shared codes', () => {
    expect(isStrongSerial('YMA55312')).toBe(true)
    expect(isStrongSerial('2436326847')).toBe(true)
    expect(isStrongSerial('DOT18E56')).toBe(false)
    expect(isStrongSerial('315/80R22.5')).toBe(false)
    expect(isStrongSerial('1.25121E+11')).toBe(false)
    expect(isStrongSerial('NULL')).toBe(false)
    expect(isStrongSerial('AB12')).toBe(false)
    expect(isStrongSerial('NO SERIAL')).toBe(false)
    expect(isStrongSerial('NOT CLEAR')).toBe(false)
    expect(isStrongSerial('#NAME?')).toBe(false)
  })
})

describe('toLifetimeTyres - one tyre, one price, cumulative km', () => {
  const refit = [
    { serial_no: 'YMA55312', country: 'KSA', asset_no: 'TM1', issue_date: '2026-01-01', km_at_fitment: 1000, km_at_removal: 21000, removal_date: '2026-03-01', cost_per_tyre: 1200, vehicle_type: 'TR-MIXER' },
    { serial_no: 'YMA55312', country: 'KSA', asset_no: 'TM2', issue_date: '2026-04-01', km_at_fitment: 50000, km_at_removal: 60000, removal_date: '2026-06-01', cost_per_tyre: 1200, vehicle_type: 'TR-MIXER' },
  ]
  it('charges the purchase once and sums km over both fitments', () => {
    const [t] = toLifetimeTyres(refit)
    expect(t._cost).toBe(1200)
    expect(t._life_km).toBe(30000)
    expect(t._fitments).toBe(2)
    expect(t._vehicles).toBe(2)
    expect(t.asset_no).toBe('TM2')
    expect(lifetimeCpk(t)).toBeCloseTo(0.04, 6)
  })
  it('fleet CPK no longer double charges a refitted tyre', () => {
    const k = computeCpkFleet(refit)
    expect(k.validCount).toBe(1)
    expect(k.fitmentRows).toBe(2)
    expect(k.fleetAvgCpk).toBeCloseTo(0.04, 6)
  })
  it('does not merge rows that share a batch code', () => {
    const weak = [
      { serial_no: 'DOT18E56', asset_no: 'A', km_at_fitment: 100, km_at_removal: 10100, cost_per_tyre: 500 },
      { serial_no: 'DOT18E56', asset_no: 'B', km_at_fitment: 100, km_at_removal: 20100, cost_per_tyre: 500 },
    ]
    expect(toLifetimeTyres(weak)).toHaveLength(2)
  })
  it('placeholder "1" fitment km is unknown, never counted', () => {
    const [t] = toLifetimeTyres([{ serial_no: 'ABC12345', km_at_fitment: 1, km_at_removal: 250000, total_km: 249999, cost_per_tyre: 900 }])
    expect(t._life_km).toBeNull()
  })
  it('weighted fleet CPK is total cost / total km, not an average of ratios', () => {
    const tyres = toLifetimeTyres([
      { serial_no: 'AAA11111', km_at_fitment: 10, km_at_removal: 1010, cost_per_tyre: 1000 },   // 1.0 / km
      { serial_no: 'BBB22222', km_at_fitment: 10, km_at_removal: 99010, cost_per_tyre: 1000 },  // 0.0101 / km
    ])
    expect(weightedCpk(tyres)).toBeCloseTo(2000 / 100000, 8)
  })
  it('average tyre life is per physical tyre', () => {
    expect(computeAvgTyreLife(refit).avgKm).toBe(30000)
  })
  it('no measurable tyre returns null, not zero', () => {
    expect(computeCpkFleet([{ serial_no: 'AAA11111' }]).fleetAvgCpk).toBeNull()
  })
})

describe('chainFitmentsPerWheel - latest upload is what is on the wheel', () => {
  it('closes earlier same-wheel fitments at the next fitting date and km', () => {
    const { rows, chained, latest } = chainFitmentsPerWheel([
      { asset_no: 'tm 1', position: 'LHF1', serial_no: 'B', issue_date: '2026-03-01', km_at_fitment: 5000 },
      { asset_no: 'TM1', position: 'LHF1', serial_no: 'A', issue_date: '2026-01-01', km_at_fitment: 1000 },
      { asset_no: 'TM1', position: 'RHF1', serial_no: 'C', issue_date: '2026-02-01' },
    ])
    expect(chained).toBe(1)
    const a = rows.find((r) => r.serial_no === 'A')
    expect(a.removal_date).toBe('2026-03-01')
    expect(a.status).toBe('Removed')
    expect(a.km_at_removal).toBe(5000)
    expect(latest.map((r) => r.serial_no).sort()).toEqual(['B', 'C'])
  })
  it('never invents a removal km from a placeholder reading', () => {
    const { rows } = chainFitmentsPerWheel([
      { asset_no: 'TM1', position: 'LHF1', serial_no: 'A', issue_date: '2026-01-01', km_at_fitment: 1000 },
      { asset_no: 'TM1', position: 'LHF1', serial_no: 'B', issue_date: '2026-02-01', km_at_fitment: 1 },
    ])
    expect(rows[0].km_at_removal).toBeUndefined()
  })
  it('leaves removed rows and rows without a wheel alone', () => {
    const { chained } = chainFitmentsPerWheel([
      { asset_no: 'TM1', position: 'LHF1', issue_date: '2026-01-01', removal_date: '2026-02-01' },
      { asset_no: '', position: 'LHF1', issue_date: '2026-01-01' },
    ])
    expect(chained).toBe(0)
    expect(wheelKey({ asset_no: 'TM1', position: '0' })).toBe('')
  })
  it('summarises the database result', () => {
    expect(summariseReconcile({ counts: { closed: 3, no_previous: 2, ambiguous_backdated: 1 }, moved_from_other_vehicle: 1 }))
      .toEqual({ total: 6, closed: 3, emptyWheel: 2, review: 1, moved: 1 })
  })
})
