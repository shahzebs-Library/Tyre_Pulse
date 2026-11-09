import { describe, it, expect } from 'vitest'
import {
  toLifetimeTyres, lifetimeCpk, fullLifetimeCpk, weightedCpk, lifetimeSummary,
  splitFinalProvisional, fromLifetimeView, isActiveTyreStatus, tyreKey, CPK_KIND, CPK_KIND_LABEL,
} from '../lib/tyreLifetime'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const fit = (o) => ({ country: 'KSA', vehicle_type: 'TRUCK', qty: 1, status: 'Removed', ...o })

describe('physical tyre lifetime (Phase 1)', () => {
  it('one tyre on three vehicles: km accumulates to 80,000 and the price counts once', () => {
    const [t] = toLifetimeTyres([
      fit({ id: 'a', serial_no: 'YMA55310', asset_no: 'TM1', issue_date: '2025-01-01', removal_date: '2025-04-01', km_at_fitment: 10000, km_at_removal: 50000, cost_per_tyre: 900 }),
      fit({ id: 'b', serial_no: 'YMA55310', asset_no: 'TM2', issue_date: '2025-05-01', removal_date: '2025-08-01', km_at_fitment: 200000, km_at_removal: 225000 }),
      fit({ id: 'c', serial_no: ' yma55310 ', asset_no: 'TM3', issue_date: '2025-09-01', removal_date: '2025-12-01', km_at_fitment: 5000, km_at_removal: 20000 }),
    ])
    expect(t._life_km).toBe(80000)
    expect(t._cost).toBe(900)
    expect(t._fitments).toBe(3)
    expect(t._vehicles).toBe(3)
    expect(t._km_coverage).toBe('complete')
    expect(t._provisional).toBe(false)
    expect(lifetimeCpk(t)).toBeCloseTo(900 / 80000, 10)
  })

  it('a refit on the same vehicle is not a second purchase', () => {
    const [t] = toLifetimeTyres([
      fit({ id: 'a', serial_no: 'EP0604207', asset_no: 'TM1', issue_date: '2025-01-01', removal_date: '2025-03-01', km_at_fitment: 1000, km_at_removal: 21000, cost_per_tyre: 800 }),
      fit({ id: 'b', serial_no: 'EP0604207', asset_no: 'TM1', issue_date: '2025-06-01', removal_date: '2025-09-01', km_at_fitment: 40000, km_at_removal: 60000, cost_per_tyre: 800 }),
    ])
    expect(t._cost).toBe(800)
    expect(t._life_km).toBe(40000)
    expect(t._cost_status).toBe('DISPUTED') // priced twice: a person decides (T2); the first price is used
  })

  it('an overlapping fitment (same km recorded twice) is excluded and flagged', () => {
    const [t] = toLifetimeTyres([
      fit({ id: 'a', serial_no: 'A208575333', asset_no: 'TM475', issue_date: '2025-09-08', removal_date: '2026-03-26', km_at_fitment: 100679, km_at_removal: 114443, cost_per_tyre: 950 }),
      fit({ id: 'b', serial_no: 'A208575333', asset_no: 'TM475', issue_date: '2025-09-09', removal_date: '2026-08-26', km_at_fitment: 100680, km_at_removal: 122741 }),
    ])
    expect(t._life_km).toBe(13764)
    expect(t._overlapping_fitments).toBe(1)
    expect(t._km_coverage).toBe('partial')
    expect(t._provisional).toBe(true)
  })

  it('a later fitment while the earlier one is still active overlaps (unclosed rotation)', () => {
    const [t] = toLifetimeTyres([
      fit({ id: 'a', serial_no: 'FC42629DX', status: 'Active', issue_date: '2026-04-01', km_at_fitment: 94317 }),
      fit({ id: 'b', serial_no: 'FC42629DX', status: 'Active', issue_date: '2026-05-01', km_at_fitment: 95000 }),
    ])
    expect(t._overlapping_fitments).toBe(1)
    expect(t._active).toBe(true)
  })

  it('same-day back-to-back stints do not overlap', () => {
    const [t] = toLifetimeTyres([
      fit({ id: 'a', serial_no: 'YMT93964', issue_date: '2025-01-01', removal_date: '2025-06-01', km_at_fitment: 1000, km_at_removal: 11000 }),
      fit({ id: 'b', serial_no: 'YMT93964', issue_date: '2025-06-01', removal_date: '2025-09-01', km_at_fitment: 50000, km_at_removal: 55000 }),
    ])
    expect(t._overlapping_fitments).toBe(0)
    expect(t._life_km).toBe(15000)
  })

  it('placeholder fitment km 1 is unknown, factory 0 is real, over-cap is unknown (T7)', () => {
    const [ph] = toLifetimeTyres([fit({ id: 'p', serial_no: 'PH123456', km_at_fitment: 1, km_at_removal: 230000, removal_date: '2025-01-01', cost_per_tyre: 900 })])
    expect(ph._life_km).toBeNull()
    expect(ph._km_coverage).toBe('none')
    expect(lifetimeCpk(ph)).toBeNull()
    const [fz] = toLifetimeTyres([fit({ id: 'f', serial_no: 'FZ123456', km_at_fitment: 0, km_at_removal: 42000, removal_date: '2025-01-01', cost_per_tyre: 900 })])
    expect(fz._life_km).toBe(42000)
    const [oc] = toLifetimeTyres([fit({ id: 'o', serial_no: 'OC123456', vehicle_type: 'TR-MIXER', km_at_fitment: 100, km_at_removal: 90100, removal_date: '2025-01-01', cost_per_tyre: 900 })])
    expect(oc._life_km).toBeNull()
  })

  it('a missing km on one of two stints reports the known part as partial, never complete', () => {
    const [t] = toLifetimeTyres([
      fit({ id: 'a', serial_no: 'MK123456', issue_date: '2025-01-01', removal_date: '2025-03-01', km_at_fitment: 1000, km_at_removal: 21000, cost_per_tyre: 700 }),
      fit({ id: 'b', serial_no: 'MK123456', issue_date: '2025-04-01', removal_date: '2025-06-01' }),
    ])
    expect(t._life_km).toBe(20000)
    expect(t._km_unknown_fitments).toBe(1)
    expect(t._km_coverage).toBe('partial')
  })

  it('cost statuses: missing, estimated, warranty zero', () => {
    const [m] = toLifetimeTyres([fit({ id: 'm', serial_no: 'NP123456', km_at_fitment: 10, km_at_removal: 10010, removal_date: '2025-01-01' })])
    expect(m._cost_status).toBe('MISSING')
    expect(m._cost).toBeNull()
    const [e] = toLifetimeTyres([fit({ id: 'e', serial_no: 'ES123456', cost_per_tyre: 714.71, price_source: 'comparable' })])
    expect(e._cost_status).toBe('ESTIMATED')
    const [w] = toLifetimeTyres([fit({ id: 'w', serial_no: 'WZ123456', cost_per_tyre: 0, price_source: 'warranty' })])
    expect(w._cost_status).toBe('CONFIRMED_ZERO')
  })

  it('full lifetime CPK adds linked repairs and retreads and subtracts recoveries', () => {
    const rows = [fit({ id: 'a', serial_no: 'RT123456', km_at_fitment: 1000, km_at_removal: 101000, removal_date: '2025-01-01', cost_per_tyre: 1000 })]
    const [t] = toLifetimeTyres(rows, { extras: { 'KSA|RT123456': { repair: 50, retread: 400, recovery: 150 } } })
    expect(t._full_cost).toBe(1300)
    expect(lifetimeCpk(t)).toBeCloseTo(0.01, 10)
    expect(fullLifetimeCpk(t)).toBeCloseTo(0.013, 10)
    // a repair never becomes a purchase price
    expect(t._cost).toBe(1000)
  })

  it('weak serial is its own tyre and its quantity is honoured; invalid serial never groups', () => {
    const tyres = toLifetimeTyres([
      fit({ id: 'x', serial_no: 'DOT18E56', qty: 4, km_at_fitment: 10, km_at_removal: 20010, removal_date: '2025-01-01', cost_per_tyre: 500 }),
      fit({ id: 'y', serial_no: 'DOT18E56', qty: 2, km_at_fitment: 10, km_at_removal: 10010, removal_date: '2025-01-01', cost_per_tyre: 500 }),
    ])
    expect(tyres).toHaveLength(2)
    expect(tyres.map((t) => t._qty).sort()).toEqual([2, 4])
  })

  it('fleet CPK is weighted (total cost / total km), never an average of ratios', () => {
    const tyres = toLifetimeTyres([
      fit({ id: 'a', serial_no: 'WA123456', km_at_fitment: 10, km_at_removal: 1010, removal_date: '2025-01-01', cost_per_tyre: 1000 }),
      fit({ id: 'b', serial_no: 'WB123456', km_at_fitment: 10, km_at_removal: 99010, removal_date: '2025-01-01', cost_per_tyre: 1000 }),
    ])
    expect(weightedCpk(tyres)).toBeCloseTo(2000 / 100000, 10)
    const s = lifetimeSummary(tyres)
    expect(s.cpkPurchase).toBeCloseTo(0.02, 10)
    expect(s.measurable).toBe(2)
    expect(s.coverage.complete).toBe(2)
  })

  it('summary states the estimated share of the cost behind the CPK', () => {
    const tyres = toLifetimeTyres([
      fit({ id: 'a', serial_no: 'SA123456', km_at_fitment: 10, km_at_removal: 50010, removal_date: '2025-01-01', cost_per_tyre: 600, price_source: 'comparable' }),
      fit({ id: 'b', serial_no: 'SB123456', km_at_fitment: 10, km_at_removal: 50010, removal_date: '2025-01-01', cost_per_tyre: 400 }),
    ])
    const s = lifetimeSummary(tyres)
    expect(s.estimatedCostInCpk).toBe(600)
    expect(s.estimatedShare).toBeCloseTo(0.6, 10)
  })

  it('active tyres are provisional and kept apart from final ones', () => {
    const tyres = toLifetimeTyres([
      fit({ id: 'a', serial_no: 'AC123456', status: 'Active', km_at_fitment: 10, total_km: 5000, cost_per_tyre: 600 }),
      fit({ id: 'b', serial_no: 'RM123456', km_at_fitment: 10, km_at_removal: 50010, removal_date: '2025-01-01', cost_per_tyre: 600 }),
    ])
    const { final, provisional } = splitFinalProvisional(tyres)
    expect(final).toHaveLength(1)
    expect(provisional).toHaveLength(1)
    expect(provisional[0]._provisional).toBe(true)
  })

  it('hour-based assets: tyre km and engine hours stay separate (no hours read)', () => {
    const [t] = toLifetimeTyres([fit({ id: 'h', serial_no: 'HR123456', vehicle_type: 'WHEEL LOADER', hrs_at_fitment: 100, hrs_at_removal: 900, removal_date: '2025-01-01', cost_per_tyre: 3000 })])
    expect(t._life_km).toBeNull()
  })

  it('status and key helpers mirror the SQL definitions', () => {
    expect(isActiveTyreStatus('Active')).toBe(true)
    expect(isActiveTyreStatus('Removed')).toBe(false)
    expect(isActiveTyreStatus('Scrapped')).toBe(false)
    expect(isActiveTyreStatus('')).toBe(false)
    expect(tyreKey({ country: 'ksa', serial_no: ' ym123456 ' })).toBe('KSA|YM123456')
    expect(tyreKey({ id: 'z', serial_no: 'NO SERIAL' })).toBe('row:z')
  })

  it('a v_tyre_lifetime row maps onto the same shape', () => {
    const t = fromLifetimeView({ tyre_key: 'KSA|X1234567', latest_id: 'r1', purchase_cost: 900, purchase_cost_status: 'ACTUAL', km_known: 45000, qty: 1, fitments: 2, vehicles: 2, km_coverage: 'complete', is_active: false, provisional: false, full_cost: 900 })
    expect(lifetimeCpk(t)).toBeCloseTo(0.02, 10)
    expect(t._fitments).toBe(2)
  })

  it('the five CPK measurements have distinct labels', () => {
    expect(Object.values(CPK_KIND)).toHaveLength(5)
    expect(new Set(Object.values(CPK_KIND_LABEL)).size).toBe(5)
  })

  it('SQL mirror: the migration defines the same key, km rule, overlap and status vocabulary', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261109160000_tyre_physical_lifetime_cpk.sql'), 'utf8')
    expect(sql).toMatch(/tyre_serial_is_strong\(t\.serial_no\)/)
    expect(sql).toMatch(/tyre_km_life\(t\.km_at_fitment, t\.km_at_removal, t\.total_km, t\.vehicle_type\)/)
    expect(sql).toMatch(/order by fit_date nulls first, id/)
    expect(sql).toMatch(/not fl\.is_overlap/)
    for (const s of ['ACTUAL', 'ESTIMATED', 'CONFIRMED_ZERO', 'DISPUTED', 'MISSING']) expect(sql).toContain(`'${s}'`)
  })
})
